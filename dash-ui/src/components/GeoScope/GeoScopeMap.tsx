import maplibregl from "maplibre-gl";
import type { MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import { apiGet } from "../../lib/api";
import { kioskRuntime } from "../../lib/runtimeFlags";
import {
  createDefaultMapCinema,
  createDefaultMapPreferences,
  createDefaultMapSettings,
  withConfigDefaults
} from "../../config/defaults";
import type {
  AppConfig,
  MapCinemaBand,
  MapCinemaConfig,
  MapConfig,
  MapPreferences,
  MapThemeConfig
} from "../../types/config";
import {
  loadMapStyle,
  type MapStyleDefinition,
  type MapStyleResult
} from "./mapStyle";

export const GEO_SCOPE_AUTOPAN_EVENT = "geoscope:auto-pan-bearing";

const FALLBACK_CINEMA = createDefaultMapCinema();
const DEFAULT_VIEW = {
  lng: 0,
  lat: FALLBACK_CINEMA.bands[0]?.lat ?? 0,
  zoom: FALLBACK_CINEMA.bands[0]?.zoom ?? 2.6,
  bearing: 0,
  pitch: FALLBACK_CINEMA.bands[0]?.pitch ?? 0
};
const DEFAULT_MIN_ZOOM = FALLBACK_CINEMA.bands[0]?.minZoom ?? 2.4;
const FALLBACK_ROTATION_DEG_PER_SEC = 6 / 60;
const DEFAULT_PAN_SPEED = Math.max(
  Number.isFinite(FALLBACK_CINEMA.panLngDegPerSec)
    ? FALLBACK_CINEMA.panLngDegPerSec
    : FALLBACK_ROTATION_DEG_PER_SEC,
  FALLBACK_ROTATION_DEG_PER_SEC
);
const FPS_LIMIT = 45;
const FRAME_MIN_INTERVAL_MS = 1000 / FPS_LIMIT;
const MAX_DELTA_SECONDS = 0.5;
const WATCHDOG_INTERVAL_MS = 3000;
const WATCHDOG_BEARING_DELTA = 0.75;
const FALLBACK_TICK_INTERVAL_MS = 1000;
const AUTOPAN_LOG_INTERVAL_MS = 5000;

const FALLBACK_THEME = createDefaultMapSettings().theme ?? {};

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

type AutopanMode = "rotate" | "serpentine";

type SerpentineConfig = {
  cols: number;
  rows: number;
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
  speedSec: number;
  pauseMs: number;
  reducedMotion: boolean;
  initialDirection: "E" | "W";
  force: boolean;
};

type DiagnosticsAutopanConfig =
  | { mode: "rotate" }
  | { mode: "serpentine"; config: SerpentineConfig };

type SerpentinePoint = {
  row: number;
  column: number;
  lon: number;
  lat: number;
};

type SerpentineRunner = {
  cancel: () => void;
};

type AutoPanGlobal = Window & {
  __AUTO_PAN_CANCEL__?: () => void;
};

const getAutoPanGlobal = (): AutoPanGlobal | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as AutoPanGlobal;
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

const parseDiagnosticsAutopanConfig = (): DiagnosticsAutopanConfig => {
  if (typeof window === "undefined") {
    return { mode: "rotate" };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return { mode: "rotate" };
  }

  const modeParam = params.get("mode")?.toLowerCase();
  if (modeParam !== "serpentine") {
    return { mode: "rotate" };
  }

  const readInt = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw == null) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const readNumber = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw == null) {
      return fallback;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const cols = Math.max(1, readInt("cols", 24));
  const rows = Math.max(1, readInt("rows", 6));

  let lonMin = readNumber("lonMin", -170);
  let lonMax = readNumber("lonMax", 170);
  if (lonMin > lonMax) {
    [lonMin, lonMax] = [lonMax, lonMin];
  }

  let latMin = clampLatitude(readNumber("latMin", -60));
  let latMax = clampLatitude(readNumber("latMax", 60));
  if (latMin > latMax) {
    [latMin, latMax] = [latMax, latMin];
  }

  const speedSecRaw = readNumber("speed", 0.8);
  const speedSec = speedSecRaw > 0 ? speedSecRaw : 0;
  const pauseMsRaw = readNumber("pause", 800);
  const pauseMs = Math.max(0, Math.round(pauseMsRaw));
  const dirParam = params.get("dir");
  const initialDirection = dirParam && dirParam.toUpperCase() === "W" ? "W" : "E";
  const reducedMotionParam = parseBooleanParam(params.get("reducedMotion"));
  const reducedMotion = reducedMotionParam === true;
  const forceParam = parseBooleanParam(params.get("force"));
  const force = forceParam === true;

  return {
    mode: "serpentine",
    config: {
      cols,
      rows,
      lonMin,
      lonMax,
      latMin,
      latMax,
      speedSec,
      pauseMs,
      reducedMotion,
      initialDirection,
      force
    }
  };
};

