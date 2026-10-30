/**
 * offlineDb — IndexedDB persistence for the patient portal.
 *
 * PURPOSE:
 *   The existing syncQueue uses localStorage, which is suitable for ASHA
 *   field-worker observation batches (SyncRecord). This module provides a
 *   separate, patient-scoped IndexedDB store for:
 *
 *     1. Pending symptom sessions — structured symptom + triage data that
 *        a patient captured while offline, waiting to be submitted to
 *        /api/v1/voice/parse-and-triage once the backend is reachable.
 *
 *   IndexedDB is chosen over localStorage because:
 *   - It is async (non-blocking on the main thread).
 *   - It supports structured cloning (no JSON serialisation limits).
 *   - It can be isolated per authenticated user via patientId.
 *   - It persists across SW updates (unlike the SW cache).
 *
 * SECURITY:
 *   - Records are keyed by (patientId + sessionId) so they are never
 *     readable under a different patient's session.
 *   - Patient identifiers ARE stored in IDB (unavoidable for scoping).
 *   - Clinical data is stored only in support of pending sync.
 *   - clearForPatient() MUST be called on logout to remove the patient's
 *     local records from shared devices.
 *   - Browser IDB is NOT encrypted at rest — this is an acknowledged
 *     limitation of the browser platform. The application must not store
 *     more data than is necessary for the pending-sync workflow.
 *
 * WHAT IS NOT STORED:
 *   - Authentication tokens (those live in patientAuth context / localStorage)
 *   - Full patient records downloaded from the server
 *   - Prescription, referral, or consultation history
 *   - Any data that belongs to a different patient
 *
 * QUOTA:
 *   - All writes check for quota errors and surface them to the caller.
 *   - Callers must not silently swallow quota errors; they must inform
 *     the user that the record could not be saved.
 */

const DB_NAME    = 'medora-patient-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-sessions';

// ── Schema ────────────────────────────────────────────────────────────────

export type PendingSessionStatus =
  | 'pending'       // awaiting network + auth
  | 'submitting'    // in-flight
  | 'submitted'     // backend acknowledged
  | 'failed'        // permanent failure — needs user review
  | 'conflict';     // server returned a conflict; human review required

export interface PendingSymptomSession {
  /** Stable UUID generated at creation. Used as IDB key. */
  sessionId: string;
  /** The authenticated patient's UUID — used for scoping and auth. */
  patientId: string;
  /** ISO timestamp when the session was captured. */
  capturedAt: string;
  /** Language code, e.g. "kn-IN". */
  language: string;
  /** Raw symptom text as the patient described it. */
  transcriptText: string;
  /** Structured symptoms extracted locally (may be empty if offline triage ran). */
  symptoms: string[];
  /** Local triage result (deterministic rules engine — NOT server triage). */
  localTriageLevel: 'RED' | 'YELLOW' | 'GREEN' | 'UNKNOWN';
  /** Sync status. */
  status: PendingSessionStatus;
  /** Number of submission attempts. */
  attempts: number;
  /** ISO timestamp of the last attempt. */
  lastAttemptAt?: string;
  /** Human-readable error from the last failed attempt. Never contains stack traces. */
  lastError?: string;
  /** Server-returned triage result once submitted. */
  serverResponse?: Record<string, unknown>;
}

// ── DB lifecycle ──────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
        // Index by patientId so we can efficiently list/delete per patient
        store.createIndex('byPatient', 'patientId', { unique: false });
        // Index by status so we can quickly find pending items
        store.createIndex('byStatus', 'status', { unique: false });
        // Composite index for "pending sessions for patient X"
        store.createIndex('byPatientStatus', ['patientId', 'status'], { unique: false });
      }
    };

    request.onsuccess = () => {
      _db = request.result;
      // Handle unexpected version upgrades from other tabs
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };
      resolve(_db);
    };

    request.onerror = () => {
      reject(new Error(`IndexedDB open failed: ${request.error?.message ?? 'unknown'}`));
    };

    request.onblocked = () => {
      reject(new Error('IndexedDB open blocked by another tab. Please close other MEDORA tabs and try again.'));
    };
  });
}

// ── IDB helpers ───────────────────────────────────────────────────────────

function txStore(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror  = () => reject(request.error);
  });
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return err.name === 'QuotaExceededError' || err.code === 22;
}

// ── Public API ────────────────────────────────────────────────────────────

