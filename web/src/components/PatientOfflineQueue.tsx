/**
 * PatientOfflineQueue — patient-facing pending-changes panel.
 *
 * Shows the patient a list of symptom sessions captured offline that are
 * waiting to be submitted to the backend. The panel is shown inside
 * PatientHome when there are pending records.
 *
 * WHAT IT DOES:
 *   - Lists pending / failed / conflict sessions scoped to the authenticated patient.
 *   - Shows status badges: Pending / Submitting / Failed / Conflict
 *   - Lets the patient dismiss submitted or permanently-failed sessions.
 *   - Warns before dismissing sessions that have never been submitted.
 *   - Does NOT allow editing clinical content (that would require a doctor).
 *   - Links to the deterministic triage result that was saved locally.
 *
 * WHAT IT DOES NOT DO:
 *   - Does not expose raw JSON or stack traces to the patient.
 *   - Does not allow submitting under a different patient's account.
 *   - Does not automatically retry — retries are handled by
 *     PatientSyncService (C-8).
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  WifiOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '../lib/cn';
import {
  listPendingSessions,
  deleteSession,
  type PendingSymptomSession,
  type PendingSessionStatus,
} from '../lib/offline/offlineDb';
import { useConnectivity } from '../lib/offline/connectivity';

interface PatientOfflineQueueProps {
  patientId: string;
  language: string;
  /** Called when the user taps "Retry" so the parent can trigger a sync. */
  onRetrySync?: () => void;
}

// ── Labels ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<PendingSessionStatus, Record<string, string>> = {
  pending:    { 'kn-IN': 'ಕಾಯುತ್ತಿದೆ', en: 'Pending'    },
  submitting: { 'kn-IN': 'ಕಳಿಸುತ್ತಿದೆ', en: 'Sending'    },
  submitted:  { 'kn-IN': 'ಕಳಿಸಲಾಗಿದೆ', en: 'Submitted'  },
  failed:     { 'kn-IN': 'ದೋಷ',         en: 'Failed'     },
  conflict:   { 'kn-IN': 'ತಾಕಲಾಟ',      en: 'Conflict'   },
};

const TRIAGE_LABEL: Record<string, Record<string, string>> = {
  RED:     { 'kn-IN': 'ತುರ್ತು',   en: 'Urgent'  },
  YELLOW:  { 'kn-IN': 'ಮಧ್ಯಮ',   en: 'Moderate'},
  GREEN:   { 'kn-IN': 'ಸ್ಥಿರ',    en: 'Stable'  },
  UNKNOWN: { 'kn-IN': 'ತಿಳಿದಿಲ್ಲ', en: 'Unknown' },
};

function label(map: Record<string, string>, lang: string): string {
  return map[lang] ?? map['en'] ?? Object.values(map)[0] ?? '';
}

