import * as maptilersdk from "@maptiler/sdk";
import { Map as MaptilerMap, config as maptilerConfig } from "@maptiler/sdk";
import type { MapLibreEvent, StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Point } from "geojson";
import "@maptiler/sdk/dist/maptiler-sdk.css";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import { apiGet, apiPost, saveConfig } from "../../lib/api";
import { useConfig } from "../../lib/useConfig";
import { applyMapStyle, computeStyleUrlFromConfig } from "../../kiosk/mapStyle";
import { kioskRuntime } from "../../lib/runtimeFlags";
import { removeLabelsOverlay, updateLabelsOpacity } from "../../lib/map/overlays/vectorLabels";
import { normalizeLabelsOverlay } from "../../lib/map/labelsOverlay";
import { signMapTilerUrl } from "../../lib/map/utils/maptilerHelpers";
import { getSafeMapStyle } from "../../lib/map/utils/safeMapStyle";
import { waitForMapReady } from "../../lib/map/utils/waitForMapReady";
import AircraftLayer from "./layers/AircraftLayer";
import GlobalRadarLayer from "./layers/GlobalRadarLayer";
import GlobalSatelliteLayer from "./layers/GlobalSatelliteLayer";
import AEMETWarningsLayer from "./layers/AEMETWarningsLayer";
import LightningLayer from "./layers/LightningLayer";
import WeatherLayer from "./layers/WeatherLayer";
import { LayerRegistry } from "./layers/LayerRegistry";
import SatelliteHybridLayer, { type SatelliteLabelsStyle } from "./layers/SatelliteHybridLayer";
import ShipsLayer from "./layers/ShipsLayer";
import AircraftMapLayer from "./layers/AircraftMapLayer";
import MapSpinner from "../MapSpinner";
import { hasSprite } from "./utils/styleSprite";
import { layerDiagnostics, type LayerId } from "./layers/LayerDiagnostics";
import {
  withConfigDefaults,
  DEFAULT_MAP_CONFIG,
  DEFAULT_OPENSKY_CONFIG
} from "../../config/defaults";
import { hasMaptilerKey, containsApiKey, buildFinalMaptilerStyleUrl } from "../../lib/map/maptilerRuntime";
import { extractMaptilerApiKeyFromUrl } from "../../lib/map/maptilerApiKey";
import { withStyleCacheBuster } from "../../lib/map/utils/styleCacheBuster";
import type {
  AppConfig,
  MapConfig,
  UIRotationConfig,
  GlobalSatelliteLayerConfig,
  GlobalRadarLayerConfig,
  FlightsLayerConfig,
  ShipsLayerConfig,
  OpenSkyConfig,
  SatelliteLabelsOverlay
} from "../../types/config";
import {
  loadMapStyle,
  type MapStyleDefinition,
  type MapStyleResult
} from "./mapStyle";
// Vista fija por defecto (España)
const DEFAULT_VIEW = {
  lng: -3.5,
  lat: 40.0,
  zoom: 3.6, // Zoom para ver toda la península ibérica en pantalla vertical
  bearing: 0,
  pitch: 0
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

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  layerId: string,
  operation: string
): Promise<T | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[${layerId}] ${operation} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms...`,
          lastError
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  if (lastError) {
    console.error(`[${layerId}] ${operation} failed after retries:`, lastError);
  }

  return null;
}
const DEFAULT_MIN_ZOOM = 2.0;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const cloneTheme = (theme?: Record<string, unknown> | null): Record<string, unknown> => ({
  ...(theme ?? {})
});

/**
 * Obtiene un bbox expandido del mapa actual con un factor de expansión.
 * @param map - Instancia del mapa de MapTiler
 * @param expandFactor - Factor de expansión (por defecto 1.5, expande 50% en cada dirección)
 * @returns Objeto con lamin, lamax, lomin, lomax
 */
function getExpandedBbox(map: MaptilerMap, expandFactor: number = 1.5): {
  lamin: number;
  lamax: number;
  lomin: number;
  lomax: number;
} {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const latSpan = ne.lat - sw.lat;
  const lonSpan = ne.lng - sw.lng;

  const latExpansion = latSpan * (expandFactor - 1);
  const lonExpansion = lonSpan * (expandFactor - 1);

  return {
    lamin: sw.lat - latExpansion,
    lamax: ne.lat + latExpansion,
    lomin: sw.lng - lonExpansion,
    lomax: ne.lng + lonExpansion,
  };
}

const setPaintProperty = (
  map: MaptilerMap,
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



const flightsResponseToGeoJSON = (
  payload: FlightsApiResponse | FeatureCollection<Point, FlightFeatureProperties>
): FeatureCollection<Point, FlightFeatureProperties> => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid flights payload: expected object");
  }

  if (isFeatureCollection<Point, FlightFeatureProperties>(payload)) {
    return payload;
  }

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

const ensureAircraftLayer = async (
  map: MaptilerMap | null,
  registry: LayerRegistry | null,
  flightsCfg: FlightsLayerConfig | undefined,
  openskyCfg: OpenSkyConfig | undefined,
): Promise<AircraftLayer | null> => {
  if (!map || !registry) {
    console.log("[GeoScopeMap] AircraftLayer: map or registry not ready, skipping init");
    return null;
  }

  if (flightsCfg?.enabled !== true || openskyCfg?.enabled !== true) {
    console.log("[GeoScopeMap] AircraftLayer: flights or OpenSky disabled in config, skipping init");
    return null;
  }

  const existing = registry.get("geoscope-aircraft");
  if (existing) {
    console.log("[GeoScopeMap] AircraftLayer already exists in LayerRegistry");
    return existing as AircraftLayer;
  }

  console.log("[GeoScopeMap] Initializing AircraftLayer with config:", { flightsCfg, openskyCfg });

  const style = getSafeMapStyle(map);
  // if (!style) {
  //   console.warn("[GeoScopeMap] AircraftLayer init skipped because map style is not ready");
  //   return null;
  // }

  let spriteAvailable = false;
  if (style) {
    try {
      spriteAvailable = await hasSprite(style);
    } catch (spriteError) {
      console.warn("[GeoScopeMap] Error checking sprite availability for AircraftLayer:", spriteError);
    }
  }

  const aircraftLayerInstance = new AircraftLayer({
    enabled: flightsCfg.enabled,
    opacity: flightsCfg.opacity,
    maxAgeSeconds: flightsCfg.max_age_seconds,
    cluster: openskyCfg.cluster,
    styleScale: flightsCfg.styleScale ?? 1,
    renderMode: flightsCfg.render_mode ?? "auto",
    circle: flightsCfg.circle,
    symbol: flightsCfg.symbol,
    spriteAvailable,
  });

  const registered = registry.register("geoscope-aircraft", aircraftLayerInstance);
  if (!registered) {
    console.warn("[GeoScopeMap] AircraftLayer failed to register in LayerRegistry");
    return null;
  }

  console.log("[GeoScopeMap] AircraftLayer initialized and registered in LayerRegistry");
  return aircraftLayerInstance;
};

const applyVectorTheme = (map: MaptilerMap, theme: Record<string, unknown>) => {
  const style = getSafeMapStyle(map);
  const layers = (Array.isArray(style?.layers) ? style!.layers : []) as Array<{ id?: string; type?: string }>;
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

const applyRasterTheme = (map: MaptilerMap, theme: Record<string, unknown>) => {
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
  map: MaptilerMap,
  styleType: MapStyleDefinition["type"],
  theme: Record<string, unknown>
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
 * del mapa híbrido.
 */
const extractHybridMappingConfig = (config: AppConfig | null): MapConfig => {
  if (!config?.ui_map) {
    return DEFAULT_MAP_CONFIG;
  }
  return config.ui_map;
};

const checkWebGLSupport = (): string | null => {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) {
      return "Tu navegador no soporta WebGL, necesario para mostrar el mapa.";
    }
    return null;
  } catch (e) {
    return "Error al inicializar WebGL.";
  }
};

const logError = (error: unknown) => {
  console.error("[GeoScopeMap]", error);
};

export type GeoScopeMapProps = {
  satelliteEnabled?: boolean;
  satelliteOpacity?: number;
  satelliteLabelsStyle?: SatelliteLabelsStyle;
};

export default function GeoScopeMap({
  satelliteEnabled,
  satelliteOpacity,
  satelliteLabelsStyle,
}: GeoScopeMapProps) {
  const { data: config, reload: reloadConfig } = useConfig();
  const mapRef = useRef<MaptilerMap | null>(null);
  const mapFillRef = useRef<HTMLDivElement>(null);
  const layerRegistryRef = useRef<LayerRegistry | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [styleChangeInProgress, setStyleChangeInProgress] = useState(false);
  const [tintColor, setTintColor] = useState<string | null>(null);

  // Estado para capas globales
  const [globalSatelliteReady, setGlobalSatelliteReady] = useState(false);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [radarPlaybackSpeed, setRadarPlaybackSpeed] = useState(1);
  const [radarOpacity, setRadarOpacity] = useState(0.7);

  // Refs para capas
  const aircraftLayerRef = useRef<AircraftLayer | null>(null);
  const shipsLayerRef = useRef<ShipsLayer | null>(null);
  const globalRadarLayerRef = useRef<GlobalRadarLayer | null>(null);
  const globalSatelliteLayerRef = useRef<GlobalSatelliteLayer | null>(null);
  const aemetWarningsLayerRef = useRef<AEMETWarningsLayer | null>(null);
  const lightningLayerRef = useRef<LightningLayer | null>(null);
  const weatherLayerRef = useRef<WeatherLayer | null>(null);
  const satelliteHybridLayerRef = useRef<SatelliteHybridLayer | null>(null);

  // Refs para estado
  const runtimeRef = useRef<any>(null);
  const themeRef = useRef<any>(null);
  const styleTypeRef = useRef<any>(null);
  const fallbackAppliedRef = useRef(false);
  const currentMinZoomRef = useRef<number | null>(null);
  const mapStateMachineRef = useRef<any>(null);

  const viewStateRef = useRef<any>({ ...DEFAULT_VIEW });

  // Configuración derivada
  const mergedConfig = useMemo(() => withConfigDefaults(config ?? undefined), [config]);
  const mapSettings = mergedConfig.ui_map;
  const maptilerConfigV2 = mapSettings.maptiler;
  const maptilerKey = useMemo(() => {
    return maptilerConfigV2?.api_key || null;
  }, [maptilerConfigV2]);

  const globalLayersSettings = useMemo(() => {
    return mergedConfig.layers?.global ?? {
      satellite: { enabled: true, provider: "gibs" as const, opacity: 1.0, refresh_minutes: 10, frame_step: 10, history_minutes: 120 },
      radar: { enabled: false, provider: "maptiler_weather" as const, opacity: 0.7, refresh_minutes: 5, frame_step: 5, history_minutes: 60 }
    };
  }, [mergedConfig]);

  const satelliteSettings: GlobalSatelliteLayerConfig = globalLayersSettings?.satellite ?? {
    enabled: true,
    provider: "gibs" as const,
    opacity: 1.0,
    refresh_minutes: 10,
    frame_step: 10,
    history_minutes: 120
  };
  const radarSettings: GlobalRadarLayerConfig = globalLayersSettings?.radar ?? {
    enabled: false,
    provider: "maptiler_weather" as const,
    opacity: 0.7,
    refresh_minutes: 5,
    frame_step: 5,
    history_minutes: 60
  };

  // Versionado de estilo para forzar recarga
  const [mapStyleVersion, setMapStyleVersion] = useState(0);

  // useEffect para configurar API key de MapTiler cuando config esté disponible
  // Este useEffect se ejecuta cada vez que config cambia, asegurando que la API key
  // se configure incluso si el mapa se creó antes de que config estuviera disponible
  useEffect(() => {
    if (!config) {
      return;
    }

    const globalApiKey =
      maptilerConfigV2?.api_key ??
      mapSettings.maptiler?.apiKey ??
      mapSettings.maptiler?.key ??
      (mapSettings.maptiler as any)?.api_key ??
      maptilerKey ??
      null;

    if (globalApiKey && (!maptilerConfig.apiKey || maptilerConfig.apiKey !== globalApiKey)) {
      maptilerConfig.apiKey = globalApiKey;
      console.log("[GeoScopeMap] MapTiler API key configured globally for SDK:", globalApiKey.substring(0, 8) + "...");
    }
  }, [config, maptilerConfigV2, mapSettings, maptilerKey]);

  // Inicialización del mapa
  useEffect(() => {
    const error = checkWebGLSupport();
    if (error) {
      setWebglError(error);
      return;
    }

    if (!mapFillRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;
    let styleLoadTimeout: number | null = null;

    // Inicializar mapa si no existe
    if (!mapRef.current) {
      try {
        // Ajustar zoom inicial según el ancho de pantalla
        const initialZoom = typeof window !== "undefined" && window.innerWidth < 800
          ? 4.5 // Zoom más alejado para pantallas pequeñas (Mini PC)
          : DEFAULT_VIEW.zoom;

        const map = new MaptilerMap({
          container: mapFillRef.current,
          style: "https://api.maptiler.com/maps/streets-v2/style.json?key=fBZDqPrUD4EwoZLV4L6A", // Placeholder
          center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat],
          zoom: initialZoom,
          bearing: DEFAULT_VIEW.bearing,
          pitch: DEFAULT_VIEW.pitch,
          attributionControl: false,
          navigationControl: false,
          geolocateControl: false,
        });
        mapRef.current = map;

        // Inicializar registro de capas
        layerRegistryRef.current = new LayerRegistry(map);

        // Inicializar capas
        aircraftLayerRef.current = new AircraftLayer();
        shipsLayerRef.current = new ShipsLayer();
        globalRadarLayerRef.current = new GlobalRadarLayer();
        globalSatelliteLayerRef.current = new GlobalSatelliteLayer();
        aemetWarningsLayerRef.current = new AEMETWarningsLayer();
        lightningLayerRef.current = new LightningLayer();
        weatherLayerRef.current = new WeatherLayer();

        // Registrar capas en el registro para que reciban el mapa y eventos
        layerRegistryRef.current.register("geoscope-aircraft", aircraftLayerRef.current);
        layerRegistryRef.current.register("geoscope-ships", shipsLayerRef.current);
        layerRegistryRef.current.register("geoscope-radar", globalRadarLayerRef.current);
        layerRegistryRef.current.register("geoscope-satellite", globalSatelliteLayerRef.current);
        layerRegistryRef.current.register("geoscope-warnings", aemetWarningsLayerRef.current);
        layerRegistryRef.current.register("geoscope-lightning", lightningLayerRef.current);
        layerRegistryRef.current.register("geoscope-weather", weatherLayerRef.current);

        map.once("load", () => {
          setMapReady(true);
        });
      } catch (e) {
        setWebglError("Error al inicializar el mapa: " + String(e));
        return;
      }
    }

    const map = mapRef.current;

    const applyStyleChange = async () => {
      if (cancelled) return;
      setStyleChangeInProgress(true);

      try {
        const previousMinZoom = map.getMinZoom() ?? DEFAULT_MIN_ZOOM;
        const currentCenter = map.getCenter() ?? DEFAULT_VIEW;
        const currentZoom = map.getZoom() ?? DEFAULT_VIEW.zoom;
        const currentBearing = map.getBearing() ?? DEFAULT_VIEW.bearing;
        const currentPitch = map.getPitch() ?? DEFAULT_VIEW.pitch;

        const configV2ForStyle = config as unknown as AppConfig | null;
        // Convertir a MapConfig para loadMapStyle
        // Calcular checksum para cache-buster (usar mapStyleVersion o timestamp)
        const configChecksum = mapStyleVersion || Date.now();

        // Obtener API key actualizada desde la configuración
        const currentApiKey =
          maptilerConfigV2?.api_key ??
          mapSettings.maptiler?.apiKey ??
          mapSettings.maptiler?.key ??
          (mapSettings.maptiler as any)?.api_key ??
          maptilerKey ??
          null;

        // Obtener styleUrl desde configuración V2 o desde mapSettings
        let styleUrlFromConfig =
          maptilerConfigV2?.styleUrl ||
          mapSettings.maptiler?.styleUrl ||
          mapSettings.maptiler?.styleUrlDark ||
          mapSettings.maptiler?.styleUrlLight ||
          mapSettings.maptiler?.styleUrlBright ||
          null;

        // Asegurar que el styleUrl esté firmado con el API key actual
        // Si la URL no tiene key o tiene un key diferente, reemplazarlo
        let styleUrlWithCacheBuster: string | null = null;
        if (styleUrlFromConfig) {
          try {
            const url = new URL(styleUrlFromConfig);
            // Si hay un API key nuevo, siempre actualizar el parámetro key
            if (currentApiKey) {
              url.searchParams.set("key", currentApiKey);
            }
            // Añadir cache buster
            url.searchParams.set("v", String(configChecksum));
            styleUrlWithCacheBuster = url.toString();
          } catch {
            // Si falla el parsing, intentar añadir key manualmente
            if (currentApiKey && styleUrlFromConfig) {
              const sep = styleUrlFromConfig.includes("?") ? "&" : "?";
              // Remover key antiguo si existe - usar RegExp constructor para evitar problemas de parsing
              const keyPattern = new RegExp("[?&]key=[^&]*");
              const urlWithoutKey = styleUrlFromConfig.replace(keyPattern, "");
              styleUrlWithCacheBuster = `${urlWithoutKey}${sep}key=${encodeURIComponent(currentApiKey)}&v=${configChecksum}`;
            } else {
              styleUrlWithCacheBuster = styleUrlFromConfig;
            }
          }
        }

        // Determinar el estilo desde la configuración V2 o desde mapSettings


        const ui_map: MapConfig = {
          engine: "maplibre",
          provider: mapSettings.provider === "maptiler_vector" ? "maptiler_vector" : "local_raster_xyz",
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

              // Asegurar que styleUrl esté firmado con el API key actual
              let finalStyleUrl = styleUrlWithCacheBuster;
              if (finalStyleUrl && resolvedKey) {
                try {
                  const url = new URL(finalStyleUrl);
                  url.searchParams.set("key", resolvedKey);
                  finalStyleUrl = url.toString();
                } catch {
                  // Si falla, intentar añadir key manualmente
                  const sep = finalStyleUrl.includes("?") ? "&" : "?";
                  const keyPattern = new RegExp("[?&]key=[^&]*");
                  const urlWithoutKey = finalStyleUrl.replace(keyPattern, "");
                  finalStyleUrl = `${urlWithoutKey}${sep}key=${encodeURIComponent(resolvedKey)}`;
                }
              }

              return {
                api_key: resolvedKey,
                apiKey: resolvedKey,
                key: legacyMaptiler.key ?? resolvedKey,
                styleUrl: finalStyleUrl,
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

        const cfgV2ForTint = config as unknown as AppConfig | null;
        const baseStyleName = cfgV2ForTint?.ui_map?.maptiler?.style || "streets-v4";
        const tintCandidate = mapSettings.theme?.tint ?? null;
        if (baseStyleName === "streets-v4") {
          setTintColor(null);
        } else if (typeof tintCandidate === "string" && tintCandidate.trim().length > 0) {
          setTintColor(tintCandidate);
        } else {
          setTintColor(null);
        }

        const mapWithCopies = map as MaptilerMap & {
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
            const style = getSafeMapStyle(map);
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
            // applyThemeToMap(map, styleType, theme);
          }

          // Reinyectar capas después de style.load
          // Esto reinyecta todas las capas registradas: radar AEMET, avisos, barcos, aviones, rayos
          layerRegistryRef.current?.reapply();

          // Reinyectar capas específicas que tienen métodos ensure*
          const merged = withConfigDefaults(config || undefined);
          const configAsV2 = config as unknown as {
            version?: number;
            aemet?: { enabled?: boolean; cap_enabled?: boolean };
            layers?: { flights?: FlightsLayerConfig; ships?: ShipsLayerConfig };
            opensky?: typeof merged.opensky;
          };

          // Reinyectar radar AEMET (avisos)
          if (configAsV2 && configAsV2.aemet?.enabled && configAsV2.aemet?.cap_enabled) {
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
          // Limpiar error previo si el estilo se cargó correctamente
          if (webglError) {
            console.log("[GeoScopeMap] Style loaded successfully, clearing previous error");
            setWebglError(null);
          }
        };

        // Timeout de 8s: si no llega style.load, recargar la página
        styleLoadTimeout = setTimeout(() => {
          if (!cancelled) {
            void logError("Style load timeout: reloading page after 8s");
            window.location.reload();
          }
        }, 8000);

        // Manejar errores de carga de estilo
        const handleStyleError = (event: MapLibreEvent & { error?: unknown }) => {
          if (cancelled || !mapRef.current) {
            return;
          }
          map.off("error", handleStyleError);

          const error = event.error as { status?: number; message?: string } | undefined;
          const status = error?.status;
          const message = error?.message || String(error);

          console.error("[GeoScopeMap] Error loading style:", error);

          // Limpiar timeout si existe
          if (styleLoadTimeout) {
            clearTimeout(styleLoadTimeout);
            styleLoadTimeout = null;
          }

          // Mostrar error específico según el código HTTP
          if (status === 401 || status === 403) {
            setWebglError("Error: API key de MapTiler inválida o sin permisos. Por favor, verifica tu API key en la configuración.");
          } else if (status === 404) {
            setWebglError("Error: URL del estilo de MapTiler no encontrada. Por favor, verifica la URL en la configuración.");
          } else if (status && status >= 400) {
            setWebglError(`Error al cargar el estilo del mapa (HTTP ${status}): ${message}`);
          } else {
            setWebglError(`Error al cargar el estilo del mapa: ${message}. Verifica que el API key y la URL sean correctos.`);
          }

          setStyleChangeInProgress(false);
          mapStateMachineRef.current?.notifyStyleData("config-style-change-error");
        };

        map.once("style.load", handleStyleLoad);
        map.once("error", handleStyleError);

        cleanup = () => {
          map.off("style.load", handleStyleLoad);
          map.off("error", handleStyleError);
          if (styleLoadTimeout) {
            clearTimeout(styleLoadTimeout);
            styleLoadTimeout = null;
          }
        };

        try {
          map.setStyle(styleResult.resolved.style as StyleSpecification, { diff: false });
        } catch (error) {
          // Limpiar listeners si falla inmediatamente
          map.off("style.load", handleStyleLoad);
          map.off("error", handleStyleError);

          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error("[GeoScopeMap] Error setting style:", error);
          setWebglError(`Error al aplicar el estilo del mapa: ${errorMessage}. Verifica que el API key y la URL sean correctos.`);
          void logError(error instanceof Error ? error : new Error(String(error)));
          setStyleChangeInProgress(false);
          return;
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[GeoScopeMap] Error applying live style change", error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          setWebglError(`Error al actualizar el mapa: ${errorMessage}. Verifica que el API key y la URL de MapTiler sean correctos.`);
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
    // En pantallas pequeñas (Mini PC), ignoramos el modo tormenta para forzar la vista fija de la península
    const isMiniPC = typeof window !== "undefined" && window.innerWidth < 1280;

    if (!config || !mapRef.current) {
      // No actualizar si no hay config o mapa
      return;
    }

    const merged = withConfigDefaults(config);
    const mapConfig = merged.ui_map;
    const fixedConfig = mapConfig?.fixed;

    // Soporte para v2: leer desde ui_map
    const v2Config = config as unknown as { ui_map?: { fixed?: { center?: { lat?: number; lon?: number }; zoom?: number; bearing?: number; pitch?: number } } };
    const v2Fixed = v2Config.ui_map?.fixed ?? fixedConfig;

    if (!v2Fixed || !v2Fixed.center || typeof v2Fixed.zoom !== "number") {
      return;
    }

    let centerLat = v2Fixed.center.lat ?? 40.4637;
    let centerLng = v2Fixed.center.lon ?? -3.7492;
    let zoom = v2Fixed.zoom ?? 4.8;
    const bearing = v2Fixed.bearing ?? 0;
    const pitch = v2Fixed.pitch ?? 0;

    // Ajuste dinámico para pantallas pequeñas (Mini PC)
    // Si la pantalla es pequeña (incluyendo 1024px o 1280px), FORZAMOS la vista de la península
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      // Usamos 3.6 para que se vea la península entera en vertical
      zoom = 3.6;
      // Forzamos el centro a España para evitar que el mapa "viaje" a otras ciudades
      centerLat = 40.0;
      centerLng = -3.5;
    }

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

    console.log("[GeoScopeMap] Applying fixed view from config:", {
      center: { lat: centerLat, lng: centerLng },
      zoom,
      bearing,
      pitch,
      source: "ui_map.fixed",
    });

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

    const merged = withConfigDefaults(config || undefined);
    const shipsConfig = merged.layers?.ships;

    if (!shipsConfig?.enabled) {
      return;
    }

    const layerId: LayerId = "ships";
    const MAX_RETRIES = 3;

    const loadShipsData = async (): Promise<void> => {
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
        } else {
          console.warn("[GeoScopeMap] Map style not loaded or map ref missing for Ships");
        }

        // FORCE Spain BBox for Mini PC debugging
        const spainBbox = "-12.0,34.0,6.0,46.0";

        if (typeof window !== "undefined") {
          console.log("[GeoScopeMap] Debug - Window width:", window.innerWidth);
          // Relaxed condition: Force if small screen OR if bbox is still undefined
          if (window.innerWidth < 2500 || !bbox) {
            console.log("[GeoScopeMap] Forcing Ships BBOX (Small screen or Map not ready):", spainBbox);
            bbox = spainBbox;
          }
        } else if (!bbox) {
          bbox = spainBbox;
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

        console.log("[GeoScopeMap] Loading ships data from:", url);

        // Validar respuesta del backend con retry
        const response = await retryWithBackoff(
          async () => {
            const resp = await apiGet<unknown>(url);

            // Validar estructura de respuesta
            if (!resp) {
              throw new Error("Empty response from backend");
            }

            // Validar que sea un FeatureCollection válido
            if (!isFeatureCollection<Point, ShipFeatureProperties>(resp)) {
              throw new Error(`Invalid FeatureCollection: ${JSON.stringify(resp).substring(0, 100)}`);
            }

            return resp;
          },
          MAX_RETRIES,
          1000,
          layerId,
          "loadShipsData"
        );

        if (!response) {
          layerDiagnostics.updatePreconditions(layerId, {
            backendAvailable: false,
          });
          return;
        }

        layerDiagnostics.updatePreconditions(layerId, {
          backendAvailable: true,
        });

        const shipsLayer = shipsLayerRef.current;
        if (shipsLayer && isFeatureCollection<Point, ShipFeatureProperties>(response)) {
          const featuresCount = response.features?.length ?? 0;
          console.log("[GeoScopeMap] Ships data loaded successfully:", {
            featuresCount,
            provider: shipsConfig.provider,
          });
          shipsLayer.updateData(response);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        layerDiagnostics.recordError(layerId, err, {
          phase: "loadShipsData",
        });
        console.error("[GeoScopeMap] Failed to load ships data:", error);
      }
    };

    // Cargar inmediatamente
    void loadShipsData();

    // Polling periódico
    const intervalSeconds = Math.max(10, shipsConfig.refresh_seconds ?? 30);
    const intervalMs = intervalSeconds * 1000;
    const intervalId = setInterval(() => {
      void loadShipsData();
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [config]);

  // Sistema de recuperación automática para capas
  useEffect(() => {
    if (!mapRef.current || !layerRegistryRef.current) {
      return;
    }

    const RECOVERY_CHECK_INTERVAL = 30000; // Verificar cada 30 segundos
    const MAX_ERROR_COUNT = 5; // Máximo de errores antes de deshabilitar temporalmente
    const RECOVERY_BACKOFF_BASE = 5000; // 5 segundos base para backoff

    const checkAndRecoverLayers = () => {
      const diagnostics = layerDiagnostics.getAllDiagnostics();

      for (const [layerId, diagnostic] of diagnostics.entries()) {
        // Solo intentar recuperar capas que están en error y están habilitadas
        if (diagnostic.state === "error" && diagnostic.enabled) {
          // Si hay demasiados errores, esperar más tiempo antes de reintentar
          if (diagnostic.errorCount >= MAX_ERROR_COUNT) {
            const backoffMs = RECOVERY_BACKOFF_BASE * Math.pow(2, Math.min(diagnostic.errorCount - MAX_ERROR_COUNT, 3));
            const timeSinceLastError = diagnostic.lastErrorTime ? Date.now() - diagnostic.lastErrorTime : Infinity;

            if (timeSinceLastError < backoffMs) {
              // Aún en período de backoff
              continue;
            }
          }

          console.log(`[GeoScopeMap] Attempting to recover layer: ${layerId}`);
          layerDiagnostics.reset(layerId);
          layerDiagnostics.setState(layerId, "initializing", {
            reason: "auto_recovery",
          });

          // Intentar reinicializar según el tipo de capa
          try {
            if (layerId === "flights" && aircraftLayerRef.current) {
              const merged = withConfigDefaults(config ?? undefined);
              const flightsConfig = merged.layers?.flights;
              const openskyConfig = merged.opensky;

              // En config v2, opensky.enabled no existe, así que lo consideramos true por defecto
              const openskyEnabled = openskyConfig.enabled ?? true;
              const openskyHasCredentials = openskyConfig.oauth2?.has_credentials === true;

              if (flightsConfig?.enabled && openskyEnabled && openskyHasCredentials) {
                void aircraftLayerRef.current.ensureFlightsLayer();
              }
            } else if (layerId === "ships" && shipsLayerRef.current) {
              const merged = withConfigDefaults(config ?? undefined);
              const shipsConfig = merged.layers?.ships;

              if (shipsConfig?.enabled) {
                void shipsLayerRef.current.ensureShipsLayer();
              }
            } else if (layerId === "weather" && weatherLayerRef.current) {
              const merged = withConfigDefaults(config ?? undefined);
              const configAsV2 = config ? (config as unknown as { version?: number; aemet?: { enabled?: boolean; cap_enabled?: boolean } }) : null;
              const aemetConfig = (configAsV2?.version === 2)
                ? configAsV2.aemet
                : merged.aemet;

              if (aemetConfig?.enabled && aemetConfig?.cap_enabled) {
                weatherLayerRef.current.setEnabled(true);
              }
            }
          } catch (recoveryError) {
            const error = recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError));
            layerDiagnostics.recordError(layerId, error, {
              phase: "auto_recovery",
            });
            console.error(`[GeoScopeMap] Failed to recover layer ${layerId}:`, recoveryError);
          }
        }
      }
    };

    // Verificar inmediatamente
    checkAndRecoverLayers();

    // Verificar periódicamente
    const recoveryInterval = setInterval(checkAndRecoverLayers, RECOVERY_CHECK_INTERVAL);

    return () => {
      clearInterval(recoveryInterval);
    };
  }, [config]);

  // useEffect para gestionar la configuración del radar
  // RainViewer está deprecado: si el provider es "rainviewer", se fuerza a "maptiler_weather"
  // MapTiler Weather se gestiona directamente mediante GlobalRadarLayer cuando provider === "maptiler_weather"
  useEffect(() => {
    console.log("[GlobalRadarLayer] useEffect enter, checking radar configuration");

    if (!config) {
      console.log("[GlobalRadarLayer] No config available, skipping");
      return;
    }

    // Leer configuración del radar
    const configAsV2Radar = config as unknown as {
      version?: number;
      ui_global?: {
        radar?: { enabled?: boolean; opacity?: number; provider?: string };
        weather_layers?: {
          radar?: { enabled?: boolean; opacity?: number; provider?: string };
        };
      };
      layers?: {
        global_?: {
          radar?: GlobalRadarLayerConfig & { provider?: string };
        };
        global?: {
          radar?: GlobalRadarLayerConfig & { provider?: string };
        };
      };
    };

    // Leer configuración desde layers.global.radar + ui_global.weather_layers.radar
    const globalRadarConfig = configAsV2Radar.version === 2 && configAsV2Radar.layers?.global_?.radar
      ? configAsV2Radar.layers.global_.radar
      : (config ? withConfigDefaults(config) : withConfigDefaults()).layers?.global?.radar;

    const weatherLayersRadar = configAsV2Radar.version === 2 ? configAsV2Radar.ui_global?.weather_layers?.radar : undefined;
    const uiGlobalRadar = configAsV2Radar.version === 2 ? configAsV2Radar.ui_global?.radar : undefined;

    // Determinar el provider: prioridad weather_layers > ui_global > layers.global
    let providerRaw =
      weatherLayersRadar?.provider ??
      uiGlobalRadar?.provider ??
      globalRadarConfig?.provider ??
      "maptiler_weather";

    // Fuerza MapTiler Weather mientras RainViewer está deprecado
    let radarProvider = providerRaw;
    if (providerRaw === "rainviewer") {
      console.log("[GlobalRadarLayer] (effect) Forcing radar provider to maptiler_weather (RainViewer deprecated)");
      radarProvider = "maptiler_weather";
    }

    // Prioridad: weather_layers.radar > ui_global.radar > layers.global*.radar
    const isRadarEnabled =
      weatherLayersRadar?.enabled ??
      uiGlobalRadar?.enabled ??
      globalRadarConfig?.enabled ??
      false;

    const radarDiagnostic = layerDiagnostics.getDiagnostic("radar");
    const apiKeysConfigured = radarProvider === "maptiler_weather"
      ? true
      : radarDiagnostic?.preconditions.apiKeysConfigured ?? true;

    layerDiagnostics.setEnabled("radar", isRadarEnabled);
    layerDiagnostics.updatePreconditions("radar", {
      configAvailable: true,
      configEnabled: isRadarEnabled,
      backendAvailable: true,
      apiKeysConfigured,
    });

    console.log("[GlobalRadarLayer] useEffect cfg=", {
      globalRadarConfig,
      weatherLayersRadar,
      uiGlobalRadar,
      layersGlobalRadar: globalRadarConfig,
      isEnabled: isRadarEnabled,
      provider: radarProvider
    });

    // Legacy RainViewer (desactivado por ahora)
    // Si el provider original era "rainviewer", lo forzamos a "maptiler_weather" arriba
    // Este bloque desactiva completamente el flujo de RainViewer
    if (providerRaw === "rainviewer") {
      console.log("[GlobalRadarLayer] RainViewer prefetch disabled (provider rainviewer ignored in effect)");
      // NO LLAMAR a fetchRadarFrames aquí
      // El provider efectivo ahora es maptiler_weather, así que continuamos con la rama MapTiler
    }

    // Si el provider efectivo es "maptiler_weather", GlobalRadarLayer se encarga del radar directamente
    if (radarProvider === "maptiler_weather") {
      console.log("[GlobalRadarLayer] MapTiler Weather selected in effect; skipping RainViewer prefetch");

      const globalRadarLayer = globalRadarLayerRef.current;
      if (globalRadarLayer) {
        // Actualizar la capa con la configuración correcta
        globalRadarLayer.update({
          enabled: isRadarEnabled,
          opacity: radarOpacity,
          provider: "maptiler_weather"
        });
      }

      if (isRadarEnabled) {
        layerDiagnostics.recordInitializationAttempt("radar");
        layerDiagnostics.setState("radar", "initializing", { provider: radarProvider });
        console.log("[GlobalRadarLayer] Initializing MapTiler Weather radar layer");
        layerDiagnostics.setState("radar", "ready", { provider: radarProvider });
        layerDiagnostics.recordDataUpdate("radar");
      } else {
        layerDiagnostics.setState("radar", "disabled", { provider: radarProvider });
      }

      return;
    }

    // Si llegamos aquí y el provider no es maptiler_weather ni rainviewer, es desconocido
    if (!isRadarEnabled) {
      layerDiagnostics.setState("radar", "disabled", { provider: radarProvider });
      return;
    }
  }, [config]);

  // useEffect para gestionar la configuración de AEMET (Avisos)
  useEffect(() => {
    if (!config || !aemetWarningsLayerRef.current) return;

    const merged = withConfigDefaults(config);
    // Soporte para v2 y v1
    const configAsV2 = config as unknown as {
      version?: number;
      aemet?: {
        enabled?: boolean;
        cap_enabled?: boolean;
        opacity?: number;
        min_severity?: string;
        refresh_seconds?: number;
      };
    };

    const aemetConfig = configAsV2.version === 2
      ? configAsV2.aemet
      : merged.aemet;

    const layer = aemetWarningsLayerRef.current;

    // Lógica de habilitación: enabled && cap_enabled (si existe)
    const isEnabled = Boolean((aemetConfig?.enabled ?? false) && (aemetConfig?.cap_enabled ?? true));

    layer.setEnabled(isEnabled);

    if (isEnabled) {
      if (typeof aemetConfig?.opacity === "number") {
        layer.setOpacity(aemetConfig.opacity);
      }
      if (aemetConfig?.min_severity) {
        layer.setMinSeverity(aemetConfig.min_severity as "minor" | "moderate" | "severe" | "extreme");
      }
      if (typeof aemetConfig?.refresh_seconds === "number") {
        layer.setRefreshSeconds(aemetConfig.refresh_seconds);
      }
    }

    // Actualizar diagnósticos
    layerDiagnostics.setEnabled("aemet-warnings", isEnabled);
    if (isEnabled) {
      layerDiagnostics.updatePreconditions("aemet-warnings", {
        configAvailable: true,
        configEnabled: true,
      });
    }
  }, [config]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const isSatelliteEnabled = satelliteSettings.enabled;
    const isRadarEnabled = radarSettings.enabled;

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
        frameSteps.push(satelliteSettings.frame_step ?? 10);
      }
      if (isRadarEnabled) {
        frameSteps.push(radarSettings.frame_step ?? 5);
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

    const satelliteRefresh = satelliteSettings?.refresh_minutes ?? 10;
    const radarRefresh = radarSettings?.refresh_minutes ?? 5;
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
      {/* Renderizar AircraftMapLayer cuando el mapa esté listo y flights esté habilitado */}
      {
        mapRef.current && mapReady && layerRegistryRef.current ? (
          <AircraftMapLayer
            mapRef={mapRef}
            layerRegistry={layerRegistryRef.current}
            config={config}
            mapReady={mapReady}
          />
        ) : null
      }
    </div >
  );
}