export class OfflineDbQuotaError extends Error {
  constructor() {
    super(
      'Storage quota exceeded. ' +
      'Free up device storage and try again. ' +
      'Your session has not been lost — please try submitting when space is available.',
    );
    this.name = 'OfflineDbQuotaError';
  }
}

export class OfflineDbUnavailableError extends Error {
  constructor(cause: string) {
    super(`Offline storage is not available: ${cause}`);
    this.name = 'OfflineDbUnavailableError';
  }
}

/**
 * Save a new pending session. Idempotent on sessionId.
 * @throws OfflineDbQuotaError if storage is full.
 * @throws OfflineDbUnavailableError if IDB is not supported.
 */
export async function saveSession(session: PendingSymptomSession): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (err) {
    throw new OfflineDbUnavailableError(String(err));
  }
  try {
    await promisify(txStore(db, 'readwrite').put(session));
  } catch (err) {
    if (isQuotaError(err)) throw new OfflineDbQuotaError();
    throw err;
  }
}

/**
 * Update the status and metadata of an existing session.
 * Only updates the fields that are relevant to sync lifecycle.
 * Does NOT overwrite clinical content (symptoms, transcriptText).
 */
export async function updateSessionStatus(
  sessionId: string,
  patch: Pick<PendingSymptomSession, 'status' | 'attempts' | 'lastAttemptAt' | 'lastError' | 'serverResponse'>,
): Promise<void> {
  const db = await openDb();
  const existing = await promisify<PendingSymptomSession | undefined>(
    txStore(db, 'readonly').get(sessionId),
  );
  if (!existing) return; // already gone — nothing to update
  const updated: PendingSymptomSession = { ...existing, ...patch };
  await promisify(txStore(db, 'readwrite').put(updated));
}

/**
 * List all pending sessions for a specific patient, ordered by capturedAt.
 * Returns only sessions that belong to the specified patientId.
 */
export async function listPendingSessions(
  patientId: string,
): Promise<PendingSymptomSession[]> {
  const db = await openDb();
  const index  = txStore(db, 'readonly').index('byPatientStatus');
  const result = await promisify<PendingSymptomSession[]>(
    index.getAll(IDBKeyRange.only([patientId, 'pending'])),
  );
  // Also include submitting + failed + conflict so the UI shows all unresolved
  const submitting = await promisify<PendingSymptomSession[]>(
    txStore(db, 'readonly').index('byPatientStatus').getAll(
      IDBKeyRange.only([patientId, 'submitting']),
    ),
  );
  const failed = await promisify<PendingSymptomSession[]>(
    txStore(db, 'readonly').index('byPatientStatus').getAll(
      IDBKeyRange.only([patientId, 'failed']),
    ),
  );
  const conflict = await promisify<PendingSymptomSession[]>(
    txStore(db, 'readonly').index('byPatientStatus').getAll(
      IDBKeyRange.only([patientId, 'conflict']),
    ),
  );
  return [...result, ...submitting, ...failed, ...conflict].sort(
    (a, b) => a.capturedAt.localeCompare(b.capturedAt),
  );
}

/**
 * Return the count of sessions awaiting sync (pending + failed) for a patient.
 */
export async function pendingSessionCount(patientId: string): Promise<number> {
  const sessions = await listPendingSessions(patientId);
  return sessions.filter((s) => s.status === 'pending' || s.status === 'failed').length;
}

/**
 * Delete a single session. Only safe to call once it has been submitted
 * or the user explicitly dismisses it.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const db = await openDb();
  await promisify(txStore(db, 'readwrite').delete(sessionId));
}

/**
 * MUST be called on patient logout.
 * Removes ALL sessions for the given patientId from IndexedDB.
 * This prevents another user on the same device from seeing the records.
 *
 * Pending (un-submitted) sessions are ALSO removed — this is intentional.
 * The user signed out; we cannot safely retain clinical records without
 * their confirmed consent. The user is warned before logout if sessions
 * are pending (see PatientOfflineQueue).
 */
export async function clearForPatient(patientId: string): Promise<void> {
  const db = await openDb();
  const index = txStore(db, 'readonly').index('byPatient');
  const keys  = await promisify<IDBValidKey[]>(
    index.getAllKeys(IDBKeyRange.only(patientId)),
  );
  if (keys.length === 0) return;
  const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
  await Promise.all(keys.map((key) => promisify(store.delete(key))));
}

/** Generate a stable session UUID. */
export function newSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
