import { useCallback, useEffect, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import type { AppConfig } from "../types/config";
import { API_ORIGIN, getConfig } from "./api";

const API_UNREACHABLE = `No se pudo conectar con el backend en ${API_ORIGIN}`;

const CONFIG_POLL_INTERVAL_MS = 1500; // Poll cada 1.5 segundos para detectar cambios más rápido

export function useConfig() {
  const [data, setData] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const cfg = await getConfig();
      const newData = withConfigDefaults((cfg ?? {}) as AppConfig);
      
      setData((prev) => {
        // Siempre actualizar para forzar re-render si hay cambios
        // La comparación se hace en los componentes que usan la config
        if (!prev) {
          return newData;
        }
        
        // Comparar valores clave que pueden cambiar (cinema.enabled, panLngDegPerSec, etc.)
        const prevCinema = prev.ui?.map?.cinema;
        const newCinema = newData.ui?.map?.cinema;
        
        const prevEnabled = prevCinema?.enabled ?? false;
        const newEnabled = newCinema?.enabled ?? false;
        const prevSpeed = prevCinema?.panLngDegPerSec ?? 0;
        const newSpeed = newCinema?.panLngDegPerSec ?? 0;
        
        // Si cambian valores importantes, actualizar siempre
        if (prevEnabled !== newEnabled || prevSpeed !== newSpeed) {
          console.log("[useConfig] Detected config change:", { prevEnabled, newEnabled, prevSpeed, newSpeed });
          return newData;
        }
        
        // Para otros cambios, comparar JSON pero solo si hay diferencias reales
        // Usar una comparación más profunda de campos importantes
        const prevJson = JSON.stringify({
          cinema: prevCinema,
          rotation: prev.ui?.rotation
        });
        const newJson = JSON.stringify({
          cinema: newCinema,
          rotation: newData.ui?.rotation
        });
        
        if (prevJson !== newJson) {
          console.log("[useConfig] Detected other config changes");
          return newData;
        }
        
        // Si no hay cambios detectados, mantener la referencia anterior para evitar re-renders
        return prev;
      });
      
      setError(null);
      setLoading(false);
    } catch (e) {
      console.error("[useConfig] Error loading config:", e);
      setError(API_UNREACHABLE);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Carga inicial
    void load();
    
    // Polling periódico para detectar cambios guardados desde /config
    const intervalId = setInterval(() => {
      void load();
    }, CONFIG_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [load]);

  return { data, loading, error, reload: load };
}
