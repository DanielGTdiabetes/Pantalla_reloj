import { useEffect, useRef } from "react";

type MapPadding = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type MapOptions = {
  container: HTMLDivElement;
  style: string;
  renderWorldCopies: boolean;
  interactive: boolean;
  attributionControl: boolean;
  pitchWithRotate: boolean;
  dragRotate: boolean;
};

type MapInstance = {
  fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: MapPadding; duration?: number }) => void;
  isStyleLoaded: () => boolean;
  once: (event: string, handler: () => void) => void;
  resize: () => void;
  remove: () => void;
};

type MapLibreModule = {
  Map: new (options: MapOptions) => MapInstance;
};

type WorldMapProps = {
  className?: string;
};

const MAP_CONTAINER_ID = "map";
const MAP_STYLE_URL = "http://127.0.0.1:8081/static/style.json";
const MAPLIBRE_SCRIPT = "https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js";
const MAPLIBRE_STYLES = "https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.css";
const SOUTH_WEST: [number, number] = [-170, -60];
const NORTH_EAST: [number, number] = [170, 75];
const PORTRAIT_PADDING: MapPadding = { top: 40, bottom: 40, left: 8, right: 8 };

let mapLibrePromise: Promise<MapLibreModule> | null = null;

const ensureMapLibre = (): Promise<MapLibreModule> => {
  if (mapLibrePromise) {
    return mapLibrePromise;
  }

  mapLibrePromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("MapLibre requires a browser environment"));
      return;
    }

    const existing = (window as unknown as { maplibregl?: MapLibreModule }).maplibregl;
    if (existing) {
      resolve(existing);
      return;
    }

    if (!document.querySelector("link[data-maplibre]") && !document.getElementById("maplibre-gl-css")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MAPLIBRE_STYLES;
      link.id = "maplibre-gl-css";
      link.setAttribute("data-maplibre", "true");
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = MAPLIBRE_SCRIPT;
    script.async = true;
    script.setAttribute("data-maplibre", "true");
    script.onload = () => {
      const globalMapLibre = (window as unknown as { maplibregl?: MapLibreModule }).maplibregl;
      if (globalMapLibre) {
        resolve(globalMapLibre);
      } else {
        reject(new Error("MapLibre script loaded but global maplibregl is undefined"));
      }
    };
    script.onerror = () => reject(new Error("No se pudo cargar MapLibre"));
    document.head.appendChild(script);
  });

  return mapLibrePromise;
};

export const WorldMap = ({ className }: WorldMapProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let mapInstance: MapInstance | null = null;
    let resizeListener: (() => void) | undefined;

    const fitWorldBounds = () => {
      if (cancelled) {
        return;
      }
      mapInstance?.fitBounds([SOUTH_WEST, NORTH_EAST], {
        padding: PORTRAIT_PADDING,
        duration: 0,
      });
    };

    const mount = async () => {
      try {
        const maplibre = await ensureMapLibre();
        if (cancelled || !containerRef.current) {
          return;
        }

        mapInstance = new maplibre.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          renderWorldCopies: false,
          interactive: false,
          attributionControl: false,
          pitchWithRotate: false,
          dragRotate: false,
        });

        if (mapInstance.isStyleLoaded()) {
          fitWorldBounds();
        } else {
          mapInstance.once("load", fitWorldBounds);
        }

        resizeListener = () => {
          mapInstance?.resize();
          fitWorldBounds();
        };

        window.addEventListener("resize", resizeListener);
      } catch (error) {
        console.error(error);
      }
    };

    void mount();

    return () => {
      cancelled = true;
      if (resizeListener) {
        window.removeEventListener("resize", resizeListener);
      }
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      id={MAP_CONTAINER_ID}
      className={`map-container${className ? ` ${className}` : ""}`}
      role="presentation"
    />
  );
};

export default WorldMap;
