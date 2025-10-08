import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  type ConfigUpdate,
  type DashboardConfig,
  fetchDashboardConfig,
  loadCachedConfig,
  persistConfig,
  updateDashboardConfig,
} from '../services/config';

interface DashboardConfigContextValue {
  config: DashboardConfig | null;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  update: (payload: ConfigUpdate) => Promise<void>;
}

const DashboardConfigContext = createContext<DashboardConfigContextValue | undefined>(undefined);

interface Props {
  children: ReactNode;
}

export const DashboardConfigProvider = ({ children }: Props) => {
  const [config, setConfig] = useState<DashboardConfig | null>(() =>
    typeof window !== 'undefined' ? loadCachedConfig() : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const remote = await fetchDashboardConfig();
      setConfig(remote);
      persistConfig(remote);
    } catch (err) {
      console.warn('No se pudo cargar config', err);
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(async (payload: ConfigUpdate) => {
    setLoading(true);
    setError(undefined);
    try {
      const updated = await updateDashboardConfig(payload);
      setConfig(updated);
      persistConfig(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!config) {
      refresh().catch(() => {
        // already handled
      });
    }
  }, []);

  const value = useMemo(
    () => ({ config, loading, error, refresh, update }),
    [config, loading, error, refresh, update]
  );

  return <DashboardConfigContext.Provider value={value}>{children}</DashboardConfigContext.Provider>;
};

export const useDashboardConfig = (): DashboardConfigContextValue => {
  const ctx = useContext(DashboardConfigContext);
  if (!ctx) {
    throw new Error('useDashboardConfig must be used within DashboardConfigProvider');
  }
  return ctx;
};
