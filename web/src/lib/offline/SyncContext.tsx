import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { bulkSync } from '../../services/sync';
import { useConnectivity } from './connectivity';
import {
  enqueue as queueEnqueue,
  getPending,
  getPendingCount,
  getAllItems,
  getLastSyncedAt,
  markSynced,
  markFailed,
  recordLastSyncedAt,
  clearSynced as storeClearSynced,
  discardSyncedItem as storeDiscardSyncedItem,
  subscribeSnapshot,
  type SyncQueueItem,
} from './syncQueue';
import { DEFAULT_PHC_ID, DEFAULT_WORKER_ID } from '../constants';
import type { SyncRecord } from '../../types';

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncState {
  online: boolean;
  pendingCount: number;
  items: SyncQueueItem[];
  status: SyncStatus;
  lastSyncedAt?: string;
  errorMessage?: string;
  workerId: string;
  phcId: string;
}

interface SyncContextValue extends SyncState {
  setWorkerId: (id: string) => void;
  setPhcId: (id: string) => void;
  enqueue: (record: SyncRecord) => void;
  flush: () => Promise<void>;
  clearSynced: () => void;
  discardSyncedItem: (uuid: string) => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { online } = useConnectivity();

  const [items, setItems] = useState<SyncQueueItem[]>(() => getAllItems());
  const [pendingCount, setPendingCount] = useState<number>(() => getPendingCount());
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>(() => getLastSyncedAt());
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [workerId, setWorkerId] = useState<string>(DEFAULT_WORKER_ID);
  const [phcId, setPhcId] = useState<string>(DEFAULT_PHC_ID);

  const syncingRef = useRef(false);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const refreshFromStore = useCallback(() => {
    setItems(getAllItems());
    setPendingCount(getPendingCount());
    setLastSyncedAt(getLastSyncedAt());
  }, []);

  useEffect(() => subscribeSnapshot(refreshFromStore), [refreshFromStore]);

  const flush = useCallback(async () => {
    if (syncingRef.current) return;         // prevent duplicate/concurrent submit
    if (!onlineRef.current) return;         // never flush while offline
    const pending = getPending();
    if (pending.length === 0) return;
    if (!workerId.trim() || !phcId.trim()) {
      // The backend requires both identifiers; do not fire an API call for a
      // malformed queue — report and retain everything.
      const message = 'Worker ID and PHC ID are required to sync. Records remain queued.';
      setStatus('error');
      setErrorMessage(message);
      return;
    }

    syncingRef.current = true;
    setStatus('syncing');
    setErrorMessage(undefined);

    const submitted = pending;
    try {
      const response = await bulkSync({
        worker_id: workerId.trim(),
        phc_id: phcId.trim(),
        sync_timestamp: new Date().toISOString(),
        records: submitted.map((item) => item.payload),
      });

      if (response.failed_count > 0) {
        // Backend explicitly reported failures. We cannot map failures to
        // specific records from the aggregate counts, so retain ALL submitted
        // records as failed rather than risk silently dropping a patient.
        const message = `Sync reported ${response.failed_count} failed record(s). They remain queued.`;
        submitted.forEach((item) => markFailed(item.local_client_uuid, message));
        setStatus('error');
        setErrorMessage(message);
        return;
      }

      const now = new Date().toISOString();
      submitted.forEach((item) => markSynced(item.local_client_uuid));
      recordLastSyncedAt(now);
      setStatus('idle');
      setErrorMessage(undefined);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'Sync failed. Records remain queued.';
      submitted.forEach((item) => markFailed(item.local_client_uuid, message));
      setStatus('error');
      setErrorMessage(message);
    } finally {
      syncingRef.current = false;
      refreshFromStore();
    }
  }, [workerId, phcId, refreshFromStore]);

  // Auto-flush when connectivity returns (OFFLINE → ONLINE) and on first load.
  useEffect(() => {
    if (online && getPendingCount() > 0) {
      void flush();
    }
  }, [online, flush]);

  const enqueue = useCallback((record: SyncRecord) => {
    queueEnqueue(record);
  }, []);

  const clearSynced = useCallback(() => {
    storeClearSynced();
    refreshFromStore();
  }, [refreshFromStore]);

  const discardSyncedItem = useCallback(
    (uuid: string) => {
      storeDiscardSyncedItem(uuid);
      refreshFromStore();
    },
    [refreshFromStore],
  );

  const value: SyncContextValue = {
    online,
    pendingCount,
    items,
    status,
    lastSyncedAt,
    errorMessage,
    workerId,
    phcId,
    setWorkerId,
    setPhcId,
    enqueue,
    flush,
    clearSynced,
    discardSyncedItem,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used within a SyncProvider');
  return context;
}