const generateSerpentinePoints = (config: SerpentineConfig): SerpentinePoint[] => {
  const points: SerpentinePoint[] = [];
  const { rows, cols, lonMin, lonMax, latMin, latMax, initialDirection } = config;
  const lonStep = cols > 1 ? (lonMax - lonMin) / (cols - 1) : 0;
  const latStep = rows > 1 ? (latMax - latMin) / (rows - 1) : 0;
  const fallbackLon = (lonMin + lonMax) / 2;
  const fallbackLat = (latMin + latMax) / 2;
  const initialEast = initialDirection === "E";

  for (let row = 0; row < rows; row += 1) {
    const goEast = row % 2 === 0 ? initialEast : !initialEast;
    const lat = rows > 1 ? latMin + latStep * row : fallbackLat;
    for (let step = 0; step < cols; step += 1) {
      const column = goEast ? step : cols - 1 - step;
      const lon = cols > 1 ? lonMin + lonStep * column : fallbackLon;
      points.push({ row, column, lon, lat });
    }
  }

  return points;
};

const createSerpentineRunner = (
  map: maplibregl.Map,
  config: SerpentineConfig,
  onCenterChange?: (lon: number, lat: number) => void
): SerpentineRunner | null => {
  const points = generateSerpentinePoints(config);
  if (!points.length) {
    return null;
  }

  let cancelled = false;
  let timeoutId: number | null = null;
  let frameId: number | null = null;
  let index = 0;

  const clearTimers = () => {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (frameId != null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };

  const scheduleNext = (delayMs: number) => {
    if (cancelled) {
      return;
    }
    if (delayMs <= 0) {
      if (typeof requestAnimationFrame === "function") {
        frameId = requestAnimationFrame(() => {
          frameId = null;
          runStep();
        });
      } else {
        timeoutId = window.setTimeout(() => {
          timeoutId = null;
          runStep();
        }, 0);
      }
      return;
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      runStep();
    }, delayMs);
  };

  const runStep = () => {
    if (cancelled) {
      return;
    }
    const point = points[index];
    if (!point) {
      index = 0;
      scheduleNext(0);
      return;
    }

    const normalizedLon = normalizeLng(point.lon);
    onCenterChange?.(normalizedLon, point.lat);
    console.log(
      `[auto-pan:step] mode=serpentine r=${point.row} c=${point.column} center=[${normalizedLon.toFixed(4)},${point.lat.toFixed(4)}]`
    );
    const center: [number, number] = [normalizedLon, point.lat];

    index = (index + 1) % points.length;

    if (config.reducedMotion) {
      map.jumpTo({ center });
      scheduleNext(config.pauseMs);
      return;
    }

    const durationMs = Math.max(0, config.speedSec * 1000);
    map.easeTo({
      center,
      duration: durationMs,
      easing: (t: number) => t
    });
    scheduleNext(durationMs + config.pauseMs);
  };

  const cancel = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    clearTimers();
    try {
      map.stop();
    } catch {
      // Ignore failures when stopping the map animation.
    }
  };

  scheduleNext(0);

  return { cancel };
};

