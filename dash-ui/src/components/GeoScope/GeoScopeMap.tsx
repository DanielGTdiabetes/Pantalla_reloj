import maplibregl from "maplibre-gl";
import type { MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import {
  createDefaultMapCinema,
  createDefaultMapSettings
} from "../../config/defaults";
import type {
  AppConfig,
  MapCinemaBand,
  MapCinemaConfig,
  MapConfig,
  MapThemeConfig,
  ResolvedMapConfig
} from "../../types/config";
import { useConfigStore } from "../../state/configStore";
import useWebGLCheck from "../../hooks/useWebGLCheck";
import {
  loadMapStyle,
  type MapStyleDefinition,
  type MapStyleResult
} from "./mapStyle";

const FALLBACK_CINEMA = createDefaultMapCinema();
const DEFAULT_VIEW = {
  lng: 0,
  lat: FALLBACK_CINEMA.bands[0]?.lat ?? 0,
  zoom: FALLBACK_CINEMA.bands[0]?.zoom ?? 2.6,
  bearing: 0,
  pitch: FALLBACK_CINEMA.bands[0]?.pitch ?? 0
};
const DEFAULT_MIN_ZOOM = FALLBACK_CINEMA.bands[0]?.minZoom ?? 2.4;
const DEFAULT_PAN_SPEED = FALLBACK_CINEMA.panLngDegPerSec;
const FPS_LIMIT = 45;
const FRAME_MIN_INTERVAL_MS = 1000 / FPS_LIMIT;
const MAX_DELTA_SECONDS = 0.5;

const FALLBACK_THEME = createDefaultMapSettings().theme ?? {};
const FALLBACK_RESOLVED_MAP: ResolvedMapConfig = {
  engine: "maplibre",
  type: "raster",
  style_url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
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

  setPaintProperty(map, "carto", "raster-saturation", saturationBoost);
  setPaintProperty(map, "carto", "raster-contrast", contrastBoost);
  setPaintProperty(map, "carto", "raster-brightness-min", brightnessMin);
  setPaintProperty(map, "carto", "raster-brightness-max", brightnessMax);
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
    theme: cloneTheme(source.theme)
  };
};

const createRuntimePreferences = async (
  config: AppConfig | null | undefined,
  resolvedMap: ResolvedMapConfig | null | undefined
): Promise<RuntimePreferences> => {
  const fallbackSettings = createDefaultMapSettings();
  const effectiveResolved = resolvedMap ?? FALLBACK_RESOLVED_MAP;
  try {
    const mapSettings = (config?.ui?.map as MapConfig | undefined) ?? fallbackSettings;
    const styleResult = await loadMapStyle(mapSettings, effectiveResolved);
    return buildRuntimePreferences(mapSettings, styleResult);
  } catch (error) {
    console.warn(
      "[GeoScopeMap] Falling back to default cinema configuration (using defaults).",
      error
    );
    const styleResult = await loadMapStyle(fallbackSettings, FALLBACK_RESOLVED_MAP);
    return buildRuntimePreferences(fallbackSettings, styleResult);
  }
};

