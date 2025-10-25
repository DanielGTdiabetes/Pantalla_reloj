import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "../services/api";
import { withConfigDefaults } from "../config/defaults";
import type { AppConfig } from "../types/config";

type ConfigContextValue = {
  config: AppConfig;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (payload: Partial<AppConfig>) => Promise<void>;
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
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (payload: Partial<AppConfig>) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.updateConfig(payload);
      setConfig(withConfigDefaults(updated));
    } catch (err) {
      setError((err as Error).message);
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
