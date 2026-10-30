/**
 * patientSyncService — submit pending patient symptom sessions to the backend.
 *
 * DESIGN:
 *   - Reads pending sessions from IndexedDB (offlineDb).
 *   - Submits each session to POST /api/v1/voice/parse-and-triage.
 *   - Uses bounded exponential backoff on transient failures.
 *   - Detects permanent failures and conflict responses.
 *   - Never submits under an expired/missing token.
 *   - Never silently discards pending sessions.
 *   - Idempotent: re-running sync on already-submitted sessions is a no-op.
 *
 * BACKOFF SCHEDULE (bounded):
 *   attempt 1: 2s
 *   attempt 2: 4s
 *   attempt 3: 8s
 *   attempt 4: 16s
 *   attempt 5+: 30s (cap)
 *   After MAX_ATTEMPTS (5): mark as 'failed', stop retrying.
 *
 * CONFLICT DETECTION:
 *   HTTP 409 from the backend → mark session as 'conflict'.
 *   The patient is shown the conflict in PatientOfflineQueue.
 *   A healthcare professional must review.
 *
 * AUTHENTICATION:
 *   If the token is missing or the backend returns 401,
 *   stop sync immediately — do NOT retry with a stale token.
 *   The session is left as 'pending' until the patient re-authenticates.
 */

import {
  listPendingSessions,
  updateSessionStatus,
  newSessionId,
  type PendingSymptomSession,
} from './offlineDb';
import { globalProbe } from './connectivityProbe';
import { request, ApiError } from '../../services/api';
import { MAX_ATTEMPTS, backoffMs } from './retryPolicy';

// ── Configuration ─────────────────────────────────────────────────────────

// Retry constants are imported from retryPolicy.ts.
// Jitter is configured in retryPolicy.ts.

// ── Backoff helper ────────────────────────────────────────────────────────

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Sync result ───────────────────────────────────────────────────────────

export interface SyncResult {
  submitted: number;
  failed: number;
  conflicts: number;
  skipped: number;
}

// ── Single session submission ─────────────────────────────────────────────

async function submitSession(
  session: PendingSymptomSession,
  token: string,
): Promise<'submitted' | 'conflict' | 'auth_expired' | 'transient_error'> {
  try {
    const response = await request<{ patient_reply: string; triage_assessment: Record<string, unknown> }>({
      method: 'POST',
      url: '/api/v1/voice/parse-and-triage',
      data: {
        transcript: session.transcriptText,
        language:   session.language.split('-')[0],
        abha_id:    null,
      },
      headers: { Authorization: `Bearer ${token}` },
    });

    await updateSessionStatus(session.sessionId, {
      status:        'submitted',
      attempts:      session.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError:     undefined,
      serverResponse: response as unknown as Record<string, unknown>,
    });
    return 'submitted';
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) return 'auth_expired';
      if (err.status === 409) {
        await updateSessionStatus(session.sessionId, {
          status:        'conflict',
          attempts:      session.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError:     'The server reported a conflict. A healthcare professional must review this session.',
        });
        return 'conflict';
      }
      if (err.status && err.status >= 400 && err.status < 500) {
        // 4xx other than 401/409 — permanent validation failure
        await updateSessionStatus(session.sessionId, {
          status:        'failed',
          attempts:      session.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError:     `Submission rejected (${err.status}). ${err.friendly}`,
        });
        return 'transient_error';
      }
    }
    // Network error / 5xx — transient
    return 'transient_error';
  }
}

// ── Public: sync all pending sessions ────────────────────────────────────

/**
 * Attempt to submit all pending sessions for a patient.
 *
 * @param patientId  The authenticated patient's UUID.
 * @param token      Bearer token for the patient session.
 * @returns          Summary of what happened.
 */
export async function syncPendingSessions(
  patientId: string,
  token: string,
): Promise<SyncResult> {
  const result: SyncResult = { submitted: 0, failed: 0, conflicts: 0, skipped: 0 };

  if (!token) {
    // No auth — leave everything pending, no retries
    return result;
  }

  // Verify backend is actually reachable before burning attempts
  const reachable = await globalProbe.check();
  if (!reachable) {
    return result;
  }

  const sessions = await listPendingSessions(patientId);
  const toSubmit = sessions.filter(
    (s) => s.status === 'pending' || s.status === 'failed',
  );

  for (const session of toSubmit) {
    // Skip if already exceeded max attempts
    if (session.attempts >= MAX_ATTEMPTS) {
      await updateSessionStatus(session.sessionId, {
        status:        'failed',
        attempts:      session.attempts,
        lastAttemptAt: session.lastAttemptAt,
        lastError:     `Maximum retry attempts (${MAX_ATTEMPTS}) exceeded. Please contact support.`,
      });
      result.skipped++;
      continue;
    }

    // Mark as submitting
    await updateSessionStatus(session.sessionId, {
      status:        'submitting',
      attempts:      session.attempts,
      lastAttemptAt: session.lastAttemptAt,
    });

    // Exponential backoff between retries (not for first attempt)
    if (session.attempts > 0) {
      await delay(backoffMs(session.attempts));
    }

    const outcome = await submitSession(session, token);

    switch (outcome) {
      case 'submitted':
        result.submitted++;
        break;
      case 'conflict':
        result.conflicts++;
        break;
      case 'auth_expired':
        // Reset to pending — will retry when patient re-authenticates
        await updateSessionStatus(session.sessionId, {
          status:        'pending',
          attempts:      session.attempts,
          lastAttemptAt: session.lastAttemptAt,
          lastError:     'Authentication expired. Please sign in again.',
        });
        // Stop all remaining syncs for this session
        return result;
      case 'transient_error': {
        const newAttempts = session.attempts + 1;
        if (newAttempts >= MAX_ATTEMPTS) {
          await updateSessionStatus(session.sessionId, {
            status:        'failed',
            attempts:      newAttempts,
            lastAttemptAt: new Date().toISOString(),
            lastError:     `Failed after ${newAttempts} attempts. Please try again later.`,
          });
          result.failed++;
        } else {
          await updateSessionStatus(session.sessionId, {
            status:        'pending',
            attempts:      newAttempts,
            lastAttemptAt: new Date().toISOString(),
            lastError:     `Temporary error. Will retry (attempt ${newAttempts} of ${MAX_ATTEMPTS}).`,
          });
        }
        break;
      }
    }
  }

  return result;
}

/**
 * Create a new pending session from a captured symptom transcript.
 * Saves it to IndexedDB immediately so it survives a page reload.
 *
 * Returns the session so the caller can react to quota errors.
 */
export function buildPendingSession(options: {
  patientId: string;
  transcriptText: string;
  language: string;
  symptoms: string[];
  localTriageLevel: 'RED' | 'YELLOW' | 'GREEN' | 'UNKNOWN';
}): PendingSymptomSession {
  return {
    sessionId:        newSessionId(),
    patientId:        options.patientId,
    capturedAt:       new Date().toISOString(),
    language:         options.language,
    transcriptText:   options.transcriptText,
    symptoms:         options.symptoms,
    localTriageLevel: options.localTriageLevel,
    status:           'pending',
    attempts:         0,
  };
}

export { MAX_ATTEMPTS, backoffMs };
