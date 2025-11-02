import { useCallback, useEffect, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import { withConfigDefaultsV2 } from "../config/defaults_v2";
import type { AppConfig } from "../types/config";
import type { AppConfigV2 } from "../types/config_v2";
import { API_ORIGIN, getConfig, getConfigV2 } from "./api";

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

  // Soporte para v2
  const v2Config = config as unknown as AppConfigV2;
  if (v2Config.version === 2 && v2Config.ui_map) {
    const provider = v2Config.ui_map.provider ?? null;
    // Para v2, extraer tileUrl según el proveedor
    let style: string | null = null;
    if (v2Config.ui_map.provider === "custom_xyz") {
      style = v2Config.ui_map.customXyz?.tileUrl ?? null;
    } else if (v2Config.ui_map.provider === "local_raster_xyz") {
      style = v2Config.ui_map.local?.tileUrl ?? null;
    } else if (v2Config.ui_map.provider === "maptiler_vector") {
      style = v2Config.ui_map.maptiler?.styleUrl ?? null;
    }
    return {
      provider,
      style,
      model: null,
    };
  }

  // Soporte para v1 (legacy)
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
      // Intentar cargar v2 primero
      let cfg: AppConfig | AppConfigV2 | undefined;
      let isV2 = false;
      try {
        const v2Cfg = await getConfigV2();
        if (v2Cfg && v2Cfg.version === 2 && v2Cfg.ui_map) {
          isV2 = true;
          cfg = v2Cfg as unknown as AppConfig;
        } else {
          cfg = await getConfig();
        }
      } catch (e) {
        // Si falla v2, intentar v1
        cfg = await getConfig();
      }
      
      const newData = isV2 
        ? (withConfigDefaultsV2(cfg as unknown as AppConfigV2) as unknown as AppConfig)
        : withConfigDefaults((cfg ?? {}) as AppConfig);
      
      setData((prev) => {
        if (!prev) {
          return newData;
        }

        // Comparar configuración de mapa (v2 o v1)
        const prevMapConfig = {
          provider: prev.ui?.map?.provider,
          style: prev.ui?.map?.style,
          xyz: prev.ui?.map?.xyz,
          fixed: prev.ui?.map?.fixed,
          viewMode: prev.ui?.map?.viewMode,
        };
        const newMapConfig = {
          provider: newData.ui?.map?.provider,
          style: newData.ui?.map?.style,
          xyz: newData.ui?.map?.xyz,
          fixed: newData.ui?.map?.fixed,
          viewMode: newData.ui?.map?.viewMode,
        };

        const prevJson = JSON.stringify(prevMapConfig);
        const newJson = JSON.stringify(newMapConfig);
        const mapConfigChanged = prevJson !== newJson;

        if (mapConfigChanged) {
          console.log("[useConfig] Detected map config change");
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

        if (mapConfigChanged || mapHotSwapChanged) {
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
