import maplibregl from "maplibre-gl";
import type { MapLibreEvent, StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import { apiGet, apiPost, saveConfig } from "../../lib/api";
import { useConfig } from "../../lib/useConfig";
import { applyMapStyle, computeStyleUrlFromConfig } from "../../kiosk/mapStyle";
import { kioskRuntime } from "../../lib/runtimeFlags";
import AircraftLayer from "./layers/AircraftLayer";
import GlobalRadarLayer from "./layers/GlobalRadarLayer";
import GlobalSatelliteLayer from "./layers/GlobalSatelliteLayer";
import AEMETWarningsLayer from "./layers/AEMETWarningsLayer";
import LightningLayer from "./layers/LightningLayer";
import WeatherLayer from "./layers/WeatherLayer";
import { LayerRegistry } from "./layers/LayerRegistry";
import SatelliteHybridLayer, { type SatelliteLabelsStyle } from "./layers/SatelliteHybridLayer";
import ShipsLayer from "./layers/ShipsLayer";
import MapSpinner from "../MapSpinner";
import { hasSprite } from "./utils/styleSprite";
import {
  createDefaultMapPreferences,
  createDefaultMapSettings,
  withConfigDefaults
} from "../../config/defaults";
import { DEFAULT_OPENSKY_CONFIG } from "../../config/defaults_v2";
import type {
  AppConfig,
  MapConfig,
  MapPreferences,
  MapThemeConfig,
  RotationConfig
} from "../../types/config";
import type {
  AppConfigV2,
  MapConfigV2
} from "../../types/config_v2";
import {
  loadMapStyle,
  type MapStyleDefinition,
  type MapStyleResult
} from "./mapStyle";
import { getMaptilerApiKey } from "../../lib/config";

// Vista fija por defecto (Castellón)
const DEFAULT_VIEW = {
  lng: 0.20,
  lat: 39.98,
  zoom: 9.0,
  bearing: 0,
  pitch: 0
};
const DEFAULT_MIN_ZOOM = 2.0;

const FALLBACK_THEME = createDefaultMapSettings().theme ?? {};

export type GeoScopeMapProps = {
  satelliteEnabled?: boolean;
  satelliteOpacity?: number;
  satelliteLabelsStyle?: SatelliteLabelsStyle;
};

const cloneTheme = (theme?: MapThemeConfig | null): MapThemeConfig => ({
  ...FALLBACK_THEME,
  ...(theme ?? {})
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const setPaintProperty = (
  map: maplibregl.Map,
  layerId: string,
  property: string,
  value: unknown
) => {
  if (value === undefined || value === null) {
    return;
  }
  if (!map.getLayer(layerId)) {
    return;
  }
  try {
    map.setPaintProperty(layerId, property, value);
  } catch {
    // TODO: The active style may not expose this property; ignore silently.
  }
};

const WATER_PATTERN = /(background|ocean|sea|water)/i;
const LAND_PATTERN = /(land|landcover|park|continent)/i;
const LABEL_PATTERN = /(label|place|road-name|poi)/i;

type LightningFeatureProperties = {
  timestamp?: number;
  intensity?: number;
};

type FlightFeatureProperties = {
  icao24?: string;
  callsign?: string;
  alt_baro?: number;
  track?: number;
  speed?: number;
  timestamp?: number;
  origin_country?: string;
  on_ground?: boolean;
  category?: string | number | null;
  vertical_rate?: number | null;
  squawk?: string | null;
  last_contact?: number | null;
  in_focus?: boolean;
  stale?: boolean;
};

type FlightsApiItem = {
  id: string;
  icao24?: string | null;
  callsign?: string | null;
  origin_country?: string | null;
  lon: number;
  lat: number;
  alt?: number | null;
  velocity?: number | null;
  vertical_rate?: number | null;
  track?: number | null;
  on_ground?: boolean;
  category?: string | number | null;
  squawk?: string | null;
  last_contact?: number | null;
  stale?: boolean | null;
};

type FlightsApiResponse = {
  count: number;
  ts?: number;
  stale?: boolean;
  disabled?: boolean;
  items: FlightsApiItem[];
};

type ShipFeatureProperties = {
  mmsi?: string;
  name?: string;
  course?: number;
  speed?: number;
  timestamp?: number;
  type?: string;
  in_focus?: boolean;
  stale?: boolean;
};

const isFeatureCollection = <G extends Geometry, P extends GeoJsonProperties = GeoJsonProperties>(
  value: unknown
): value is FeatureCollection<G, P> => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as FeatureCollection<G, P>;
  return candidate.type === "FeatureCollection" && Array.isArray(candidate.features);
};

const flightsResponseToGeoJSON = (payload: FlightsApiResponse): FeatureCollection<Point, FlightFeatureProperties> => {
  const timestampFallback = typeof payload.ts === "number" ? payload.ts : Math.floor(Date.now() / 1000);
  const features: Array<Feature<Point, FlightFeatureProperties>> = [];

  for (const item of payload.items) {
    if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) {
      continue;
    }
    const timestamp = typeof item.last_contact === "number" ? item.last_contact : timestampFallback;
    const isStale = item.stale === true;
    features.push({
      type: "Feature",
      id: item.id,
      geometry: {
        type: "Point",
        coordinates: [item.lon, item.lat],
      },
      properties: {
        icao24: item.icao24 ?? undefined,
        callsign: item.callsign ?? undefined,
        alt_baro: typeof item.alt === "number" ? item.alt : undefined,
        track: typeof item.track === "number" ? item.track : undefined,
        speed: typeof item.velocity === "number" ? item.velocity : undefined,
        origin_country: item.origin_country ?? undefined,
        on_ground: Boolean(item.on_ground),
        category: item.category ?? null,
        vertical_rate: typeof item.vertical_rate === "number" ? item.vertical_rate : undefined,
        squawk: item.squawk ?? null,
        timestamp,
        last_contact: typeof item.last_contact === "number" ? item.last_contact : undefined,
        stale: isStale ? true : undefined,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
};

const applyVectorTheme = (map: maplibregl.Map, theme: MapThemeConfig) => {
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  if (!layers.length) {
    return;
  }

  const sea = theme.sea ?? undefined;
  const land = theme.land ?? undefined;
  const label = theme.label ?? undefined;
  const contrast = typeof theme.contrast === "number" ? theme.contrast : 0;

  const fillOpacity = clamp(0.65 + contrast * 0.35, 0.3, 1);
  const lineOpacity = clamp(0.55 + contrast * 0.3, 0.2, 1);
  const backgroundOpacity = clamp(0.7 + contrast * 0.25, 0.4, 1);
  const labelOpacity = clamp(0.85 + contrast * 0.15, 0.5, 1);
  const haloOpacity = clamp(0.5 - contrast * 0.2, 0.25, 0.6);

  for (const layer of layers) {
    const id = layer.id;
    if (!id) {
      continue;
    }

    if (sea && WATER_PATTERN.test(id)) {
      if (layer.type === "background") {
        setPaintProperty(map, id, "background-color", sea);
        setPaintProperty(map, id, "background-opacity", backgroundOpacity);
      } else if (layer.type === "fill" || layer.type === "fill-extrusion") {
        setPaintProperty(map, id, "fill-color", sea);
        setPaintProperty(map, id, "fill-opacity", fillOpacity);
      } else if (layer.type === "line") {
        setPaintProperty(map, id, "line-color", sea);
        setPaintProperty(map, id, "line-opacity", lineOpacity);
      }
    }

    if (land && LAND_PATTERN.test(id)) {
      if (layer.type === "background") {
        setPaintProperty(map, id, "background-color", land);
        setPaintProperty(map, id, "background-opacity", backgroundOpacity);
      } else if (layer.type === "fill" || layer.type === "fill-extrusion") {
        setPaintProperty(map, id, "fill-color", land);
        setPaintProperty(map, id, "fill-opacity", fillOpacity);
      } else if (layer.type === "line") {
        setPaintProperty(map, id, "line-color", land);
        setPaintProperty(map, id, "line-opacity", lineOpacity);
      }
    }

    if (label && LABEL_PATTERN.test(id) && layer.type === "symbol") {
      setPaintProperty(map, id, "text-color", label);
      setPaintProperty(map, id, "text-opacity", labelOpacity);
      setPaintProperty(map, id, "text-halo-color", `rgba(0, 0, 0, ${haloOpacity.toFixed(2)})`);
      setPaintProperty(map, id, "icon-color", label);
      setPaintProperty(map, id, "icon-opacity", labelOpacity);
    }
  }
};

const applyRasterTheme = (map: maplibregl.Map, theme: MapThemeConfig) => {
  const contrast = typeof theme.contrast === "number" ? theme.contrast : 0;
  const saturationBoost = clamp(0.25 + contrast * 0.25, -1, 1);
  const contrastBoost = clamp(0.12 + contrast * 0.2, -1, 1);
  const brightnessMin = clamp(0.05 - contrast * 0.05, 0, 1);
  const brightnessMax = clamp(1.2 + contrast * 0.2, 0.5, 2);

  const rasterLayers = ["carto", "osm"];
  for (const layerId of rasterLayers) {
    setPaintProperty(map, layerId, "raster-saturation", saturationBoost);
    setPaintProperty(map, layerId, "raster-contrast", contrastBoost);
    setPaintProperty(map, layerId, "raster-brightness-min", brightnessMin);
    setPaintProperty(map, layerId, "raster-brightness-max", brightnessMax);
  }
};

const applyThemeToMap = (
  map: maplibregl.Map,
  styleType: MapStyleDefinition["type"],
  theme: MapThemeConfig
) => {
  if (styleType === "vector") {
    applyVectorTheme(map, theme);
    return;
  }

  applyRasterTheme(map, theme);
};

const normalizeLng = (lng: number) => ((lng + 540) % 360) - 180;
const lerp = (start: number, end: number, t: number) => start + (end - start) * t;
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const normalizeBearing = (bearing: number) => {
  let normalized = bearing % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
};


const parseBooleanParam = (value: string | null | undefined): boolean | undefined => {
  if (value == null) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return undefined;
};

const clampLatitude = (value: number) => clamp(value, -85, 85);

type MapLifecycleState = "IDLE" | "LOADING_STYLE" | "READY";

type MapStateMachine = {
  getState(): MapLifecycleState;
  notifyStyleLoading: (reason: string) => void;
  notifyStyleData: (source?: string) => void;
  notifyIdle: (source?: string) => void;
  reset: (reason?: string) => void;
};

type MapStateMachineOptions = {
  isStyleLoaded: () => boolean;
  onReady?: (source: string) => void;
  logger?: Pick<Console, "debug" | "warn" | "info" | "error">;
};

const createMapStateMachine = (options: MapStateMachineOptions): MapStateMachine => {
  const logger = options.logger ?? console;
  let state: MapLifecycleState = "IDLE";
  let styleDataSeen = false;

  const maybeReady = (source: string) => {
    if (state !== "LOADING_STYLE") {
      return;
    }
    if (!styleDataSeen) {
      logger.debug?.(`[map:fsm] waiting for styledata before ready (${source})`);
      return;
    }
    if (!options.isStyleLoaded()) {
      logger.debug?.(`[map:fsm] waiting for style load completion (${source})`);
      return;
    }
    state = "READY";
    logger.debug?.(`[map:fsm] -> READY (${source})`);
    options.onReady?.(source);
  };

  return {
    getState: () => state,
    notifyStyleLoading: (reason: string) => {
      state = "LOADING_STYLE";
      styleDataSeen = false;
      logger.debug?.(`[map:fsm] -> LOADING_STYLE (${reason})`);
    },
    notifyStyleData: (source = "styledata") => {
      if (state !== "LOADING_STYLE") {
        return;
      }
      styleDataSeen = true;
      logger.debug?.(`[map:fsm] styledata acknowledged (${source})`);
      maybeReady(source);
    },
    notifyIdle: (source = "idle") => {
      maybeReady(source);
    },
    reset: (reason = "reset") => {
      state = "IDLE";
      styleDataSeen = false;
      logger.debug?.(`[map:fsm] -> IDLE (${reason})`);
    },
  };
};

type RuntimePreferences = {
  mapSettings?: MapConfig;
  renderWorldCopies: boolean;
  style: MapStyleDefinition;
  fallbackStyle: MapStyleDefinition;
  styleWasFallback: boolean;
  theme: MapThemeConfig;
  respectReducedMotion: boolean;
  rotationEnabled: boolean;
};

const buildRuntimePreferences = (
  mapSettings: MapConfig,
  rotationSettings: RotationConfig,
  styleResult: MapStyleResult
): RuntimePreferences => {
  const defaults = createDefaultMapSettings();
  const source = mapSettings ?? defaults;
  const rotationEnabled = Boolean(rotationSettings?.enabled);

  return {
    mapSettings: source,
    renderWorldCopies: source.renderWorldCopies ?? defaults.renderWorldCopies ?? true,
    style: styleResult.resolved,
    fallbackStyle: styleResult.fallback,
    styleWasFallback: styleResult.usedFallback,
    theme: cloneTheme(source.theme),
    respectReducedMotion:
      typeof source.respectReducedMotion === "boolean"
        ? source.respectReducedMotion
        : defaults.respectReducedMotion ?? false,
    rotationEnabled,
  };
};

const loadRuntimePreferences = async (): Promise<RuntimePreferences> => {
  try {
    // Intentar cargar v2 primero
    let mapConfigV2: AppConfigV2 | undefined;
    let rotationSettings: RotationConfig | undefined;
    try {
      const { getConfigV2 } = await import("../../lib/api");
      const { withConfigDefaultsV2 } = await import("../../config/defaults_v2");
      const v2Config = await getConfigV2();
      if (v2Config && v2Config.version === 2 && v2Config.ui_map) {
        mapConfigV2 = withConfigDefaultsV2(v2Config);
        rotationSettings = { enabled: false, duration_sec: 10, panels: [] }; // Rotation viene de otro lugar
      } else {
        // Fallback a v1 si no hay v2
        const config = await apiGet<AppConfig | undefined>("/api/config");
        const merged = withConfigDefaults(config);
        const mapSettings = merged.ui.map;
        rotationSettings = merged.ui.rotation;
        // Convertir v1 a v2 para compatibilidad
        const v2FromV1: MapConfigV2 = {
          engine: "maplibre",
          provider: mapSettings.provider === "maptiler" ? "maptiler_vector" : "local_raster_xyz",
          renderWorldCopies: mapSettings.renderWorldCopies ?? true,
          interactive: mapSettings.interactive ?? false,
          controls: mapSettings.controls ?? false,
          local: {
            tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            minzoom: 0,
            maxzoom: 19,
          },
          maptiler: mapSettings.maptiler
            ? (() => {
                const legacyMaptiler = mapSettings.maptiler as typeof mapSettings.maptiler & {
                  api_key?: string | null;
                  urls?: Record<string, string | null>;
                };
                const resolvedKey =
                  legacyMaptiler.apiKey ??
                  legacyMaptiler.key ??
                  legacyMaptiler.api_key ??
                  null;
                const resolvedStyleUrl =
                  legacyMaptiler.styleUrl ??
                  legacyMaptiler.styleUrlDark ??
                  legacyMaptiler.styleUrlLight ??
                  legacyMaptiler.styleUrlBright ??
                  null;

                return {
                  api_key: resolvedKey,
                  apiKey: resolvedKey,
                  key: legacyMaptiler.key ?? resolvedKey,
                  style: mapSettings.style ?? null,
                  styleUrl: resolvedStyleUrl,
                  styleUrlDark: legacyMaptiler.styleUrlDark ?? null,
                  styleUrlLight: legacyMaptiler.styleUrlLight ?? null,
                  styleUrlBright: legacyMaptiler.styleUrlBright ?? null,
                  ...(legacyMaptiler.urls ? { urls: legacyMaptiler.urls } : {}),
                };
              })()
            : undefined,
          customXyz: undefined,
          viewMode: mapSettings.viewMode || "fixed",
          fixed: mapSettings.fixed ? {
            center: mapSettings.fixed.center,
            zoom: mapSettings.fixed.zoom,
            bearing: mapSettings.fixed.bearing || 0,
            pitch: mapSettings.fixed.pitch || 0,
          } : undefined,
          region: mapSettings.region ? { postalCode: mapSettings.region.postalCode } : undefined,
        };
        mapConfigV2 = {
          version: 2,
          ui_map: v2FromV1,
          ui_global: undefined,
          opensky: DEFAULT_OPENSKY_CONFIG,
          layers: undefined,
          panels: undefined,
          secrets: undefined,
        };
      }
    } catch (e) {
      // Si falla v2, intentar v1
      const config = await apiGet<AppConfig | undefined>("/api/config");
      const merged = withConfigDefaults(config);
      const mapSettings = merged.ui.map;
      rotationSettings = merged.ui.rotation;
      // Convertir v1 a v2 para compatibilidad
      const v2FromV1: MapConfigV2 = {
        engine: "maplibre",
        provider: "local_raster_xyz",
        renderWorldCopies: true,
        interactive: false,
        controls: false,
        local: {
          tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          minzoom: 0,
          maxzoom: 19,
        },
        maptiler: undefined,
        customXyz: undefined,
        viewMode: "fixed",
        fixed: {
          center: { lat: 39.98, lon: 0.20 },
          zoom: 9.0,
          bearing: 0,
          pitch: 0,
        },
        region: undefined,
      };
      mapConfigV2 = {
        version: 2,
        ui_map: v2FromV1,
        ui_global: undefined,
        opensky: DEFAULT_OPENSKY_CONFIG,
        layers: undefined,
        panels: undefined,
        secrets: undefined,
      };
    }
    
    if (!mapConfigV2) {
      throw new Error("No config loaded");
    }
    
    const ui_map = mapConfigV2.ui_map;
    
    // Si hay viewMode "fixed" y región con postalCode, geocodificar primero
    if (ui_map.viewMode === "fixed" && ui_map.region?.postalCode) {
      try {
        const { geocodePostalES } = await import("../../lib/api");
        const geocodeResult = await geocodePostalES(ui_map.region.postalCode);
        if (geocodeResult.ok && geocodeResult) {
          // Actualizar fixed.center con las coordenadas geocodificadas
          if (ui_map.fixed) {
            ui_map.fixed.center = {
              lat: geocodeResult.lat,
              lon: geocodeResult.lon,
            };
          }
        }
      } catch (geocodeError) {
        console.warn(
          "[GeoScopeMap] Failed to geocode postal code:",
          ui_map.region.postalCode,
          geocodeError
        );
        // Continuar con valores existentes si falla el geocoding
      }
    }
    
    const styleResult = await loadMapStyle(ui_map);
    
    // Convertir a formato compatible con buildRuntimePreferences
    // Construir un MapConfig compatible usando unknown para evitar errores de tipo
    const mapSettings = {
      engine: "maplibre" as const,
      provider: ui_map.provider === "maptiler_vector" ? "maptiler" : (ui_map.provider === "local_raster_xyz" ? "osm" : "xyz") as MapConfig["provider"],
      renderWorldCopies: ui_map.renderWorldCopies,
      interactive: ui_map.interactive,
      controls: ui_map.controls,
      viewMode: ui_map.viewMode,
      fixed: ui_map.fixed,
      region: ui_map.region,
      style: "vector-dark" as const,
      theme: { sea: "#0b3756", land: "#20262c", label: "#d6e7ff", contrast: 0.15, tint: "rgba(0,170,255,0.06)" },
      respectReducedMotion: false,
      maptiler: ui_map.provider === "maptiler_vector"
        ? {
            key: ui_map.maptiler?.api_key ?? ui_map.maptiler?.apiKey ?? ui_map.maptiler?.key ?? null,
            apiKey: ui_map.maptiler?.api_key ?? ui_map.maptiler?.apiKey ?? null,
            styleUrlDark: ui_map.maptiler?.styleUrl ?? null,
          }
        : undefined,
      cinema: undefined,
      idlePan: undefined,
    } as unknown as MapConfig;
    
    return buildRuntimePreferences(mapSettings, rotationSettings || { enabled: false, duration_sec: 10, panels: [] }, styleResult);
  } catch (error) {
    console.warn(
      "[GeoScopeMap] Falling back to default configuration (using defaults).",
      error
    );
    const fallbackSettings = createDefaultMapSettings();
    const fallbackPreferences = createDefaultMapPreferences();
    const fallbackMapConfigV2: MapConfigV2 = {
      engine: "maplibre",
      provider: "maptiler_vector",
      renderWorldCopies: true,
      interactive: false,
      controls: false,
      local: {
        tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        minzoom: 0,
        maxzoom: 19,
      },
      maptiler: {
        api_key: null,
        style: "vector-bright",
        styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json",
        apiKey: null,
        key: null,
      },
      customXyz: { tileUrl: null, minzoom: 0, maxzoom: 19 },
      viewMode: "fixed",
      fixed: {
        center: { lat: 39.98, lon: 0.20 },
        zoom: 9.0,
        bearing: 0,
        pitch: 0,
      },
      region: { postalCode: "12001" },
    };
    const styleResult = await loadMapStyle(fallbackMapConfigV2);
    const fallbackRotation = withConfigDefaults(undefined).ui.rotation;
    return buildRuntimePreferences(fallbackSettings, fallbackRotation, styleResult);
  }
};

// Verificar disponibilidad de WebGL
function checkWebGLSupport(): { supported: boolean; reason?: string } {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    
    if (!gl) {
      return { supported: false, reason: "WebGL no está disponible en este navegador" };
    }
    
    // Verificar que WebGL esté realmente funcional
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (!debugInfo) {
      return { supported: false, reason: "WebGL no está completamente funcional" };
    }
    
    return { supported: true };
  } catch (error) {
    return { supported: false, reason: `Error verificando WebGL: ${error}` };
  }
}

export default function GeoScopeMap({
  satelliteEnabled = false,
  satelliteOpacity,
  satelliteLabelsStyle = "maptiler-streets-v4-labels",
}: GeoScopeMapProps = {}) {
  const { data: config, reload: reloadConfig, mapStyleVersion } = useConfig();
  const maptilerKey = useMemo(() => getMaptilerApiKey(config), [config]);
  const uiMapSatellite = useMemo(() => {
    const v2Config = config as unknown as AppConfigV2 | null;
    if (v2Config?.version === 2 && v2Config.ui_map?.satellite) {
      return v2Config.ui_map.satellite;
    }
    return null;
  }, [config]);
  const effectiveSatelliteOpacity =
    uiMapSatellite?.opacity ?? satelliteOpacity ?? 0.85;
  const effectiveLabelsEnabled =
    uiMapSatellite?.labels_enabled ??
    (satelliteLabelsStyle !== "none");
  const effectiveSatelliteEnabled = Boolean(
    (uiMapSatellite?.enabled ?? satelliteEnabled) && maptilerKey,
  );
  const mapFillRef = useRef<HTMLDivElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [styleChangeInProgress, setStyleChangeInProgress] = useState(false);
  // Estados para controles de radar animado
  const [radarPlaying, setRadarPlaying] = useState(true);
  const [radarPlaybackSpeed, setRadarPlaybackSpeed] = useState(1.0);
  const [radarOpacity, setRadarOpacity] = useState(0.7);
  
  // Recargar config cuando la página se vuelve visible (después de guardar en /config)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        reloadConfig();
      }
    };
    
    const handleFocus = () => {
      reloadConfig();
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [reloadConfig]);

  useEffect(() => {
    webglErrorRef.current = webglError;
  }, [webglError]);
  
  // Listeners globales de errores (opcional)
  useEffect(() => {
    const handleWindowError = (ev: ErrorEvent) => {
      const errorMsg = ev.error?.message || ev.message || String(ev.error || ev);
      fetch("/api/logs/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ts: Date.now(), where: "window.error", msg: errorMsg, level: "error" }),
      }).catch(() => {});
    };
    
    const handleUnhandledRejection = (ev: PromiseRejectionEvent) => {
      const reason = (ev as any)?.reason || "unhandled";
      fetch("/api/logs/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ts: Date.now(), where: "promise", msg: String(reason), level: "error" }),
      }).catch(() => {});
    };
    
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    
    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);
  
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dprMediaRef = useRef<MediaQueryList | null>(null);
  const viewStateRef = useRef({ ...DEFAULT_VIEW });
  const currentMinZoomRef = useRef(DEFAULT_MIN_ZOOM);
  const themeRef = useRef<MapThemeConfig>(cloneTheme(null));
  const styleTypeRef = useRef<MapStyleDefinition["type"]>("raster");
  const fallbackStyleRef = useRef<MapStyleDefinition | null>(null);
  const fallbackAppliedRef = useRef(false);
  const respectReducedMotionRef = useRef(false);
  const reducedMotionMediaRef = useRef<MediaQueryList | null>(null);
  const reducedMotionActiveRef = useRef(false);
  const webglErrorRef = useRef<string | null>(null);
  const aircraftLayerRef = useRef<AircraftLayer | null>(null);
  const globalRadarLayerRef = useRef<GlobalRadarLayer | null>(null);
  const globalSatelliteLayerRef = useRef<GlobalSatelliteLayer | null>(null);
  const aemetWarningsLayerRef = useRef<AEMETWarningsLayer | null>(null);
  const lightningLayerRef = useRef<LightningLayer | null>(null);
  const weatherLayerRef = useRef<WeatherLayer | null>(null);
  const layerRegistryRef = useRef<LayerRegistry | null>(null);
  const shipsLayerRef = useRef<ShipsLayer | null>(null);
  const satelliteLayerRef = useRef<SatelliteHybridLayer | null>(null);
  const stormModeActiveRef = useRef(false);
  const respectDefaultRef = useRef(false);
  const [tintColor, setTintColor] = useState<string | null>(null);
  const mapStateMachineRef = useRef<MapStateMachine | null>(null);
  const runtimeRef = useRef<RuntimePreferences | null>(null);
  const styleLoadedHandlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const layer = satelliteLayerRef.current;
    if (!layer) {
      return;
    }
    layer.setApiKey(maptilerKey);
  }, [maptilerKey]);

  useEffect(() => {
    const layer = satelliteLayerRef.current;
    if (!layer) {
      return;
    }
    layer.setOpacity(effectiveSatelliteOpacity);
  }, [effectiveSatelliteOpacity]);

  useEffect(() => {
    const layer = satelliteLayerRef.current;
    if (!layer) {
      return;
    }
    layer.setLabelsEnabled(effectiveLabelsEnabled);
  }, [effectiveLabelsEnabled]);

  useEffect(() => {
    const layer = satelliteLayerRef.current;
    if (!layer) {
      return;
    }
    layer.setEnabled(effectiveSatelliteEnabled);
  }, [effectiveSatelliteEnabled]);


  const updateMapView = (map: maplibregl.Map) => {
    const viewState = viewStateRef.current;
    if (!viewState) {
      return;
    }
    // Siempre mantener bearing en 0 (sin rotación)
    map.jumpTo({
      center: [viewState.lng, viewState.lat],
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: 0
    });
  };

  useEffect(() => {
    let destroyed = false;
    let sizeCheckFrame: number | null = null;
    let styleErrorHandler: ((event: MapLibreEvent & { error?: unknown }) => void) | null =
      null;

    const safeFit = () => {
      const map = mapRef.current;
      const host = mapFillRef.current;

      if (!map || !host) return;

      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) {
        console.warn("[GeoScopeMap] resize skipped: host has no size");
        return;
      }

      map.resize();
      map.setMinZoom(currentMinZoomRef.current);
      updateMapView(map);
    };


    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      reducedMotionActiveRef.current = event.matches;
    };

    const applyReducedMotionPreference = (respect: boolean) => {
      respectReducedMotionRef.current = respect;
      const existing = reducedMotionMediaRef.current;
      if (existing) {
        existing.removeEventListener("change", handleReducedMotionChange);
        reducedMotionMediaRef.current = null;
      }

      if (!respect || typeof window.matchMedia !== "function") {
        reducedMotionActiveRef.current = false;
        return;
      }

      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotionActiveRef.current = media.matches;
      media.addEventListener("change", handleReducedMotionChange);
      reducedMotionMediaRef.current = media;
    };

    const refreshRuntimePolicy = (defaultRespect?: boolean) => {
      const baseRespect = defaultRespect ?? respectDefaultRef.current;
      const effectiveRespect = kioskRuntime.shouldRespectReducedMotion(baseRespect ?? false);
      applyReducedMotionPreference(effectiveRespect);
    };

    const requestBackendReset = async (reason: string) => {
      try {
        await fetch("/api/map/reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        });
      } catch (error) {
        console.warn("[map] failed to notify backend reset endpoint", error);
      }
    };

    const attachStateMachine = (map: maplibregl.Map, reason: string) => {
      mapStateMachineRef.current?.reset("reinitialize");
      const machine = createMapStateMachine({
        isStyleLoaded: () => Boolean(mapRef.current?.isStyleLoaded()),
        onReady: (source) => {
          // No iniciar animaciones automáticas
        },
        logger: console,
      });
      mapStateMachineRef.current = machine;
      machine.notifyStyleLoading(reason);
      if (map.isStyleLoaded()) {
        machine.notifyStyleData("immediate");
        machine.notifyIdle("immediate");
      }
    };

    const handleDprChange = () => {
      safeFit();
      const previous = dprMediaRef.current;
      if (previous) {
        previous.removeEventListener("change", handleDprChange);
      }
      if (window.matchMedia) {
        const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        media.addEventListener("change", handleDprChange);
        dprMediaRef.current = media;
      }
    };

    const waitForStableSize = (): Promise<HTMLDivElement | null> => {
      return new Promise((resolve) => {
        let stableFrames = 0;

        const check = () => {
          if (destroyed) {
            resolve(null);
            return;
          }

          const host = mapFillRef.current;
          if (!host) {
            resolve(null);
            return;
          }

          const { width, height } = host.getBoundingClientRect();
          if (width > 0 && height > 0) {
            stableFrames += 1;
          } else {
            stableFrames = 0;
          }

          if (stableFrames >= 2) {
            sizeCheckFrame = null;
            resolve(host);
            return;
          }

          sizeCheckFrame = requestAnimationFrame(check);
        };

        sizeCheckFrame = requestAnimationFrame(check);
      });
    };

    const handleLoad = () => {
      const map = mapRef.current;
      if (map) {
        const styleType = styleTypeRef.current;
        const theme = themeRef.current;
        if (styleType && theme) {
          applyThemeToMap(map, styleType, theme);
        }
      }
      safeFit();
      mapStateMachineRef.current?.notifyStyleData("load");
      mapStateMachineRef.current?.notifyIdle("load");
    };

    const handleStyleData = () => {
      const map = mapRef.current;
      if (map) {
        const styleType = styleTypeRef.current;
        const theme = themeRef.current;
        if (styleType && theme) {
          applyThemeToMap(map, styleType, theme);
        }
      }
      safeFit();
      mapStateMachineRef.current?.notifyStyleData();
    };

    const handleIdle = () => {
      mapStateMachineRef.current?.notifyIdle();
    };

    const handleContextLost = (
      event: MapLibreEvent & { originalEvent?: WebGLContextEvent }
    ) => {
      event.originalEvent?.preventDefault();
      safeFit();
    };

    const handleWebGLContextLost = (
      event: MapLibreEvent & { originalEvent?: WebGLContextEvent }
    ) => {
      console.error("[GeoScopeMap] WebGL context lost");
      setWebglError("El contexto WebGL se perdió. El mapa puede no funcionar correctamente.");
      handleContextLost(event);
    };

    const handleMapError = (event: MapLibreEvent & { error?: unknown }) => {
      console.error("[GeoScopeMap] Map error:", event);
      if (styleErrorHandler) {
        styleErrorHandler(event);
        return;
      }
      const error = event.error;
      const errorMsg = error instanceof Error ? error.message : String(error || "Error desconocido");
      setWebglError(`Error en el mapa: ${errorMsg}`);
    };

    const handleContextRestored = () => {
      safeFit();
    };

    const handleVisibilityChange = () => {
      // No hacer nada - no hay animaciones que detener
    };

    const setupResizeObserver = (target: Element) => {
      const observer = new ResizeObserver(() => {
        safeFit();
      });

      observer.observe(target);
      resizeObserverRef.current = observer;
    };

    const initializeMap = async () => {
      // Verificar WebGL antes de continuar
      const webglCheck = checkWebGLSupport();
      if (!webglCheck.supported) {
        console.error("[GeoScopeMap] WebGL no disponible:", webglCheck.reason);
        setWebglError(webglCheck.reason || "WebGL no está disponible");
        return;
      }
      
      setWebglError(null);
      const hostPromise = waitForStableSize();
      const runtime = await loadRuntimePreferences();
      runtimeRef.current = runtime;
      respectDefaultRef.current = Boolean(runtime.respectReducedMotion);

      if (destroyed) {
        return;
      }

      const host = await hostPromise;

      if (!host || destroyed || mapRef.current) return;

      const mapSettings = runtime.mapSettings;
      const viewMode = mapSettings?.viewMode ?? "fixed"; // Por defecto fixed para v2
      
      // Por defecto usar fixed view (v2)
      let viewState = viewStateRef.current;
      if (!viewState) {
        return;
      }
      
      // Vista fija por defecto (v2)
      if (viewMode === "fixed") {
        if (mapSettings?.fixed) {
          const fixedView = mapSettings.fixed;
          viewState.lat = fixedView.center.lat;
          viewState.lng = fixedView.center.lon;
          viewState.zoom = fixedView.zoom;
          viewState.bearing = fixedView.bearing ?? 0;
          viewState.pitch = fixedView.pitch ?? 0;
        } else {
          // Defaults de Castellón si no hay fixed config
          viewState.lat = 39.98;
          viewState.lng = 0.20;
          viewState.zoom = 9.0;
          viewState.bearing = 0;
          viewState.pitch = 0;
        }
      } else if (viewMode === "aoiCycle" && mapSettings?.aoiCycle) {
        // Modo aoiCycle (legacy) - mantener soporte por ahora
        const aoiCycle = mapSettings.aoiCycle;
        const firstStop = aoiCycle.stops?.[0];
        if (firstStop) {
          viewState.lat = firstStop.center.lat;
          viewState.lng = firstStop.center.lon;
          viewState.zoom = firstStop.zoom;
          viewState.bearing = firstStop.bearing ?? 0;
          viewState.pitch = firstStop.pitch ?? 0;
        }
      }
      
      viewState = viewStateRef.current;
      if (!viewState) {
        return;
      }

      themeRef.current = cloneTheme(runtime.theme);
      styleTypeRef.current = runtime.style.type;
      fallbackStyleRef.current = runtime.fallbackStyle;
      fallbackAppliedRef.current =
        runtime.styleWasFallback || runtime.style.type !== "vector";

      if (!destroyed) {
        const tintCandidate = runtime.theme?.tint ?? null;
        if (typeof tintCandidate === "string" && tintCandidate.trim().length > 0) {
          setTintColor(tintCandidate);
        } else {
          setTintColor(null);
        }
      }

      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: host,
          style: runtime.style.style,
          center: viewState ? [viewState.lng, viewState.lat] : [0, 0],
          zoom: viewState?.zoom ?? 2.6,
          minZoom: viewMode === "fixed" ? (mapSettings?.fixed?.zoom ?? 9.0) - 2 : 0,
          pitch: viewState?.pitch ?? 0,
          bearing: viewState?.bearing ?? 0,
          interactive: false,
          attributionControl: false,
          renderWorldCopies: runtime.renderWorldCopies,
          trackResize: false
        });
      } catch (error) {
        console.error("[GeoScopeMap] Failed to create map:", error);
        setWebglError(`Error al inicializar el mapa: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      mapRef.current = map;
      // Configurar minZoom según viewMode
      if (viewMode === "fixed") {
        const fixedZoom = mapSettings?.fixed?.zoom ?? 9.0;
        map.setMinZoom(Math.max(fixedZoom - 2, 0));
      } else {
        // Para otros modos, usar zoom mínimo razonable
        map.setMinZoom(0);
      }
      refreshRuntimePolicy(runtime.respectReducedMotion);

      attachStateMachine(map, "initial-style");

      const applyFallbackStyle = (reason?: unknown) => {
        if (fallbackAppliedRef.current) {
          return;
        }
        const fallbackStyle = fallbackStyleRef.current;
        if (!fallbackStyle) {
          return;
        }
        fallbackAppliedRef.current = true;
        styleTypeRef.current = fallbackStyle.type;
        console.warn("[map] vector style failed, using raster fallback", reason);
        const center = map.getCenter();
        const zoom = map.getZoom();
        const pitch = map.getPitch();
        const bearing = 0;
        console.debug("[map] applyStyle (fallback) preserving view", { center, zoom, pitch });
        map.setStyle(fallbackStyle.style as maplibregl.StyleSpecification);
        mapStateMachineRef.current?.notifyStyleLoading("fallback-style");
        // Reaplicar vista tras style load
        map.once("load", async () => {
          let spriteAvailable = false;
          try {
            const style = map.getStyle() as StyleSpecification | undefined;
            spriteAvailable = style ? await hasSprite(style) : false;
          } catch {
            spriteAvailable = false;
          }
          aircraftLayerRef.current?.setSpriteAvailability(spriteAvailable);
          map.jumpTo({ center, zoom, pitch, bearing });
        });
      };

      styleErrorHandler = (event: MapLibreEvent & { error?: unknown }) => {
        if (styleTypeRef.current !== "vector" || fallbackAppliedRef.current) {
          return;
        }
        const error = event.error as
          | {
              status?: number;
              message?: string;
              error?: unknown;
            }
          | undefined;
        const innerError = (error?.error as { status?: number; message?: string }) ?? undefined;
        const statusCandidate =
          typeof error?.status === "number"
            ? error.status
            : typeof innerError?.status === "number"
            ? innerError.status
            : undefined;
        const messageCandidate =
          typeof error?.message === "string"
            ? error.message
            : typeof innerError?.message === "string"
            ? innerError.message
            : "";
        if (typeof statusCandidate === "number" && statusCandidate >= 400) {
          applyFallbackStyle(error);
          return;
        }
        if (
          messageCandidate &&
          /style/i.test(messageCandidate) &&
          /fail|unauthorized|forbidden|error/i.test(messageCandidate)
        ) {
          applyFallbackStyle(error);
        }
      };

      map.on("load", handleLoad);
      map.on("styledata", handleStyleData);
      map.on("idle", handleIdle);
      map.on("webglcontextlost", handleWebGLContextLost);
      map.on("webglcontextrestored", handleContextRestored);
      map.on("error", handleMapError);

      // Asegurar que la capa de vuelos se reestablezca después de cambios de estilo
      const handleEnsureFlightsLayer = async () => {
        const aircraftLayer = aircraftLayerRef.current;
        if (aircraftLayer) {
          await aircraftLayer.ensureFlightsLayer();
        }
      };
      map.on("styledata", handleEnsureFlightsLayer);
      map.on("load", handleEnsureFlightsLayer);

      const handleEnsureAEMETWarningsLayer = async () => {
        const aemetLayer = aemetWarningsLayerRef.current;
        if (aemetLayer) {
          await aemetLayer.ensureWarningsLayer();
        }
      };
      map.on("styledata", handleEnsureAEMETWarningsLayer);
      map.on("load", handleEnsureAEMETWarningsLayer);

      const handleEnsureShipsLayer = async () => {
        const shipsLayer = shipsLayerRef.current;
        if (shipsLayer) {
          await shipsLayer.ensureShipsLayer();
        }
      };
      map.on("styledata", handleEnsureShipsLayer);
      map.on("load", handleEnsureShipsLayer);

      // Guardar referencia para cleanup
      const ensureFlightsLayerHandler = handleEnsureFlightsLayer;

      // Inicializar sistema de capas cuando el mapa esté listo
      map.once("load", async () => {
        if (destroyed || !mapRef.current) return;
        
        const layerRegistry = new LayerRegistry(map);
        layerRegistryRef.current = layerRegistry;

        const satelliteLayer = new SatelliteHybridLayer({
          apiKey: maptilerKey,
          enabled: effectiveSatelliteEnabled,
          opacity: effectiveSatelliteOpacity,
          labelsEnabled: effectiveLabelsEnabled,
          zIndex: 5,
        });
        layerRegistry.add(satelliteLayer);
        satelliteLayerRef.current = satelliteLayer;

        // Inicializar LightningLayer (siempre habilitado si hay datos)
        const lightningLayer = new LightningLayer({ enabled: true });
        layerRegistry.add(lightningLayer);
        lightningLayerRef.current = lightningLayer;

        // Inicializar AircraftLayer y ShipsLayer según configuración
        // Usar defaults si config aún no está disponible
        const mergedConfig = config ? withConfigDefaults(config) : withConfigDefaults();

          // Global Satellite Layer (z-index 10, debajo de AEMET)
          const globalSatelliteConfig = mergedConfig.layers.global?.satellite;
          if (globalSatelliteConfig?.enabled) {
            const globalSatelliteLayer = new GlobalSatelliteLayer({
              enabled: globalSatelliteConfig.enabled,
              opacity: globalSatelliteConfig.opacity,
            });
            layerRegistry.add(globalSatelliteLayer);
            globalSatelliteLayerRef.current = globalSatelliteLayer;
          }

          // Global Radar Layer (z-index 10, debajo de AEMET)
          const globalRadarConfig = mergedConfig.layers.global?.radar;
          if (globalRadarConfig?.enabled) {
            const globalRadarLayer = new GlobalRadarLayer({
              enabled: globalRadarConfig.enabled,
              opacity: globalRadarConfig.opacity,
            });
            layerRegistry.add(globalRadarLayer);
            globalRadarLayerRef.current = globalRadarLayer;
          }

          // Weather Layer (z-index 12, entre radar/satélite y AEMET warnings)
          // Leer configuración AEMET desde v2 o v1
          const configAsV2Init = config as unknown as { 
            version?: number; 
            aemet?: { enabled?: boolean; cap_enabled?: boolean; cache_minutes?: number };
            layers?: { flights?: typeof mergedConfig.layers.flights }; 
            opensky?: typeof mergedConfig.opensky;
          };
          const aemetConfigInit = configAsV2Init.version === 2 
            ? configAsV2Init.aemet 
            : mergedConfig.aemet;
          if (aemetConfigInit?.enabled && aemetConfigInit?.cap_enabled) {
            const weatherLayer = new WeatherLayer({
              enabled: true,
              opacity: 0.3,
              refreshSeconds: (aemetConfigInit.cache_minutes ?? 15) * 60,
            });
            layerRegistry.add(weatherLayer);
            weatherLayerRef.current = weatherLayer;
          }

          // AEMET Warnings Layer (z-index 15, entre radar y vuelos)
          if (aemetConfigInit?.enabled && aemetConfigInit?.cap_enabled) {
            const aemetWarningsLayer = new AEMETWarningsLayer({
              enabled: true,
              opacity: 0.6,
              minSeverity: "moderate",
              refreshSeconds: (aemetConfigInit.cache_minutes ?? 15) * 60,
            });
            layerRegistry.add(aemetWarningsLayer);
            aemetWarningsLayerRef.current = aemetWarningsLayer;
          }

          // AircraftLayer
          // Leer configuración desde v2 o v1 (usando la misma variable configAsV2Init)
          const flightsConfig = configAsV2Init.version === 2 && configAsV2Init.layers?.flights
            ? configAsV2Init.layers.flights
            : mergedConfig.layers.flights;
          const openskyConfig = configAsV2Init.version === 2 && configAsV2Init.opensky
            ? configAsV2Init.opensky
            : mergedConfig.opensky;

          const initializeAircraftLayer = async () => {
            let spriteAvailable = false;
            try {
              const style = map.getStyle() as StyleSpecification | undefined;
              spriteAvailable = style ? await hasSprite(style) : false;
            } catch {
              spriteAvailable = false;
            }
            if (destroyed || !mapRef.current) {
              return;
            }

            const aircraftLayer = new AircraftLayer({
              enabled: flightsConfig.enabled,
              opacity: flightsConfig.opacity,
              maxAgeSeconds: flightsConfig.max_age_seconds,
              cluster: openskyConfig.cluster,
              styleScale: flightsConfig.styleScale ?? 1,
              renderMode: flightsConfig.render_mode ?? "auto",
              circle: flightsConfig.circle,
              symbol: flightsConfig.symbol,
              spriteAvailable,
            });
            layerRegistry.add(aircraftLayer);
            aircraftLayerRef.current = aircraftLayer;
          };

          void initializeAircraftLayer();

          // ShipsLayer
          // Leer configuración desde v2 o v1
          const configAsV2ShipsInit = config as unknown as { 
            version?: number; 
            layers?: { ships?: typeof mergedConfig.layers.ships };
          };
          const shipsConfig = configAsV2ShipsInit.version === 2 && configAsV2ShipsInit.layers?.ships
            ? configAsV2ShipsInit.layers.ships
            : mergedConfig.layers.ships;
          let spriteAvailableShips = false;
          try {
            const style = map.getStyle() as StyleSpecification | undefined;
            spriteAvailableShips = style ? await hasSprite(style) : false;
          } catch {
            spriteAvailableShips = false;
          }
          if (!destroyed && mapRef.current) {
            const shipsLayer = new ShipsLayer({
              enabled: shipsConfig.enabled,
              opacity: shipsConfig.opacity,
              maxAgeSeconds: shipsConfig.max_age_seconds,
              styleScale: shipsConfig.styleScale,
              renderMode: shipsConfig.render_mode,
              circle: shipsConfig.circle,
              symbol: shipsConfig.symbol,
              spriteAvailable: spriteAvailableShips,
            });
            layerRegistry.add(shipsLayer);
            shipsLayerRef.current = shipsLayer;
          }
      });

      setupResizeObserver(host);

      if (window.matchMedia) {
        const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        media.addEventListener("change", handleDprChange);
        dprMediaRef.current = media;
      }

      kioskRuntime.ensureKioskDetection().then(() => {
        if (!destroyed) {
          refreshRuntimePolicy(runtime.respectReducedMotion);
        }
      });

      // Watchdog por checksum: polling cada 5s para detectar cambios de configuración
      let lastChecksum: string | null = null;
      
      async function pollHealthAndReact(map: maplibregl.Map) {
        try {
          const h = await fetch("/api/health/full", { cache: "no-store" }).then((r) => r.json());
          const current = h?.config_checksum || null;
          
          if (current && current !== lastChecksum) {
            lastChecksum = current;
            
            // Leer config fresca
            const cfg = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
            
            // Obtener styleUrl desde la configuración
            const merged = withConfigDefaults(cfg);
            const mapSettings = merged.ui?.map;
            const styleUrl = computeStyleUrlFromConfig(mapSettings?.maptiler ? {
              maptiler: mapSettings.maptiler,
              style: mapSettings.style || "vector-dark",
            } : null);
            
            if (styleUrl) {
              await applyMapStyle(map, styleUrl, current);
            }
          }
        } catch (e) {
          // Log error pero continuar polling
          console.warn("[map] pollHealthAndReact error:", e);
          try {
            await fetch("/api/logs/client", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ts: Date.now(), where: "pollHealthAndReact", msg: String(e), level: "error" }),
            }).catch(() => {});
          } catch {}
        } finally {
          if (!destroyed) {
            setTimeout(() => pollHealthAndReact(map), 5000);
          }
        }
      }
      
      // Iniciar polling después de que el mapa esté listo
      map.once("load", () => {
        if (!destroyed && mapRef.current) {
          // Obtener checksum inicial
          fetch("/api/health/full", { cache: "no-store" })
            .then((r) => r.json())
            .then((h) => {
              lastChecksum = h?.config_checksum || null;
              // Iniciar polling
              setTimeout(() => pollHealthAndReact(map), 5000);
            })
            .catch(() => {
              // Si falla, iniciar polling de todos modos
              setTimeout(() => pollHealthAndReact(map), 5000);
            });
        }
      });

      // Listener para reinyectar capas después de cambiar estilo
      const handleStyleLoaded = () => {
        if (destroyed || !mapRef.current) return;
        // Reinyectar capas usando LayerRegistry
        layerRegistryRef.current?.reapply();
        
        // Reinyectar capas específicas que tienen métodos ensure*
        const merged = withConfigDefaults(config || {});
        const configAsV2 = (config || {}) as unknown as {
          version?: number;
          aemet?: { enabled?: boolean; cap_enabled?: boolean };
          layers?: { flights?: typeof merged.layers.flights; ships?: typeof merged.layers.ships };
          opensky?: typeof merged.opensky;
        };
        
        // Reinyectar radar AEMET (avisos)
        if (configAsV2.aemet?.enabled && configAsV2.aemet?.cap_enabled) {
          const aemetWarningsLayer = aemetWarningsLayerRef.current;
          if (aemetWarningsLayer) {
            void aemetWarningsLayer.ensureWarningsLayer();
          }
        }
        
        // Reinyectar barcos
        const shipsLayer = shipsLayerRef.current;
        if (shipsLayer) {
          void shipsLayer.ensureShipsLayer();
        }
        
        // Reinyectar aviones
        const aircraftLayer = aircraftLayerRef.current;
        if (aircraftLayer) {
          void aircraftLayer.ensureFlightsLayer();
        }
      };
      
      window.addEventListener("map:style:loaded", handleStyleLoaded);
      
      // Guardar handler para cleanup
      styleLoadedHandlerRef.current = handleStyleLoaded;
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    void initializeMap();

    return () => {
      destroyed = true;

      if (sizeCheckFrame != null) {
        cancelAnimationFrame(sizeCheckFrame);
        sizeCheckFrame = null;
      }


      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      const media = dprMediaRef.current;
      if (media) {
        media.removeEventListener("change", handleDprChange);
        dprMediaRef.current = null;
      }

      const reduced = reducedMotionMediaRef.current;
      if (reduced) {
        reduced.removeEventListener("change", handleReducedMotionChange);
        reducedMotionMediaRef.current = null;
      }

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }

      // Limpiar sistema de capas
      const layerRegistry = layerRegistryRef.current;
      if (layerRegistry) {
        layerRegistry.destroy();
        layerRegistryRef.current = null;
      }
      satelliteLayerRef.current = null;
      aircraftLayerRef.current = null;
      globalRadarLayerRef.current = null;
      globalSatelliteLayerRef.current = null;
      aemetWarningsLayerRef.current = null;
      lightningLayerRef.current = null;
      weatherLayerRef.current = null;
      shipsLayerRef.current = null;

      const map = mapRef.current;
      if (map) {
        map.off("load", handleLoad);
        map.off("styledata", handleStyleData);
        map.off("idle", handleIdle);
        map.off("webglcontextlost", handleWebGLContextLost);
        map.off("webglcontextrestored", handleContextRestored);
        map.off("error", handleMapError);
        styleErrorHandler = null;
        map.remove();
        mapRef.current = null;
      }
      
      // Limpiar listener de map:style:loaded
      const styleLoadedHandler = styleLoadedHandlerRef.current;
      if (styleLoadedHandler) {
        window.removeEventListener("map:style:loaded", styleLoadedHandler);
        styleLoadedHandlerRef.current = null;
      }
      
      mapStateMachineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!config || !mapRef.current) {
      return;
    }
    if (mapStyleVersion === 0) {
      return;
    }

    let cancelled = false;
    const map = mapRef.current;
    let cleanup: (() => void) | null = null;
    let styleLoadTimeout: ReturnType<typeof setTimeout> | null = null;

    // Función para loguear errores al backend
    const logError = async (error: Error | string) => {
      try {
        const errorMessage = typeof error === "string" ? error : error.message || String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        await apiPost("/api/logs/client", {
          level: "error",
          message: `[GeoScopeMap] ${errorMessage}`,
          stack: errorStack,
          timestamp: new Date().toISOString(),
        });
      } catch (logError) {
        // Ignorar errores de logging
        console.warn("[GeoScopeMap] Failed to log error to backend", logError);
      }
    };

    const applyStyleChange = async () => {
      if (!map) {
        return;
      }

      setStyleChangeInProgress(true);
      mapStateMachineRef.current?.notifyStyleLoading("config-style-change");

      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom();
      const currentBearing = map.getBearing();
      const currentPitch = map.getPitch();
      const previousMinZoom = map.getMinZoom();

      try {
        const merged = withConfigDefaults(config);
        const mapSettings = merged.ui.map;
        const mapPreferences = merged.map ?? createDefaultMapPreferences();

        // Convertir a MapConfigV2 para loadMapStyle
        // Calcular checksum para cache-buster (usar mapStyleVersion o timestamp)
        const configChecksum = mapStyleVersion || Date.now();
        
        // Agregar cache-buster al styleUrl si existe
        let styleUrlWithCacheBuster =
          mapSettings.maptiler?.styleUrl ||
          mapSettings.maptiler?.styleUrlDark ||
          mapSettings.maptiler?.styleUrlLight ||
          mapSettings.maptiler?.styleUrlBright ||
          null;
        if (styleUrlWithCacheBuster) {
          const url = new URL(styleUrlWithCacheBuster);
          url.searchParams.set("v", String(configChecksum));
          styleUrlWithCacheBuster = url.toString();
        }
        
        const ui_map: MapConfigV2 = {
          engine: "maplibre",
          provider: mapSettings.provider === "maptiler" ? "maptiler_vector" : "local_raster_xyz",
          renderWorldCopies: mapSettings.renderWorldCopies ?? true,
          interactive: mapSettings.interactive ?? false,
          controls: mapSettings.controls ?? false,
          local: {
            tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            minzoom: 0,
            maxzoom: 19,
          },
          maptiler: mapSettings.maptiler
            ? (() => {
                const legacyMaptiler = mapSettings.maptiler as typeof mapSettings.maptiler & {
                  api_key?: string | null;
                  urls?: Record<string, string | null>;
                };
                const resolvedKey =
                  legacyMaptiler.apiKey ??
                  legacyMaptiler.key ??
                  legacyMaptiler.api_key ??
                  maptilerKey ??
                  null;

                return {
                  api_key: resolvedKey,
                  apiKey: resolvedKey,
                  key: legacyMaptiler.key ?? resolvedKey,
                  style: mapSettings.style ?? null,
                  styleUrl: styleUrlWithCacheBuster,
                  styleUrlDark: legacyMaptiler.styleUrlDark ?? null,
                  styleUrlLight: legacyMaptiler.styleUrlLight ?? null,
                  styleUrlBright: legacyMaptiler.styleUrlBright ?? null,
                  ...(legacyMaptiler.urls ? { urls: legacyMaptiler.urls } : {}),
                };
              })()
            : undefined,
          customXyz: undefined,
          viewMode: mapSettings.viewMode || "fixed",
          fixed: mapSettings.fixed,
          region: mapSettings.region,
        };
        const styleResult = await loadMapStyle(ui_map);
        if (cancelled || !mapRef.current) {
          return;
        }

        runtimeRef.current = runtimeRef.current
          ? {
              ...runtimeRef.current,
              style: styleResult.resolved,
              fallbackStyle: styleResult.fallback,
              styleWasFallback: styleResult.usedFallback,
              theme: cloneTheme(mapSettings.theme),
              renderWorldCopies:
                typeof mapSettings.renderWorldCopies === "boolean"
                  ? mapSettings.renderWorldCopies
                  : runtimeRef.current.renderWorldCopies,
            }
          : runtimeRef.current;

        themeRef.current = cloneTheme(mapSettings.theme);
        styleTypeRef.current = styleResult.resolved.type;
        fallbackStyleRef.current = styleResult.fallback;
        fallbackAppliedRef.current = styleResult.usedFallback || styleResult.resolved.type !== "vector";

        const tintCandidate = mapSettings.theme?.tint ?? null;
        if (typeof tintCandidate === "string" && tintCandidate.trim().length > 0) {
          setTintColor(tintCandidate);
        } else {
          setTintColor(null);
        }

        const mapWithCopies = map as maplibregl.Map & {
          setRenderWorldCopies?: (value: boolean) => void;
        };
        try {
          mapWithCopies.setRenderWorldCopies?.(mapSettings.renderWorldCopies ?? true);
        } catch {
          // Ignorar si el motor no soporta esta API.
        }

        const handleStyleLoad = async () => {
          if (cancelled || !mapRef.current) {
            return;
          }
          map.off("style.load", handleStyleLoad);
          
          // Limpiar timeout si existe
          if (styleLoadTimeout) {
            clearTimeout(styleLoadTimeout);
            styleLoadTimeout = null;
          }

          let spriteAvailable = false;
          try {
            const style = map.getStyle() as StyleSpecification | undefined;
            spriteAvailable = style ? await hasSprite(style) : false;
          } catch {
            spriteAvailable = false;
          }

          if (cancelled || !mapRef.current) {
            return;
          }

          aircraftLayerRef.current?.setSpriteAvailability(spriteAvailable);

          map.setMinZoom(currentMinZoomRef.current ?? previousMinZoom);
          map.jumpTo({
            center: currentCenter,
            zoom: currentZoom,
            bearing: currentBearing,
            pitch: currentPitch,
          });
          const styleType = styleTypeRef.current;
          const theme = themeRef.current;
          if (styleType && theme) {
            applyThemeToMap(map, styleType, theme);
          }
          
          // Reinyectar capas después de style.load
          // Esto reinyecta todas las capas registradas: radar AEMET, avisos, barcos, aviones, rayos
          layerRegistryRef.current?.reapply();
          
          // Reinyectar capas específicas que tienen métodos ensure*
          const merged = withConfigDefaults(config);
          const configAsV2 = config as unknown as {
            version?: number;
            aemet?: { enabled?: boolean; cap_enabled?: boolean };
            layers?: { flights?: typeof merged.layers.flights; ships?: typeof merged.layers.ships };
            opensky?: typeof merged.opensky;
          };
          
          // Reinyectar radar AEMET (avisos)
          if (configAsV2.aemet?.enabled && configAsV2.aemet?.cap_enabled) {
            const aemetWarningsLayer = aemetWarningsLayerRef.current;
            if (aemetWarningsLayer) {
              await aemetWarningsLayer.ensureWarningsLayer();
            }
          }
          
          // Reinyectar barcos
          const shipsLayer = shipsLayerRef.current;
          if (shipsLayer) {
            await shipsLayer.ensureShipsLayer();
          }
          
          // Reinyectar aviones
          const aircraftLayer = aircraftLayerRef.current;
          if (aircraftLayer) {
            await aircraftLayer.ensureFlightsLayer();
          }
          
          mapStateMachineRef.current?.notifyStyleData("config-style-change");
          setStyleChangeInProgress(false);
        };

        // Timeout de 8s: si no llega style.load, recargar la página
        styleLoadTimeout = setTimeout(() => {
          if (!cancelled) {
            void logError("Style load timeout: reloading page after 8s");
            window.location.reload();
          }
        }, 8000);

        cleanup = () => {
          map.off("style.load", handleStyleLoad);
          if (styleLoadTimeout) {
            clearTimeout(styleLoadTimeout);
            styleLoadTimeout = null;
          }
        };

        map.once("style.load", handleStyleLoad);
        
        try {
          map.setStyle(styleResult.resolved.style as maplibregl.StyleSpecification, { diff: false });
        } catch (error) {
          void logError(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[GeoScopeMap] Error applying live style change", error);
          void logError(error instanceof Error ? error : new Error(String(error)));
          setStyleChangeInProgress(false);
        }
      }
    };

    void applyStyleChange();

    return () => {
      cancelled = true;
      cleanup?.();
      setStyleChangeInProgress(false);
    };
  }, [config, mapStyleVersion]);


  // useEffect para actualizar vista cuando cambia ui_map.fixed (zoom/centro)
  useEffect(() => {
    if (!config || !mapRef.current || stormModeActiveRef.current) {
      // No actualizar si storm mode está activo (tiene prioridad)
      return;
    }

    const merged = withConfigDefaults(config);
    const mapConfig = merged.ui?.map;
    const fixedConfig = mapConfig?.fixed;
    
    // Soporte para v2: leer desde ui_map
    const v2Config = config as unknown as { ui_map?: { fixed?: { center?: { lat?: number; lon?: number }; zoom?: number; bearing?: number; pitch?: number } } };
    const v2Fixed = v2Config.ui_map?.fixed ?? fixedConfig;
    
    if (!v2Fixed || !v2Fixed.center || typeof v2Fixed.zoom !== "number") {
      return;
    }

    const centerLat = v2Fixed.center.lat ?? 39.98;
    const centerLng = v2Fixed.center.lon ?? 0.20;
    const zoom = v2Fixed.zoom ?? 9.0;
    const bearing = v2Fixed.bearing ?? 0;
    const pitch = v2Fixed.pitch ?? 0;

    const map = mapRef.current;
    if (!map) {
      return;
    }

    // Actualizar estado de vista
    const viewState = viewStateRef.current;
    if (!viewState) {
      return;
    }

    // Solo actualizar si realmente cambió
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const distanceThreshold = 0.001; // ~100m
    const zoomThreshold = 0.01;
    
    const centerChanged = 
      Math.abs(currentCenter.lat - centerLat) > distanceThreshold ||
      Math.abs(currentCenter.lng - centerLng) > distanceThreshold;
    const zoomChanged = Math.abs(currentZoom - zoom) > zoomThreshold;

    if (!centerChanged && !zoomChanged) {
      return;
    }

    viewState.lat = centerLat;
    viewState.lng = centerLng;
    viewState.zoom = zoom;
    viewState.bearing = bearing;
    viewState.pitch = pitch;

    // Aplicar cambios al mapa con animación suave
    if (map.isStyleLoaded()) {
      map.easeTo({
        center: [centerLng, centerLat],
        zoom,
        bearing,
        pitch,
        duration: 800 // Animación más rápida para hot-reload
      });
    } else {
      map.once("load", () => {
        map.easeTo({
          center: [centerLng, centerLat],
          zoom,
          bearing,
          pitch,
          duration: 800
        });
      });
    }
  }, [config]);

  // useEffect para manejar cambios en Storm Mode
  useEffect(() => {
    if (!config || !mapRef.current) {
      return;
    }

    const merged = withConfigDefaults(config);
    const stormConfig = merged.storm;
    const stormEnabled = Boolean(stormConfig?.enabled);
    const prevStormActive = stormModeActiveRef.current;

    // Si cambió el estado de storm mode
    if (stormEnabled !== prevStormActive) {
      stormModeActiveRef.current = stormEnabled;
      const map = mapRef.current;
      const lightningLayer = lightningLayerRef.current;

      if (stormEnabled) {
        // Zoom a Castellón/Vila-real según configuración
        const centerLat = Number.isFinite(stormConfig.center_lat) ? stormConfig.center_lat : 39.986;
        const centerLng = Number.isFinite(stormConfig.center_lng) ? stormConfig.center_lng : -0.051;
        const zoom = Number.isFinite(stormConfig.zoom) ? stormConfig.zoom : 9.0;

        // Actualizar estado de vista
        const viewState = viewStateRef.current;
        if (!viewState) {
          return;
        }
        viewState.lat = centerLat;
        viewState.lng = centerLng;
        viewState.zoom = zoom;
        viewState.bearing = 0;
        viewState.pitch = 0;

        // Aplicar zoom al mapa con animación suave
        if (map.isStyleLoaded()) {
          map.easeTo({
            center: [centerLng, centerLat],
            zoom,
            bearing: 0,
            pitch: 0,
            duration: 1500
          });
        } else {
          map.once("load", () => {
            map.easeTo({
              center: [centerLng, centerLat],
              zoom,
              bearing: 0,
              pitch: 0,
              duration: 1500
            });
          });
        }

        // Actualizar estado en backend (opcional, para persistencia)
        apiGet<{ enabled: boolean }>("/api/storm_mode").then((stormMode) => {
          if (!stormMode.enabled) {
            // Activar en backend si no está activo
            fetch("/api/storm_mode", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: true })
            }).catch((err) => {
              console.error("[GeoScopeMap] Failed to update storm mode in backend:", err);
            });
          }
        }).catch(() => {
          // Ignore
        });
      } else {
        // Restaurar vista fija por defecto (Castellón)
        const merged = withConfigDefaults(config);
        const mapConfig = merged.ui?.map;
        const fixedConfig = mapConfig?.fixed;
        
        const centerLat = fixedConfig?.center?.lat ?? 39.98;
        const centerLng = fixedConfig?.center?.lon ?? 0.20;
        const zoom = fixedConfig?.zoom ?? 9.0;

        const viewState = viewStateRef.current;
        if (!viewState) {
          return;
        }
        viewState.lat = centerLat;
        viewState.lng = centerLng;
        viewState.zoom = zoom;
        viewState.bearing = 0;
        viewState.pitch = 0;

        if (map.isStyleLoaded()) {
          map.easeTo({
            center: [centerLng, centerLat],
            zoom,
            bearing: 0,
            pitch: 0,
            duration: 1500
          });
        }
      }
    }
  }, [config]);

  // Función auxiliar para calcular distancia entre dos puntos en km (Haversine)
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // useEffect para cargar y actualizar datos de rayos siempre (en todo el mapa)
  useEffect(() => {
    if (!config || !mapRef.current || !lightningLayerRef.current) {
      return;
    }

    const merged = withConfigDefaults(config);
    const blitzortungEnabled = Boolean(merged.blitzortung?.enabled);

    // Solo cargar si Blitzortung está habilitado (aunque aún no tenga datos)
    if (!blitzortungEnabled) {
      return;
    }

    // Cargar datos de rayos periódicamente
    const loadLightningData = async () => {
      try {
        const response = await apiGet<unknown>("/api/lightning");

        const lightningLayer = lightningLayerRef.current;
        if (lightningLayer && isFeatureCollection<Point, LightningFeatureProperties>(response)) {
          lightningLayer.updateData(response);

          // Verificar auto-activación del modo tormenta
          const stormConfig = merged.storm;
          const stormEnabled = Boolean(stormConfig?.enabled);
          const autoEnable = Boolean(stormConfig?.auto_enable);

          // Si auto-enable está activo pero el modo tormenta no está activo
          if (autoEnable && !stormEnabled && response.features.length > 0) {
            // Verificar si hay rayos cerca de Castellón/Vila-real
            const centerLat = Number.isFinite(stormConfig.center_lat) ? stormConfig.center_lat : 39.986;
            const centerLng = Number.isFinite(stormConfig.center_lng) ? stormConfig.center_lng : -0.051;
            const maxDistance = 50; // Radio de 50 km

            const hasNearbyLightning = response.features.some((feature) => {
              if (!feature.geometry || feature.geometry.type !== "Point") {
                return false;
              }
              const [lng, lat] = feature.geometry.coordinates;
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                return false;
              }
              const distance = calculateDistance(centerLat, centerLng, lat, lng);
              return distance <= maxDistance;
            });

            if (hasNearbyLightning) {

              // Activar modo tormenta actualizando la configuración
              const updatedConfig = {
                ...merged,
                storm: {
                  ...stormConfig,
                  enabled: true
                }
              };

              // Guardar configuración para activar el modo tormenta
              saveConfig(updatedConfig).then(() => {
                // Recargar configuración para que el useEffect de storm mode reaccione
                reloadConfig();
              }).catch((err) => {
                console.error("[GeoScopeMap] Failed to auto-enable storm mode:", err);
              });
            }
          }
        }
      } catch (error) {
        console.error("[GeoScopeMap] Failed to load lightning data:", error);
      }
    };

    // Cargar inmediatamente
    void loadLightningData();

    // Cargar cada 5 segundos
    const intervalId = setInterval(() => {
      void loadLightningData();
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [config, reloadConfig]);

  // useEffect para actualizar configuración de layers (enabled, opacity)
  useEffect(() => {
    if (!config || !mapRef.current) {
      return;
    }

    const merged = withConfigDefaults(config);
    
    // Leer configuración desde v2 o v1
    const configAsV2Update = config as unknown as { 
      version?: number; 
      layers?: { 
        flights?: typeof merged.layers.flights;
        ships?: typeof merged.layers.ships;
      }; 
      opensky?: typeof merged.opensky;
    };
    
    const flightsConfig = configAsV2Update.version === 2 && configAsV2Update.layers?.flights
      ? configAsV2Update.layers.flights
      : merged.layers.flights;
    const shipsConfig = configAsV2Update.version === 2 && configAsV2Update.layers?.ships
      ? configAsV2Update.layers.ships
      : merged.layers.ships;
    const openskyConfig = configAsV2Update.version === 2 && configAsV2Update.opensky
      ? configAsV2Update.opensky
      : merged.opensky;

    // Actualizar AircraftLayer
    const aircraftLayer = aircraftLayerRef.current;
    if (aircraftLayer) {
      aircraftLayer.setRenderMode(flightsConfig.render_mode ?? "auto");
      aircraftLayer.setCircleOptions(flightsConfig.circle);
      aircraftLayer.setSymbolOptions(flightsConfig.symbol);
      aircraftLayer.setEnabled(flightsConfig.enabled && openskyConfig.enabled);
      aircraftLayer.setOpacity(flightsConfig.opacity);
      aircraftLayer.setMaxAgeSeconds(flightsConfig.max_age_seconds);
      aircraftLayer.setCluster(openskyConfig.cluster);
      aircraftLayer.setStyleScale(flightsConfig.styleScale ?? 1);
    }

    // Actualizar ShipsLayer
    const shipsLayer = shipsLayerRef.current;
    if (shipsLayer) {
      shipsLayer.setEnabled(shipsConfig.enabled);
      shipsLayer.setOpacity(shipsConfig.opacity);
      shipsLayer.setMaxAgeSeconds(shipsConfig.max_age_seconds);
      shipsLayer.setStyleScale(shipsConfig.styleScale ?? 1);
      shipsLayer.setRenderMode(shipsConfig.render_mode);
      shipsLayer.setCircleOptions(shipsConfig.circle);
      shipsLayer.setSymbolOptions(shipsConfig.symbol);
    }

    // Actualizar Weather Layer y AEMET Warnings Layer
    // Leer configuración AEMET desde v2 o v1
    const configAsV2 = config as unknown as { version?: number; aemet?: { enabled?: boolean; cap_enabled?: boolean; cache_minutes?: number } };
    const aemetConfig = configAsV2.version === 2 
      ? configAsV2.aemet 
      : merged.aemet;
    
    const weatherLayer = weatherLayerRef.current;
    if (weatherLayer && aemetConfig?.enabled && aemetConfig?.cap_enabled) {
      weatherLayer.setEnabled(true);
      weatherLayer.setOpacity(0.3);
      weatherLayer.setRefreshSeconds((aemetConfig.cache_minutes ?? 15) * 60);
    } else if (weatherLayer) {
      weatherLayer.setEnabled(false);
    }

    // Actualizar AEMET Warnings Layer
    const aemetLayer = aemetWarningsLayerRef.current;
    if (aemetLayer && aemetConfig?.enabled && aemetConfig?.cap_enabled) {
      aemetLayer.setEnabled(true);
      aemetLayer.setOpacity(0.6);
      aemetLayer.setRefreshSeconds((aemetConfig.cache_minutes ?? 15) * 60);
    } else if (aemetLayer) {
      aemetLayer.setEnabled(false);
    }
  }, [config]);

  // useEffect para cargar datos de flights periódicamente
  useEffect(() => {
    if (!config || !mapRef.current || !aircraftLayerRef.current) {
      return;
    }

    const merged = withConfigDefaults(config);
    const flightsConfig = merged.layers.flights;
    const openskyConfig = merged.opensky;

    if (!flightsConfig.enabled || !openskyConfig.enabled) {
      return;
    }

    const loadFlightsData = async () => {
      try {
        // Calcular bbox del mapa actual
        const map = mapRef.current;
        let bbox: string | undefined;

        if (map && map.isStyleLoaded()) {
          const bounds = map.getBounds();
          const sw = bounds.getSouthWest();
          const ne = bounds.getNorthEast();
          const lamin = Math.min(sw.lat, ne.lat);
          const lamax = Math.max(sw.lat, ne.lat);
          const lomin = Math.min(sw.lng, ne.lng);
          const lomax = Math.max(sw.lng, ne.lng);
          bbox = `${lamin},${lamax},${lomin},${lomax}`;
        }

        // Construir URL con parámetros
        let url = "/api/layers/flights";
        const params = new URLSearchParams();
        if (bbox) {
          params.append("bbox", bbox);
        }
        if (params.toString()) {
          url += `?${params.toString()}`;
        }

        const response = await apiGet<FlightsApiResponse | undefined>(url);

        const aircraftLayer = aircraftLayerRef.current;
        if (aircraftLayer && response && !response.disabled) {
          const featureCollection = flightsResponseToGeoJSON(response);
          aircraftLayer.updateData(featureCollection);
        }
      } catch (error) {
        console.error("[GeoScopeMap] Failed to load flights data:", error);
      }
    };

    // Cargar inmediatamente
    void loadFlightsData();

    // Cargar periódicamente según refresh_seconds
    const intervalSeconds = Math.max(5, openskyConfig.poll_seconds);
    const intervalMs = intervalSeconds * 1000;
    const intervalId = setInterval(() => {
      void loadFlightsData();
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [config]);

  // useEffect para cargar datos de ships periódicamente
  useEffect(() => {
    if (!config || !mapRef.current || !shipsLayerRef.current) {
      return;
    }

    const merged = withConfigDefaults(config);
    const shipsConfig = merged.layers.ships;

    if (!shipsConfig.enabled) {
      return;
    }

    const loadShipsData = async () => {
      try {
        // Calcular bbox del mapa actual
        const map = mapRef.current;
        let bbox: string | undefined;
        let maxItemsView: number | undefined;
        
        if (map && map.isStyleLoaded()) {
          const bounds = map.getBounds();
          const sw = bounds.getSouthWest();
          const ne = bounds.getNorthEast();
          bbox = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
          maxItemsView = shipsConfig.max_items_view;
        }
        
        // Construir URL con parámetros
        let url = "/api/layers/ships";
        const params = new URLSearchParams();
        if (bbox) {
          params.append("bbox", bbox);
        }
        if (maxItemsView) {
          params.append("max_items_view", String(maxItemsView));
        }
        if (params.toString()) {
          url += `?${params.toString()}`;
        }
        
        const response = await apiGet<unknown>(url);

        const shipsLayer = shipsLayerRef.current;
        if (shipsLayer && isFeatureCollection<Point, ShipFeatureProperties>(response)) {
          shipsLayer.updateData(response);
        }
      } catch (error) {
        console.error("[GeoScopeMap] Failed to load ships data:", error);
      }
    };

    // Cargar inmediatamente
    void loadShipsData();

    // Cargar periódicamente según refresh_seconds
    const intervalSeconds =
      typeof shipsConfig.update_interval === "number" && shipsConfig.update_interval > 0
        ? shipsConfig.update_interval
        : shipsConfig.refresh_seconds;
    const intervalMs = intervalSeconds * 1000;
    const intervalId = setInterval(() => {
      void loadShipsData();
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [config]);

  // useEffect para gestionar frames de capas globales (satellite/radar)
  useEffect(() => {
    if (!config || !mapRef.current) {
      return;
    }

    const merged = withConfigDefaults(config);
    const globalConfig = merged.layers.global;
    
    if (!globalConfig) {
      return;
    }

    // Inicializar opacidad del radar desde configuración
    if (globalConfig.radar?.enabled && typeof globalConfig.radar.opacity === "number") {
      setRadarOpacity(globalConfig.radar.opacity);
    }

    let satelliteFrameIndex = 0;
    let radarFrameIndex = 0;
    let satelliteFrames: Array<{ timestamp: number; iso: string }> = [];
    let radarFrames: Array<{ timestamp: number; iso: string }> = [];
    let animationTimer: number | null = null;

    const fetchFrames = async () => {
      try {
        // Fetch satellite frames
        if (globalConfig.satellite?.enabled) {
          const satResponse = await apiGet<{
            frames: Array<{ timestamp: number; iso: string }>;
            count: number;
            provider: string;
          }>("/api/global/satellite/frames");
          if (satResponse?.frames && satResponse.frames.length > 0) {
            satelliteFrames = satResponse.frames;
            satelliteFrameIndex = 0;
            
            // Actualizar capa con primer frame
            const globalSatLayer = globalSatelliteLayerRef.current;
            if (globalSatLayer && satelliteFrames[0]) {
              globalSatLayer.update({ currentTimestamp: satelliteFrames[0].timestamp });
            }
          }
        }

        // Fetch radar frames
        if (globalConfig.radar?.enabled) {
          const radarResponse = await apiGet<{
            frames: Array<{ timestamp: number; iso: string }>;
            count: number;
            provider: string;
          }>("/api/global/radar/frames");
          if (radarResponse?.frames && radarResponse.frames.length > 0) {
            radarFrames = radarResponse.frames;
            radarFrameIndex = 0;
            
            // Actualizar capa con primer frame
            const globalRadarLayer = globalRadarLayerRef.current;
            if (globalRadarLayer && radarFrames[0]) {
              globalRadarLayer.update({ currentTimestamp: radarFrames[0].timestamp });
            }
          }
        }
      } catch (err) {
        console.error("[GeoScopeMap] Failed to fetch global frames:", err);
      }
    };

    const advanceFrames = () => {
      if (!radarPlaying) return;

      // Avanzar satellite frames
      if (globalConfig.satellite?.enabled && satelliteFrames.length > 0) {
        satelliteFrameIndex = (satelliteFrameIndex + 1) % satelliteFrames.length;
        const globalSatLayer = globalSatelliteLayerRef.current;
        if (globalSatLayer && satelliteFrames[satelliteFrameIndex]) {
          globalSatLayer.update({ currentTimestamp: satelliteFrames[satelliteFrameIndex].timestamp });
        }
      }

      // Avanzar radar frames
      if (globalConfig.radar?.enabled && radarFrames.length > 0) {
        radarFrameIndex = (radarFrameIndex + 1) % radarFrames.length;
        const globalRadarLayer = globalRadarLayerRef.current;
        if (globalRadarLayer && radarFrames[radarFrameIndex]) {
          globalRadarLayer.update({ currentTimestamp: radarFrames[radarFrameIndex].timestamp });
        }
      }
    };

    const startAnimation = () => {
      if (animationTimer !== null) return;

      // Usar frame_step de configuración (en minutos) convertido a ms
      const satFrameStep = globalConfig.satellite?.frame_step ?? 10;
      const radarFrameStep = globalConfig.radar?.frame_step ?? 5;
      // Usar el menor intervalo
      const frameIntervalMs = Math.min(satFrameStep, radarFrameStep) * 60 * 1000 / radarPlaybackSpeed;

      const animate = () => {
        advanceFrames();
        animationTimer = window.setTimeout(animate, frameIntervalMs);
      };

      animate();
    };

    const stopAnimation = () => {
      if (animationTimer !== null) {
        window.clearTimeout(animationTimer);
        animationTimer = null;
      }
    };

    // Reiniciar animación si cambia play/pause o velocidad
    const restartAnimation = () => {
      stopAnimation();
      if (radarPlaying && (globalConfig.satellite?.enabled || globalConfig.radar?.enabled)) {
        startAnimation();
      }
    };

    // Cargar frames inicialmente
    void fetchFrames();

    // Actualizar frames periódicamente según refresh_minutes
    const refreshInterval = Math.min(
      globalConfig.satellite?.refresh_minutes ?? 10,
      globalConfig.radar?.refresh_minutes ?? 5
    ) * 60 * 1000;

    const refreshTimer = setInterval(() => {
      void fetchFrames();
    }, refreshInterval);

    // Iniciar animación si está habilitada
    if (radarPlaying && (globalConfig.satellite?.enabled || globalConfig.radar?.enabled)) {
      startAnimation();
    }

    // Actualizar opacidad de las capas cuando cambie la configuración
    const updateLayersOpacity = () => {
      const globalSatLayer = globalSatelliteLayerRef.current;
      if (globalSatLayer && globalConfig.satellite?.enabled) {
        globalSatLayer.update({ opacity: globalConfig.satellite.opacity });
      }

      const globalRadarLayer = globalRadarLayerRef.current;
      if (globalRadarLayer && globalConfig.radar?.enabled) {
        globalRadarLayer.update({ opacity: radarOpacity });
      }
    };

    updateLayersOpacity();

    // Reiniciar animación cuando cambien los controles (play/pause o velocidad)
    restartAnimation();

    return () => {
      stopAnimation();
      clearInterval(refreshTimer);
    };
  }, [config, radarPlaying, radarPlaybackSpeed, radarOpacity]);


  // Mostrar error si WebGL no está disponible o el mapa falló
  if (webglError) {
    return (
      <div className="map-host map-error">
        <div className="map-error-content">
          <h2>Error de visualización</h2>
          <p>{webglError}</p>
          <p className="map-error-hint">
            Por favor, verifica que tu navegador soporte WebGL y que los controladores gráficos estén actualizados.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-host">
      <div ref={mapFillRef} className="map-fill" />
      {styleChangeInProgress ? <MapSpinner /> : null}
      {tintColor ? (
        <div className="map-tint" style={{ background: tintColor }} aria-hidden="true" />
      ) : null}
    </div>
  );
}
