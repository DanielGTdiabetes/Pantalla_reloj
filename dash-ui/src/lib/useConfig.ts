import { useCallback, useEffect, useRef, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import { withConfigDefaultsV2 } from "../config/defaults_v2";
import type { AppConfig } from "../types/config";
import type { AppConfigV2 } from "../types/config_v2";
import { API_ORIGIN, getConfig, getConfigMeta, getConfigV2 } from "./api";

const API_UNREACHABLE = `No se pudo conectar con el backend en ${API_ORIGIN}`;

const META_POLL_INTERVAL_MIN_MS = 15000;
const META_POLL_INTERVAL_MAX_MS = 30000;

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
  const metaTimestampRef = useRef<string | null>(null);

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
      
      let processedData: AppConfig;
      
      if (isV2 && cfg) {
        // Procesar v2 preservando la estructura completa
        const v2Config = withConfigDefaultsV2(cfg as unknown as AppConfigV2);
        // Preservar ui_map y version en processedData para que las comparaciones funcionen
        processedData = {
          ...(v2Config as unknown as AppConfig),
          version: 2,
          ui_map: v2Config.ui_map,
          ui_global: v2Config.ui_global,
          // Mapear ui_global → layers.global para compatibilidad con código legacy
          layers: {
            ...(v2Config.layers as unknown as AppConfig["layers"]),
            global: {
              satellite: {
                enabled: v2Config.ui_global?.satellite?.enabled ?? true,
                provider: "gibs" as const,
                refresh_minutes: 10,
                history_minutes: 90,
                frame_step: 10,
                opacity: v2Config.ui_global?.satellite?.opacity ?? 1.0,
              },
              radar: {
                enabled: v2Config.layers?.global_?.radar?.enabled ?? v2Config.layers?.global?.radar?.enabled ?? false,
                provider: "rainviewer" as const,
                refresh_minutes: v2Config.layers?.global_?.radar?.refresh_minutes ?? v2Config.layers?.global?.radar?.refresh_minutes ?? 5,
                history_minutes: v2Config.layers?.global_?.radar?.history_minutes ?? v2Config.layers?.global?.radar?.history_minutes ?? 90,
                frame_step: v2Config.layers?.global_?.radar?.frame_step ?? v2Config.layers?.global?.radar?.frame_step ?? 5,
                opacity: v2Config.layers?.global_?.radar?.opacity ?? v2Config.layers?.global?.radar?.opacity ?? 0.7,
              },
            },
          },
        } as AppConfig & { version: number; ui_map: AppConfigV2["ui_map"]; ui_global: AppConfigV2["ui_global"] };
      } else {
        processedData = withConfigDefaults((cfg ?? {}) as AppConfig);
      }
      
      let wasUpdated = false;
      setData((prev) => {
        const newData = processedData;
        if (!prev) {
          wasUpdated = true;
          return newData;
        }

        // Comparar configuración de mapa (v2 o v1)
        // Para v2, usar ui_map; para v1, usar ui.map
        const prevAsV2 = prev as unknown as AppConfigV2;
        const newAsV2 = newData as unknown as AppConfigV2;
        
        const isPrevV2 = prevAsV2.version === 2 && prevAsV2.ui_map;
        const isNewV2 = newAsV2.version === 2 && newAsV2.ui_map;
        
        let prevMapConfig: Record<string, unknown>;
        let newMapConfig: Record<string, unknown>;
        
        if (isPrevV2 && isNewV2) {
          // Comparar v2
          prevMapConfig = {
            provider: prevAsV2.ui_map?.provider,
            style: prevAsV2.ui_map?.maptiler?.styleUrl || prevAsV2.ui_map?.customXyz?.tileUrl || prevAsV2.ui_map?.local?.tileUrl,
            fixed: prevAsV2.ui_map?.fixed,
            viewMode: prevAsV2.ui_map?.viewMode,
          };
          newMapConfig = {
            provider: newAsV2.ui_map?.provider,
            style: newAsV2.ui_map?.maptiler?.styleUrl || newAsV2.ui_map?.customXyz?.tileUrl || newAsV2.ui_map?.local?.tileUrl,
            fixed: newAsV2.ui_map?.fixed,
            viewMode: newAsV2.ui_map?.viewMode,
          };
        } else {
          // Comparar v1 (legacy)
          prevMapConfig = {
            provider: prev.ui?.map?.provider,
            style: prev.ui?.map?.style,
            xyz: prev.ui?.map?.xyz,
            fixed: prev.ui?.map?.fixed,
            viewMode: prev.ui?.map?.viewMode,
          };
          newMapConfig = {
            provider: newData.ui?.map?.provider,
            style: newData.ui?.map?.style,
            xyz: newData.ui?.map?.xyz,
            fixed: newData.ui?.map?.fixed,
            viewMode: newData.ui?.map?.viewMode,
          };
        }

        const prevJson = JSON.stringify(prevMapConfig);
        const newJson = JSON.stringify(newMapConfig);
        const mapConfigChanged = prevJson !== newJson;

        if (mapConfigChanged) {
          console.log("[useConfig] Detected map config change", {
            prev: prevMapConfig,
            new: newMapConfig,
          });
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
          wasUpdated = true;
          setPrevData(prev);
          if (mapHotSwapChanged) {
            setMapStyleVersion((value) => value + 1);
          }
          return newData;
        }

        wasUpdated = true;
        return newData;
      });
      
      const meta = await getConfigMeta().catch(() => null);
      if (meta && meta.config_loaded_at) {
        metaTimestampRef.current = meta.config_loaded_at;
      }

      if (wasUpdated) {
        window.dispatchEvent(new CustomEvent("config-changed"));
      }
      
      setError(null);
      setLoading(false);
    } catch (e) {
      console.error("[useConfig] Error loading config:", e);
      setError(API_UNREACHABLE);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    let cancelled = false;
    let timeoutId: number | null = null;

    const pollMeta = async () => {
      try {
        const meta = await getConfigMeta();
        if (cancelled) {
          return;
        }
        const timestamp = meta.config_loaded_at ?? null;
        if (timestamp) {
          if (!metaTimestampRef.current) {
            metaTimestampRef.current = timestamp;
          } else if (metaTimestampRef.current !== timestamp) {
            metaTimestampRef.current = timestamp;
            await load();
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.debug("[useConfig] Failed to poll config meta", error);
        }
      } finally {
        if (!cancelled) {
          scheduleNextPoll();
        }
      }
    };

    function scheduleNextPoll() {
      const delay =
        META_POLL_INTERVAL_MIN_MS +
        Math.random() * (META_POLL_INTERVAL_MAX_MS - META_POLL_INTERVAL_MIN_MS);
      timeoutId = window.setTimeout(pollMeta, delay);
    }

    void pollMeta();

    const handleConfigSaved = () => {
      console.log("[useConfig] Config saved event received, forcing reload");
      void load();
    };

    window.addEventListener("pantalla:config:saved", handleConfigSaved);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("pantalla:config:saved", handleConfigSaved);
    };
  }, [load]);

  return { data, prevData, loading, error, reload: load, mapStyleVersion };
}
