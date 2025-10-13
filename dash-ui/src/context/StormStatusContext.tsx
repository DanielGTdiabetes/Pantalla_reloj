import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchStormStatus, type StormStatus } from '../services/storms';

interface StormStatusState {
  status: StormStatus | null;
  error: string | null;
}

const StormStatusContext = createContext<StormStatusState | undefined>(undefined);

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function StormStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StormStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const data = await fetchStormStatus();
        if (!cancelled) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sin datos');
        }
      }
    };

    void load();
    timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      status,
      error,
    }),
    [status, error],
  );

  return <StormStatusContext.Provider value={value}>{children}</StormStatusContext.Provider>;
}

export function useStormStatus(): StormStatusState {
  const context = useContext(StormStatusContext);
  if (!context) {
    throw new Error('useStormStatus debe utilizarse dentro de StormStatusProvider');
  }
  return context;
}
