/**
 * connectivityProbe — real backend reachability check.
 *
 * Why this exists:
 *   navigator.onLine only detects whether the OS has a network interface.
 *   On a captive-portal WiFi, or when the backend is down but the device
 *   is on LAN, navigator.onLine = true while the backend is unreachable.
 *   This module probes the actual MEDORA backend /health endpoint to give
 *   a truthful "backend reachable" signal.
 *
 * Usage:
 *   const probe = createConnectivityProbe({ baseUrl: import.meta.env.VITE_API_BASE_URL })
 *   probe.start()                        // begin polling
 *   probe.stop()                         // stop polling on unmount
 *   probe.subscribe(isReachable => ...)  // listen for state changes
 *   probe.check()                        // one-shot immediate check
 *
 * Contract:
 *   - Returns true ONLY when the backend /health endpoint responds 200.
 *   - Returns false on network error, non-200, or timeout.
 *   - Never throws; all errors are silently caught and treated as unreachable.
 *   - Does NOT cache the response (cache: 'no-store').
 *   - Does NOT include credentials or patient data.
 *   - Poll interval is conservative (30s online, 10s after going offline)
 *     to avoid flooding the network on a slow connection.
 */

export interface ConnectivityProbeOptions {
  /** Backend base URL, e.g. 'http://127.0.0.1:8000'. Defaults to empty (same origin). */
  baseUrl?: string;
  /** Probe timeout in ms. Default: 5000. */
  timeoutMs?: number;
  /** Poll interval when currently believed-online. Default: 30_000. */
  pollIntervalOnlineMs?: number;
  /** Poll interval when currently believed-offline (faster retry). Default: 10_000. */
  pollIntervalOfflineMs?: number;
}

export interface ConnectivityProbe {
  /** Last known reachability state. */
  readonly reachable: boolean;
  /** Perform an immediate probe and return the result. */
  check(): Promise<boolean>;
  /** Start periodic polling. Safe to call multiple times. */
  start(): void;
  /** Stop periodic polling. */
  stop(): void;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: (reachable: boolean) => void): () => void;
}

export function createConnectivityProbe(
  options: ConnectivityProbeOptions = {},
): ConnectivityProbe {
  const {
    baseUrl = '',
    timeoutMs = 5_000,
    pollIntervalOnlineMs = 30_000,
    pollIntervalOfflineMs = 10_000,
  } = options;

  const healthUrl = `${baseUrl}/health`;
  let _reachable = navigator?.onLine ?? true; // optimistic initial value
  let _timerId: ReturnType<typeof setTimeout> | null = null;
  const _listeners = new Set<(reachable: boolean) => void>();

  function notify(state: boolean): void {
    if (state === _reachable) return; // no change — skip noisy re-renders
    _reachable = state;
    _listeners.forEach((fn) => fn(state));
  }

  async function check(): Promise<boolean> {
    // Fast-fail if the OS reports no network at all
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      notify(false);
      return false;
    }

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(healthUrl, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      clearTimeout(id);
      const ok = response.status === 200;
      notify(ok);
      return ok;
    } catch {
      // Network error, timeout, or CORS — treat as unreachable
      notify(false);
      return false;
    }
  }

  function scheduleNext(): void {
    if (_timerId !== null) clearTimeout(_timerId);
    const interval = _reachable ? pollIntervalOnlineMs : pollIntervalOfflineMs;
    _timerId = setTimeout(async () => {
      await check();
      scheduleNext();
    }, interval);
  }

  function start(): void {
    if (_timerId !== null) return; // already started
    // Probe immediately, then start polling
    void check().then(() => scheduleNext());

    // Also react instantly to OS-level network events
    if (typeof window !== 'undefined') {
      window.addEventListener('online',  handleOnline);
      window.addEventListener('offline', handleOffline);
    }
  }

  function stop(): void {
    if (_timerId !== null) {
      clearTimeout(_timerId);
      _timerId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  }

  function handleOnline():  void { void check(); }
  function handleOffline(): void { notify(false); }

  function subscribe(listener: (reachable: boolean) => void): () => void {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  }

  return {
    get reachable() { return _reachable; },
    check,
    start,
    stop,
    subscribe,
  };
}

// ── Singleton for the patient portal ──────────────────────────────────────
// Shared instance so the ConnectivityProvider and SyncContext read the same
// probe state without duplicating HTTP traffic.
const _baseUrl =
  typeof import.meta !== 'undefined'
    ? (import.meta.env?.VITE_API_BASE_URL ?? '')
    : '';

export const globalProbe = createConnectivityProbe({ baseUrl: _baseUrl });
