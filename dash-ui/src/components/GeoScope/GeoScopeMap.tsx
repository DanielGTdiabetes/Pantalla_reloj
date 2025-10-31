import maplibregl from "maplibre-gl";
import type { MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import { apiGet } from "../../lib/api";
import { useConfig } from "../../lib/useConfig";
import { kioskRuntime } from "../../lib/runtimeFlags";
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
    console.info("[auto-pan:step]", {
      mode: "serpentine",
      lat: Number(step.lat.toFixed(4)),
      lon: Number(step.lon.toFixed(4)),
      band: step.band,
      direction: step.direction,
      stepDeg: speedDeg,
      latStepDeg: config.latStepDeg
    });
    if (!lastAggregateLog || now - lastAggregateLog >= AUTOPAN_LOG_INTERVAL_MS) {
      lastAggregateLog = now;
      console.info(
        `[diagnostics:auto-pan] lat=${step.lat.toFixed(4)}, lon=${step.lon.toFixed(4)}, band=${step.band}`
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
  idlePan: MapIdlePanConfig;
  rotationEnabled: boolean;
  allowCinema: boolean;
  panSpeedDegPerSec: number;
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
    panSpeedDegPerSec
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

export default function GeoScopeMap() {
  const { data: config, reload: reloadConfig } = useConfig();
  const mapFillRef = useRef<HTMLDivElement | null>(null);
  
  // Guardar estado de si necesitamos iniciar animación cuando la página esté visible
  const pendingAnimationRef = useRef(false);
  
  // Recargar config cuando la página se vuelve visible (después de guardar en /config)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log("[GeoScopeMap] Page became visible, pendingAnimation:", pendingAnimationRef.current);
        // Recargar config cuando la página vuelve a ser visible
        reloadConfig();
        
        // Si había una animación pendiente, iniciarla ahora
        if (pendingAnimationRef.current) {
          const map = mapRef.current;
          console.log("[GeoScopeMap] Checking conditions for pending animation:", {
            map: !!map,
            isStyleLoaded: map?.isStyleLoaded(),
            allowCinema: allowCinemaRef.current,
            autopanMode: autopanModeRef.current,
            animationFrame: animationFrameRef.current
          });
          
          if (map && map.isStyleLoaded() && allowCinemaRef.current && autopanModeRef.current === "rotate" && animationFrameRef.current === null) {
            console.log("[GeoScopeMap] Starting pending animation after visibility change");
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

              const deltaLng = panSpeedRef.current * elapsedSeconds * horizontalDirectionRef.current;
              let newLng = viewStateRef.current.lng + deltaLng;

              const reachedEast = newLng >= 180;
              const reachedWest = newLng <= -180;

              if (reachedEast || reachedWest) {
                newLng = reachedEast ? 180 : -180;
                const nextIndex = currentIndex + verticalDirectionRef.current;

                if (nextIndex < 0) {
                  verticalDirectionRef.current = 1;
                  horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
                  newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
                  bandIndexRef.current = 0;
                } else if (nextIndex >= totalBands) {
                  verticalDirectionRef.current = -1;
                  horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
                  newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
                  bandIndexRef.current = totalBands - 1;
                } else {
                  bandIndexRef.current = nextIndex;
                  horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
                  newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
                }
              }

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
  const allowCinemaRef = useRef(false);
  const idlePanConfigRef = useRef<MapIdlePanConfig>(createDefaultMapIdlePan());
  const idlePanTimerRef = useRef<number | null>(null);
  const idlePanDirectionRef = useRef<1 | -1>(1);
  const idlePanDeltaRef = useRef(0.5);
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
  const horizontalDirectionRef = useRef<1 | -1>(1); // 1 = Este (derecha), -1 = Oeste (izquierda)
  const verticalDirectionRef = useRef<1 | -1>(1); // 1 = hacia abajo, -1 = hacia arriba

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

      lastFrameTimeRef.current = null;
      lastRepaintTimeRef.current = null;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      lastLogTimeRef.current = now - AUTOPAN_LOG_INTERVAL_MS;
      animationFrameRef.current = requestAnimationFrame(stepPan);
      ensureFallbackTimer();
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

      // Mover horizontalmente
      const deltaLng = panSpeedRef.current * elapsedSeconds * horizontalDirectionRef.current;
      let newLng = viewStateRef.current.lng + deltaLng;

      // Verificar si llegamos al final horizontal
      const reachedEast = newLng >= 180;
      const reachedWest = newLng <= -180;

      if (reachedEast || reachedWest) {
        // Normalizar la longitud al límite
        newLng = reachedEast ? 180 : -180;

        // Cambiar a la siguiente banda verticalmente
        const nextIndex = currentIndex + verticalDirectionRef.current;

        // Si llegamos al final de las bandas (abajo o arriba), invertir dirección vertical
        if (nextIndex < 0) {
          // Estamos en la primera banda y vamos hacia arriba, invertir dirección
          verticalDirectionRef.current = 1; // Cambiar a bajar
          // Invertir también dirección horizontal para la siguiente pasada
          horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
          // Empezar desde el lado opuesto
          newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
          // Ir a la primera banda
          bandIndexRef.current = 0;
        } else if (nextIndex >= totalBands) {
          // Estamos en la última banda y vamos hacia abajo, invertir dirección
          verticalDirectionRef.current = -1; // Cambiar a subir
          // Invertir también dirección horizontal para la siguiente pasada
          horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
          // Empezar desde el lado opuesto
          newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
          // Ir a la última banda
          bandIndexRef.current = totalBands - 1;
        } else {
          // Cambiar a la siguiente banda
          bandIndexRef.current = nextIndex;
          // Invertir dirección horizontal al cambiar de banda
          horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
          // Empezar desde el lado opuesto
          newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
        }
      }

      viewStateRef.current.lng = normalizeLng(newLng);
      
      // Actualizar el minZoom del mapa
      map.setMinZoom(minZoom);

      updateMapView(map);
      lastRepaintTimeRef.current = timestamp;
      map.triggerRepaint();
      
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
      recomputeAutopanActivation();
      scheduleIdlePan();
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
      stopPan();
      clearIdlePanTimer();
      safeFit();
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
      const hostPromise = waitForStableSize();
      const runtime = await loadRuntimePreferences();
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

      // Inicializar direcciones: empezar desde la izquierda moviéndose hacia la derecha
      horizontalDirectionRef.current = 1; // Este (derecha)
      verticalDirectionRef.current = 1; // Hacia abajo
      
      // Empezar desde el lado izquierdo del mapa
      viewStateRef.current.lng = -180;
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
          
          // Reiniciar el mapa con nueva configuración
          cinemaRef.current = cloneCinema(cinemaSource);
          
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
        cinemaRef.current = cloneCinema(cinemaSource);
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

    // Si cambió el estado de allowCinema o la velocidad, actualizar
    const speedChanged = Math.abs(panSpeedDegPerSec - panSpeedRef.current) > 0.001;
    const cinemaChanged = newAllowCinema !== allowCinemaRef.current;
    
    if (cinemaChanged || (newAllowCinema && speedChanged)) {
      console.log("[GeoScopeMap] Config changed - updating:", {
        cinemaEnabled,
        panSpeedDegPerSec,
        newAllowCinema,
        currentAllowCinema: allowCinemaRef.current,
        cinemaChanged,
        speedChanged
      });
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
        
        // Asegurar que autopanEnabled esté activado
        autopanEnabledRef.current = true;
        
        // Reiniciar animación si el mapa está listo
        const map = mapRef.current;
        console.log("[GeoScopeMap] Attempting to start animation:", {
          mapExists: !!map,
          isStyleLoaded: map?.isStyleLoaded(),
          isHidden: document.hidden,
          autopanMode: autopanModeRef.current,
          allowCinema: allowCinemaRef.current,
          animationFrame: animationFrameRef.current
        });
        
        // Si la página está oculta, marcar como pendiente para iniciar cuando vuelva a ser visible
        if (document.hidden) {
          console.log("[GeoScopeMap] Page is hidden, will start animation when visible");
          pendingAnimationRef.current = true;
          // No intentar iniciar ahora, se iniciará cuando la página vuelva a ser visible
        } else {
          // Iniciar inmediatamente si la página está visible
          console.log("[GeoScopeMap] Page is visible, attempting to start animation immediately");
          pendingAnimationRef.current = false;
          
          // Intentar iniciar la animación inmediatamente si el mapa está listo
          const tryStartAnimation = () => {
            const map = mapRef.current;
            if (map && map.isStyleLoaded() && !document.hidden && allowCinemaRef.current && 
                autopanModeRef.current === "rotate" && animationFrameRef.current === null) {
              console.log("[GeoScopeMap] Starting animation cycle immediately");
              
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
                  if (animationFrameRef.current === null) {
                    console.log("[GeoScopeMap] stepPan: Animation frame cancelled");
                  }
                  return;
                }
                if (autopanModeRef.current !== "rotate") {
                  console.log("[GeoScopeMap] stepPan: Wrong autopan mode:", autopanModeRef.current);
                  return;
                }
                if (!autopanEnabledRef.current) {
                  console.log("[GeoScopeMap] stepPan: Autopan disabled");
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

                // Mover horizontalmente
                const deltaLng = panSpeedRef.current * elapsedSeconds * horizontalDirectionRef.current;
                let newLng = viewStateRef.current.lng + deltaLng;

                // Verificar si llegamos al final horizontal
                const reachedEast = newLng >= 180;
                const reachedWest = newLng <= -180;

                if (reachedEast || reachedWest) {
                  newLng = reachedEast ? 180 : -180;
                  const nextIndex = currentIndex + verticalDirectionRef.current;

                  if (nextIndex < 0) {
                    verticalDirectionRef.current = 1;
                    horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
                    newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
                    bandIndexRef.current = 0;
                  } else if (nextIndex >= totalBands) {
                    verticalDirectionRef.current = -1;
                    horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
                    newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
                    bandIndexRef.current = totalBands - 1;
                  } else {
                    bandIndexRef.current = nextIndex;
                    horizontalDirectionRef.current = horizontalDirectionRef.current === 1 ? -1 : 1;
                    newLng = horizontalDirectionRef.current === 1 ? -180 : 180;
                  }
                }

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
              console.log("[GeoScopeMap] Animation frame started:", animationFrameRef.current);
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
      }
    } else if (newAllowCinema && speedChanged) {
      // Si solo cambió la velocidad pero el modo sigue activo
      console.log("[GeoScopeMap] Speed changed:", {
        from: panSpeedRef.current,
        to: panSpeedDegPerSec
      });
      const overrideSpeed = kioskRuntime.getSpeedOverride(
        panSpeedDegPerSec,
        FALLBACK_ROTATION_DEG_PER_SEC
      );
      panSpeedRef.current = overrideSpeed;
      cinemaRef.current = cloneCinema(cinemaSource);
    }
  }, [config, reloadConfig]);

  return (
    <div className="map-host">
      <div ref={mapFillRef} className="map-fill" />
      {tintColor ? (
        <div className="map-tint" style={{ background: tintColor }} aria-hidden="true" />
      ) : null}
    </div>
  );
}
