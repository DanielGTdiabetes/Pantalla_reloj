import { useCallback, useEffect, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import type { AppConfig } from "../types/config";
import { API_ORIGIN, getConfig } from "./api";

const API_UNREACHABLE = `No se pudo conectar con el backend en ${API_ORIGIN}`;

export function useConfig() {
  const [data, setData] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await getConfig();
      setData(withConfigDefaults((cfg ?? {}) as AppConfig));
      setError(null);
    } catch (e) {
      setError(API_UNREACHABLE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}
