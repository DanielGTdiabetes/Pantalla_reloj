import { useCallback, useEffect, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import type { AppConfig } from "../types/config";
import { API_BASE, apiGet } from "./api";

const API_UNREACHABLE = `No se pudo contactar con /api en ${API_BASE}`;

export function useConfig() {
  const [data, setData] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await apiGet<AppConfig>("/config");
      setData(withConfigDefaults(cfg));
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