const sanitizeBand = (
  band: MapCinemaBand,
  fallback: MapCinemaBand
): MapCinemaBand => {
  const safeFallback = fallback ?? FALLBACK_CINEMA.bands[0];
  const zoom = Number.isFinite(band.zoom) ? band.zoom : safeFallback.zoom;
  const minZoomCandidate = Number.isFinite(band.minZoom) ? band.minZoom : safeFallback.minZoom;
  const minZoom = minZoomCandidate <= zoom ? minZoomCandidate : zoom;

  return {
    lat: Number.isFinite(band.lat) ? band.lat : safeFallback.lat,
    zoom,
    pitch: Number.isFinite(band.pitch) ? band.pitch : safeFallback.pitch,
    minZoom,
    duration_sec: Number.isFinite(band.duration_sec)
      ? Math.max(band.duration_sec, 0.1)
      : Math.max(safeFallback.duration_sec, 0.1)
  };
};

const cloneCinema = (cinema: MapCinemaConfig): MapCinemaConfig => {
  const fallbackBands = FALLBACK_CINEMA.bands;
  const bands = cinema.bands.map((band, index) =>
    sanitizeBand({ ...band }, fallbackBands[index] ?? fallbackBands[0] ?? band)
  );

  const fallbackPan = FALLBACK_CINEMA.panLngDegPerSec;
  const fallbackTransition = FALLBACK_CINEMA.bandTransition_sec;

  const panLngDegPerSec = Number.isFinite(cinema.panLngDegPerSec)
    ? Math.max(cinema.panLngDegPerSec, 0)
    : fallbackPan;
  const bandTransition_sec = Number.isFinite(cinema.bandTransition_sec)
    ? Math.max(cinema.bandTransition_sec, 0)
    : fallbackTransition;

  return {
    ...cinema,
    panLngDegPerSec,
    bandTransition_sec,
    bands
  };
};

type TransitionState = {
  from: MapCinemaBand;
  to: MapCinemaBand;
  toIndex: number;
  duration: number;
  elapsed: number;
};

type RuntimePreferences = {
  cinema: MapCinemaConfig;
  renderWorldCopies: boolean;
  initialLng: number;
  style: MapStyleDefinition;
  fallbackStyle: MapStyleDefinition;
  styleWasFallback: boolean;
  theme: MapThemeConfig;
  respectReducedMotion: boolean;
};

const buildRuntimePreferences = (
  mapSettings: MapConfig,
  styleResult: MapStyleResult
): RuntimePreferences => {
  const defaults = createDefaultMapSettings();
  const source = mapSettings ?? defaults;
  const cinemaSource = source.cinema ?? defaults.cinema ?? createDefaultMapCinema();
  const cinema = cloneCinema(cinemaSource);
  cinema.enabled = true;

  const initialLng = 0;

  return {
    cinema,
    renderWorldCopies: source.renderWorldCopies ?? defaults.renderWorldCopies ?? true,
    initialLng,
    style: styleResult.resolved,
    fallbackStyle: styleResult.fallback,
    styleWasFallback: styleResult.usedFallback,
    theme: cloneTheme(source.theme),
    respectReducedMotion:
      typeof source.respectReducedMotion === "boolean"
        ? source.respectReducedMotion
        : defaults.respectReducedMotion ?? false
  };
};

const loadRuntimePreferences = async (): Promise<RuntimePreferences> => {
  try {
    const config = await apiGet<AppConfig | undefined>("/api/config");
    const merged = withConfigDefaults(config);
    const mapSettings = merged.ui.map;
    const mapPreferences: MapPreferences = merged.map ?? createDefaultMapPreferences();
    const styleResult = await loadMapStyle(mapSettings, mapPreferences);
    return buildRuntimePreferences(mapSettings, styleResult);
  } catch (error) {
    console.warn(
      "[GeoScopeMap] Falling back to default cinema configuration (using defaults).",
      error
    );
    const fallbackSettings = createDefaultMapSettings();
    const fallbackPreferences = createDefaultMapPreferences();
    const styleResult = await loadMapStyle(fallbackSettings, fallbackPreferences);
    return buildRuntimePreferences(fallbackSettings, styleResult);
  }
};

