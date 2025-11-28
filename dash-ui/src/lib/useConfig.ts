import { useCallback, useEffect, useRef, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import type { AppConfig } from "../types/config";
import { API_ORIGIN, getConfig, getConfigMeta } from "./api";

const API_UNREACHABLE = `No se pudo conectar con el backend en ${API_ORIGIN}`;

const META_POLL_INTERVAL_MIN_MS = 15000;
const META_POLL_INTERVAL_MAX_MS = 30000;

type MapHotSwapDescriptor = {
  provider: string | null;
  style: string | null;
  model: string | null;
  api_key: string | null; // Incluir API key para detectar cambios
};

const extractMapHotSwapDescriptor = (config: AppConfig | null): MapHotSwapDescriptor => {
  if (!config) {
    return { provider: null, style: null, model: null, api_key: null };
  }

  // Soporte para v2
  const v2Config = config as unknown as AppConfig;
  if (v2Config.version === 2 && v2Config.ui_map) {
    const provider = v2Config.ui_map.provider ?? null;
    // Para v2, extraer tileUrl según el proveedor
    let style: string | null = null;
    let api_key: string | null = null;
    if (v2Config.ui_map.provider === "custom_xyz") {
      style = v2Config.ui_map.customXyz?.tileUrl ?? null;
    } else if (v2Config.ui_map.provider === "local_raster_xyz") {
      style = v2Config.ui_map.local?.tileUrl ?? null;
    } else if (v2Config.ui_map.provider === "maptiler_vector") {
      style = v2Config.ui_map.maptiler?.styleUrl ?? null;
      // Incluir API key para detectar cambios
      api_key = v2Config.ui_map.maptiler?.api_key ??
        v2Config.ui_map.maptiler?.apiKey ??
        v2Config.ui_map.maptiler?.key ??
        null;
    }
    return {
      provider,
      style,
      model: null,
      api_key,
    };
  }

  // Soporte para v1 (legacy)
  const legacyConfig = config as any;
  const uiMap = legacyConfig.ui?.map ?? null;
  const prefs = legacyConfig.map ?? null;

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

  // Extraer API key para v1 legacy
  const api_key = (uiMap?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.apiKey ??
    (uiMap?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.key ??
    (uiMap?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.api_key ??
    null;

  return {
    provider: provider ?? null,
    style: style ?? null,
    model,
    api_key,
  };
};

const descriptorsEqual = (a: MapHotSwapDescriptor, b: MapHotSwapDescriptor) => {
  return a.provider === b.provider &&
    a.style === b.style &&
    a.model === b.model &&
    a.api_key === b.api_key;
};

export function useConfig() {
  const [data, setData] = useState<AppConfig | null>(null);
  const [prevData, setPrevData] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapStyleVersion, setMapStyleVersion] = useState(0);
  const metaTimestampRef = useRef<string | null>(null);
  const configChecksumRef = useRef<string | null>(null);
  const reloadDebounceRef = useRef<number | null>(null);
  const isReloadingRef = useRef(false);

  const load = useCallback(async (forceReload = false) => {
    // Prevenir recargas concurrentes
    if (isReloadingRef.current && !forceReload) {
      console.debug("[useConfig] Reload already in progress, skipping");
      return;
    }

    // Obtener checksum actual antes de cargar config
    let currentChecksum: string | null = null;
    try {
      const healthResponse = await fetch(`${API_ORIGIN}/api/health/full`, { cache: "no-store" });
      if (healthResponse.ok) {
        const healthData = await healthResponse.json().catch(() => null);
        currentChecksum = healthData?.config_checksum ?? null;

        // Si el checksum no ha cambiado y no es una recarga forzada, no hacer nada
        if (!forceReload && currentChecksum && configChecksumRef.current === currentChecksum) {
          console.debug("[useConfig] Config checksum unchanged, skipping reload");
          return;
        }
      }
    } catch (e) {
      console.debug("[useConfig] Failed to get checksum, proceeding with reload", e);
      // Continuar con la recarga aunque falle el checksum
    }

    isReloadingRef.current = true;
    try {
      // Intentar cargar v2 primero
      let cfg: AppConfig | undefined;
      let isV2 = false;
      try {
        const v2Cfg = await getConfig();
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
        const v2Config = withConfigDefaults(cfg as unknown as AppConfig);
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
                enabled: v2Config.layers?.global?.radar?.enabled ?? v2Config.layers?.global_?.radar?.enabled ?? false,
                provider: "rainviewer" as const,
                refresh_minutes: v2Config.layers?.global?.radar?.refresh_minutes ?? v2Config.layers?.global_?.radar?.refresh_minutes ?? 5,
                history_minutes: v2Config.layers?.global?.radar?.history_minutes ?? v2Config.layers?.global_?.radar?.history_minutes ?? 90,
                frame_step: v2Config.layers?.global?.radar?.frame_step ?? v2Config.layers?.global_?.radar?.frame_step ?? 5,
                opacity: v2Config.layers?.global?.radar?.opacity ?? v2Config.layers?.global_?.radar?.opacity ?? 0.7,
              },
            },
          },
        } as AppConfig;
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
        const prevAsV2 = prev as unknown as AppConfig;
        const newAsV2 = newData as unknown as AppConfig;

        const isPrevV2 = prevAsV2.version === 2 && prevAsV2.ui_map;
        const isNewV2 = newAsV2.version === 2 && newAsV2.ui_map;

        let prevMapConfig: Record<string, unknown>;
        let newMapConfig: Record<string, unknown>;

        if (isPrevV2 && isNewV2) {
          // Comparar v2 - incluir api_key para detectar cambios en la clave de MapTiler
          prevMapConfig = {
            provider: prevAsV2.ui_map?.provider,
            style: prevAsV2.ui_map?.maptiler?.styleUrl || prevAsV2.ui_map?.customXyz?.tileUrl || prevAsV2.ui_map?.local?.tileUrl,
            api_key: prevAsV2.ui_map?.maptiler?.api_key,
            style_name: prevAsV2.ui_map?.maptiler?.style,
            fixed: prevAsV2.ui_map?.fixed,
            viewMode: prevAsV2.ui_map?.viewMode,
          };
          newMapConfig = {
            provider: newAsV2.ui_map?.provider,
            style: newAsV2.ui_map?.maptiler?.styleUrl || newAsV2.ui_map?.customXyz?.tileUrl || newAsV2.ui_map?.local?.tileUrl,
            api_key: newAsV2.ui_map?.maptiler?.api_key,
            style_name: newAsV2.ui_map?.maptiler?.style,
            fixed: newAsV2.ui_map?.fixed,
            viewMode: newAsV2.ui_map?.viewMode,
          };
        } else {
          // Comparar v1 (legacy) - incluir api_key si está disponible
          const prevLegacy = prev as any;
          const newLegacy = newData as any;
          prevMapConfig = {
            provider: prevLegacy.ui?.map?.provider,
            style: prevLegacy.ui?.map?.style,
            xyz: prevLegacy.ui?.map?.xyz,
            api_key: (prevLegacy.ui?.map?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.apiKey ||
              (prevLegacy.ui?.map?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.key ||
              (prevLegacy.ui?.map?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.api_key,
            fixed: prevLegacy.ui?.map?.fixed,
            viewMode: prevLegacy.ui?.map?.viewMode,
          };
          newMapConfig = {
            provider: newLegacy.ui?.map?.provider,
            style: newLegacy.ui?.map?.style,
            xyz: newLegacy.ui?.map?.xyz,
            api_key: (newLegacy.ui?.map?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.apiKey ||
              (newLegacy.ui?.map?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.key ||
              (newLegacy.ui?.map?.maptiler as { apiKey?: string; key?: string; api_key?: string })?.api_key,
            fixed: newLegacy.ui?.map?.fixed,
            viewMode: newLegacy.ui?.map?.viewMode,
          };
        }

        const prevJson = JSON.stringify(prevMapConfig);
        const newJson = JSON.stringify(newMapConfig);
        const mapConfigChanged = prevJson !== newJson;

        if (mapConfigChanged) {
          console.log("[useConfig] Detected map config change", {
            prev: prevMapConfig,
            new: newMapConfig,
            prevJson,
            newJson,
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
          // Incrementar mapStyleVersion si cambió la configuración del mapa o el hot swap descriptor
          // Esto incluye cambios en api_key, styleUrl, provider, etc.
          // SIEMPRE incrementar cuando hay un cambio
          setMapStyleVersion((value) => {
            const newValue = value + 1;
            console.log("[useConfig] Incrementing mapStyleVersion", {
              from: value,
              to: newValue,
              reason: mapConfigChanged ? "mapConfigChanged" : "mapHotSwapChanged",
              mapConfigChanged,
              mapHotSwapChanged
            });
            return newValue;
          });
          return newData;
        }

        wasUpdated = true;
        return newData;
      });

      const meta = await getConfigMeta().catch(() => null);
      if (meta && meta.config_loaded_at) {
        metaTimestampRef.current = meta.config_loaded_at;
      }

      // Actualizar checksum solo si la carga fue exitosa
      if (currentChecksum) {
        configChecksumRef.current = currentChecksum;
      }

      // Solo disparar evento si realmente hubo cambios (wasUpdated) y no estamos recargando por el evento mismo
      if (wasUpdated) {
        // Usar debounce para evitar múltiples eventos seguidos
        if (reloadDebounceRef.current !== null) {
          window.clearTimeout(reloadDebounceRef.current);
        }
        reloadDebounceRef.current = window.setTimeout(() => {
          // Marcar flag antes de disparar evento para evitar bucle
          isReloadingRef.current = false;
          window.dispatchEvent(new CustomEvent("config-changed"));
        }, 100);
      } else {
        isReloadingRef.current = false;
      }

      setError(null);
      setLoading(false);
    } catch (e) {
      console.error("[useConfig] Error loading config:", e);
      setError(API_UNREACHABLE);
      setLoading(false);
      isReloadingRef.current = false;
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
      // Forzar recarga inmediata cuando se guarda desde /config
      void load(true);
    };

    const handleConfigChanged = () => {
      // Si ya estamos recargando, ignorar el evento para evitar bucle infinito
      if (isReloadingRef.current) {
        console.debug("[useConfig] Config changed event ignored (reload in progress)");
        return;
      }

      // Usar debounce para evitar múltiples recargas seguidas
      if (reloadDebounceRef.current !== null) {
        window.clearTimeout(reloadDebounceRef.current);
      }

      reloadDebounceRef.current = window.setTimeout(async () => {
        console.log("[useConfig] Config changed event received, checking for changes");
        // Verificar checksum antes de recargar
        try {
          const healthResponse = await fetch(`${API_ORIGIN}/api/health/full`, { cache: "no-store" });
          if (healthResponse.ok) {
            const healthData = await healthResponse.json().catch(() => null);
            const newChecksum = healthData?.config_checksum ?? null;

            // Solo recargar si el checksum cambió
            if (newChecksum && newChecksum !== configChecksumRef.current) {
              console.log("[useConfig] Checksum changed, reloading config");
              void load(true);
            } else {
              console.debug("[useConfig] Checksum unchanged, skipping reload");
            }
          } else {
            // Si falla health check, recargar de todas formas
            void load(true);
          }
        } catch (e) {
          console.debug("[useConfig] Failed to check checksum, reloading anyway", e);
          void load(true);
        }
      }, 500); // Debounce de 500ms
    };

    window.addEventListener("pantalla:config:saved", handleConfigSaved);
    window.addEventListener("config-changed", handleConfigChanged);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (reloadDebounceRef.current !== null) {
        window.clearTimeout(reloadDebounceRef.current);
        reloadDebounceRef.current = null;
      }
      window.removeEventListener("pantalla:config:saved", handleConfigSaved);
      window.removeEventListener("config-changed", handleConfigChanged);
    };
  }, [load]);

  return { data, prevData, loading, error, reload: load, mapStyleVersion };
}
