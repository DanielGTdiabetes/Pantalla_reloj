import { useCallback } from "react";

import { API_ORIGIN, getConfig } from "./api";
import {
  applyConfigPayload,
  setConfigError,
  setConfigLoading,
  useConfigStore
} from "../state/configStore";

const API_UNREACHABLE = `No se pudo conectar con el backend en ${API_ORIGIN}`;

export function useConfig() {
  const { config, loading, error } = useConfigStore((state) => ({
    config: state.config,
    loading: state.loading,
    error: state.error
  }));

  const load = useCallback(async () => {
    try {
      setConfigLoading(true);
      const cfg = await getConfig();
      if (cfg) {
        applyConfigPayload(cfg, { loading: false, error: null });
      } else {
        setConfigError(API_UNREACHABLE);
        setConfigLoading(false);
      }
    } catch (e) {
      setConfigError(API_UNREACHABLE);
      setConfigLoading(false);
    }
  }, []);

  return { data: config, loading, error, reload: load };
}
