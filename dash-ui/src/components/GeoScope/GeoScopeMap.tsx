import maplibregl from "maplibre-gl";
import type { MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import { apiGet } from "../../lib/api";
import {
  createDefaultMapCinema,
  createDefaultMapSettings,
  withConfigDefaults
} from "../../config/defaults";
import type {
  AppConfig,
  UIMapCinemaBand,
  UIMapCinemaSettings,
  UIMapSettings,
  UIMapThemeSettings
} from "../../types/config";
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

const cloneTheme = (theme?: UIMapThemeSettings | null): UIMapThemeSettings => ({
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

const applyVectorTheme = (map: maplibregl.Map, theme: UIMapThemeSettings) => {
  const sea = theme.sea ?? undefined;
  const land = theme.land ?? undefined;
  const label = theme.label ?? undefined;
  const contrast = typeof theme.contrast === "number" ? theme.contrast : undefined;

  if (sea) {
    const waterFillLayers = [
      "water",
      "water-depth",
      "water-pattern",
      "water-shadow",
      "ocean",
      "sea",
      "lake",
      "reservoir",
      "river",
      "river-canal"
    ];
    const waterLineLayers = ["waterway", "waterway-other", "water-boundary"];

    // TODO: extend this list if the upstream style adds or renames hydro layers.
    for (const layerId of waterFillLayers) {
      setPaintProperty(map, layerId, "fill-color", sea);
    }
    for (const layerId of waterLineLayers) {
      setPaintProperty(map, layerId, "line-color", sea);
    }
  }

  if (land) {
    const landFillLayers = [
      "background",
      "land",
      "landcover",
      "landcover-ice",
      "landcover-wood",
      "landuse",
      "landuse-residential",
      "park",
      "park-outline",
      "national-park"
    ];

    // TODO: keep layer mappings in sync with the active base style revisions.
    for (const layerId of landFillLayers) {
      setPaintProperty(map, layerId, layerId === "background" ? "background-color" : "fill-color", land);
    }
  }

  if (label) {
    const labelLayers = [
      "place-label",
      "settlement-major-label",
      "settlement-minor-label",
      "state-label",
      "country-label",
      "marine-label",
      "airport-label",
      "road-label",
      "road-number-shield",
      "poi-label",
      "natural-point-label",
      "water-label"
    ];

    // TODO: widen coverage for specialised label layers when styles evolve.
    for (const layerId of labelLayers) {
      setPaintProperty(map, layerId, "text-color", label);
      setPaintProperty(map, layerId, "icon-color", label);
    }
  }

  if (contrast !== undefined) {
    const opacity = clamp(0.7 + contrast * 0.6, 0.2, 1);
    const landOpacityLayers = [
      "landcover",
      "landcover-wood",
      "landuse",
      "park",
      "national-park"
    ];
    for (const layerId of landOpacityLayers) {
      setPaintProperty(map, layerId, "fill-opacity", opacity);
    }
  }
};

const applyRasterTheme = (map: maplibregl.Map, theme: UIMapThemeSettings) => {
  const contrast = typeof theme.contrast === "number" ? clamp(theme.contrast, -0.5, 0.5) : 0;

  setPaintProperty(map, "carto", "raster-contrast", contrast);
  setPaintProperty(map, "carto", "raster-saturation", 0);
  setPaintProperty(map, "carto", "raster-brightness-min", clamp(0.6 - contrast * 0.4, 0, 1.5));
  setPaintProperty(map, "carto", "raster-brightness-max", clamp(1.3 + contrast * 0.4, 0.5, 2));
};

const applyThemeToMap = (
  map: maplibregl.Map,
  styleType: MapStyleDefinition["type"],
  theme: UIMapThemeSettings
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

const cloneCinema = (cinema: UIMapCinemaSettings): UIMapCinemaSettings => ({
  ...cinema,
  bands: cinema.bands.map((band) => ({ ...band }))
});

type TransitionState = {
  from: UIMapCinemaBand;
  to: UIMapCinemaBand;
  toIndex: number;
  duration: number;
  elapsed: number;
};

type RuntimePreferences = {
  cinema: UIMapCinemaSettings;
  renderWorldCopies: boolean;
  initialLng: number;
  style: MapStyleDefinition;
  fallbackStyle: MapStyleDefinition;
  styleWasFallback: boolean;
  theme: UIMapThemeSettings;
};

const buildRuntimePreferences = (
  mapSettings: UIMapSettings,
  styleResult: MapStyleResult
): RuntimePreferences => {
  const defaults = createDefaultMapSettings();
  const source = mapSettings ?? defaults;
  const cinemaSource = source.cinema ?? defaults.cinema ?? createDefaultMapCinema();
  const cinema = cloneCinema(cinemaSource);
  cinema.enabled = true;

  const centerLngCandidate = Array.isArray(source.center)
    ? source.center[0]
    : defaults.center[0];
  const initialLng = normalizeLng(
    Number.isFinite(Number(centerLngCandidate))
      ? Number(centerLngCandidate)
      : defaults.center[0]
  );

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

const loadRuntimePreferences = async (): Promise<RuntimePreferences> => {
  try {
    const config = await apiGet<AppConfig | undefined>("/api/config");
    const merged = withConfigDefaults(config);
    const mapSettings = merged.ui.map;
    const styleResult = await loadMapStyle(mapSettings);
    return buildRuntimePreferences(mapSettings, styleResult);
  } catch (error) {
    console.warn(
      "[GeoScopeMap] Falling back to default cinema configuration (using defaults).",
      error
    );
    const fallbackSettings = createDefaultMapSettings();
    const styleResult = await loadMapStyle(fallbackSettings);
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
  const cinemaRef = useRef<UIMapCinemaSettings>(cloneCinema(FALLBACK_CINEMA));
  const bandIndexRef = useRef(0);
  const bandElapsedRef = useRef(0);
  const bandTransitionRef = useRef<TransitionState | null>(null);
  const themeRef = useRef<UIMapThemeSettings>(cloneTheme(null));
  const styleTypeRef = useRef<MapStyleDefinition["type"]>("raster");
  const fallbackStyleRef = useRef<MapStyleDefinition | null>(null);
  const fallbackAppliedRef = useRef(false);
  const [tintColor, setTintColor] = useState<string | null>(null);

  const applyBandInstant = (band: UIMapCinemaBand, map?: maplibregl.Map | null) => {
    viewStateRef.current.lat = band.lat;
    viewStateRef.current.zoom = band.zoom;
    viewStateRef.current.pitch = band.pitch;
    currentMinZoomRef.current = band.minZoom;

    const target = map ?? mapRef.current;
    if (target) {
      target.setMinZoom(band.minZoom);
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
      const runtime = await loadRuntimePreferences();

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

      viewStateRef.current.lng = runtime.initialLng;
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