export default function GeoScopeMap() {
  const mapFillRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const dprMediaRef = useRef<MediaQueryList | null>(null);
  const viewStateRef = useRef({ ...DEFAULT_VIEW });
  const currentMinZoomRef = useRef(DEFAULT_MIN_ZOOM);
  const panSpeedRef = useRef(DEFAULT_PAN_SPEED);
  const cinemaRef = useRef<MapCinemaConfig>(cloneCinema(FALLBACK_CINEMA));
  const bandIndexRef = useRef(0);
  const bandElapsedRef = useRef(0);
  const bandTransitionRef = useRef<TransitionState | null>(null);
  const themeRef = useRef<MapThemeConfig>(cloneTheme(null));
  const styleTypeRef = useRef<MapStyleDefinition["type"]>("raster");
  const fallbackStyleRef = useRef<MapStyleDefinition | null>(null);
  const fallbackAppliedRef = useRef(false);
  const fallbackTimerRef = useRef<number | null>(null);
  const lastRepaintTimeRef = useRef<number | null>(null);
  const respectReducedMotionRef = useRef(false);
  const reducedMotionMediaRef = useRef<MediaQueryList | null>(null);
  const reducedMotionActiveRef = useRef(false);
  const kioskModeRef = useRef(kioskRuntime.isLikelyKiosk());
  const autopanForcedOnRef = useRef(kioskRuntime.isAutopanForcedOn());
  const autopanForcedOffRef = useRef(kioskRuntime.isAutopanForcedOff());
  const motionForcedRef = useRef(kioskRuntime.isMotionForced());
  const motionOverrideLoggedRef = useRef(false);
  const autopanEnabledRef = useRef(true);
  const diagnosticsAutopanRef = useRef<DiagnosticsAutopanConfig>(
    parseDiagnosticsAutopanConfig()
  );
  const autopanModeRef = useRef<AutopanMode>(diagnosticsAutopanRef.current.mode);
  const serpentineConfigRef = useRef<SerpentineConfig | null>(
    diagnosticsAutopanRef.current.mode === "serpentine"
      ? diagnosticsAutopanRef.current.config
      : null
  );
  const serpentineControllerRef = useRef<SerpentineRunner | null>(null);
  const serpentineForcePendingRef = useRef<boolean>(
    diagnosticsAutopanRef.current.mode === "serpentine"
      ? diagnosticsAutopanRef.current.config.force
      : false
  );
  const lastLogTimeRef = useRef<number>(0);
  const respectDefaultRef = useRef(false);
  const [tintColor, setTintColor] = useState<string | null>(null);

  const applyBandInstant = (band: MapCinemaBand, map?: maplibregl.Map | null) => {
    const zoom = Number.isFinite(band.zoom) ? band.zoom : viewStateRef.current.zoom;
    const minZoom = Math.min(Number.isFinite(band.minZoom) ? band.minZoom : zoom, zoom);

    viewStateRef.current.lat = Number.isFinite(band.lat) ? band.lat : viewStateRef.current.lat;
    viewStateRef.current.zoom = zoom;
    viewStateRef.current.pitch = Number.isFinite(band.pitch) ? band.pitch : viewStateRef.current.pitch;
    viewStateRef.current.bearing = 0;
    currentMinZoomRef.current = minZoom;

    const target = map ?? mapRef.current;
    if (target) {
      target.setMinZoom(minZoom);
    }
  };

  const finishTransition = (map: maplibregl.Map | null) => {
    const state = bandTransitionRef.current;
    if (!state) return;

    applyBandInstant(state.to, map ?? mapRef.current);
    bandIndexRef.current = state.toIndex;
    bandElapsedRef.current = 0;
    bandTransitionRef.current = null;
  };

  const startTransition = (nextIndex: number) => {
    const cinema = cinemaRef.current;
    if (!cinema.bands.length) return;

    const totalBands = cinema.bands.length;
    const currentIndex = ((bandIndexRef.current % totalBands) + totalBands) % totalBands;
    const targetIndex = ((nextIndex % totalBands) + totalBands) % totalBands;

    const fromBand = cinema.bands[currentIndex];
    const toBand = cinema.bands[targetIndex];
    if (!fromBand || !toBand) {
      return;
    }

    const duration = Math.max(0.1, cinema.bandTransition_sec);
    bandTransitionRef.current = {
      from: fromBand,
      to: toBand,
      toIndex: targetIndex,
      duration,
      elapsed: 0
    };

    const minZoom = Math.min(fromBand.minZoom, toBand.minZoom);
    currentMinZoomRef.current = minZoom;
    const map = mapRef.current;
    if (map) {
      map.setMinZoom(minZoom);
    }
  };

  const advanceTransition = (deltaSeconds: number): number => {
    const state = bandTransitionRef.current;
    if (!state) return deltaSeconds;

    const previousElapsed = state.elapsed;
    const targetElapsed = previousElapsed + deltaSeconds;
    const clampedElapsed = Math.min(targetElapsed, state.duration);
    state.elapsed = clampedElapsed;

    const progress = state.duration > 0 ? clampedElapsed / state.duration : 1;
    const eased = easeInOut(Math.min(progress, 1));

    const fromBand = state.from;
    const toBand = state.to;

    const nextLat = lerp(fromBand.lat, toBand.lat, eased);
    const nextZoom = lerp(fromBand.zoom, toBand.zoom, eased);
    const nextPitch = lerp(fromBand.pitch, toBand.pitch, eased);
    const interpolatedMinZoom = lerp(fromBand.minZoom, toBand.minZoom, eased);
    const nextMinZoom = Math.min(interpolatedMinZoom, nextZoom);

    viewStateRef.current.lat = nextLat;
    viewStateRef.current.zoom = nextZoom;
    viewStateRef.current.pitch = nextPitch;
    viewStateRef.current.bearing = 0;
    currentMinZoomRef.current = nextMinZoom;

    const map = mapRef.current;
    if (map) {
      map.setMinZoom(nextMinZoom);
    }

    if (clampedElapsed >= state.duration) {
      finishTransition(map);
    }

    const consumed = clampedElapsed - previousElapsed;
    const remaining = deltaSeconds - consumed;
    return remaining > 0 ? remaining : 0;
  };

  const updateBandState = (deltaSeconds: number) => {
    const cinema = cinemaRef.current;
    const totalBands = cinema.bands.length;
    if (!totalBands) {
      return;
    }

    let remaining = deltaSeconds;
    let previousRemaining = Number.POSITIVE_INFINITY;

    while (remaining > 0) {
      if (remaining >= previousRemaining - 1e-6) {
        break;
      }
      previousRemaining = remaining;

      const afterTransition = advanceTransition(remaining);
      if (afterTransition < remaining) {
        remaining = afterTransition;
        continue;
      }

      const currentIndex = ((bandIndexRef.current % totalBands) + totalBands) % totalBands;
      const currentBand = cinema.bands[currentIndex];
      if (!currentBand) {
        return;
      }

      const duration = Math.max(0.1, currentBand.duration_sec);
      const elapsed = bandElapsedRef.current + remaining;

      if (elapsed < duration) {
        bandElapsedRef.current = elapsed;
        return;
      }

      const leftover = Math.max(0, elapsed - duration);
      bandElapsedRef.current = 0;
      startTransition(currentIndex + 1);

      if (!bandTransitionRef.current) {
        const nextIndex = (currentIndex + 1 + totalBands) % totalBands;
        const nextBand = cinema.bands[nextIndex];
        if (nextBand) {
          applyBandInstant(nextBand, mapRef.current);
          bandIndexRef.current = nextIndex;
        }
      }

      remaining = leftover;
    }
  };

  const updateMapView = (map: maplibregl.Map) => {
    const { lng, lat, zoom, pitch, bearing } = viewStateRef.current;
    map.jumpTo({
      center: [lng, lat],
      zoom,
      pitch,
      bearing
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

    const teardownFallbackTimer = () => {
      if (fallbackTimerRef.current != null) {
        window.clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };

    const cancelSerpentine = () => {
      const controller = serpentineControllerRef.current;
      if (!controller) {
        return;
      }
      serpentineControllerRef.current = null;
      try {
        controller.cancel();
      } catch {
        // Ignore failures when cancelling a serpentine sequence.
      }
      const autopanGlobal = getAutoPanGlobal();
      if (autopanGlobal && autopanGlobal.__AUTO_PAN_CANCEL__ === controller.cancel) {
        autopanGlobal.__AUTO_PAN_CANCEL__ = undefined;
      }
    };

    const ensureSerpentine = () => {
      const map = mapRef.current;
      const config = serpentineConfigRef.current;
      if (!map || !config) {
        return;
      }

      const needsRestart =
        serpentineForcePendingRef.current || serpentineControllerRef.current === null;

      if (!needsRestart) {
        return;
      }

      if (serpentineForcePendingRef.current) {
        serpentineForcePendingRef.current = false;
        const autopanGlobal = getAutoPanGlobal();
        try {
          autopanGlobal?.__AUTO_PAN_CANCEL__?.();
        } catch (error) {
          console.warn("[diagnostics:auto-pan] failed to cancel previous auto-pan sequence", error);
        }
      }

      cancelSerpentine();

      const runner = createSerpentineRunner(map, config, (lon, lat) => {
        viewStateRef.current.lng = lon;
        viewStateRef.current.lat = lat;
        viewStateRef.current.bearing = 0;
      });

      if (runner) {
        serpentineControllerRef.current = runner;
        const autopanGlobal = getAutoPanGlobal();
        if (autopanGlobal) {
          autopanGlobal.__AUTO_PAN_CANCEL__ = runner.cancel;
        }
      }
    };

    const stopPan = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      teardownFallbackTimer();
      lastFrameTimeRef.current = null;
      lastRepaintTimeRef.current = null;
      lastLogTimeRef.current = 0;
    };

    const startPan = () => {
      if (autopanModeRef.current !== "rotate") {
        return;
      }
      if (animationFrameRef.current != null) return;
      if (!mapRef.current) return;

      lastFrameTimeRef.current = null;
      lastRepaintTimeRef.current = null;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      lastLogTimeRef.current = now - AUTOPAN_LOG_INTERVAL_MS;
      animationFrameRef.current = requestAnimationFrame(stepPan);
      ensureFallbackTimer();
    };

    const recomputeAutopanActivation = () => {
      if (autopanModeRef.current !== "rotate") {
        autopanEnabledRef.current = false;
        stopPan();
        if (autopanModeRef.current === "serpentine") {
          ensureSerpentine();
        } else {
          cancelSerpentine();
        }
        return;
      }

      cancelSerpentine();

      const forcedOff = autopanForcedOffRef.current;
      const kioskDetected = kioskModeRef.current;
      const motionForced = motionForcedRef.current || autopanForcedOnRef.current;
      const respectPreference = respectReducedMotionRef.current;
      const reducedActive = reducedMotionActiveRef.current;

      let shouldRun = !forcedOff;
      if (shouldRun) {
        if (motionForced || kioskDetected) {
          shouldRun = true;
        } else if (respectPreference && reducedActive) {
          shouldRun = false;
        }
      }

      autopanEnabledRef.current = shouldRun;

      if (shouldRun) {
        startPan();
      } else {
        stopPan();
      }
    };

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      reducedMotionActiveRef.current = event.matches;
      recomputeAutopanActivation();
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
        recomputeAutopanActivation();
        return;
      }

      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotionActiveRef.current = media.matches;
      media.addEventListener("change", handleReducedMotionChange);
      reducedMotionMediaRef.current = media;

      recomputeAutopanActivation();
    };

    const refreshRuntimePolicy = (defaultRespect?: boolean) => {
      const baseRespect = defaultRespect ?? respectDefaultRef.current;
      autopanForcedOnRef.current = kioskRuntime.isAutopanForcedOn();
      autopanForcedOffRef.current = kioskRuntime.isAutopanForcedOff();
      motionForcedRef.current = kioskRuntime.isMotionForced();
      kioskModeRef.current = kioskRuntime.isLikelyKiosk();
      const effectiveRespect = kioskRuntime.shouldRespectReducedMotion(baseRespect);
      applyReducedMotionPreference(effectiveRespect);
      if (!effectiveRespect && (motionForcedRef.current || autopanForcedOnRef.current)) {
        if (!motionOverrideLoggedRef.current) {
          console.info("[GeoScopeMap] prefers-reduced-motion override active (kiosk)");
          motionOverrideLoggedRef.current = true;
        }
      } else if (effectiveRespect) {
        motionOverrideLoggedRef.current = false;
      }
    };

    const emitBearing = (bearing: number, timestamp: number, force?: boolean) => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(GEO_SCOPE_AUTOPAN_EVENT, {
            detail: { bearing }
          })
        );
      }
      const lastLog = lastLogTimeRef.current;
      if (force || !lastLog || timestamp - lastLog >= AUTOPAN_LOG_INTERVAL_MS) {
        lastLogTimeRef.current = timestamp;
        console.log(`[diagnostics:auto-pan] bearing=${bearing.toFixed(1)}`);
      }
    };

    const runPanTick = (timestamp: number, options?: { force?: boolean }) => {
      const map = mapRef.current;
      if (!map) {
        stopPan();
        return;
      }
      if (autopanModeRef.current !== "rotate") {
        return;
      }
      if (!options?.force && !autopanEnabledRef.current) {
        return;
      }
      if (
        !options?.force &&
        respectReducedMotionRef.current &&
        reducedMotionActiveRef.current &&
        !motionForcedRef.current &&
        !autopanForcedOnRef.current
      ) {
        return;
      }

      const lastFrame = lastFrameTimeRef.current;
      const effectiveLast = lastFrame ?? timestamp - FRAME_MIN_INTERVAL_MS;
      const deltaMs = timestamp - effectiveLast;
      if (!options?.force && deltaMs < FRAME_MIN_INTERVAL_MS) {
        return;
      }

      lastFrameTimeRef.current = timestamp;

      let elapsedSeconds = deltaMs / 1000;
      if (elapsedSeconds > MAX_DELTA_SECONDS) {
        elapsedSeconds = MAX_DELTA_SECONDS;
      }

      updateBandState(elapsedSeconds);

      const deltaBearing = panSpeedRef.current * elapsedSeconds;
      viewStateRef.current.bearing = normalizeBearing(
        viewStateRef.current.bearing + deltaBearing
      );

      updateMapView(map);
      lastRepaintTimeRef.current = timestamp;
      map.triggerRepaint();
      emitBearing(viewStateRef.current.bearing, timestamp, options?.force);
    };

    const stepPan = (timestamp: number) => {
      if (animationFrameRef.current === null) {
        return;
      }
      runPanTick(timestamp);
      animationFrameRef.current = requestAnimationFrame(stepPan);
    };

    const ensureFallbackTimer = () => {
      if (fallbackTimerRef.current != null) {
        return;
      }
      fallbackTimerRef.current = window.setInterval(() => {
        const map = mapRef.current;
        if (!map) {
          return;
        }
        if (!autopanEnabledRef.current && !motionForcedRef.current && !autopanForcedOnRef.current) {
          return;
        }
        const now = performance.now();
        const lastFrame = lastFrameTimeRef.current;
        if (!lastFrame || now - lastFrame >= FRAME_MIN_INTERVAL_MS) {
          runPanTick(now, { force: true });
        }

        if (!lastFrame || now - lastFrame >= WATCHDOG_INTERVAL_MS) {
          const center = map.getCenter();
          const nextBearing = map.getBearing() + WATCHDOG_BEARING_DELTA;
          const normalizedBearing = normalizeBearing(nextBearing);
          viewStateRef.current.bearing = normalizedBearing;
          map.jumpTo({
            center,
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: normalizedBearing
          });
          lastFrameTimeRef.current = now;
          lastRepaintTimeRef.current = now;
          map.triggerRepaint();
          if (animationFrameRef.current === null) {
            animationFrameRef.current = requestAnimationFrame(stepPan);
          }
          console.warn(
            "[GeoScopeMap] watchdog jump enforced (bearing=",
            normalizedBearing.toFixed(2),
            ")"
          );
          emitBearing(normalizedBearing, now, true);
          return;
        }

        const lastRepaint = lastRepaintTimeRef.current;
        if (!lastRepaint || now - lastRepaint >= WATCHDOG_INTERVAL_MS) {
          map.triggerRepaint();
          lastRepaintTimeRef.current = now;
        }
      }, FALLBACK_TICK_INTERVAL_MS);
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
        applyThemeToMap(map, styleTypeRef.current, themeRef.current);
      }
      safeFit();
      recomputeAutopanActivation();
    };

    const handleStyleData = () => {
      const map = mapRef.current;
      if (map) {
        applyThemeToMap(map, styleTypeRef.current, themeRef.current);
      }
      safeFit();
    };

    const handleContextLost = (
      event: MapLibreEvent & { originalEvent?: WebGLContextEvent }
    ) => {
      event.originalEvent?.preventDefault();
      safeFit();
    };

    const handleContextRestored = () => {
      safeFit();
      recomputeAutopanActivation();
    };

    const setupResizeObserver = (target: Element) => {
      const observer = new ResizeObserver(() => {
        safeFit();
      });

      observer.observe(target);
      resizeObserverRef.current = observer;
    };

    const initializeMap = async () => {
      const hostPromise = waitForStableSize();
      const runtime = await loadRuntimePreferences();
      respectDefaultRef.current = Boolean(runtime.respectReducedMotion);

      if (destroyed) {
        return;
      }

      const host = await hostPromise;

      if (!host || destroyed || mapRef.current) return;

      const cinemaSettings = cloneCinema(runtime.cinema);
      const firstBand = cinemaSettings.bands[0] ?? FALLBACK_CINEMA.bands[0];
      if (!firstBand) {
        return;
      }

      cinemaRef.current = cinemaSettings;
      panSpeedRef.current = kioskRuntime.getSpeedOverride(
        cinemaSettings.panLngDegPerSec,
        FALLBACK_ROTATION_DEG_PER_SEC
      );
      if (Math.abs(panSpeedRef.current - cinemaSettings.panLngDegPerSec) > 1e-6) {
        console.info(
          `[GeoScopeMap] autopan speed override active (${panSpeedRef.current.toFixed(3)}°/s)`
        );
      }
      bandIndexRef.current = 0;
      bandElapsedRef.current = 0;
      bandTransitionRef.current = null;

      viewStateRef.current.lng = normalizeLng(runtime.initialLng);
      applyBandInstant(firstBand, null);
      viewStateRef.current.pitch = firstBand.pitch;
      viewStateRef.current.bearing = 0;

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

      const map = new maplibregl.Map({
        container: host,
        style: runtime.style.style,
        center: [viewStateRef.current.lng, viewStateRef.current.lat],
        zoom: viewStateRef.current.zoom,
        minZoom: firstBand.minZoom,
        pitch: viewStateRef.current.pitch,
        bearing: viewStateRef.current.bearing,
        interactive: false,
        attributionControl: false,
        renderWorldCopies: runtime.renderWorldCopies,
        trackResize: false
      });

      mapRef.current = map;
      map.setMinZoom(firstBand.minZoom);
      refreshRuntimePolicy(runtime.respectReducedMotion);

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
        map.setStyle(fallbackStyle.style);
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
      map.on("webglcontextlost", handleContextLost);
      map.on("webglcontextrestored", handleContextRestored);
      if (styleErrorHandler) {
        map.on("error", styleErrorHandler);
      }

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
    };

    void initializeMap();

    return () => {
      destroyed = true;

      if (sizeCheckFrame != null) {
        cancelAnimationFrame(sizeCheckFrame);
        sizeCheckFrame = null;
      }

      cancelSerpentine();
      stopPan();

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

      const map = mapRef.current;
      if (map) {
        map.off("load", handleLoad);
        map.off("styledata", handleStyleData);
        map.off("webglcontextlost", handleContextLost);
        map.off("webglcontextrestored", handleContextRestored);
        if (styleErrorHandler) {
          map.off("error", styleErrorHandler);
          styleErrorHandler = null;
        }
        map.remove();
        mapRef.current = null;
      }
    };
  }, []);
  return (
    <div className="map-host">
      <div ref={mapFillRef} className="map-fill" />
      {tintColor ? (
        <div className="map-tint" style={{ background: tintColor }} aria-hidden="true" />
      ) : null}
    </div>
  );
}
