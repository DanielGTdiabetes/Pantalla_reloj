import maplibregl from "maplibre-gl";
import type { MapLibreEvent, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

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
  UIMapSettings
} from "../../types/config";

const VOYAGER = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors, © CARTO"
    }
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }]
} satisfies StyleSpecification;

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
};

const buildRuntimePreferences = (mapSettings?: UIMapSettings): RuntimePreferences => {
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
    initialLng
  };
};

const loadRuntimePreferences = async (): Promise<RuntimePreferences> => {
  try {
    const config = await apiGet<AppConfig>("/config");
    const merged = withConfigDefaults(config);
    return buildRuntimePreferences(merged.ui.map);
  } catch (error) {
    console.warn(
      "[GeoScopeMap] Falling back to default cinema configuration (using defaults).",
      error
    );
    return buildRuntimePreferences(createDefaultMapSettings());
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
      safeFit();
      if (document.visibilityState === "visible") {
        startPan();
      }
    };

    const handleStyleData = () => {
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

      const map = new maplibregl.Map({
        container: host,
        style: VOYAGER,
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

      map.on("load", handleLoad);
      map.on("styledata", handleStyleData);
      map.on("webglcontextlost", handleContextLost);
      map.on("webglcontextrestored", handleContextRestored);

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
        map.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div className="map-host">
      <div ref={mapFillRef} className="map-fill" />
    </div>
  );
}
