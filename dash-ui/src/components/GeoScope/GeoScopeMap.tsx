import maplibregl from "maplibre-gl";
import type { MapLibreEvent, StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import { apiGet, apiPost, saveConfig } from "../../lib/api";
import { useConfig } from "../../lib/useConfig";
import { applyMapStyle, computeStyleUrlFromConfig } from "../../kiosk/mapStyle";
import { kioskRuntime } from "../../lib/runtimeFlags";
import { removeLabelsOverlay, updateLabelsOpacity } from "../../lib/map/overlays/vectorLabels";
import { normalizeLabelsOverlay } from "../../lib/map/labelsOverlay";
import { signMapTilerUrl } from "../../lib/map/utils/maptilerHelpers";
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
import { hasMaptilerKey, containsApiKey, buildFinalMaptilerStyleUrl } from "../../lib/map/maptilerRuntime";
import { DEFAULT_OPENSKY_CONFIG } from "../../config/defaults_v2";
import type {
  AppConfig,
  MapConfig,
  MapPreferences,
  MapThemeConfig,
  RotationConfig,
  GlobalSatelliteLayerConfig,
  GlobalRadarLayerConfig,
  FlightsLayerConfig,
  OpenSkyConfig,
  AEMETConfig
} from "../../types/config";
import type {
  AppConfigV2,
  MapConfigV2,
  SatelliteLabelsOverlay
} from "../../types/config_v2";
import {
  loadMapStyle,
  type MapStyleDefinition,
  type MapStyleResult
} from "./mapStyle";
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

const maskMaptilerUrl = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return value ?? null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.searchParams.has("key")) {
      url.searchParams.set("key", "***");
      return url.toString();
    }
  } catch {
    // Ignorar errores de parseo – devolver URL tal cual
  }
  return trimmed;
};

type HybridLabelsConfig = {
  enabled: boolean;
  styleUrl: string | null;
  layerFilter: string | null;
  opacity: number;
};

type HybridSatelliteConfig = {
  enabled: boolean;
  styleUrl: string | null;
  opacity: number;
  labels: HybridLabelsConfig;
};

type HybridMappingConfig = {
  baseStyleUrl: string | null;
  maptilerKey: string | null;
  satellite: HybridSatelliteConfig;
};

const createDefaultHybridMapping = (): HybridMappingConfig => ({
  baseStyleUrl: null,
  maptilerKey: null,
  satellite: {
    enabled: false,
    styleUrl: null,
    opacity: 1,
    labels: {
      enabled: false,
      styleUrl: null,
      layerFilter: null,
      opacity: 1,
    },
  },
});

const stringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const pickFirstString = (...values: Array<unknown>): string | null => {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed && trimmed !== "***") {
      return trimmed;
    }
  }
  return null;
};

const pickFirstUrl = (...values: Array<unknown>): string | null => {
  for (const value of values) {
    const normalized = stringOrNull(typeof value === "string" ? value : null);
    if (normalized) {
      return normalized;
    }
  }
  return null;
};

const extractApiKeyFromUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const key = url.searchParams.get("key");
    const sanitized = key?.trim();
    if (sanitized && sanitized !== "***") {
      return sanitized;
    }
  } catch {
    const match = trimmed.match(/[?&]key=([^&]+)/);
    if (match && match[1]) {
      try {
        const decoded = decodeURIComponent(match[1]);
        const sanitized = decoded.trim();
        if (sanitized && sanitized !== "***") {
          return sanitized;
        }
      } catch {
        const sanitized = match[1].trim();
        if (sanitized && sanitized !== "***") {
          return sanitized;
        }
      }
    }
  }

  return null;
};

const coerceLabelsOverlay = (
  value: boolean | SatelliteLabelsOverlay | null | undefined,
): SatelliteLabelsOverlay | null => {
  if (value && typeof value === "object") {
    return value;
  }
  if (typeof value === "boolean") {
    return { enabled: value };
  }
  return null;
};

const clamp01 = (value: unknown, fallback: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return clamp(numeric, 0, 1);
};

/**
 * Traduce literalmente `config.ui_map` a la estructura consumida por el runtime
 * del mapa híbrido. Evitar transformaciones legacy garantiza que los campos
 * modernos (`ui_map.maptiler.*`, `ui_map.satellite.*`) lleguen intactos al
 * runtime.
 */