export default function GeoScopeMap() {
  const { config, resolved, version } = useConfigStore((state) => ({
    config: state.config,
    resolved: state.resolved,
    version: state.version
  }));
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
  const [tintColor, setTintColor] = useState<string | null>(null);
  const fallbackNoticeRef = useRef(false);
  const webglCheck = useWebGLCheck();

  useEffect(() => {
    const mapSettings = config?.ui?.map;
    const provider = mapSettings?.provider;
    const key = mapSettings?.maptiler?.key ?? null;
    const missingKey = provider === "maptiler" && (!key || key.trim().length === 0);
    const usingRaster = (resolved?.map?.type ?? "raster") === "raster";
    if (missingKey && usingRaster) {
      if (!fallbackNoticeRef.current) {
        console.warn("[map] No MapTiler key: using raster Carto fallback");
        fallbackNoticeRef.current = true;
      }
    } else {
      fallbackNoticeRef.current = false;
    }
  }, [config?.ui?.map?.provider, config?.ui?.map?.maptiler?.key, resolved?.map?.type, resolved?.map?.style_url]);

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

    const targetElapsed = state.elapsed + deltaSeconds;
    const clampedElapsed = Math.min(targetElapsed, state.duration);
    state.elapsed = clampedElapsed;

    const progress = state.duration > 0 ? clampedElapsed / state.duration : 1;
    const eased = easeInOut(Math.min(progress, 1));

    viewStateRef.current.lat = lerp(state.from.lat, state.to.lat, eased);
    viewStateRef.current.zoom = lerp(state.from.zoom, state.to.zoom, eased);
    viewStateRef.current.pitch = lerp(state.from.pitch, state.to.pitch, eased);
    viewStateRef.current.bearing = 0;

    if (progress >= 1) {
      finishTransition(mapRef.current);
      const leftover = targetElapsed - state.duration;
      return leftover > 0 ? leftover : 0;
    }

    return 0;
  };

  const updateBandState = (deltaSeconds: number) => {
    const cinema = cinemaRef.current;
    if (!cinema.bands.length) return;

    if (bandTransitionRef.current) {
      const leftover = advanceTransition(deltaSeconds);
      if (leftover > 0) {
        updateBandState(leftover);
      }
      return;
    }

    const totalBands = cinema.bands.length;
    const currentIndex = ((bandIndexRef.current % totalBands) + totalBands) % totalBands;
    const currentBand = cinema.bands[currentIndex];
    const newElapsed = bandElapsedRef.current + deltaSeconds;

    if (newElapsed >= currentBand.duration_sec) {
      bandElapsedRef.current = currentBand.duration_sec;
      const overshoot = newElapsed - currentBand.duration_sec;
      const nextIndex = (currentIndex + 1) % totalBands;
      startTransition(nextIndex);
      const leftover = advanceTransition(overshoot);
      if (leftover > 0) {
        updateBandState(leftover);
      }
    } else {
      bandElapsedRef.current = newElapsed;
      applyBandInstant(currentBand);
    }
  };

  const updateMapView = (map: maplibregl.Map) => {
    const { lng, lat, zoom, pitch, bearing } = viewStateRef.current;
    const zoomValue = Number.isFinite(zoom) ? zoom : DEFAULT_VIEW.zoom;
    const pitchValue = Number.isFinite(pitch) ? pitch : DEFAULT_VIEW.pitch;
    const bearingValue = Number.isFinite(bearing) ? bearing : 0;
    const centerLng = Number.isFinite(lng) ? lng : DEFAULT_VIEW.lng;
    const centerLat = Number.isFinite(lat) ? lat : DEFAULT_VIEW.lat;
    map.jumpTo({
      center: [centerLng, centerLat],
      zoom: zoomValue,
      pitch: pitchValue,
      bearing: bearingValue
    });
  };

  useEffect(() => {
    if (!webglCheck.supported) {
      return;
    }
    void version;
    const activeConfig = config ?? null;
    const activeResolved = resolved?.map ?? null;
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

    const stopPan = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = null;
    };

    const stepPan = (timestamp: number) => {
      const map = mapRef.current;
      if (!map) {
        stopPan();
        return;
      }

      const lastFrame = lastFrameTimeRef.current;
      if (lastFrame == null) {
        lastFrameTimeRef.current = timestamp;
        animationFrameRef.current = requestAnimationFrame(stepPan);
        return;
      }

      const deltaMs = timestamp - lastFrame;
      if (deltaMs < FRAME_MIN_INTERVAL_MS) {
        animationFrameRef.current = requestAnimationFrame(stepPan);
        return;
      }

      lastFrameTimeRef.current = timestamp;

      let elapsedSeconds = deltaMs / 1000;
      if (elapsedSeconds > MAX_DELTA_SECONDS) {
        elapsedSeconds = MAX_DELTA_SECONDS;
      }

      updateBandState(elapsedSeconds);

      const deltaLng = panSpeedRef.current * elapsedSeconds;
      viewStateRef.current.lng = normalizeLng(viewStateRef.current.lng + deltaLng);

      updateMapView(map);

      animationFrameRef.current = requestAnimationFrame(stepPan);
    };

    const startPan = () => {
      if (animationFrameRef.current != null || !mapRef.current) return;
      lastFrameTimeRef.current = null;
      animationFrameRef.current = requestAnimationFrame(stepPan);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startPan();
      } else {
        stopPan();
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
        applyThemeToMap(map, styleTypeRef.current, themeRef.current);
      }
      safeFit();
      if (document.visibilityState === "visible") {
        startPan();
      }
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
      const runtime = await createRuntimePreferences(activeConfig, activeResolved);

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
      panSpeedRef.current = cinemaSettings.panLngDegPerSec;
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
        const normalizedError =
          error instanceof Error ? error : new Error(String(error ?? "Error creando MapLibre"));
        console.error("[GeoScopeMap] No se pudo inicializar el mapa", normalizedError);
        setTimeout(() => {
          throw normalizedError;
        });
        return;
      }

      mapRef.current = map;
      map.setMinZoom(firstBand.minZoom);

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

      document.addEventListener("visibilitychange", handleVisibilityChange);
    };

    void initializeMap();

    return () => {
      destroyed = true;

      if (sizeCheckFrame != null) {
        cancelAnimationFrame(sizeCheckFrame);
        sizeCheckFrame = null;
      }

      document.removeEventListener("visibilitychange", handleVisibilityChange);

      stopPan();

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      const media = dprMediaRef.current;
      if (media) {
        media.removeEventListener("change", handleDprChange);
        dprMediaRef.current = null;
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
  }, [config, resolved, version, webglCheck.supported]);

  return (
    <div className="map-host">
      <div ref={mapFillRef} className="map-fill" />
      {tintColor ? (
        <div className="map-tint" style={{ background: tintColor }} aria-hidden="true" />
      ) : null}
    </div>
  );
}
