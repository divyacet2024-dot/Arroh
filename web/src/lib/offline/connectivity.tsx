/**
 * ConnectivityProvider — probe-aware network state.
 *
 * Upgrades the previous navigator.onLine-only implementation with a real
 * backend reachability probe via /health. This means:
 *
 *   online = true   → backend /health returned 200 recently
 *   online = false  → either OS reports no network, or /health timed out
 *
 * The probe runs in the background; the React context mirrors its state.
 * Components that previously used `useConnectivity().online` continue to
 * work without modification — they just get a more truthful value.
 *
 * The raw navigator.onLine value is also exposed as `navigatorOnline` for
 * the rare case where a component needs to distinguish "OS has network but
 * backend is unreachable" from "OS has no network at all".
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { globalProbe } from './connectivityProbe';

export interface ConnectivityState {
  /** True only when the backend /health endpoint is reachable. */
  online: boolean;
  /** Raw navigator.onLine value — OS network interface presence. */
  navigatorOnline: boolean;
  /** True while the first probe is in-flight (brief initial state). */
  probing: boolean;
}

const defaultValue: ConnectivityState = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  navigatorOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  probing: true,
};

const ConnectivityContext = createContext<ConnectivityState>(defaultValue);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectivityState>(() => ({
    online: globalProbe.reachable,
    navigatorOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    probing: true,
  }));

  useEffect(() => {
    // Subscribe to probe state changes
    const unsubscribeProbe = globalProbe.subscribe((reachable) => {
      setState((prev) => ({
        ...prev,
        online: reachable,
        probing: false,
      }));
    });

    // Also track raw navigator.onLine for the navigatorOnline field
    const onOnline  = () => setState((p) => ({ ...p, navigatorOnline: true  }));
    const onOffline = () => setState((p) => ({ ...p, navigatorOnline: false }));
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);

    // Start the probe — it fires immediately then polls periodically
    globalProbe.start();

    // After first probe completes, mark probing=false
    globalProbe.check().then((reachable) => {
      setState({
        online: reachable,
        navigatorOnline: navigator.onLine,
        probing: false,
      });
    });

    return () => {
      unsubscribeProbe();
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
      // Do NOT call globalProbe.stop() here — the probe is a singleton that
      // should keep running for the lifetime of the app.
    };
  }, []);

  return (
    <ConnectivityContext.Provider value={state}>
      {children}
    </ConnectivityContext.Provider>
  );
}

export function useConnectivity(): ConnectivityState {
  return useContext(ConnectivityContext);
}
