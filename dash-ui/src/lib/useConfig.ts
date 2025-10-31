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
        
        // Comparar TODOS los campos del modo cine para detectar cualquier cambio
        const prevCinema = prev.ui?.map?.cinema;
        const newCinema = newData.ui?.map?.cinema;
        
        // Comparar campos principales del modo cine
        const prevEnabled = prevCinema?.enabled ?? false;
        const newEnabled = newCinema?.enabled ?? false;
        const prevSpeed = prevCinema?.panLngDegPerSec ?? 0;
        const newSpeed = newCinema?.panLngDegPerSec ?? 0;
        const prevTransition = prevCinema?.bandTransition_sec ?? 8;
        const newTransition = newCinema?.bandTransition_sec ?? 8;
        
        // Comparar las bandas del modo cine (importante para detectar cambios)
        const prevBands = prevCinema?.bands ?? [];
        const newBands = newCinema?.bands ?? [];
        const bandsChanged = JSON.stringify(prevBands) !== JSON.stringify(newBands);
        
        // Si cambian valores importantes del modo cine, actualizar siempre
        if (prevEnabled !== newEnabled || 
            Math.abs(prevSpeed - newSpeed) > 0.0001 || 
            prevTransition !== newTransition ||
            bandsChanged) {
          console.log("[useConfig] Detected cinema config change:", { 
            prevEnabled, newEnabled, 
            prevSpeed, newSpeed,
            prevTransition, newTransition,
            bandsChanged
          });
          return newData;
        }
        
        // Comparar otros campos importantes de la configuración
        const prevMapConfig = {
          cinema: prevCinema,
          idlePan: prev.ui?.map?.idlePan,
          style: prev.ui?.map?.style,
          provider: prev.ui?.map?.provider,
          rotation: prev.ui?.rotation
        };
        const newMapConfig = {
          cinema: newCinema,
          idlePan: newData.ui?.map?.idlePan,
          style: newData.ui?.map?.style,
          provider: newData.ui?.map?.provider,
          rotation: newData.ui?.rotation
        };
        
        // Comparar JSON para detectar cualquier cambio en la configuración del mapa
        const prevJson = JSON.stringify(prevMapConfig);
        const newJson = JSON.stringify(newMapConfig);
        
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
