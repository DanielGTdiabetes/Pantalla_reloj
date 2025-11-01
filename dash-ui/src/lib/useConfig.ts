import { useCallback, useEffect, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import type { AppConfig } from "../types/config";
import { API_ORIGIN, getConfig } from "./api";

const API_UNREACHABLE = `No se pudo conectar con el backend en ${API_ORIGIN}`;

const CONFIG_POLL_INTERVAL_MS = 1500; // Poll cada 1.5 segundos para detectar cambios más rápido

type MapHotSwapDescriptor = {
  provider: string | null;
  style: string | null;
  model: string | null;
};

const extractMapHotSwapDescriptor = (config: AppConfig | null): MapHotSwapDescriptor => {
  if (!config) {
    return { provider: null, style: null, model: null };
  }

  const uiMap = config.ui?.map ?? null;
  const prefs = config.map ?? null;

  const provider =
    (typeof uiMap?.provider === "string" && uiMap.provider.trim()) ||
    (typeof prefs?.provider === "string" && prefs.provider.trim()) ||
    null;

  const style =
    (typeof uiMap?.style === "string" && uiMap.style.trim()) ||
    (typeof (prefs as unknown as { style?: string | null })?.style === "string"
      ? ((prefs as unknown as { style?: string | null }).style ?? null)
      : null);

  const modelCandidate =
    (uiMap as unknown as { model?: string | null })?.model ??
    (prefs as unknown as { model?: string | null })?.model ??
    null;

  const model = typeof modelCandidate === "string" && modelCandidate.trim().length > 0
    ? modelCandidate.trim()
    : null;

  return {
    provider: provider ?? null,
    style: style ?? null,
    model,
  };
};

const descriptorsEqual = (a: MapHotSwapDescriptor, b: MapHotSwapDescriptor) => {
  return a.provider === b.provider && a.style === b.style && a.model === b.model;
};

export function useConfig() {
  const [data, setData] = useState<AppConfig | null>(null);
  const [prevData, setPrevData] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapStyleVersion, setMapStyleVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const cfg = await getConfig();
      const newData = withConfigDefaults((cfg ?? {}) as AppConfig);
      
      setData((prev) => {
        if (!prev) {
          return newData;
        }

        const prevCinema = prev.ui?.map?.cinema;
        const newCinema = newData.ui?.map?.cinema;

        const prevEnabled = prevCinema?.enabled ?? false;
        const newEnabled = newCinema?.enabled ?? false;
        const prevSpeed = prevCinema?.panLngDegPerSec ?? 0;
        const newSpeed = newCinema?.panLngDegPerSec ?? 0;
        const prevTransition = prevCinema?.bandTransition_sec ?? 8;
        const newTransition = newCinema?.bandTransition_sec ?? 8;

        const prevBands = prevCinema?.bands ?? [];
        const newBands = newCinema?.bands ?? [];
        const bandsChanged = JSON.stringify(prevBands) !== JSON.stringify(newBands);

        const cinemaChanged =
          prevEnabled !== newEnabled ||
          Math.abs(prevSpeed - newSpeed) > 0.0001 ||
          prevTransition !== newTransition ||
          bandsChanged;

        if (cinemaChanged) {
          console.log("[useConfig] Detected cinema config change:", {
            prevEnabled,
            newEnabled,
            prevSpeed,
            newSpeed,
            prevTransition,
            newTransition,
            bandsChanged,
          });
        }

        const prevMapConfig = {
          cinema: prevCinema,
          idlePan: prev.ui?.map?.idlePan,
          style: prev.ui?.map?.style,
          provider: prev.ui?.map?.provider,
          rotation: prev.ui?.rotation,
        };
        const newMapConfig = {
          cinema: newCinema,
          idlePan: newData.ui?.map?.idlePan,
          style: newData.ui?.map?.style,
          provider: newData.ui?.map?.provider,
          rotation: newData.ui?.rotation,
        };

        const prevJson = JSON.stringify(prevMapConfig);
        const newJson = JSON.stringify(newMapConfig);
        const mapConfigChanged = prevJson !== newJson;

        if (mapConfigChanged && !cinemaChanged) {
          console.log("[useConfig] Detected other config changes");
        }

        const prevDescriptor = extractMapHotSwapDescriptor(prev);
        const newDescriptor = extractMapHotSwapDescriptor(newData);
        const mapHotSwapChanged = !descriptorsEqual(prevDescriptor, newDescriptor);

        if (mapHotSwapChanged) {
          console.log("[useConfig] Detected base map change", {
            previous: prevDescriptor,
            next: newDescriptor,
          });
        }

        if (cinemaChanged || mapConfigChanged || mapHotSwapChanged) {
          setPrevData(prev);
          if (mapHotSwapChanged) {
            setMapStyleVersion((value) => value + 1);
          }
          return newData;
        }

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

  return { data, prevData, loading, error, reload: load, mapStyleVersion };
}
