import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

interface ConnectivityState {
  online: boolean;
}

const defaultValue: ConnectivityState = { online: typeof navigator !== 'undefined' ? navigator.onLine : true };

const ConnectivityContext = createContext<ConnectivityState>(defaultValue);

function readOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Tracks real network reachability via the Platform API (`navigator.onLine`)
 * and the `online`/`offline` events. This is the source of truth for the
 * ONLINE / OFFLINE indicator — it is never faked.
 */
export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean>(() => readOnline());

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return <ConnectivityContext.Provider value={{ online }}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity(): ConnectivityState {
  return useContext(ConnectivityContext);
}
