import maplibregl from "maplibre-gl";
import type { MapLibreEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { apiGet, saveConfig } from "../../lib/api";
import { useConfig } from "../../lib/useConfig";
import { kioskRuntime } from "../../lib/runtimeFlags";
import AircraftLayer from "./layers/AircraftLayer";
import GlobalRadarLayer from "./layers/GlobalRadarLayer";
import GlobalSatelliteLayer from "./layers/GlobalSatelliteLayer";
import LightningLayer from "./layers/LightningLayer";
import { LayerRegistry } from "./layers/LayerRegistry";
import ShipsLayer from "./layers/ShipsLayer";
import {
  createDefaultMapCinema,
  createDefaultMapIdlePan,
  createDefaultMapPreferences,
  createDefaultMapSettings,
  withConfigDefaults
} from "../../config/defaults";
import type {
  AppConfig,
  MapCinemaBand,
  MapCinemaConfig,
  MapConfig,
  MapIdlePanConfig,
  MapPreferences,
  MapThemeConfig,
  RotationConfig
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
const DEFAULT_CINEMA_MOTION = FALLBACK_CINEMA.motion;
const HORIZONTAL_CENTER_LNG = 0;
const MIN_MOTION_AMPLITUDE = 1;
const MAX_MOTION_AMPLITUDE = 180;
const FPS_LIMIT = 45;
const FRAME_MIN_INTERVAL_MS = 1000 / FPS_LIMIT;
const MAX_DELTA_SECONDS = 0.5;
const WATCHDOG_INTERVAL_MS = 3000;
const WATCHDOG_BEARING_DELTA = 0.75;
const FALLBACK_TICK_INTERVAL_MS = 1000;
const AUTOPAN_LOG_INTERVAL_MS = 5000;
const CINEMA_HEARTBEAT_INTERVAL_MS = 8000;

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

type AutopanMode = "rotate" | "serpentine";

type SerpentineDirection = "E" | "W";

type SerpentineConfig = {
  stepDeg: number;
  latStepDeg: number;
  pauseMs: number;
  loops: number;
  reducedMotion: boolean;
  force: boolean;
  latMin: number;
  latMax: number;
  startDirection: SerpentineDirection;
};

type DiagnosticsAutopanConfig =
  | { mode: "rotate" }
  | { mode: "serpentine"; config: SerpentineConfig };

type SerpentineStep = {
  lon: number;
  lat: number;
  band: number;
  direction: SerpentineDirection;
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

const LON_MIN = -180;
const LON_MAX = 180;
const SERPENTINE_MIN_STEP_DEG = 0.05;
const SERPENTINE_MIN_LAT_STEP_DEG = 0.1;
const SERPENTINE_MIN_DURATION_MS = 120;
const SERPENTINE_MAX_DURATION_MS = 4000;
const SERPENTINE_DEFAULT_LAT_MIN = -70;
const SERPENTINE_DEFAULT_LAT_MAX = 70;

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
  const path = window.location.pathname ?? "";
  const defaultSerpentine = /\/diagnostics\/auto-pan(\/|$)/.test(path);

  const isSpinMode =
    modeParam === "spin" ||
    modeParam === "rotate" ||
    modeParam === "bearing" ||
    (!modeParam && !defaultSerpentine);

  if (isSpinMode) {
    return { mode: "rotate" };
  }

  const readNumber = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw == null || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const readInt = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw == null || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const stepSource = params.has("stepDeg") ? "stepDeg" : params.has("speed") ? "speed" : null;
  const stepDefault = 0.4;
  const stepDegRaw = stepSource ? readNumber(stepSource, stepDefault) : stepDefault;
  const stepDeg = Math.max(SERPENTINE_MIN_STEP_DEG, Math.abs(stepDegRaw));

  const latStepRaw = readNumber("latStepDeg", 5);
  const latStepDeg = Math.max(SERPENTINE_MIN_LAT_STEP_DEG, Math.abs(latStepRaw));

  const pauseMs = Math.max(0, Math.round(readNumber("pauseMs", readNumber("pause", 500))));

  const loopsRaw = readInt("loops", -1);
  const loops = Number.isFinite(loopsRaw) ? loopsRaw : -1;

  let latMin = clampLatitude(readNumber("latMin", SERPENTINE_DEFAULT_LAT_MIN));
  let latMax = clampLatitude(readNumber("latMax", SERPENTINE_DEFAULT_LAT_MAX));
  if (latMin > latMax) {
    [latMin, latMax] = [latMax, latMin];
  }

  const dirParam = params.get("dir") ?? params.get("direction");
  const startDirection: SerpentineDirection =
    dirParam && dirParam.toUpperCase() === "W" ? "W" : "E";

  const reducedMotionParam = parseBooleanParam(params.get("reducedMotion"));
  const reducedMotion = reducedMotionParam === true;
  const forceParam = parseBooleanParam(params.get("force"));
  const force = forceParam === true;

  return {
    mode: "serpentine",
    config: {
      stepDeg,
      latStepDeg,
      pauseMs,
      loops,
      reducedMotion,
      force,
      latMin,
      latMax,
      startDirection
    }
  };
};

const buildSerpentineBands = (
  latMin: number,
  latMax: number,
  latStepDeg: number
): number[] => {
  const bands: number[] = [];
  if (!Number.isFinite(latMin) || !Number.isFinite(latMax) || latStepDeg <= 0) {
    return bands;
  }

  const safeStep = Math.max(SERPENTINE_MIN_LAT_STEP_DEG, latStepDeg);
  const epsilon = safeStep / 1000;
  let cursor = latMin;
  while (cursor <= latMax + epsilon) {
    bands.push(clampLatitude(cursor));
    cursor += safeStep;
  }
  const last = bands[bands.length - 1];
  if (!bands.length || Math.abs(last - latMax) > epsilon) {
    bands.push(clampLatitude(latMax));
  }

  return bands;
};

const createSerpentineRunner = (
  map: maplibregl.Map,
  config: SerpentineConfig,
  onStep?: (step: SerpentineStep) => void
): SerpentineRunner | null => {
  const bands = buildSerpentineBands(config.latMin, config.latMax, config.latStepDeg);
  if (!bands.length) {
    return null;
  }

  const speedDeg = Math.max(SERPENTINE_MIN_STEP_DEG, config.stepDeg);
  let cancelled = false;
  let timeoutId: number | null = null;
  let frameId: number | null = null;
  let bandIndex = 0;
  let direction: SerpentineDirection = config.startDirection;
  let lon = direction === "E" ? LON_MIN : LON_MAX;
  let loopsRemaining = config.loops;
  const infiniteLoops = loopsRemaining < 0;
  let lastAggregateLog = 0;

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

  const dispatchStep = (step: SerpentineStep) => {
    onStep?.(step);
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(GEO_SCOPE_AUTOPAN_EVENT, {
            detail: {
              mode: "serpentine",
              lat: step.lat,
              lon: step.lon,
              band: step.band,
              direction: step.direction
            }
          })
        );
      }
    } catch {
      // Ignore event dispatch failures in non-browser environments.
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

  const computeDuration = (distanceDeg: number): number => {
    if (config.reducedMotion) {
      return Math.max(16, Math.round((distanceDeg / speedDeg) * 1000));
    }
    const candidate = Math.round((distanceDeg / speedDeg) * 1000);
    return clamp(candidate, SERPENTINE_MIN_DURATION_MS, SERPENTINE_MAX_DURATION_MS);
  };

  const logStep = (step: SerpentineStep) => {
    const now = Date.now();
    if (!lastAggregateLog || now - lastAggregateLog >= AUTOPAN_LOG_INTERVAL_MS) {
      lastAggregateLog = now;
      const latText = step.lat.toFixed(4);
      const lonText = step.lon.toFixed(4);
      console.log(
        `[diagnostics:auto-pan] bearing=${lonText}, lat=${latText}, lon=${lonText}, band=${step.band}`
      );
    }
  };

  const advanceBand = () => {
    if (bandIndex >= bands.length - 1) {
      if (!infiniteLoops) {
        loopsRemaining -= 1;
        if (loopsRemaining < 0) {
          loopsRemaining = 0;
        }
        if (loopsRemaining === 0) {
          return false;
        }
      }
      bandIndex = 0;
      direction = "E";
      lon = LON_MIN;
      return true;
    }

    bandIndex += 1;
    direction = direction === "E" ? "W" : "E";
    lon = direction === "E" ? LON_MIN : LON_MAX;
    return true;
  };

  const runStep = () => {
    if (cancelled) {
      return;
    }
    if (!infiniteLoops && loopsRemaining === 0) {
      cancel();
      return;
    }

    const targetLon = direction === "E" ? LON_MAX : LON_MIN;
    const remaining = Math.abs(targetLon - lon);
    const stepDistance = remaining <= speedDeg ? remaining : speedDeg;
    const nextLon = direction === "E" ? lon + stepDistance : lon - stepDistance;
    const bandLat = bands[bandIndex];
    const step: SerpentineStep = {
      lon: normalizeLng(nextLon),
      lat: bandLat,
      band: bandIndex,
      direction: direction
    };

    const duration = computeDuration(stepDistance || speedDeg);

    dispatchStep(step);
    logStep(step);

    if (config.reducedMotion) {
      map.jumpTo({ center: [step.lon, step.lat] });
    } else {
      map.easeTo({
        center: [step.lon, step.lat],
        duration,
        easing: (t: number) => t,
        essential: true
      });
    }

    lon = direction === "E" ? Math.min(targetLon, nextLon) : Math.max(targetLon, nextLon);

    const reachedEnd = Math.abs(targetLon - lon) <= 1e-3;
    if (reachedEnd) {
      if (!advanceBand()) {
        cancel();
        return;
      }
      scheduleNext(duration + config.pauseMs);
      return;
    }

    scheduleNext(duration);
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
  const fallbackMotion = FALLBACK_CINEMA.motion;
  const sourceMotion = cinema.motion ?? fallbackMotion;

  const panLngDegPerSec = Number.isFinite(cinema.panLngDegPerSec)
    ? Math.max(cinema.panLngDegPerSec, 0)
    : fallbackPan;
  const bandTransition_sec = Number.isFinite(cinema.bandTransition_sec)
    ? Math.max(cinema.bandTransition_sec, 0)
    : fallbackTransition;

  const motion: MapCinemaConfig["motion"] = {
    speedPreset:
      sourceMotion?.speedPreset === "slow" || sourceMotion?.speedPreset === "medium" || sourceMotion?.speedPreset === "fast"
        ? sourceMotion.speedPreset
        : fallbackMotion.speedPreset,
    amplitudeDeg: clamp(
      Number.isFinite(sourceMotion?.amplitudeDeg) ? Number(sourceMotion?.amplitudeDeg) : fallbackMotion.amplitudeDeg,
      1,
      180
    ),
    easing: sourceMotion?.easing === "linear" ? "linear" : "ease-in-out",
    pauseWithOverlay:
      typeof sourceMotion?.pauseWithOverlay === "boolean"
        ? sourceMotion.pauseWithOverlay
        : fallbackMotion.pauseWithOverlay,
    phaseOffsetDeg: clamp(
      Number.isFinite(sourceMotion?.phaseOffsetDeg)
        ? Number(sourceMotion?.phaseOffsetDeg)
        : fallbackMotion.phaseOffsetDeg,
      0,
      360
    ),
  };

  const fallbackFsmEnabled = typeof FALLBACK_CINEMA.fsmEnabled === "boolean" ? FALLBACK_CINEMA.fsmEnabled : true;
  const fsmEnabled = typeof cinema.fsmEnabled === "boolean" ? cinema.fsmEnabled : fallbackFsmEnabled;

  return {
    ...cinema,
    fsmEnabled,
    panLngDegPerSec,
    bandTransition_sec,
    bands,
    motion
  };
};

const initializeMotionState = (
  cinema: MapCinemaConfig,
  motionProgressRef: MutableRefObject<number>,
  horizontalDirectionRef: MutableRefObject<1 | -1>
) => {
  const motion = cinema.motion ?? DEFAULT_CINEMA_MOTION;
  const normalizedPhase = Number.isFinite(motion.phaseOffsetDeg)
    ? ((Number(motion.phaseOffsetDeg) % 360) + 360) % 360
    : DEFAULT_CINEMA_MOTION.phaseOffsetDeg;
  let cycle = normalizedPhase / 180;
  let direction: 1 | -1 = 1;
  if (cycle > 1) {
    cycle = 2 - cycle;
    direction = -1;
  }
  const progress = clamp(cycle, 0, 1);
  motionProgressRef.current = progress;
  horizontalDirectionRef.current = direction;
  const amplitude = clamp(
    Number.isFinite(motion.amplitudeDeg)
      ? Number(motion.amplitudeDeg)
      : DEFAULT_CINEMA_MOTION.amplitudeDeg,
    MIN_MOTION_AMPLITUDE,
    MAX_MOTION_AMPLITUDE
  );
  const eased = motion.easing === "ease-in-out" ? easeInOut(progress) : progress;
  const minLng = HORIZONTAL_CENTER_LNG - amplitude;
  const maxLng = HORIZONTAL_CENTER_LNG + amplitude;
  const lng = minLng + (maxLng - minLng) * eased;
  return { motion, amplitude, lng };
};

type TransitionState = {
  from: MapCinemaBand;
  to: MapCinemaBand;
  toIndex: number;
  duration: number;
  elapsed: number;
};

type MapLifecycleState = "IDLE" | "LOADING_STYLE" | "READY" | "PANNING";
type CinemaTelemetryState =
  | "IDLE"
  | "LOADING_STYLE"
  | "READY"
  | "PANNING"
  | "PAUSED"
  | "ERROR"
  | "DISABLED";

type MapStateMachine = {
  getState(): MapLifecycleState;
  notifyStyleLoading: (reason: string) => void;
  notifyStyleData: (source?: string) => void;
  notifyIdle: (source?: string) => void;
  canBeginPan: () => boolean;
  beginPan: (start: () => void, reason?: string) => boolean;
  pausePan: (stop: () => void, reason?: string) => boolean;
  reset: (reason?: string) => void;
};

type MapStateMachineOptions = {
  isStyleLoaded: () => boolean;
  onReady?: (source: string) => void;
  onWatchdog?: (reason: string) => void | Promise<void>;
  logger?: Pick<Console, "debug" | "warn" | "info" | "error">;
  windowRef?: Window | undefined;
};

const WATCHDOG_TIMEOUT_MS = 10_000;

const createMapStateMachine = (options: MapStateMachineOptions): MapStateMachine => {
  const logger = options.logger ?? console;
  const win = options.windowRef ?? (typeof window !== "undefined" ? window : undefined);
  let state: MapLifecycleState = "IDLE";
  let styleDataSeen = false;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => {
    if (watchdogTimer != null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const armWatchdog = (reason: string) => {
    if (!win) {
      return;
    }
    clearWatchdog();
    watchdogTimer = win.setTimeout(() => {
      logger.warn?.(`[map:fsm] watchdog expired (${reason})`);
      watchdogTimer = null;
      styleDataSeen = false;
      state = "IDLE";
      void options.onWatchdog?.(reason);
    }, WATCHDOG_TIMEOUT_MS);
  };

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
    clearWatchdog();
    state = "READY";
    logger.debug?.(`[map:fsm] -> READY (${source})`);
    options.onReady?.(source);
  };

  return {
    getState: () => state,
    notifyStyleLoading: (reason: string) => {
      if (state === "PANNING") {
        state = "READY";
      }
      state = "LOADING_STYLE";
      styleDataSeen = false;
      logger.debug?.(`[map:fsm] -> LOADING_STYLE (${reason})`);
      armWatchdog(reason);
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
    canBeginPan: () => state === "READY",
    beginPan: (start, reason = "auto") => {
      if (state !== "READY") {
        logger.debug?.(`[map:fsm] cannot begin pan from state ${state} (${reason})`);
        return false;
      }
      state = "PANNING";
      clearWatchdog();
      logger.debug?.(`[map:fsm] -> PANNING (${reason})`);
      start();
      return true;
    },
    pausePan: (stop, reason = "pause") => {
      if (state === "PANNING") {
        state = "READY";
        logger.debug?.(`[map:fsm] -> READY (pause:${reason})`);
        stop();
        return true;
      }
      if (state === "LOADING_STYLE") {
        stop();
        return true;
      }
      if (state === "READY") {
        stop();
        return true;
      }
      return false;
    },
    reset: (reason = "reset") => {
      clearWatchdog();
      state = "IDLE";
      styleDataSeen = false;
      logger.debug?.(`[map:fsm] -> IDLE (${reason})`);
    },
  };
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
  idlePan: MapIdlePanConfig;
  rotationEnabled: boolean;
  allowCinema: boolean;
  panSpeedDegPerSec: number;
  fsmEnabled: boolean;
};

const buildRuntimePreferences = (
  mapSettings: MapConfig,
  rotationSettings: RotationConfig,
  styleResult: MapStyleResult
): RuntimePreferences => {
  const defaults = createDefaultMapSettings();
  const source = mapSettings ?? defaults;
  const cinemaSource = source.cinema ?? defaults.cinema ?? createDefaultMapCinema();
  const cinema = cloneCinema(cinemaSource);
  const fallbackIdlePan = defaults.idlePan ?? createDefaultMapIdlePan();
  const idlePanSource = source.idlePan ?? fallbackIdlePan;
  const idlePan: MapIdlePanConfig = {
    enabled: Boolean(idlePanSource.enabled),
    intervalSec: Math.max(10, Math.round(idlePanSource.intervalSec ?? fallbackIdlePan.intervalSec))
  };

  const rotationEnabled = Boolean(rotationSettings?.enabled);
  const panSpeedDegPerSec = Math.max(
    0,
    Number.isFinite(cinema.panLngDegPerSec) ? cinema.panLngDegPerSec : 0
  );
  // El modo horizontal funciona independientemente de rotation.enabled
  // Solo requiere cinema.enabled y panSpeedDegPerSec > 0
  const allowCinema = cinema.enabled && panSpeedDegPerSec > 0;
  const fsmEnabled = typeof cinema.fsmEnabled === "boolean" ? cinema.fsmEnabled : true;

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
        : defaults.respectReducedMotion ?? false,
    idlePan,
    rotationEnabled,
    allowCinema,
    panSpeedDegPerSec,
    fsmEnabled
  };
};

const loadRuntimePreferences = async (): Promise<RuntimePreferences> => {
  try {
    const config = await apiGet<AppConfig | undefined>("/api/config");
    const merged = withConfigDefaults(config);
    const mapSettings = merged.ui.map;
    const rotationSettings = merged.ui.rotation;
    const mapPreferences: MapPreferences = merged.map ?? createDefaultMapPreferences();
    const styleResult = await loadMapStyle(mapSettings, mapPreferences);
    return buildRuntimePreferences(mapSettings, rotationSettings, styleResult);
  } catch (error) {
    console.warn(
      "[GeoScopeMap] Falling back to default cinema configuration (using defaults).",
      error
    );
    const fallbackSettings = createDefaultMapSettings();
    const fallbackPreferences = createDefaultMapPreferences();
    const styleResult = await loadMapStyle(fallbackSettings, fallbackPreferences);
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

export default function GeoScopeMap() {
  const { data: config, reload: reloadConfig } = useConfig();
  const mapFillRef = useRef<HTMLDivElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  
  // Guardar estado de si necesitamos iniciar animación cuando la página esté visible
  const pendingAnimationRef = useRef(false);
  
  // Recargar config cuando la página se vuelve visible (después de guardar en /config)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Recargar config cuando la página vuelve a ser visible
        reloadConfig();

        // Si había una animación pendiente, iniciarla ahora
        if (pendingAnimationRef.current) {
          const map = mapRef.current;
          if (map && map.isStyleLoaded() && allowCinemaRef.current && autopanModeRef.current === "rotate" && animationFrameRef.current === null) {
            autopanEnabledRef.current = true;
            lastFrameTimeRef.current = null;
            lastRepaintTimeRef.current = null;
            const now = typeof performance !== "undefined" ? performance.now() : Date.now();
            lastLogTimeRef.current = now - AUTOPAN_LOG_INTERVAL_MS;
            
            // Usar la función stepPan del useEffect principal si está disponible
            // Si no, iniciar con el método inline
            const stepPan = (timestamp: number) => {
              if (animationFrameRef.current === null || !mapRef.current || !allowCinemaRef.current) {
                return;
              }
              if (autopanModeRef.current !== "rotate" || !autopanEnabledRef.current) {
                return;
              }
              
              const map = mapRef.current;
              const lastFrame = lastFrameTimeRef.current;
              const effectiveLast = lastFrame ?? timestamp - FRAME_MIN_INTERVAL_MS;
              const deltaMs = timestamp - effectiveLast;
              if (deltaMs < FRAME_MIN_INTERVAL_MS) {
                animationFrameRef.current = requestAnimationFrame(stepPan);
                return;
              }

              lastFrameTimeRef.current = timestamp;
              let elapsedSeconds = deltaMs / 1000;
              if (elapsedSeconds > MAX_DELTA_SECONDS) {
                elapsedSeconds = MAX_DELTA_SECONDS;
              }

              const cinema = cinemaRef.current;
              const totalBands = cinema.bands.length;
              if (!totalBands) {
                animationFrameRef.current = requestAnimationFrame(stepPan);
                return;
              }

              const currentIndex = ((bandIndexRef.current % totalBands) + totalBands) % totalBands;
              const currentBand = cinema.bands[currentIndex];
              if (!currentBand) {
                animationFrameRef.current = requestAnimationFrame(stepPan);
                return;
              }

              viewStateRef.current.lat = currentBand.lat;
              viewStateRef.current.zoom = currentBand.zoom;
              viewStateRef.current.pitch = currentBand.pitch;
              viewStateRef.current.bearing = 0;
              const minZoom = Math.min(
                Number.isFinite(currentBand.minZoom) ? currentBand.minZoom : currentBand.zoom,
                currentBand.zoom
              );
              currentMinZoomRef.current = minZoom;

              updateBandState(elapsedSeconds);

              const motion = cinema.motion ?? DEFAULT_CINEMA_MOTION;
              const amplitude = clamp(
                Number.isFinite(motion.amplitudeDeg)
                  ? Number(motion.amplitudeDeg)
                  : DEFAULT_CINEMA_MOTION.amplitudeDeg,
                MIN_MOTION_AMPLITUDE,
                MAX_MOTION_AMPLITUDE
              );
              const travel = Math.max(amplitude * 2, 1);
              const deltaProgress = travel > 0 ? (panSpeedRef.current * elapsedSeconds) / travel : 0;
              let progress = motionProgressRef.current + deltaProgress * horizontalDirectionRef.current;

              let hitMax = false;
              let hitMin = false;
              if (progress >= 1) {
                progress = 1;
                hitMax = true;
              } else if (progress <= 0) {
                progress = 0;
                hitMin = true;
              }

              if (hitMax || hitMin) {
                const nextIndex = currentIndex + verticalDirectionRef.current;
                if (nextIndex < 0) {
                  verticalDirectionRef.current = 1;
                  bandIndexRef.current = 0;
                  horizontalDirectionRef.current = 1;
                  progress = 0;
                } else if (nextIndex >= totalBands) {
                  verticalDirectionRef.current = -1;
                  bandIndexRef.current = totalBands - 1;
                  horizontalDirectionRef.current = -1;
                  progress = 1;
                } else {
                  bandIndexRef.current = nextIndex;
                  horizontalDirectionRef.current = hitMax ? -1 : 1;
                }
              }

              motionProgressRef.current = progress;

              const easedProgress = motion.easing === "ease-in-out" ? easeInOut(progress) : progress;
              const minLng = HORIZONTAL_CENTER_LNG - amplitude;
              const maxLng = HORIZONTAL_CENTER_LNG + amplitude;
              const newLng = minLng + (maxLng - minLng) * easedProgress;

              viewStateRef.current.lng = normalizeLng(newLng);
              map.setMinZoom(minZoom);
              
              const { lng, lat, zoom, pitch } = viewStateRef.current;
              map.jumpTo({
                center: [lng, lat],
                zoom,
                pitch,
                bearing: 0
              });
              
              lastRepaintTimeRef.current = timestamp;
              map.triggerRepaint();

              animationFrameRef.current = requestAnimationFrame(stepPan);
            };
            
            animationFrameRef.current = requestAnimationFrame(stepPan);
            pendingAnimationRef.current = false;
          }
        }
      }
    };
    
    const handleFocus = () => {
      // Recargar config cuando la ventana recupera el foco
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
  const lastPanTickIsoRef = useRef<string | null>(null);
  const respectReducedMotionRef = useRef(false);
  const reducedMotionMediaRef = useRef<MediaQueryList | null>(null);
  const reducedMotionActiveRef = useRef(false);
  const kioskModeRef = useRef(kioskRuntime.isLikelyKiosk());
  const autopanForcedOnRef = useRef(kioskRuntime.isAutopanForcedOn());
  const autopanForcedOffRef = useRef(kioskRuntime.isAutopanForcedOff());
  const motionForcedRef = useRef(kioskRuntime.isMotionForced());
  const motionOverrideLoggedRef = useRef(false);
  const allowCinemaRef = useRef(false);
  const idlePanConfigRef = useRef<MapIdlePanConfig>(createDefaultMapIdlePan());
  const idlePanTimerRef = useRef<number | null>(null);
  const idlePanDirectionRef = useRef<1 | -1>(1);
  const idlePanDeltaRef = useRef(0.5);
  const autopanEnabledRef = useRef(true);
  const cinemaHeartbeatTimerRef = useRef<number | null>(null);
  const webglErrorRef = useRef<string | null>(null);
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
  const aircraftLayerRef = useRef<AircraftLayer | null>(null);
  const globalRadarLayerRef = useRef<GlobalRadarLayer | null>(null);
  const globalSatelliteLayerRef = useRef<GlobalSatelliteLayer | null>(null);
  const lightningLayerRef = useRef<LightningLayer | null>(null);
  const layerRegistryRef = useRef<LayerRegistry | null>(null);
  const shipsLayerRef = useRef<ShipsLayer | null>(null);
  const stormModeActiveRef = useRef(false);
  const lastLogTimeRef = useRef<number>(0);
  const respectDefaultRef = useRef(false);
  const [tintColor, setTintColor] = useState<string | null>(null);
  const horizontalDirectionRef = useRef<1 | -1>(1); // 1 = Este (derecha), -1 = Oeste (izquierda)
  const verticalDirectionRef = useRef<1 | -1>(1); // 1 = hacia abajo, -1 = hacia arriba
  const motionProgressRef = useRef(0.5);
  const mapStateMachineRef = useRef<MapStateMachine | null>(null);
  const cinemaFsmEnabledRef = useRef(false);
  const runtimeRef = useRef<RuntimePreferences | null>(null);
  const machineFactoryRef = useRef<((map: maplibregl.Map, reason: string) => void) | null>(null);

  const clearIdlePanTimer = () => {
    if (idlePanTimerRef.current != null) {
      window.clearInterval(idlePanTimerRef.current);
      idlePanTimerRef.current = null;
    }
  };

  const runIdlePan = () => {
    if (!allowCinemaRef.current) {
      return;
    }
    const config = idlePanConfigRef.current;
    if (!config.enabled) {
      return;
    }
    if (respectReducedMotionRef.current && reducedMotionActiveRef.current) {
      return;
    }
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const direction = idlePanDirectionRef.current;
    idlePanDirectionRef.current = direction === 1 ? -1 : 1;

    const center = map.getCenter();
    const delta = Math.max(0.05, idlePanDeltaRef.current);
    const nextLng = normalizeLng(center.lng + direction * delta);

    map.easeTo({
      center: [nextLng, center.lat],
      duration: 1500,
      easing: (t: number) => t,
      essential: true
    });
  };

  const scheduleIdlePan = () => {
    clearIdlePanTimer();
    if (!mapRef.current) {
      return;
    }
    if (!allowCinemaRef.current) {
      return;
    }
    const config = idlePanConfigRef.current;
    if (!config.enabled) {
      return;
    }
    if (respectReducedMotionRef.current && reducedMotionActiveRef.current) {
      return;
    }
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }

    const intervalSec = Math.max(10, Math.round(config.intervalSec));
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
      return;
    }
    idlePanTimerRef.current = window.setInterval(() => {
      runIdlePan();
    }, intervalSec * 1000);
  };

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
    const { lng, lat, zoom, pitch } = viewStateRef.current;
    // Siempre mantener bearing en 0 (sin rotación)
    map.jumpTo({
      center: [lng, lat],
      zoom,
      pitch,
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

      const runner = createSerpentineRunner(map, config, (step) => {
        viewStateRef.current.lng = step.lon;
        viewStateRef.current.lat = step.lat;
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

    const stopPanInternal = () => {
      console.debug("[map] pause: stopping auto-pan");
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      teardownFallbackTimer();
      lastFrameTimeRef.current = null;
      lastRepaintTimeRef.current = null;
      lastLogTimeRef.current = 0;
    };

    const startPanInternal = () => {
      if (!allowCinemaRef.current) {
        return;
      }
      if (autopanModeRef.current !== "rotate") {
        return;
      }
      if (animationFrameRef.current != null) return;
      const map = mapRef.current;
      if (!map || (typeof document !== "undefined" && document.hidden)) return;
      if (!map.isStyleLoaded()) {
        return;
      }

      console.debug("[map] resume: starting auto-pan");
      lastFrameTimeRef.current = null;
      lastRepaintTimeRef.current = null;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      lastLogTimeRef.current = now - AUTOPAN_LOG_INTERVAL_MS;
      animationFrameRef.current = requestAnimationFrame(stepPan);
      ensureFallbackTimer();
    };

    const stopPan = (reason?: string) => {
      if (cinemaFsmEnabledRef.current) {
        const machine = mapStateMachineRef.current;
        if (machine?.pausePan(() => stopPanInternal(), reason)) {
          return;
        }
      }
      stopPanInternal();
    };

    const startPan = (reason?: string) => {
      if (cinemaFsmEnabledRef.current) {
        const machine = mapStateMachineRef.current;
        if (!machine) {
          startPanInternal();
          return;
        }
        if (!machine.beginPan(() => startPanInternal(), reason)) {
          return;
        }
        return;
      }
      startPanInternal();
    };

    const recomputeAutopanActivation = () => {
      autopanEnabledRef.current = false;
      stopPan();
      cancelSerpentine();
    };

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      reducedMotionActiveRef.current = event.matches;
      recomputeAutopanActivation();
      scheduleIdlePan();
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
        scheduleIdlePan();
        return;
      }

      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotionActiveRef.current = media.matches;
      media.addEventListener("change", handleReducedMotionChange);
      reducedMotionMediaRef.current = media;

      recomputeAutopanActivation();
      scheduleIdlePan();
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

    const handleWatchdogReset = async (reason: string) => {
      const map = mapRef.current;
      const runtimeSnapshot = runtimeRef.current;
      if (!map || !runtimeSnapshot) {
        return;
      }
      console.warn(`[map] watchdog triggered, reloading style (${reason})`);
      stopPan(`watchdog:${reason}`);
      await requestBackendReset(reason);
      const useFallback = fallbackAppliedRef.current && runtimeSnapshot.fallbackStyle;
      const targetStyle = useFallback
        ? runtimeSnapshot.fallbackStyle?.style
        : runtimeSnapshot.style.style;
      if (targetStyle) {
        map.setStyle(targetStyle);
        mapStateMachineRef.current?.notifyStyleLoading(`watchdog:${reason}`);
      }
    };

    const attachStateMachine = (map: maplibregl.Map, reason: string) => {
      mapStateMachineRef.current?.reset("reinitialize");
      if (!cinemaFsmEnabledRef.current) {
        mapStateMachineRef.current = null;
        return;
      }
      const machine = createMapStateMachine({
        isStyleLoaded: () => Boolean(mapRef.current?.isStyleLoaded()),
        onReady: (source) => {
          if (!allowCinemaRef.current || autopanModeRef.current !== "rotate") {
            return;
          }
          if (typeof document !== "undefined" && document.hidden) {
            pendingAnimationRef.current = true;
            return;
          }
          pendingAnimationRef.current = false;
          autopanEnabledRef.current = true;
          startPan(`fsm-ready:${source}`);
        },
        onWatchdog: handleWatchdogReset,
        logger: console,
        windowRef: typeof window !== "undefined" ? window : undefined,
      });
      mapStateMachineRef.current = machine;
      machine.notifyStyleLoading(reason);
      if (map.isStyleLoaded()) {
        machine.notifyStyleData("immediate");
        machine.notifyIdle("immediate");
      }
    };

    machineFactoryRef.current = attachStateMachine;

    const runPanTick = (timestamp: number, options?: { force?: boolean }) => {
      const map = mapRef.current;
      if (!map) {
        stopPan();
        return;
      }
      if (!allowCinemaRef.current) {
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

      const cinema = cinemaRef.current;
      const totalBands = cinema.bands.length;
      if (!totalBands) {
        return;
      }

      // Obtener la banda actual
      const currentIndex = ((bandIndexRef.current % totalBands) + totalBands) % totalBands;
      const currentBand = cinema.bands[currentIndex];
      if (!currentBand) {
        return;
      }

      // Aplicar la configuración de la banda actual (zoom, pitch, lat)
      viewStateRef.current.lat = currentBand.lat;
      viewStateRef.current.zoom = currentBand.zoom;
      viewStateRef.current.pitch = currentBand.pitch;
      viewStateRef.current.bearing = 0; // Sin rotación
      const minZoom = Math.min(
        Number.isFinite(currentBand.minZoom) ? currentBand.minZoom : currentBand.zoom,
        currentBand.zoom
      );
      currentMinZoomRef.current = minZoom;

      updateBandState(elapsedSeconds);

      const motion = cinema.motion ?? DEFAULT_CINEMA_MOTION;
      const amplitude = clamp(
        Number.isFinite(motion.amplitudeDeg)
          ? Number(motion.amplitudeDeg)
          : DEFAULT_CINEMA_MOTION.amplitudeDeg,
        MIN_MOTION_AMPLITUDE,
        MAX_MOTION_AMPLITUDE
      );
      const travel = Math.max(amplitude * 2, 1);
      const deltaProgress = travel > 0 ? (panSpeedRef.current * elapsedSeconds) / travel : 0;
      let progress = motionProgressRef.current + deltaProgress * horizontalDirectionRef.current;

      let hitMax = false;
      let hitMin = false;
      if (progress >= 1) {
        progress = 1;
        hitMax = true;
      } else if (progress <= 0) {
        progress = 0;
        hitMin = true;
      }

      if (hitMax || hitMin) {
        const nextIndex = currentIndex + verticalDirectionRef.current;
        if (nextIndex < 0) {
          verticalDirectionRef.current = 1;
          bandIndexRef.current = 0;
          horizontalDirectionRef.current = 1;
          progress = 0;
        } else if (nextIndex >= totalBands) {
          verticalDirectionRef.current = -1;
          bandIndexRef.current = totalBands - 1;
          horizontalDirectionRef.current = -1;
          progress = 1;
        } else {
          bandIndexRef.current = nextIndex;
          horizontalDirectionRef.current = hitMax ? -1 : 1;
        }
      }

      motionProgressRef.current = progress;

      const easedProgress = motion.easing === "ease-in-out" ? easeInOut(progress) : progress;
      const minLng = HORIZONTAL_CENTER_LNG - amplitude;
      const maxLng = HORIZONTAL_CENTER_LNG + amplitude;
      const newLng = minLng + (maxLng - minLng) * easedProgress;

      viewStateRef.current.lng = normalizeLng(newLng);
      
      // Actualizar el minZoom del mapa
      map.setMinZoom(minZoom);

      updateMapView(map);
      lastRepaintTimeRef.current = timestamp;
      map.triggerRepaint();
      lastPanTickIsoRef.current = new Date().toISOString();

      // Emitir evento con la posición actual (sin bearing)
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(GEO_SCOPE_AUTOPAN_EVENT, {
            detail: {
              mode: "horizontal",
              lng: viewStateRef.current.lng,
              lat: viewStateRef.current.lat,
              band: currentIndex
            }
          })
        );
      }
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
          // Watchdog: sincronizar el estado del mapa si el movimiento se detuvo
          if (animationFrameRef.current === null) {
            animationFrameRef.current = requestAnimationFrame(stepPan);
          }
          // Asegurar que el mapa esté actualizado con el estado actual
          const currentView = viewStateRef.current;
          map.jumpTo({
            center: [currentView.lng, currentView.lat],
            zoom: currentView.zoom,
            pitch: currentView.pitch,
            bearing: 0
          });
          lastFrameTimeRef.current = now;
          lastRepaintTimeRef.current = now;
          map.triggerRepaint();
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
      mapStateMachineRef.current?.notifyStyleData("load");
      mapStateMachineRef.current?.notifyIdle("load");
      // Forzar inicio de animación si está permitido por la configuración
      if (allowCinemaRef.current && autopanModeRef.current === "rotate" && map?.isStyleLoaded()) {
        console.debug("[map] init rotor: starting auto-pan on load");
        autopanEnabledRef.current = true;
        startPan();
      } else {
        recomputeAutopanActivation();
        scheduleIdlePan();
      }
    };

    const handleStyleData = () => {
      const map = mapRef.current;
      if (map) {
        applyThemeToMap(map, styleTypeRef.current, themeRef.current);
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
      stopPan();
      clearIdlePanTimer();
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
      recomputeAutopanActivation();
      scheduleIdlePan();
    };

    const handleVisibilityChange = () => {
      if (typeof document === "undefined") {
        return;
      }
      if (document.hidden) {
        stopPan();
        clearIdlePanTimer();
        return;
      }
      scheduleIdlePan();
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
      cinemaFsmEnabledRef.current = runtime.fsmEnabled !== false;
      respectDefaultRef.current = Boolean(runtime.respectReducedMotion);
      allowCinemaRef.current = runtime.allowCinema;
      idlePanConfigRef.current = {
        ...runtime.idlePan,
        enabled: runtime.allowCinema ? runtime.idlePan.enabled : false
      };
      idlePanDirectionRef.current = 1;
      if (runtime.allowCinema) {
        const overrideSpeed = kioskRuntime.getSpeedOverride(
          runtime.panSpeedDegPerSec,
          FALLBACK_ROTATION_DEG_PER_SEC
        );
        panSpeedRef.current = overrideSpeed;
        idlePanDeltaRef.current =
          overrideSpeed > 0 ? Math.min(3, Math.max(0.1, overrideSpeed * 2)) : 0.5;
      } else {
        panSpeedRef.current = 0;
        idlePanDeltaRef.current = 0.5;
      }

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
      bandIndexRef.current = 0;
      bandElapsedRef.current = 0;
      bandTransitionRef.current = null;

      const motionInit = initializeMotionState(
        cinemaSettings,
        motionProgressRef,
        horizontalDirectionRef
      );
      verticalDirectionRef.current = 1;
      viewStateRef.current.lng = motionInit.lng;
      applyBandInstant(firstBand, null);
      viewStateRef.current.pitch = firstBand.pitch;
      viewStateRef.current.bearing = 0; // Sin rotación

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
      } catch (error) {
        console.error("[GeoScopeMap] Failed to create map:", error);
        setWebglError(`Error al inicializar el mapa: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      mapRef.current = map;
      map.setMinZoom(firstBand.minZoom);
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
        map.setStyle(fallbackStyle.style);
        mapStateMachineRef.current?.notifyStyleLoading("fallback-style");
        // Reaplicar vista tras style load
        map.once("load", () => {
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

      // Inicializar sistema de capas cuando el mapa esté listo
      map.once("load", () => {
        if (destroyed || !mapRef.current) return;
        
        const layerRegistry = new LayerRegistry(map);
        layerRegistryRef.current = layerRegistry;

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

          // AircraftLayer
          const flightsConfig = mergedConfig.layers.flights;
          const openskyConfig = mergedConfig.opensky;
          const aircraftLayer = new AircraftLayer({
            enabled: flightsConfig.enabled,
            opacity: flightsConfig.opacity,
            maxAgeSeconds: flightsConfig.max_age_seconds,
            cineFocus: flightsConfig.cine_focus?.enabled ? {
              enabled: flightsConfig.cine_focus.enabled,
              outsideDimOpacity: flightsConfig.cine_focus.outside_dim_opacity,
              hardHideOutside: flightsConfig.cine_focus.hard_hide_outside,
            } : undefined,
            cluster: openskyConfig.cluster,
          });
          layerRegistry.add(aircraftLayer);
          aircraftLayerRef.current = aircraftLayer;

          // ShipsLayer
          const shipsConfig = mergedConfig.layers.ships;
          const shipsLayer = new ShipsLayer({
            enabled: shipsConfig.enabled,
            opacity: shipsConfig.opacity,
            maxAgeSeconds: shipsConfig.max_age_seconds,
            cineFocus: shipsConfig.cine_focus?.enabled ? {
              enabled: shipsConfig.cine_focus.enabled,
              outsideDimOpacity: shipsConfig.cine_focus.outside_dim_opacity,
              hardHideOutside: shipsConfig.cine_focus.hard_hide_outside,
            } : undefined,
          });
          layerRegistry.add(shipsLayer);
          shipsLayerRef.current = shipsLayer;
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
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    void initializeMap();

    // Escuchar cambios en la configuración y reaccionar inmediatamente
    const checkConfigChanges = () => {
      if (!config || !mapRef.current) {
        return;
      }

      const merged = withConfigDefaults(config);
      const mapSettings = merged.ui.map;
      const cinemaSource = mapSettings.cinema ?? createDefaultMapCinema();
      const panSpeedDegPerSec = Math.max(
        0,
        Number.isFinite(cinemaSource.panLngDegPerSec) ? cinemaSource.panLngDegPerSec : 0
      );
      const cinemaEnabled = Boolean(cinemaSource.enabled);
      const newAllowCinema = cinemaEnabled && panSpeedDegPerSec > 0;
      const newFsmEnabled = typeof cinemaSource.fsmEnabled === "boolean" ? cinemaSource.fsmEnabled : true;
      const previousFsmEnabled = cinemaFsmEnabledRef.current;
      const fsmChanged = newFsmEnabled !== previousFsmEnabled;

      if (runtimeRef.current) {
        runtimeRef.current = {
          ...runtimeRef.current,
          cinema: cloneCinema(cinemaSource),
          allowCinema: newAllowCinema,
          panSpeedDegPerSec,
          fsmEnabled: newFsmEnabled,
        };
      }

      if (fsmChanged) {
        cinemaFsmEnabledRef.current = newFsmEnabled;
        const map = mapRef.current;
        if (map) {
          if (newFsmEnabled) {
            machineFactoryRef.current?.(map, "config-toggle");
          } else {
            mapStateMachineRef.current = null;
          }
        }
      }

      // Si cambió el estado de allowCinema, actualizar
      if (newAllowCinema !== allowCinemaRef.current) {
        allowCinemaRef.current = newAllowCinema;

        // Detener cualquier animación actual
        stopPan();
        clearIdlePanTimer();
        cancelSerpentine();

        if (newAllowCinema) {
          // Actualizar velocidad y reiniciar si corresponde
          const overrideSpeed = kioskRuntime.getSpeedOverride(
            panSpeedDegPerSec,
            FALLBACK_ROTATION_DEG_PER_SEC
          );
          panSpeedRef.current = overrideSpeed;
          console.debug("[map] applySpeed: initial pan speed", { degPerSec: overrideSpeed });

          // Reiniciar el mapa con nueva configuración
          cinemaRef.current = cloneCinema(cinemaSource);
          const motionInit = initializeMotionState(
            cinemaRef.current,
            motionProgressRef,
            horizontalDirectionRef
          );
          verticalDirectionRef.current = 1;
          viewStateRef.current.lng = motionInit.lng;

          // NO llamar recomputeAutopanActivation() aquí porque lo desactiva
          // En su lugar, activar directamente
          autopanEnabledRef.current = true;
          
          // Reiniciar animación si el mapa está listo
          const map = mapRef.current;
          if (map && map.isStyleLoaded() && !document.hidden) {
            startPan();
          }
        } else {
          // Si se desactiva, asegurar que el bearing sea 0
          panSpeedRef.current = 0;
          viewStateRef.current.bearing = 0;
          const map = mapRef.current;
          if (map) {
            map.jumpTo({
              center: [viewStateRef.current.lng, viewStateRef.current.lat],
              zoom: viewStateRef.current.zoom,
              pitch: viewStateRef.current.pitch,
              bearing: 0
            });
          }
        }
      } else if (newAllowCinema && panSpeedRef.current !== panSpeedDegPerSec) {
        // Si la velocidad cambió pero el modo sigue activo
        const overrideSpeed = kioskRuntime.getSpeedOverride(
          panSpeedDegPerSec,
          FALLBACK_ROTATION_DEG_PER_SEC
        );
        panSpeedRef.current = overrideSpeed;
        console.debug("[map] applySpeed: updated pan speed", { degPerSec: overrideSpeed });
        cinemaRef.current = cloneCinema(cinemaSource);
        const motionInit = initializeMotionState(
          cinemaRef.current,
          motionProgressRef,
          horizontalDirectionRef
        );
        viewStateRef.current.lng = motionInit.lng;
      }
    };

    return () => {
      destroyed = true;

      if (sizeCheckFrame != null) {
        cancelAnimationFrame(sizeCheckFrame);
        sizeCheckFrame = null;
      }

      cancelSerpentine();
      stopPan();
      clearIdlePanTimer();

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
      aircraftLayerRef.current = null;
      globalRadarLayerRef.current = null;
      globalSatelliteLayerRef.current = null;
      lightningLayerRef.current = null;
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
      mapStateMachineRef.current = null;
      machineFactoryRef.current = null;
    };
  }, []);

  // useEffect separado para escuchar cambios en la configuración
  useEffect(() => {
    if (!config || !mapRef.current) {
      return;
    }

    const merged = withConfigDefaults(config);
    const mapSettings = merged.ui.map;
    const cinemaSource = mapSettings.cinema ?? createDefaultMapCinema();
    const panSpeedDegPerSec = Math.max(
      0,
      Number.isFinite(cinemaSource.panLngDegPerSec) ? cinemaSource.panLngDegPerSec : 0
    );
    const cinemaEnabled = Boolean(cinemaSource.enabled);
    const newAllowCinema = cinemaEnabled && panSpeedDegPerSec > 0;
    const newFsmEnabled = typeof cinemaSource.fsmEnabled === "boolean" ? cinemaSource.fsmEnabled : true;
    const previousFsmEnabled = cinemaFsmEnabledRef.current;
    const fsmChanged = newFsmEnabled !== previousFsmEnabled;

    if (runtimeRef.current) {
      runtimeRef.current = {
        ...runtimeRef.current,
        cinema: cloneCinema(cinemaSource),
        allowCinema: newAllowCinema,
        panSpeedDegPerSec,
        fsmEnabled: newFsmEnabled,
      };
    }

    if (fsmChanged) {
      cinemaFsmEnabledRef.current = newFsmEnabled;
      const map = mapRef.current;
      if (map) {
        if (newFsmEnabled) {
          machineFactoryRef.current?.(map, "config-toggle");
        } else {
          mapStateMachineRef.current = null;
        }
      }
    }

    // Detectar cambios en todos los campos del modo cine
    const speedChanged = Math.abs(panSpeedDegPerSec - panSpeedRef.current) > 0.001;
    const cinemaChanged = newAllowCinema !== allowCinemaRef.current || fsmChanged;
    
    // Comparar bandas actuales vs nuevas
    const currentCinema = cinemaRef.current;
    const bandsChanged = currentCinema ? 
      JSON.stringify(currentCinema.bands) !== JSON.stringify(cinemaSource.bands) : true;
    const transitionChanged = currentCinema ?
      currentCinema.bandTransition_sec !== cinemaSource.bandTransition_sec : true;
    
    // Actualizar si cambió el estado, velocidad, bandas o tiempo de transición
    if (cinemaChanged || (newAllowCinema && (speedChanged || bandsChanged || transitionChanged))) {
      allowCinemaRef.current = newAllowCinema;
      
      // Detener cualquier animación actual
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Limpiar timers
      if (fallbackTimerRef.current != null) {
        window.clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      
      if (idlePanTimerRef.current != null) {
        window.clearInterval(idlePanTimerRef.current);
        idlePanTimerRef.current = null;
      }
      
      lastFrameTimeRef.current = null;
      lastRepaintTimeRef.current = null;
      lastLogTimeRef.current = 0;

      // Cancelar serpentine si está activo
      const controller = serpentineControllerRef.current;
      if (controller) {
        serpentineControllerRef.current = null;
        try {
          controller.cancel();
        } catch {
          // Ignore
        }
      }

      if (newAllowCinema) {
        // Actualizar velocidad y reiniciar si corresponde
        const overrideSpeed = kioskRuntime.getSpeedOverride(
          panSpeedDegPerSec,
          FALLBACK_ROTATION_DEG_PER_SEC
        );
        panSpeedRef.current = overrideSpeed;

        // Reiniciar el mapa con nueva configuración
        cinemaRef.current = cloneCinema(cinemaSource);
        const motionInit = initializeMotionState(
          cinemaRef.current,
          motionProgressRef,
          horizontalDirectionRef
        );
        verticalDirectionRef.current = 1;
        viewStateRef.current.lng = motionInit.lng;

        // Asegurar que autopanEnabled esté activado
        autopanEnabledRef.current = true;
        
        // Reiniciar animación si el mapa está listo
        const map = mapRef.current;
        // Si la página está oculta, marcar como pendiente para iniciar cuando vuelva a ser visible
        if (document.hidden) {
          pendingAnimationRef.current = true;
          // No intentar iniciar ahora, se iniciará cuando la página vuelva a ser visible
        } else {
          // Iniciar inmediatamente si la página está visible
          pendingAnimationRef.current = false;

          // Intentar iniciar la animación inmediatamente si el mapa está listo
          const tryStartAnimation = () => {
            const map = mapRef.current;
            if (map && map.isStyleLoaded() && !document.hidden && allowCinemaRef.current &&
                autopanModeRef.current === "rotate" && animationFrameRef.current === null) {
              // Asegurar que autopanEnabled esté activado antes de iniciar
              autopanEnabledRef.current = true;
              
              lastFrameTimeRef.current = null;
              lastRepaintTimeRef.current = null;
              const now = typeof performance !== "undefined" ? performance.now() : Date.now();
              lastLogTimeRef.current = now - AUTOPAN_LOG_INTERVAL_MS;
              
              // Función inline para iniciar el ciclo de animación
              const stepPan = (timestamp: number) => {
                const map = mapRef.current;
                if (animationFrameRef.current === null || !map || !allowCinemaRef.current) {
                  return;
                }
                if (autopanModeRef.current !== "rotate") {
                  return;
                }
                if (!autopanEnabledRef.current) {
                  return;
                }
                
                const lastFrame = lastFrameTimeRef.current;
                const effectiveLast = lastFrame ?? timestamp - FRAME_MIN_INTERVAL_MS;
                const deltaMs = timestamp - effectiveLast;
                if (deltaMs < FRAME_MIN_INTERVAL_MS) {
                  animationFrameRef.current = requestAnimationFrame(stepPan);
                  return;
                }

                lastFrameTimeRef.current = timestamp;

                let elapsedSeconds = deltaMs / 1000;
                if (elapsedSeconds > MAX_DELTA_SECONDS) {
                  elapsedSeconds = MAX_DELTA_SECONDS;
                }

                const cinema = cinemaRef.current;
                const totalBands = cinema.bands.length;
                if (!totalBands) {
                  animationFrameRef.current = requestAnimationFrame(stepPan);
                  return;
                }

                // Obtener la banda actual
                const currentIndex = ((bandIndexRef.current % totalBands) + totalBands) % totalBands;
                const currentBand = cinema.bands[currentIndex];
                if (!currentBand) {
                  animationFrameRef.current = requestAnimationFrame(stepPan);
                  return;
                }

                // Aplicar la configuración de la banda actual
                viewStateRef.current.lat = currentBand.lat;
                viewStateRef.current.zoom = currentBand.zoom;
                viewStateRef.current.pitch = currentBand.pitch;
                viewStateRef.current.bearing = 0;
                const minZoom = Math.min(
                  Number.isFinite(currentBand.minZoom) ? currentBand.minZoom : currentBand.zoom,
                  currentBand.zoom
                );
                currentMinZoomRef.current = minZoom;

                updateBandState(elapsedSeconds);

                const motion = cinema.motion ?? DEFAULT_CINEMA_MOTION;
                const amplitude = clamp(
                  Number.isFinite(motion.amplitudeDeg)
                    ? Number(motion.amplitudeDeg)
                    : DEFAULT_CINEMA_MOTION.amplitudeDeg,
                  MIN_MOTION_AMPLITUDE,
                  MAX_MOTION_AMPLITUDE
                );
                const travel = Math.max(amplitude * 2, 1);
                const deltaProgress = travel > 0 ? (panSpeedRef.current * elapsedSeconds) / travel : 0;
                let progress = motionProgressRef.current + deltaProgress * horizontalDirectionRef.current;

                let hitMax = false;
                let hitMin = false;
                if (progress >= 1) {
                  progress = 1;
                  hitMax = true;
                } else if (progress <= 0) {
                  progress = 0;
                  hitMin = true;
                }

                if (hitMax || hitMin) {
                  const nextIndex = currentIndex + verticalDirectionRef.current;
                  if (nextIndex < 0) {
                    verticalDirectionRef.current = 1;
                    bandIndexRef.current = 0;
                    horizontalDirectionRef.current = 1;
                    progress = 0;
                  } else if (nextIndex >= totalBands) {
                    verticalDirectionRef.current = -1;
                    bandIndexRef.current = totalBands - 1;
                    horizontalDirectionRef.current = -1;
                    progress = 1;
                  } else {
                    bandIndexRef.current = nextIndex;
                    horizontalDirectionRef.current = hitMax ? -1 : 1;
                  }
                }

                motionProgressRef.current = progress;

                const easedProgress = motion.easing === "ease-in-out" ? easeInOut(progress) : progress;
                const minLng = HORIZONTAL_CENTER_LNG - amplitude;
                const maxLng = HORIZONTAL_CENTER_LNG + amplitude;
                const newLng = minLng + (maxLng - minLng) * easedProgress;

                viewStateRef.current.lng = normalizeLng(newLng);
                map.setMinZoom(minZoom);
                
                const { lng, lat, zoom, pitch } = viewStateRef.current;
                map.jumpTo({
                  center: [lng, lat],
                  zoom,
                  pitch,
                  bearing: 0
                });
                
                lastRepaintTimeRef.current = timestamp;
                map.triggerRepaint();
                
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent(GEO_SCOPE_AUTOPAN_EVENT, {
                      detail: {
                        mode: "horizontal",
                        lng: viewStateRef.current.lng,
                        lat: viewStateRef.current.lat,
                        band: currentIndex
                      }
                    })
                  );
                }

                animationFrameRef.current = requestAnimationFrame(stepPan);
              };
              
              // Iniciar el ciclo de animación
              animationFrameRef.current = requestAnimationFrame(stepPan);
            } else {
              console.warn("[GeoScopeMap] Conditions not met to start animation:", {
                map: !!map,
                isStyleLoaded: map?.isStyleLoaded(),
                isHidden: document.hidden,
                allowCinema: allowCinemaRef.current,
                autopanMode: autopanModeRef.current,
                animationFrame: animationFrameRef.current
              });
            }
          };
          
          // Intentar iniciar inmediatamente
          tryStartAnimation();
          
          // Si no se pudo iniciar, intentar después de un pequeño delay
          setTimeout(() => {
            const map = mapRef.current;
            if (map && map.isStyleLoaded() && !document.hidden && allowCinemaRef.current && 
                autopanModeRef.current === "rotate" && animationFrameRef.current === null) {
              tryStartAnimation();
            }
          }, 100);
        }
      } else {
        // Si se desactiva, asegurar que el bearing sea 0
        panSpeedRef.current = 0;
        viewStateRef.current.bearing = 0;
        const map = mapRef.current;
        if (map) {
          map.jumpTo({
            center: [viewStateRef.current.lng, viewStateRef.current.lat],
            zoom: viewStateRef.current.zoom,
            pitch: viewStateRef.current.pitch,
            bearing: 0
          });
        }
      }
      
      // Actualizar velocidad siempre que cambie
      if (speedChanged) {
        const overrideSpeed = kioskRuntime.getSpeedOverride(
          panSpeedDegPerSec,
          FALLBACK_ROTATION_DEG_PER_SEC
        );
        panSpeedRef.current = overrideSpeed;
        cinemaRef.current = cloneCinema(cinemaSource);
        const motionInit = initializeMotionState(
          cinemaRef.current,
          motionProgressRef,
          horizontalDirectionRef
        );
        viewStateRef.current.lng = motionInit.lng;
      }
    } else if (newAllowCinema && (speedChanged || bandsChanged || transitionChanged)) {
      // Si cambió la velocidad, bandas o tiempo de transición pero el modo sigue activo
      const overrideSpeed = kioskRuntime.getSpeedOverride(
        panSpeedDegPerSec,
        FALLBACK_ROTATION_DEG_PER_SEC
      );
      panSpeedRef.current = overrideSpeed;
      cinemaRef.current = cloneCinema(cinemaSource);
      const motionInit = initializeMotionState(
        cinemaRef.current,
        motionProgressRef,
        horizontalDirectionRef
      );
      viewStateRef.current.lng = motionInit.lng;

      // Si cambiaron las bandas o el tiempo de transición, reiniciar el índice de banda
      if (bandsChanged || transitionChanged) {
        bandIndexRef.current = 0;
        bandElapsedRef.current = 0;
        bandTransitionRef.current = null;
      }
    }
  }, [config, reloadConfig]);

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
        
        // Detener modo cine si está activo - usar refs directamente
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        
        // Detener cualquier animación actual
        if (fallbackTimerRef.current != null) {
          window.clearInterval(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        
        // Limpiar timers de idle pan
        if (idlePanTimerRef.current != null) {
          window.clearInterval(idlePanTimerRef.current);
          idlePanTimerRef.current = null;
        }
        
        // Cancelar serpentine si está activo
        const controller = serpentineControllerRef.current;
        if (controller) {
          serpentineControllerRef.current = null;
          try {
            controller.cancel();
          } catch {
            // Ignore
          }
        }
        
        // Resetear estado de animación
        lastFrameTimeRef.current = null;
        lastRepaintTimeRef.current = null;
        lastLogTimeRef.current = 0;

        // Zoom a Castellón/Vila-real
        const centerLat = Number.isFinite(stormConfig.center_lat) ? stormConfig.center_lat : 39.986;
        const centerLng = Number.isFinite(stormConfig.center_lng) ? stormConfig.center_lng : -0.051;
        const zoom = Number.isFinite(stormConfig.zoom) ? stormConfig.zoom : 9.0;

        // Actualizar estado de vista
        viewStateRef.current.lat = centerLat;
        viewStateRef.current.lng = centerLng;
        viewStateRef.current.zoom = zoom;
        viewStateRef.current.bearing = 0;
        viewStateRef.current.pitch = 0;

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

        // Restaurar vista al modo normal (volver a la primera banda del cine si está activo)
        if (allowCinemaRef.current && cinemaRef.current) {
          const firstBand = cinemaRef.current.bands[0];
          if (firstBand) {
            viewStateRef.current.lat = firstBand.lat;
            viewStateRef.current.lng = -180;
            viewStateRef.current.zoom = firstBand.zoom;
            viewStateRef.current.pitch = firstBand.pitch;
            viewStateRef.current.bearing = 0;

            if (map.isStyleLoaded()) {
              map.easeTo({
                center: [-180, firstBand.lat],
                zoom: firstBand.zoom,
                pitch: firstBand.pitch,
                bearing: 0,
                duration: 1500
              });
            }
          }
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
    const flightsConfig = merged.layers.flights;
    const shipsConfig = merged.layers.ships;
    const openskyConfig = merged.opensky;

    // Actualizar AircraftLayer
    const aircraftLayer = aircraftLayerRef.current;
    if (aircraftLayer) {
      aircraftLayer.setEnabled(flightsConfig.enabled && openskyConfig.enabled);
      aircraftLayer.setOpacity(flightsConfig.opacity);
      aircraftLayer.setMaxAgeSeconds(flightsConfig.max_age_seconds);
      aircraftLayer.setCluster(openskyConfig.cluster);
      // Actualizar cine_focus si está disponible (requeriría método setCineFocus)
      // Por ahora, se actualiza con updateData que lee in_focus del payload
    }

    // Actualizar ShipsLayer
    const shipsLayer = shipsLayerRef.current;
    if (shipsLayer) {
      shipsLayer.setEnabled(shipsConfig.enabled);
      shipsLayer.setOpacity(shipsConfig.opacity);
      shipsLayer.setMaxAgeSeconds(shipsConfig.max_age_seconds);
      // Actualizar cine_focus si está disponible
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

    let satelliteFrameIndex = 0;
    let radarFrameIndex = 0;
    let satelliteFrames: Array<{ timestamp: number; iso: string }> = [];
    let radarFrames: Array<{ timestamp: number; iso: string }> = [];
    let animationTimer: number | null = null;
    let isPlaying = true;
    let playbackSpeed = 1.0;

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
      if (!isPlaying) return;

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
      const frameIntervalMs = Math.min(satFrameStep, radarFrameStep) * 60 * 1000 / playbackSpeed;

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
    if (globalConfig.satellite?.enabled || globalConfig.radar?.enabled) {
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
        globalRadarLayer.update({ opacity: globalConfig.radar.opacity });
      }
    };

    updateLayersOpacity();

    return () => {
      stopAnimation();
      clearInterval(refreshTimer);
    };
  }, [config]);

  const resolveCinemaTelemetryState = (
    runtime: RuntimePreferences
  ): CinemaTelemetryState => {
    if (webglErrorRef.current) {
      return "ERROR";
    }
    if (!runtime.allowCinema) {
      return "DISABLED";
    }
    if (cinemaFsmEnabledRef.current) {
      const machine = mapStateMachineRef.current;
      if (machine) {
        return machine.getState();
      }
      return "IDLE";
    }
    if (autopanModeRef.current === "serpentine") {
      if (!autopanEnabledRef.current) {
        return "PAUSED";
      }
      return serpentineControllerRef.current ? "PANNING" : "READY";
    }
    if (autopanModeRef.current !== "rotate") {
      return "PAUSED";
    }
    if (!autopanEnabledRef.current) {
      return "PAUSED";
    }
    return animationFrameRef.current != null ? "PANNING" : "READY";
  };

  useEffect(() => {
    if (typeof window === "undefined" || typeof fetch !== "function") {
      return;
    }

    let cancelled = false;

    const sendHeartbeat = async () => {
      if (cancelled) {
        return;
      }
      const runtime = runtimeRef.current;
      if (!runtime) {
        return;
      }

      const state = resolveCinemaTelemetryState(runtime);
      const nowIso = new Date().toISOString();
      const lastPanTickIso = lastPanTickIsoRef.current ?? nowIso;
      if (lastPanTickIsoRef.current == null) {
        lastPanTickIsoRef.current = lastPanTickIso;
      }

      const payload = {
        state,
        lastPanTickIso,
        reducedMotion:
          respectReducedMotionRef.current && reducedMotionActiveRef.current ? true : false,
      };

      try {
        const response = await fetch("/api/telemetry/cinema", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok && response.status !== 204) {
          // Respuesta inesperada: ignorar en silencio
        }
      } catch {
        // Silencioso: errores en telemetría no deben afectar al mapa
      }
    };

    cinemaHeartbeatTimerRef.current = window.setInterval(() => {
      void sendHeartbeat();
    }, CINEMA_HEARTBEAT_INTERVAL_MS);

    void sendHeartbeat();

    return () => {
      cancelled = true;
      const timer = cinemaHeartbeatTimerRef.current;
      if (timer != null) {
        window.clearInterval(timer);
        cinemaHeartbeatTimerRef.current = null;
      }
    };
  }, []);

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
      {tintColor ? (
        <div className="map-tint" style={{ background: tintColor }} aria-hidden="true" />
      ) : null}
    </div>
  );
}
