import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../services/api";
import { withConfigDefaults } from "../config/defaults";
import type { AppConfig } from "../types/config";

type ConfigContextValue = {
  config: AppConfig;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (payload: AppConfig) => Promise<void>;
};

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AppConfig>(withConfigDefaults());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.fetchConfig();
      setConfig(withConfigDefaults(payload));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar la configuración";
      setError(message);
      setConfig(withConfigDefaults());
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (payload: AppConfig) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.updateConfig(payload);
      setConfig(withConfigDefaults(updated));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo guardar la configuración";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ config, loading, error, refresh, save }),
    [config, loading, error, refresh, save]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
};

export const useConfig = (): ConfigContextValue => {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useConfig must be used inside ConfigProvider");
  }
  return ctx;
};
