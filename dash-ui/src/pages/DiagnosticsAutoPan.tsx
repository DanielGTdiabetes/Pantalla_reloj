import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

const ROTATE_INTERVAL_MS = 1500;
const ROTATE_DELTA_DEGREES = 45;

const easeLinear = (t: number) => t;

export const DiagnosticsAutoPan: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const intervalRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

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
      pitch: 20,
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

    const rotate = () => {
      const current = map.getBearing();
      const next = current + ROTATE_DELTA_DEGREES;
      map.easeTo({
        bearing: next,
        duration: ROTATE_INTERVAL_MS,
        easing: easeLinear
      });
      map.triggerRepaint();
    };

    const startRotation = () => {
      rotate();
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current);
      }
      intervalRef.current = window.setInterval(() => {
        rotate();
      }, ROTATE_INTERVAL_MS);
    };

    const handleLoad = () => {
      startRotation();
    };

    map.once("load", handleLoad);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        map.resize();
        map.triggerRepaint();
      });
      observer.observe(container);
      resizeObserverRef.current = observer;
    }

    return () => {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      const observer = resizeObserverRef.current;
      if (observer) {
        observer.disconnect();
        resizeObserverRef.current = null;
      }

      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="diagnostics-auto-pan">
      <div className="diagnostics-auto-pan__map" ref={containerRef} />
    </div>
  );
};

export default DiagnosticsAutoPan;