const extractHybridMappingConfig = (config: AppConfigV2 | null | undefined): HybridMappingConfig => {
  if (!config || config.version !== 2 || !config.ui_map) {
    return createDefaultHybridMapping();
  }

  const mappingConfig = config.ui_map;
  const maptiler = mappingConfig.maptiler ?? null;
  const satellite = mappingConfig.satellite ?? null;
  const labelsOverlay = satellite?.labels_overlay ?? null;

  const baseStyleUrl = pickFirstUrl(
    maptiler?.styleUrl,
    (maptiler as { style_url?: unknown })?.style_url,
    (maptiler?.urls as { styleUrlBright?: unknown })?.styleUrlBright,
    (maptiler?.urls as { styleUrlDark?: unknown })?.styleUrlDark,
    (maptiler?.urls as { styleUrlLight?: unknown })?.styleUrlLight,
  );

  const directKey = pickFirstString(
    maptiler?.api_key,
    (maptiler as { apiKey?: unknown })?.apiKey,
    (maptiler as { key?: unknown })?.key,
  );

  const satelliteEnabled = Boolean(satellite?.enabled);
  const satelliteStyleUrl = pickFirstUrl(
    satellite?.style_url,
    (satellite as { style_raster?: unknown })?.style_raster,
  );
  const satelliteOpacity = clamp01(satellite?.opacity, 1);

  const labelsEnabled = Boolean((labelsOverlay as { enabled?: unknown })?.enabled);
  const labelsStyleUrl = pickFirstUrl(
    (labelsOverlay as { style_url?: unknown })?.style_url,
    (satellite as { labels_style_url?: unknown })?.labels_style_url,
  );
  const labelsLayerFilter = stringOrNull((labelsOverlay as { layer_filter?: unknown })?.layer_filter ?? null);
  const labelsOpacity = clamp01((labelsOverlay as { opacity?: unknown })?.opacity ?? undefined, 1);

  let maptilerKey = directKey;
  if (!maptilerKey) {
    const urlCandidates = [
      baseStyleUrl,
      labelsStyleUrl,
      satelliteStyleUrl,
      (maptiler?.urls as { styleUrlBright?: unknown })?.styleUrlBright,
      (maptiler?.urls as { styleUrlDark?: unknown })?.styleUrlDark,
      (maptiler?.urls as { styleUrlLight?: unknown })?.styleUrlLight,
    ];
    for (const candidate of urlCandidates) {
      const extracted = extractApiKeyFromUrl(candidate);
      if (extracted) {
        maptilerKey = extracted;
        break;
      }
    }
  }

  return {
    baseStyleUrl,
    maptilerKey,
    satellite: {
      enabled: satelliteEnabled,
      styleUrl: satelliteStyleUrl,
      opacity: satelliteOpacity,
      labels: {
        enabled: labelsEnabled,
        styleUrl: labelsStyleUrl,
        layerFilter: labelsLayerFilter,
        opacity: labelsOpacity,
      },
    },
  };
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
  mapConfigV2?: AppConfigV2; // Añadir para acceso a configuración v2
};

