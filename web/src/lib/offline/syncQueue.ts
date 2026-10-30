/**
 * Durable, typed offline outbox.
 *
 * Stores patient-observation records captured while offline so they survive a
 * page reload. Records are only ever removed after the backend has positively
 * acknowledged them (`markSynced`), or a synced record is cleared by an
 * explicit user action. Nothing is silently discarded.
 *
 * The store is a pure, non-React module backed by localStorage with a tiny
 * subscription API. React wiring lives in `SyncContext.tsx`.
 */

import type { SyncRecord } from '../../types';

const STORAGE_KEY = 'arroh.sync.outbox.v2';
const CORRUPT_BACKUP_KEY = 'arroh.sync.outbox.corrupt.v2';

export type SyncItemStatus = 'pending' | 'syncing' | 'failed' | 'synced';

export interface SyncQueueItem {
  /** Stable identity — the same value the backend uses for idempotent de-dupe. */
  local_client_uuid: string;
  local_timestamp: string;
  payload: SyncRecord;
  status: SyncItemStatus;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: string;
}

interface PersistedOutbox {
  v: 2;
  items: SyncQueueItem[];
  lastSyncedAt?: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function currentStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/* ----------------------- validation / persistence ----------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSyncRecord(value: unknown): value is SyncRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.local_client_uuid === 'string' &&
    typeof value.local_timestamp === 'string' &&
    typeof value.name === 'string' &&
    typeof value.gender === 'string' &&
    typeof value.birth_date === 'string' &&
    typeof value.district === 'string' &&
    typeof value.state === 'string' &&
    Array.isArray(value.symptoms) &&
    isRecord(value.vitals)
  );
}

function isQueueItem(value: unknown): value is SyncQueueItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.local_client_uuid === 'string' &&
    typeof value.local_timestamp === 'string' &&
    isSyncRecord(value.payload) &&
    typeof value.status === 'string' &&
    typeof value.attempts === 'number'
  );
}

function loadOutbox(storage: StorageLike | undefined = currentStorage()): PersistedOutbox {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { v: 2, items: [] };
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && parsed.v === 2 && Array.isArray(parsed.items)) {
      const items = parsed.items.filter(isQueueItem).map((item) => ({
        ...item,
        lastError: typeof item.lastError === 'string' ? item.lastError : undefined,
        lastAttemptAt: typeof item.lastAttemptAt === 'string' ? item.lastAttemptAt : undefined,
      }));
      return { v: 2, items, lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined };
    }
    throw new Error('unexpected outbox shape');
  } catch (error) {
    // Malformed data: preserve the raw blob for recovery rather than silently
    // discarding potentially unrecoverable patient records.
    try {
      const corrupted = storage?.getItem(STORAGE_KEY);
      if (corrupted) storage?.setItem(CORRUPT_BACKUP_KEY, corrupted);
    } catch {
      // storage may be unavailable — nothing more we can do
    }
    return { v: 2, items: [] };
  }
}

function persistOutbox(outbox: PersistedOutbox, storage: StorageLike | undefined = currentStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(outbox));
  } catch {
    // Quota exceeded / storage disabled — keep the in-memory copy so the UI
    // still reflects pending work for this session.
  }
}

/* --------------------------- store + subscribe -------------------------- */

let storageOwner = currentStorage();
let outbox: PersistedOutbox = loadOutbox(storageOwner);
const listeners = new Set<() => void>();

type SubscribeListener = () => void;

export function subscribeSnapshot(listener: SubscribeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: PersistedOutbox) {
  ensureCurrentStorage();
  outbox = next;
  persistOutbox(outbox, storageOwner);
  listeners.forEach((listener) => listener());
}

/**
 * Browser storage is stable in production. Re-reading only when the storage
 * object changes keeps tests and SSR storage shims isolated instead of leaking
 * a stale in-memory queue into a new storage context.
 */
function ensureCurrentStorage() {
  const storage = currentStorage();
  if (storage !== storageOwner) {
    storageOwner = storage;
    outbox = loadOutbox(storageOwner);
  }
}

function newUuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* ------------------------------- public API ----------------------------- */

/**
 * Queue a local observation. Idempotent on `payload.local_client_uuid`: if an
 * item with that identity already exists it is refreshed to `pending` rather
 * than duplicated (prevents duplicate submission).
 */
export function enqueue(payload: SyncRecord): SyncQueueItem {
  ensureCurrentStorage();
  const uuid = payload.local_client_uuid || newUuid();
  const record: SyncRecord = { ...payload, local_client_uuid: uuid };
  const existing = outbox.items.find((item) => item.local_client_uuid === uuid);

  let item: SyncQueueItem;
  if (existing) {
    item = {
      ...existing,
      payload: record,
      local_timestamp: record.local_timestamp || existing.local_timestamp,
      status: 'pending',
      lastError: undefined,
    };
  } else {
    item = {
      local_client_uuid: uuid,
      local_timestamp: record.local_timestamp || new Date().toISOString(),
      payload: record,
      status: 'pending',
      attempts: 0,
    };
  }

  const items = existing
    ? outbox.items.map((entry) => (entry.local_client_uuid === uuid ? item : entry))
    : [item, ...outbox.items];

  commit({ ...outbox, items });
  return item;
}

/** Items that still need syncing (pending/failed/syncing — anything unacked). */
export function getPending(): SyncQueueItem[] {
  ensureCurrentStorage();
  return outbox.items.filter((item) => item.status !== 'synced');
}

export function getPendingCount(): number {
  return getPending().length;
}

export function getAllItems(): SyncQueueItem[] {
  ensureCurrentStorage();
  return outbox.items;
}

export function markSynced(localClientUuid: string) {
  ensureCurrentStorage();
  commit({
    ...outbox,
    items: outbox.items.map((item) =>
      item.local_client_uuid === localClientUuid
        ? { ...item, status: 'synced', lastError: undefined }
        : item,
    ),
  });
}

export function markFailed(localClientUuid: string, message: string) {
  ensureCurrentStorage();
  commit({
    ...outbox,
    items: outbox.items.map((item) =>
      item.local_client_uuid === localClientUuid
        ? {
            ...item,
            status: 'failed',
            attempts: item.attempts + 1,
            lastError: message,
            lastAttemptAt: new Date().toISOString(),
          }
        : item,
    ),
  });
}

export function recordLastSyncedAt(when: string) {
  ensureCurrentStorage();
  commit({ ...outbox, lastSyncedAt: when });
}

/** Remove only records the backend has acknowledged. Never discards pending work. */
export function clearSynced() {
  ensureCurrentStorage();
  commit({ ...outbox, items: outbox.items.filter((item) => item.status !== 'synced') });
}

/**
 * Remove a single record, but ONLY if the backend has acknowledged it. This is
 * a hard safety guard — pending/failed items can never be discarded here.
 */
export function discardSyncedItem(localClientUuid: string) {
  ensureCurrentStorage();
  commit({
    ...outbox,
    items: outbox.items.filter(
      (item) => !(item.local_client_uuid === localClientUuid && item.status === 'synced'),
    ),
  });
}

export function getLastSyncedAt(): string | undefined {
  ensureCurrentStorage();
  return outbox.lastSyncedAt;
}

export { STORAGE_KEY };