function formatDate(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleString(lang, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Status badge ──────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<PendingSessionStatus, string> = {
  pending:    'pq-badge pq-badge--amber',
  submitting: 'pq-badge pq-badge--blue',
  submitted:  'pq-badge pq-badge--green',
  failed:     'pq-badge pq-badge--red',
  conflict:   'pq-badge pq-badge--red',
};

const STATUS_ICONS: Record<PendingSessionStatus, React.ElementType> = {
  pending:    Clock,
  submitting: RefreshCw,
  submitted:  CheckCircle2,
  failed:     AlertTriangle,
  conflict:   AlertTriangle,
};

// ── Component ─────────────────────────────────────────────────────────────

export function PatientOfflineQueue({
  patientId,
  language,
  onRetrySync,
}: PatientOfflineQueueProps) {
  const isKn = language.startsWith('kn');
  const { online } = useConnectivity();

  const [sessions, setSessions]   = useState<PendingSymptomSession[]>([]);
  const [expanded, setExpanded]   = useState(false);
  const [loading, setLoading]     = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listPendingSessions(patientId);
      setSessions(list);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void reload(); }, [reload]);

  // ── Dismiss a session ───────────────────────────────────────────────────
  async function handleDismiss(session: PendingSymptomSession) {
    if (session.status === 'pending' || session.status === 'submitting') {
      const confirmMsg = isKn
        ? 'ಈ ಮಾಹಿತಿ ಇನ್ನೂ ಕಳಿಸಲಾಗಿಲ್ಲ. ಅಳಿಸಿ ಹಾಕಲಾ?'
        : 'This session has not been submitted. Delete it permanently?';
      if (!window.confirm(confirmMsg)) return;
    }
    await deleteSession(session.sessionId);
    await reload();
  }

  const unresolved = sessions.filter(
    (s) => s.status === 'pending' || s.status === 'failed' || s.status === 'conflict',
  );

  if (loading) return null;
  if (sessions.length === 0) return null;

  return (
    <div className="pq-root">
      {/* Header row */}
      <button
        type="button"
        className="pq-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="pq-list"
      >
        <span className="pq-header-left">
          {unresolved.length > 0 ? (
            <Clock className="h-4 w-4 text-amber-600" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          )}
          <span className="pq-header-title">
            {isKn
              ? `${unresolved.length} ದಾಖಲೆ ಕಾಯುತ್ತಿದೆ`
              : `${unresolved.length} record${unresolved.length === 1 ? '' : 's'} pending`}
          </span>
          {!online && (
            <span className="pq-offline-chip">
              <WifiOff className="h-3 w-3" aria-hidden="true" />
              {isKn ? 'Offline' : 'Offline'}
            </span>
          )}
        </span>
        {expanded
          ? <ChevronUp  className="h-4 w-4 text-slate-400" aria-hidden="true" />
          : <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />}
      </button>

      {/* Expandable list */}
      {expanded && (
        <div id="pq-list" className="pq-list">
          {/* Retry button when online and there are failures */}
          {online && unresolved.some((s) => s.status === 'failed') && onRetrySync && (
            <button
              type="button"
              className="pq-retry-btn"
              onClick={onRetrySync}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {isKn ? 'ಮತ್ತೆ ಕಳಿಸಿ' : 'Retry sync'}
            </button>
          )}

          {/* Offline explanation */}
          {!online && unresolved.length > 0 && (
            <p className="pq-offline-note">
              {isKn
                ? 'Internet ಬಂದಾಗ ಸ್ವಯಂ sync ಆಗುತ್ತದೆ.'
                : 'Will sync automatically when internet returns.'}
            </p>
          )}

          {sessions.map((session) => {
            const Icon = STATUS_ICONS[session.status];
            return (
              <div key={session.sessionId} className="pq-item">
                <div className="pq-item-main">
                  <span className={STATUS_CLASSES[session.status]}>
                    <Icon
                      className={cn(
                        'h-3 w-3',
                        session.status === 'submitting' && 'animate-spin',
                      )}
                      aria-hidden="true"
                    />
                    {label(STATUS_LABEL[session.status], language)}
                  </span>

                  <div className="pq-item-body">
                    <p className="pq-item-text">
                      {session.transcriptText.slice(0, 80)}
                      {session.transcriptText.length > 80 ? '…' : ''}
                    </p>
                    <p className="pq-item-meta">
                      {formatDate(session.capturedAt, language)}
                      {' · '}
                      <span
                        className={cn(
                          'font-semibold',
                          session.localTriageLevel === 'RED'    && 'text-red-600',
                          session.localTriageLevel === 'YELLOW' && 'text-amber-600',
                          session.localTriageLevel === 'GREEN'  && 'text-emerald-600',
                        )}
                      >
                        {label(TRIAGE_LABEL[session.localTriageLevel] ?? TRIAGE_LABEL.UNKNOWN, language)}
                      </span>
                    </p>
                    {session.lastError && session.status === 'failed' && (
                      <p className="pq-item-error">
                        {isKn ? 'ದೋಷ: ' : 'Error: '}
                        {session.lastError}
                      </p>
                    )}
                    {session.status === 'conflict' && (
                      <p className="pq-item-error">
                        {isKn
                          ? 'ಸಂಘರ್ಷ ಆಗಿದೆ. ವೈದ್ಯರ ಸಹಾಯ ತೆಗೆದುಕೊಳ್ಳಿ.'
                          : 'Conflict detected. Please contact a healthcare professional.'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Dismiss — only for submitted/failed/conflict */}
                {(session.status === 'submitted' ||
                  session.status === 'failed' ||
                  session.status === 'conflict') && (
                  <button
                    type="button"
                    className="pq-dismiss-btn"
                    onClick={() => void handleDismiss(session)}
                    aria-label={isKn ? 'ತೆಗೆದುಹಾಕಿ' : `Dismiss ${session.sessionId}`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
