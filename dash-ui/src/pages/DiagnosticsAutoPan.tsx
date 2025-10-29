import maplibregl from "maplibre-gl";
import type { MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import { kioskRuntime } from "../lib/runtimeFlags";

const ROTATE_DELTA_DEGREES = 0.05;
const FRAME_MIN_INTERVAL_MS = 1000 / 60;
const WATCHDOG_INTERVAL_MS = 1500;
const WATCHDOG_TICK_MS = 500;
const WATCHDOG_BEARING_DELTA = 1.5;
const LOG_INTERVAL_MS = 2000;

export const DiagnosticsAutoPan: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastLogRef = useRef<number>(0);
  const [bearingDisplay, setBearingDisplay] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const map = new maplibregl.Map({
      container,
      style: "https://demotiles.maplibre.org/style.json",
      center: [0, 20],
      zoom: 2.4,
      pitch: 25,
      bearing: 0,
      interactive: false,
      attributionControl: false,
      renderWorldCopies: true,
      dragRotate: false,
      dragPan: false,
      keyboard: false,
      boxZoom: false,
      doubleClickZoom: false,
      touchPitch: false,
      touchZoomRotate: false
    });

    mapRef.current = map;

    const logBearing = (bearing: number, timestamp: number) => {
      if (!lastLogRef.current) {
        lastLogRef.current = timestamp;
      }
      if (timestamp - lastLogRef.current >= LOG_INTERVAL_MS) {
        lastLogRef.current = timestamp;
        setBearingDisplay(bearing);
        console.log(`[diagnostics:auto-pan] bearing=${bearing.toFixed(2)}`);
      }
    };

    const step = (timestamp: number) => {
      const mapInstance = mapRef.current;
      if (!mapInstance) {
        animationFrameRef.current = null;
        return;
      }

      const lastFrame = lastFrameRef.current ?? timestamp - FRAME_MIN_INTERVAL_MS;
      const delta = timestamp - lastFrame;
      if (delta >= FRAME_MIN_INTERVAL_MS) {
        const nextBearing = mapInstance.getBearing() + ROTATE_DELTA_DEGREES;
        mapInstance.jumpTo({ bearing: nextBearing });
        mapInstance.triggerRepaint();
        lastFrameRef.current = timestamp;
        logBearing(nextBearing, timestamp);
      }

      animationFrameRef.current = requestAnimationFrame(step);
    };

    const ensureAnimationFrame = () => {
      if (animationFrameRef.current == null) {
        animationFrameRef.current = requestAnimationFrame(step);
      }
    };

    const ensureWatchdog = () => {
      if (watchdogRef.current != null) {
        return;
      }
      watchdogRef.current = window.setInterval(() => {
        const mapInstance = mapRef.current;
        if (!mapInstance) {
          return;
        }
        const now = performance.now();
        const lastFrame = lastFrameRef.current;
        if (!lastFrame || now - lastFrame >= WATCHDOG_INTERVAL_MS) {
          const nextBearing = mapInstance.getBearing() + WATCHDOG_BEARING_DELTA;
          mapInstance.jumpTo({ bearing: nextBearing });
          mapInstance.triggerRepaint();
          lastFrameRef.current = now;
          logBearing(nextBearing, now);
          console.warn(
            `[diagnostics:auto-pan] watchdog jump bearing=${nextBearing.toFixed(2)}`
          );
          ensureAnimationFrame();
        }
      }, WATCHDOG_TICK_MS);
    };

    const start = () => {
      lastLogRef.current = performance.now() - LOG_INTERVAL_MS;
      ensureAnimationFrame();
      ensureWatchdog();
    };

    const handleContextLost = (event: MapLibreEvent & { originalEvent?: WebGLContextEvent }) => {
      event.originalEvent?.preventDefault();
      ensureAnimationFrame();
      ensureWatchdog();
    };

    const handleContextRestored = () => {
      ensureAnimationFrame();
    };

    map.once("load", () => {
      if (kioskRuntime.isMotionForced()) {
        console.info("[diagnostics:auto-pan] forcing animation (kiosk override)");
      }
      start();
    });
    map.on("webglcontextlost", handleContextLost);
    map.on("webglcontextrestored", handleContextRestored);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        map.resize();
        map.triggerRepaint();
      });
      observer.observe(container);
      resizeObserverRef.current = observer;
    }

    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (watchdogRef.current != null) {
        window.clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }

      const observer = resizeObserverRef.current;
      if (observer) {
        observer.disconnect();
        resizeObserverRef.current = null;
      }

      map.off("webglcontextlost", handleContextLost);
      map.off("webglcontextrestored", handleContextRestored);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="diagnostics-auto-pan">
      <div className="diagnostics-auto-pan__map" ref={containerRef} />
      <div className="diagnostics-auto-pan__overlay">
        <div className="diagnostics-auto-pan__ticker" aria-live="polite">
          <span className="diagnostics-auto-pan__label">Bearing</span>
          <span className="diagnostics-auto-pan__value">{bearingDisplay.toFixed(1)}°</span>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsAutoPan;
