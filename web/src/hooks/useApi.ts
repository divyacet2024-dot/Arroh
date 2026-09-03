import { useCallback, useEffect, useRef, useState } from 'react';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: unknown | null;
}

/**
 * `useApi` runs an async loader on mount (and on every `reload`) and exposes a
 * stable `data` / `loading` / `error` triple plus a `reload` trigger. Idle
 * errors are provided so pages can render `ErrorState` rather than crashing.
 */
export function useApi<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<UseApiState<T>>({ data: null, loading: true, error: null });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mountedRef = useRef(true);

  const run = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const result = await loaderRef.current();
      if (!mountedRef.current) return;
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      if (!mountedRef.current) return;
      setState({ data: null, loading: false, error });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void run();
    return () => {
      mountedRef.current = false;
    };
  }, [run]);

  const reload = useCallback(() => run(), [run]);

  return { ...state, reload };
}
