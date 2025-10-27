import maplibregl from "maplibre-gl";
import type { MapLibreEvent, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

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

const DEFAULT_VIEW = {
  lng: 0,
  zoom: 2.4,
  bearing: 0,
  pitch: 12
};

const MIN_ZOOM = 2.2;
const PAN_SPEED_DEG_PER_SEC = 0.25;

const normalizeLng = (lng: number) => ((lng + 540) % 360) - 180;

export default function GeoScopeMap() {
  const mapFillRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const dprMediaRef = useRef<MediaQueryList | null>(null);
  const viewStateRef = useRef({ ...DEFAULT_VIEW });
  const panSpeedRef = useRef(PAN_SPEED_DEG_PER_SEC);

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
      const { lng, zoom, bearing, pitch } = viewStateRef.current;
      map.jumpTo({
        center: [lng, 0],
        zoom,
        bearing,
        pitch
      });
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

      if (lastFrameTimeRef.current == null) {
        lastFrameTimeRef.current = timestamp;
      }

      const elapsedSeconds = (timestamp - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = timestamp;

      const deltaLng = panSpeedRef.current * elapsedSeconds;
      const nextLng = normalizeLng(viewStateRef.current.lng + deltaLng);
      viewStateRef.current.lng = nextLng;

      map.jumpTo({
        center: [nextLng, 0],
        zoom: viewStateRef.current.zoom,
        bearing: viewStateRef.current.bearing,
        pitch: viewStateRef.current.pitch
      });

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

    const handleContextLost = (event: MapLibreEvent & { originalEvent?: WebGLContextEvent }) => {
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
      const host = await waitForStableSize();
      if (!host || destroyed || mapRef.current) return;

      const map = new maplibregl.Map({
        container: host,
        style: VOYAGER,
        center: [viewStateRef.current.lng, 0],
        zoom: viewStateRef.current.zoom,
        minZoom: MIN_ZOOM,
        pitch: viewStateRef.current.pitch,
        bearing: viewStateRef.current.bearing,
        interactive: false,
        attributionControl: false,
        renderWorldCopies: true,
        trackResize: false
      });

      mapRef.current = map;

      map.on("load", handleLoad);
      map.on("styledata", handleStyleData);
      map.on("webglcontextlost", handleContextLost);
      map.on("webglcontextrestored", handleContextRestored);

      if (host) {
        setupResizeObserver(host);
      }

      if (window.matchMedia) {
        const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        media.addEventListener("change", handleDprChange);
        dprMediaRef.current = media;
      }

      document.addEventListener("visibilitychange", handleVisibilityChange);
    };

    initializeMap();

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