const buildRuntimePreferences = (
  mapSettings: MapConfig,
  rotationSettings: RotationConfig,
  styleResult: MapStyleResult,
  mapConfigV2?: AppConfigV2
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
    mapConfigV2,
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

    const rawLabelsOverlay = coerceLabelsOverlay(ui_map?.satellite?.labels_overlay);

    const rawBaseStyleUrl = pickFirstUrl(
      ui_map?.maptiler?.styleUrl,
      (ui_map?.maptiler as { style_url?: unknown })?.style_url,
      (ui_map?.maptiler?.urls as { styleUrlBright?: unknown })?.styleUrlBright,
      (ui_map?.maptiler?.urls as { styleUrlDark?: unknown })?.styleUrlDark,
      (ui_map?.maptiler?.urls as { styleUrlLight?: unknown })?.styleUrlLight,
    );

    const rawSatelliteStyleUrl = pickFirstUrl(
      ui_map?.satellite?.style_url,
      (ui_map?.satellite as { style_raster?: unknown })?.style_raster,
    );

    const rawLabelsStyleUrl = pickFirstUrl(
      rawLabelsOverlay?.style_url,
      (ui_map?.satellite as { labels_style_url?: unknown })?.labels_style_url,
    );

    const rawDirectKey = pickFirstString(
      ui_map?.maptiler?.api_key,
      (ui_map?.maptiler as { apiKey?: unknown })?.apiKey,
      (ui_map?.maptiler as { key?: unknown })?.key,
    );

    let rawKeyPresent = Boolean(rawDirectKey);
    if (!rawKeyPresent) {
      const rawUrlCandidates = [
        rawBaseStyleUrl,
        rawSatelliteStyleUrl,
        rawLabelsStyleUrl,
        (ui_map?.maptiler?.urls as { styleUrlBright?: unknown })?.styleUrlBright,
        (ui_map?.maptiler?.urls as { styleUrlDark?: unknown })?.styleUrlDark,
        (ui_map?.maptiler?.urls as { styleUrlLight?: unknown })?.styleUrlLight,
      ];
      for (const candidate of rawUrlCandidates) {
        if (extractApiKeyFromUrl(candidate)) {
          rawKeyPresent = true;
          break;
        }
      }
    }

    // Solo usar estilo base streets-v4, sin híbridos ni satélite
    
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
    // Determinar el estilo desde la configuración real
    const maptilerStyle = ui_map.maptiler?.style || "streets-v4";
    const styleFromConfig = maptilerStyle === "hybrid" ? "streets-v4" : 
                           maptilerStyle === "satellite" ? "streets-v4" :
                           maptilerStyle === "vector-dark" ? "vector-dark" :
                           maptilerStyle === "vector-bright" ? "vector-bright" :
                           maptilerStyle === "streets-v4" ? "streets-v4" :
                           "streets-v4";
    
    const mapSettings = {
      engine: "maplibre" as const,
      provider: ui_map.provider === "maptiler_vector" ? "maptiler" : (ui_map.provider === "local_raster_xyz" ? "osm" : "xyz") as MapConfig["provider"],
      renderWorldCopies: ui_map.renderWorldCopies,
      interactive: ui_map.interactive,
      controls: ui_map.controls,
      viewMode: ui_map.viewMode,
      fixed: ui_map.fixed,
      region: ui_map.region,
      style: styleFromConfig as MapConfig["style"],
      theme: { sea: "#0b3756", land: "#20262c", label: "#d6e7ff", contrast: 0.15, tint: "rgba(0,170,255,0.06)" },
      respectReducedMotion: false,
      maptiler: ui_map.provider === "maptiler_vector"
        ? {
            key: ui_map.maptiler?.api_key ?? ui_map.maptiler?.apiKey ?? ui_map.maptiler?.key ?? null,
            apiKey: ui_map.maptiler?.api_key ?? ui_map.maptiler?.apiKey ?? null,
            styleUrl: ui_map.maptiler?.styleUrl ?? null,
            styleUrlDark: ui_map.maptiler?.styleUrl ?? null,
            styleUrlLight: null,
            styleUrlBright: null,
          }
        : undefined,
      cinema: undefined,
      idlePan: undefined,
    } as unknown as MapConfig;
    
    return buildRuntimePreferences(mapSettings, rotationSettings || { enabled: false, duration_sec: 10, panels: [] }, styleResult, mapConfigV2);
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
    return buildRuntimePreferences(fallbackSettings, fallbackRotation, styleResult, undefined);
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
  const [health, setHealth] = useState<{ maptiler?: { has_api_key?: boolean; styleUrl?: string | null } } | null>(null);

  // Leer /api/health/full una vez para disponer de has_api_key y styleUrl firmado
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await fetch("/api/health/full", { cache: "no-store" }).then((r) => r.json());
        if (!cancelled) {
          setHealth(h ?? null);
        }
      } catch {
        // Silencioso: si falla health, seguimos con config
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const configV2 = useMemo(() => {
    const candidate = config as unknown as AppConfigV2 | null;
    if (candidate?.version === 2) {
      return candidate;
    }
    return null;
  }, [config]);

  // Obtener estilo base directamente desde ui_map.maptiler.styleUrl
  const baseStyleUrl = useMemo(() => {
    const styleUrl = configV2?.ui_map?.maptiler?.styleUrl;
    if (!styleUrl) {
      return null;
    }
    // Ya viene firmado del backend, solo asegurar que esté firmado
    const apiKey = configV2?.ui_map?.maptiler?.api_key ?? extractApiKeyFromUrl(styleUrl);
    return signMapTilerUrl(styleUrl, apiKey ?? undefined) ?? styleUrl;
  }, [configV2?.ui_map?.maptiler?.styleUrl, configV2?.ui_map?.maptiler?.api_key]);

  const maptilerKey = useMemo(() => {
    return configV2?.ui_map?.maptiler?.api_key ?? extractApiKeyFromUrl(baseStyleUrl ?? undefined) ?? null;
  }, [configV2?.ui_map?.maptiler?.api_key, baseStyleUrl]);

  // Satellite y hybrid desactivados: siempre usar solo el estilo base streets-v4
  const runtimeBaseStyleUrl = baseStyleUrl;
  
  const mapFillRef = useRef<HTMLDivElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [styleChangeInProgress, setStyleChangeInProgress] = useState(false);
  // Estados para controles de radar animado
  const [radarPlaying, setRadarPlaying] = useState(true);
  const [radarPlaybackSpeed, setRadarPlaybackSpeed] = useState(1.0);
  const [radarOpacity, setRadarOpacity] = useState(0.7);
  const [globalSatelliteReady, setGlobalSatelliteReady] = useState(false);
  const [layerRegistryReady, setLayerRegistryReady] = useState(false);

  // TEMPORALMENTE DESACTIVADO: Todas las capas globales (GIBS, radar global) están deshabilitadas
  // para dejar solo el mapa base MapTiler (streets-v4) funcionando de forma estable.
  // TODO: Re-activar en una segunda iteración controlada cuando GIBS esté completamente probado.
  const globalLayersSettings = useMemo(() => {
    // Forzar isEnabled=false siempre, ignorando completamente la configuración
    return {
      satellite: {
        config: undefined as GlobalSatelliteLayerConfig | undefined,
        ui: undefined as { enabled?: boolean; opacity?: number } | undefined,
        isEnabled: false, // FORZADO: siempre false
        opacity: 1,
      },
      radar: {
        config: undefined as GlobalRadarLayerConfig | undefined,
        ui: undefined as { enabled?: boolean; opacity?: number } | undefined,
        isEnabled: false, // FORZADO: siempre false
        opacity: undefined as number | undefined,
      },
    };
    
    /* CÓDIGO DESACTIVADO TEMPORALMENTE - IGNORAR CONFIG
    const defaults = {
      satellite: {
        config: undefined as GlobalSatelliteLayerConfig | undefined,
        ui: undefined as { enabled?: boolean; opacity?: number } | undefined,
        isEnabled: false,
        opacity: 1,
      },
      radar: {
        config: undefined as GlobalRadarLayerConfig | undefined,
        ui: undefined as { enabled?: boolean; opacity?: number } | undefined,
        isEnabled: false,
        opacity: undefined as number | undefined,
      },
    };

    if (!config) {
      return defaults;
    }

    const merged = withConfigDefaults(config);
    const configAsV2 = config as unknown as {
      version?: number;
      ui_global?: {
        satellite?: { enabled?: boolean; opacity?: number };
        radar?: { enabled?: boolean; opacity?: number };
      };
      layers?: {
        global_?: {
          satellite?: GlobalSatelliteLayerConfig;
          radar?: GlobalRadarLayerConfig;
        };
      };
    };

    const globalSatelliteConfig =
      configAsV2.version === 2 && configAsV2.layers?.global_?.satellite
        ? configAsV2.layers.global_.satellite
        : merged.layers.global?.satellite;
    const uiGlobalSatellite = configAsV2.version === 2 ? configAsV2.ui_global?.satellite : undefined;
    const isSatelliteEnabled =
      uiGlobalSatellite?.enabled === true ||
      (uiGlobalSatellite?.enabled === undefined && globalSatelliteConfig?.enabled === true);
    const satelliteOpacity = uiGlobalSatellite?.opacity ?? globalSatelliteConfig?.opacity ?? 1;

    const globalRadarConfig =
      configAsV2.version === 2 && configAsV2.layers?.global_?.radar
        ? configAsV2.layers.global_.radar
        : merged.layers.global?.radar;
    const uiGlobalRadar = configAsV2.version === 2 ? configAsV2.ui_global?.radar : undefined;
    const isRadarEnabled = Boolean(globalRadarConfig?.enabled && uiGlobalRadar?.enabled !== false);
    const radarOpacityValue = uiGlobalRadar?.opacity ?? globalRadarConfig?.opacity;

    return {
      satellite: {
        config: globalSatelliteConfig,
        ui: uiGlobalSatellite,
        isEnabled: Boolean(isSatelliteEnabled),
        opacity: satelliteOpacity,
      },
      radar: {
        config: globalRadarConfig,
        ui: uiGlobalRadar,
        isEnabled: isRadarEnabled,
        opacity: radarOpacityValue,
      },
    };
    */
  }, [config]);
  
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
  // Fallback desactivado: solo usar streets-v4
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

  // Satellite y labels overlay desactivados: no hay efectos que ejecutar


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
      console.info("[GeoScopeMap] Map load");
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
      // Fallback desactivado: solo usar streets-v4
      fallbackAppliedRef.current = false;

      if (!destroyed) {
        const tintCandidate = runtime.theme?.tint ?? null;
        if (typeof tintCandidate === "string" && tintCandidate.trim().length > 0) {
          setTintColor(tintCandidate);
        } else {
          setTintColor(null);
        }
      }

      const configV2 = config as unknown as AppConfigV2 | null;
      const providerForLog =
        configV2?.ui_map?.provider ??
        (runtime.mapSettings?.provider ? String(runtime.mapSettings.provider) : null);

      // Construir URL final firmada usando buildFinalMaptilerStyleUrl
      // Esta función prioriza health.maptiler.styleUrl (ya firmado) y luego construye desde config + apiKey
      const styleUrlFromRuntimeConfig =
        (runtime.mapConfigV2 as (AppConfigV2 | undefined))?.ui_map?.maptiler?.styleUrl ?? null;
      
      const baseStyleUrlFinal = buildFinalMaptilerStyleUrl(
        config as unknown as any,
        health as any,
        styleUrlFromRuntimeConfig || runtimeBaseStyleUrl || null,
        runtimeBaseStyleUrl
      );

      const keyPresentForLog =
        hasMaptilerKey((config as unknown) as any, health as any) ||
        containsApiKey(baseStyleUrlFinal);

      console.info("[MapInit] runtime options before maplibregl.Map", {
        provider: providerForLog,
        base_style_url: maskMaptilerUrl(baseStyleUrlFinal),
        maptiler_key_present: keyPresentForLog,
      });

      // Usar la URL final firmada como estilo para MapLibre
      const styleUrlFromConfig = baseStyleUrlFinal;
      console.log("[MapInit] styleUrl from config:", styleUrlFromConfig ? maskMaptilerUrl(styleUrlFromConfig) : styleUrlFromConfig);
      if (!styleUrlFromConfig) {
        console.error("[MapInit] Missing ui_map.maptiler.styleUrl in config");
      }
      // Usar siempre el estilo desde config (streets-v4)
      const initialStyle = styleUrlFromConfig;
      if (!initialStyle) {
        console.error(
          "[MapInit] no valid styleUrlFinal, aborting map init (neither ui_map.maptiler.styleUrl nor runtime.style.style available)"
        );
        setWebglError("Error: el estilo del mapa no está disponible. Por favor, verifica la configuración.");
        return;
      }

      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: host,
          style: initialStyle,
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
        console.log("[MapInit] final style used for maplibre", { styleUrlFinal: initialStyle });
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

      // Fallback desactivado: solo usar streets-v4

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
          console.error("[GeoScopeMap] Style load error (HTTP " + statusCandidate + "):", error);
          setWebglError(`Error al cargar el estilo del mapa (HTTP ${statusCandidate})`);
          return;
        }
        if (
          messageCandidate &&
          /style/i.test(messageCandidate) &&
          /fail|unauthorized|forbidden|error/i.test(messageCandidate)
        ) {
          console.error("[GeoScopeMap] Style load error:", error);
          setWebglError("Error al cargar el estilo del mapa");
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
        setLayerRegistryReady(true);

        // Satellite layer desactivado: solo usar estilo base streets-v4

        // Inicializar LightningLayer (siempre habilitado si hay datos)
        const lightningLayer = new LightningLayer({ enabled: true });
        layerRegistry.add(lightningLayer);
        lightningLayerRef.current = lightningLayer;

        // Inicializar AircraftLayer y ShipsLayer según configuración
        // Usar defaults si config aún no está disponible
        const mergedConfig = config ? withConfigDefaults(config) : withConfigDefaults();

          // Declarar configAsV2Init una sola vez con todas las propiedades necesarias
          const configAsV2Init = config as unknown as { 
            version?: number; 
            ui_global?: { satellite?: { enabled?: boolean; opacity?: number } };
            layers?: { 
              global_?: { satellite?: GlobalSatelliteLayerConfig };
              flights?: FlightsLayerConfig;
              ships?: typeof mergedConfig.layers.ships;
            };
            aemet?: AEMETConfig;
            opensky?: OpenSkyConfig;
          };

          // TEMPORALMENTE DESACTIVADO: Global Radar Layer
          // Todas las capas globales están deshabilitadas temporalmente para dejar solo el mapa base.
          // TODO: Re-activar en una segunda iteración controlada.
          /*
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
          */

          // Weather Layer (z-index 12, entre radar/satélite y AEMET warnings)
          // Leer configuración AEMET desde v2 o v1
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
        // Desactivado temporalmente: no cambiar el style del mapa tras la inicialización
        return;
        try {
          const h = await fetch("/api/health/full", { cache: "no-store" }).then((r) => r.json());
          const current = h?.config_checksum || null;
          
          if (current && current !== lastChecksum) {
            lastChecksum = current;
            
            // Leer config fresca y health
            const cfg = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
            const healthData = await fetch("/api/health/full", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
            
            // Obtener styleUrl desde la configuración usando buildFinalMaptilerStyleUrl
            const merged = withConfigDefaults(cfg);
            const mapSettings = merged.ui?.map;
            const baseStyleUrl = mapSettings?.maptiler?.styleUrl || null;
            const styleUrl = buildFinalMaptilerStyleUrl(
              cfg as any,
              healthData as any,
              baseStyleUrl,
              null
            ) || computeStyleUrlFromConfig(mapSettings?.maptiler ? {
              maptiler: mapSettings.maptiler,
              style: mapSettings.style || "vector-dark",
            } : null, healthData);
            
            if (styleUrl) {
              // Desactivado temporalmente: no aplicar cambios de estilo en caliente
              // await applyMapStyle(map, styleUrl, current);
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
      
      // Desactivado: no iniciar polling que pueda provocar setStyle en caliente
      // map.once("load", () => {
      //   if (!destroyed && mapRef.current) {
      //     fetch("/api/health/full", { cache: "no-store" })
      //       .then((r) => r.json())
      //       .then((h) => {
      //         lastChecksum = h?.config_checksum || null;
      //         setTimeout(() => pollHealthAndReact(map), 5000);
      //       })
      //       .catch(() => {
      //         setTimeout(() => pollHealthAndReact(map), 5000);
      //       });
      //   }
      // });

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

  // TEMPORALMENTE DESACTIVADO: useEffect que gestiona GlobalSatelliteLayer
  // Todas las capas globales están deshabilitadas temporalmente para dejar solo el mapa base.
  // TODO: Re-activar en una segunda iteración controlada cuando GIBS esté completamente probado.
  useEffect(() => {
    const map = mapRef.current;
    const layerRegistry = layerRegistryRef.current;
    const satelliteSettings = globalLayersSettings.satellite;

    // FORZADO: GlobalSatelliteLayer siempre deshabilitado temporalmente
    // Limpiar cualquier capa existente y salir inmediatamente
    if (map && layerRegistry && layerRegistryReady) {
      const existingLayer = globalSatelliteLayerRef.current;
      if (existingLayer) {
        // Limpiar completamente: quitar capa, source y referencias
        layerRegistry.removeById(existingLayer.id);
        globalSatelliteLayerRef.current = null;
        if (globalSatelliteReady) {
          setGlobalSatelliteReady(false);
        }
        console.info("[GlobalSatelliteLayer] removed (temporarily disabled - base map only mode)");
      }
    }
    return; // Salir inmediatamente, no crear ni gestionar la capa
    
    /* CÓDIGO DESACTIVADO TEMPORALMENTE
    if (!map || !layerRegistry || !layerRegistryReady) {
      return;
    }

    const existingLayer = globalSatelliteLayerRef.current;

    // PRIMERO: Verificar si el satélite está desactivado - hacer cleanup y salir
    if (!satelliteSettings.isEnabled) {
      if (existingLayer) {
        // Limpiar completamente: quitar capa, source y referencias
        layerRegistry.removeById(existingLayer.id);
        globalSatelliteLayerRef.current = null;
        if (globalSatelliteReady) {
          setGlobalSatelliteReady(false);
        }
        console.info("[GlobalSatelliteLayer] removed (satellite disabled)");
      }
      return;
    }

    // SEGUNDO: Si el satélite está activado, verificar que el estilo esté cargado
    // Función interna para adjuntar la capa cuando el estilo esté listo
    const attachGlobalSatelliteLayer = (targetMap: maplibregl.Map) => {
      // Verificar que el mapa y el estilo estén completamente cargados
      // Proteger contra "Cannot read properties of null (reading 'version')"
      try {
        if (!targetMap.isStyleLoaded()) {
          // El estilo aún no está listo
          return;
        }
        
        const style = targetMap.getStyle();
        if (!style) {
          // El estilo es null, aún no está listo
          return;
        }
        
        // Verificar que version exista y sea un número válido
        if (typeof style.version === "undefined" || style.version === null) {
          // El estilo aún no tiene versión, no está completamente cargado
          return;
        }
      } catch (error) {
        // Si hay un error accediendo al estilo, esperar
        console.debug("[GlobalSatelliteLayer] Style not ready yet, waiting:", error);
        return;
      }

      // Verificar que el satélite siga habilitado (puede haber cambiado mientras esperábamos)
      if (!satelliteSettings.isEnabled) {
        return;
      }

      const opacity = satelliteSettings.opacity ?? 1;

      if (!existingLayer) {
        const globalSatelliteLayer = new GlobalSatelliteLayer({
          enabled: true,
          opacity,
        });
        layerRegistry.add(globalSatelliteLayer);
        globalSatelliteLayerRef.current = globalSatelliteLayer;
        if (!globalSatelliteReady) {
          setGlobalSatelliteReady(true);
        }
        console.info("[GlobalSatelliteLayer] created", {
          opacity,
          minzoom: 1,
          maxzoom: 9,
        });
        console.info("[GeoScopeMap] GlobalSatelliteLayer attached");
      } else {
        existingLayer.update({ enabled: true, opacity });
        if (!globalSatelliteReady) {
          setGlobalSatelliteReady(true);
        }
      }
    };

    // Verificar si el estilo ya está cargado (con protección contra null)
    try {
      if (map.isStyleLoaded()) {
        const style = map.getStyle();
        if (style && typeof style.version !== "undefined" && style.version !== null) {
          // El estilo ya está listo, adjuntar inmediatamente
          attachGlobalSatelliteLayer(map);
          return;
        }
      }
    } catch (error) {
      // Si hay un error accediendo al estilo, esperar al evento
      console.debug("[GlobalSatelliteLayer] Error checking style, waiting for load event:", error);
    }

    // El estilo aún no está listo, esperar al evento 'styledata' o 'load'
    let styleDataHandler: (() => void) | null = null;
    let loadHandler: (() => void) | null = null;

    styleDataHandler = () => {
      attachGlobalSatelliteLayer(map);
    };

    loadHandler = () => {
      attachGlobalSatelliteLayer(map);
    };

    map.once("styledata", styleDataHandler);
    map.once("load", loadHandler);

    // Cleanup: remover listeners si el efecto se desmonta o cambia
    return () => {
      if (styleDataHandler) {
        map.off("styledata", styleDataHandler);
      }
      if (loadHandler) {
        map.off("load", loadHandler);
      }
    };
  }, [
    globalLayersSettings.satellite.isEnabled,
    globalLayersSettings.satellite.opacity,
    globalSatelliteReady,
    layerRegistryReady,
  ]);

  useEffect(() => {
    if (!config || !mapRef.current) {
      return;
    }
    if (mapStyleVersion === 0) {
      return;
    }

    // Reactivado: cambiar el estilo del mapa cuando cambia la configuración

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

        // Obtener configuración V2 directamente si está disponible
        const configV2ForStyle = config as unknown as AppConfigV2 | null;
        const maptilerConfigV2 = configV2ForStyle?.ui_map?.maptiler;

        // Convertir a MapConfigV2 para loadMapStyle
        // Calcular checksum para cache-buster (usar mapStyleVersion o timestamp)
        const configChecksum = mapStyleVersion || Date.now();
        
        // Obtener styleUrl desde configuración V2 o desde mapSettings
        let styleUrlWithCacheBuster =
          maptilerConfigV2?.styleUrl ||
          mapSettings.maptiler?.styleUrl ||
          mapSettings.maptiler?.styleUrlDark ||
          mapSettings.maptiler?.styleUrlLight ||
          mapSettings.maptiler?.styleUrlBright ||
          null;
        if (styleUrlWithCacheBuster) {
          try {
            const url = new URL(styleUrlWithCacheBuster);
            url.searchParams.set("v", String(configChecksum));
            styleUrlWithCacheBuster = url.toString();
          } catch {
            // Si falla el parsing, usar tal cual
          }
        }
        
        // Determinar el estilo desde la configuración V2 o desde mapSettings
        const styleFromConfig = maptilerConfigV2?.style || mapSettings.style || "streets-v4";
        
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
                  maptilerConfigV2?.api_key ??
                  legacyMaptiler.apiKey ??
                  legacyMaptiler.key ??
                  legacyMaptiler.api_key ??
                  maptilerKey ??
                  null;

                return {
                  api_key: resolvedKey,
                  apiKey: resolvedKey,
                  key: legacyMaptiler.key ?? resolvedKey,
                  style: styleFromConfig,
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
          satellite: configV2ForStyle?.ui_map?.satellite,
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
        // Fallback desactivado: solo usar streets-v4
        fallbackAppliedRef.current = false;

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
          
          // Reinyectar barcos (esto re-registra los iconos)
          const shipsLayer = shipsLayerRef.current;
          if (shipsLayer) {
            await shipsLayer.ensureShipsLayer();
          }
          
          // Reinyectar aviones (esto re-registra los iconos)
          const aircraftLayer = aircraftLayerRef.current;
          if (aircraftLayer) {
            await aircraftLayer.ensureFlightsLayer();
          }
          
          // Disparar evento personalizado para notificar que el estilo se cargó
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("map:style:loaded"));
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

  // TEMPORALMENTE DESACTIVADO: useEffect para gestionar frames de capas globales (satellite/radar)
  // Todas las capas globales están deshabilitadas temporalmente para dejar solo el mapa base.
  // TODO: Re-activar en una segunda iteración controlada cuando GIBS esté completamente probado.
  useEffect(() => {
    // FORZADO: No gestionar frames de capas globales, salir inmediatamente
    // Esto asegura que no se hagan peticiones a /api/global/satellite/frames ni /api/global/radar/frames
    return;
    
    /* CÓDIGO DESACTIVADO TEMPORALMENTE
    if (!mapRef.current) {
      return;
    }

    const satelliteSettings = globalLayersSettings.satellite;
    const radarSettings = globalLayersSettings.radar;

    const isSatelliteEnabled = satelliteSettings.isEnabled;
    const isRadarEnabled = radarSettings.isEnabled;

    // Si el satélite está desactivado, NO hacer nada relacionado con GIBS
    if (!isSatelliteEnabled && !isRadarEnabled) {
      return;
    }

    // Si solo el radar está activado, no procesar frames de satélite
    if (!isSatelliteEnabled) {
      // Solo procesar radar si está activado
      if (isRadarEnabled) {
        // El código del radar continúa más abajo
      } else {
        return;
      }
    }

    if (
      isRadarEnabled &&
      typeof radarSettings.opacity === "number" &&
      radarSettings.opacity !== radarOpacity
    ) {
      setRadarOpacity(radarSettings.opacity);
    }

    type SatelliteFrame = {
      timestamp: number;
      iso?: string;
      t_iso?: string;
      tile_url?: string;
      min_zoom?: number;
      max_zoom?: number;
      tile_matrix_set?: string;
    };
    type RadarFrame = { timestamp: number; iso?: string };

    let satelliteFrameIndex = 0;
    let radarFrameIndex = 0;
    let satelliteFrames: SatelliteFrame[] = [];
    let radarFrames: RadarFrame[] = [];
    let animationTimer: number | null = null;
    let notifiedWaitingForSatellite = false;

    const canRenderSatellite = () =>
      Boolean(
        isSatelliteEnabled &&
          globalSatelliteReady &&
          globalSatelliteLayerRef.current &&
          mapRef.current
      );

    const applySatelliteFrame = (frame: SatelliteFrame, source?: "fetch" | "animation") => {
      const layer = globalSatelliteLayerRef.current;
      if (!layer) {
        return;
      }

      // Preparar opciones de actualización
      const updateOpts: {
        tileUrl?: string;
        currentTimestamp?: number;
        minZoom?: number;
        maxZoom?: number;
      } = {};

      if (frame.tile_url) {
        updateOpts.tileUrl = frame.tile_url;
      } else if (frame.timestamp) {
        updateOpts.currentTimestamp = frame.timestamp;
      }

      // Añadir min_zoom y max_zoom si están disponibles
      // Asegurar que max_zoom nunca exceda 9 para GoogleMapsCompatible_Level9
      if (frame.min_zoom !== undefined) {
        updateOpts.minZoom = frame.min_zoom;
      }
      if (frame.max_zoom !== undefined) {
        // Para GoogleMapsCompatible_Level9, el máximo zoom efectivo es 9
        const tileMatrixSet = frame.tile_matrix_set || "GoogleMapsCompatible_Level9";
        if (tileMatrixSet.includes("Level9")) {
          updateOpts.maxZoom = Math.min(frame.max_zoom, 9);
        } else {
          updateOpts.maxZoom = frame.max_zoom;
        }
      }

      // Actualizar la capa con todas las opciones
      if (Object.keys(updateOpts).length > 0) {
        layer.update(updateOpts);
      }

      if (source === "fetch") {
        console.info("[GlobalSatelliteLayer] update frame", {
          ts: frame.timestamp,
          mode: frame.tile_url ? "tile_url" : "legacy",
          min_zoom: frame.min_zoom,
          max_zoom: frame.max_zoom,
          source,
        });
      }
    };

    const fetchFrames = async () => {
      try {
        // Verificar nuevamente que el satélite esté habilitado antes de hacer fetch
        if (!isSatelliteEnabled) {
          satelliteFrames = [];
          return;
        }

        if (isSatelliteEnabled) {
          if (!canRenderSatellite()) {
            if (!notifiedWaitingForSatellite) {
              console.info(
                "[GeoScopeMap] Waiting for GlobalSatelliteLayer before fetching GIBS frames"
              );
              notifiedWaitingForSatellite = true;
            }
            return; // No hacer fetch hasta que la capa esté lista
          } else {
            const satResponse = await apiGet<{
              frames: SatelliteFrame[];
              count: number;
              provider: string;
              error: string | null;
            }>("/api/global/satellite/frames");

            // Validación robusta de frames
            if (
              !satResponse ||
              satResponse.error !== null ||
              !Array.isArray(satResponse.frames) ||
              satResponse.frames.length === 0
            ) {
              if (satResponse?.error) {
                console.warn("[GeoScopeMap] GIBS frames error:", satResponse.error);
              } else {
                console.warn("[GeoScopeMap] GIBS frames empty or not available");
              }
              satelliteFrames = [];
              return;
            }

            // Filtrar frames que tengan al menos tile_url o timestamp válido
            const validFrames = satResponse.frames.filter(
              (frame) => frame && (frame.tile_url || frame.timestamp)
            );

            if (validFrames.length === 0) {
              console.warn("[GeoScopeMap] GIBS frames: no hay frames válidos con tile_url o timestamp");
              satelliteFrames = [];
              return;
            }

            notifiedWaitingForSatellite = false;
            satelliteFrames = validFrames;
            satelliteFrameIndex = satelliteFrames.length - 1;
            const currentFrame = satelliteFrames[satelliteFrameIndex];
            if (currentFrame) {
              applySatelliteFrame(currentFrame, "fetch");
              console.info(`[GeoScopeMap] GIBS frames fetched N=${satelliteFrames.length}`);
            }
          }
        } else {
          satelliteFrames = [];
        }

        if (isRadarEnabled) {
          const radarResponse = await apiGet<{
            frames: RadarFrame[];
            count: number;
            provider: string;
          }>("/api/global/radar/frames");

          if (radarResponse?.frames && radarResponse.frames.length > 0) {
            radarFrames = radarResponse.frames;
            radarFrameIndex = 0;
            const globalRadarLayer = globalRadarLayerRef.current;
            if (globalRadarLayer) {
              globalRadarLayer.update({ currentTimestamp: radarFrames[0].timestamp });
            }
          }
        } else {
          radarFrames = [];
        }
      } catch (err) {
        console.error("[GeoScopeMap] Failed to fetch global frames:", err);
      }
    };

    const advanceFrames = () => {
      if (!radarPlaying) {
        return;
      }

      if (canRenderSatellite() && satelliteFrames.length > 0) {
        satelliteFrameIndex = (satelliteFrameIndex + 1) % satelliteFrames.length;
        const currentFrame = satelliteFrames[satelliteFrameIndex];
        if (currentFrame) {
          applySatelliteFrame(currentFrame, "animation");
        }
      }

      if (isRadarEnabled && radarFrames.length > 0) {
        radarFrameIndex = (radarFrameIndex + 1) % radarFrames.length;
        const globalRadarLayer = globalRadarLayerRef.current;
        if (globalRadarLayer) {
          globalRadarLayer.update({ currentTimestamp: radarFrames[radarFrameIndex].timestamp });
        }
      }
    };

    const startAnimation = () => {
      if (animationTimer !== null) {
        return;
      }

      const frameSteps: number[] = [];
      if (canRenderSatellite()) {
        frameSteps.push(satelliteSettings.config?.frame_step ?? 10);
      }
      if (isRadarEnabled) {
        frameSteps.push(radarSettings.config?.frame_step ?? 5);
      }

      const baseMinutes = frameSteps.length > 0 ? Math.min(...frameSteps) : 5;
      const intervalMs =
        (baseMinutes * 60 * 1000) / Math.max(0.25, radarPlaybackSpeed ?? 1);

      const animate = () => {
        advanceFrames();
        animationTimer = window.setTimeout(animate, intervalMs);
      };

      animate();
    };

    const stopAnimation = () => {
      if (animationTimer !== null) {
        window.clearTimeout(animationTimer);
        animationTimer = null;
      }
    };

    const restartAnimation = () => {
      stopAnimation();
      if (radarPlaying && (canRenderSatellite() || isRadarEnabled)) {
        startAnimation();
      }
    };

    void fetchFrames();

    const satelliteRefresh = satelliteSettings.config?.refresh_minutes ?? 10;
    const radarRefresh = radarSettings.config?.refresh_minutes ?? 5;
    const refreshSources: number[] = [];
    if (isSatelliteEnabled) {
      refreshSources.push(satelliteRefresh);
    }
    if (isRadarEnabled) {
      refreshSources.push(radarRefresh);
    }
    const refreshIntervalMs =
      (refreshSources.length > 0 ? Math.min(...refreshSources) : 5) * 60 * 1000;

    const refreshTimer = window.setInterval(() => {
      void fetchFrames();
    }, refreshIntervalMs);

    const updateLayersState = () => {
      const map = mapRef.current;
      const globalSatLayer = globalSatelliteLayerRef.current;
      if (map && globalSatLayer && canRenderSatellite()) {
        globalSatLayer.update({
          opacity: satelliteSettings.opacity ?? 1,
          enabled: true,
        });
      }

      const globalRadarLayer = globalRadarLayerRef.current;
      if (globalRadarLayer && isRadarEnabled) {
        globalRadarLayer.update({ opacity: radarOpacity });
      }
    };

    updateLayersState();
    restartAnimation();

    return () => {
      stopAnimation();
      window.clearInterval(refreshTimer);
    };
    */
  }, [
    globalLayersSettings,
    globalSatelliteReady,
    radarPlaying,
    radarPlaybackSpeed,
    radarOpacity,
  ]);


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
      {/* MapHybrid desactivado: solo usar estilo base streets-v4 */}
    </div>
  );
}
