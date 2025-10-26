import React, { useEffect, useRef } from "react";

type LatLngTuple = [number, number];
type BoundsTuple = [LatLngTuple, LatLngTuple];

type FitBoundsOptions = {
  padding?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  duration?: number;
};

type LeafletMap = {
  setView: (center: LatLngTuple, zoom: number) => LeafletMap;
  fitBounds: (bounds: BoundsTuple, options?: FitBoundsOptions) => LeafletMap;
  setMaxBounds: (bounds: BoundsTuple) => LeafletMap;
  remove: () => void;
  invalidateSize: () => LeafletMap;
};

type LeafletTileLayer = {
  addTo: (map: LeafletMap) => LeafletTileLayer;
  remove: () => void;
  setUrl: (url: string) => LeafletTileLayer;
};

type LeafletModule = {
  map: (container: HTMLDivElement, options: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => LeafletTileLayer;
};

type WorldMapProps = {
  center: [number, number];
  zoom: number;
  provider?: string;
  className?: string;
};

const TILE_PROVIDERS: Record<string, string> = {
  osm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
};

const DEFAULT_PROVIDER = "osm";
const LEAFLET_SCRIPT = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_STYLES = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

const WORLD_BOUNDS: BoundsTuple = [
  [-85, -180],
  [85, 180]
];

const PORTRAIT_BOUNDS: BoundsTuple = [
  [-60, -170],
  [75, 170]
];

const PORTRAIT_PADDING: NonNullable<FitBoundsOptions["padding"]> = {
  top: 40,
  bottom: 40,
  left: 8,
  right: 8
};

const TILE_LAYER_OPTIONS: Record<string, unknown> = {
  minZoom: 1,
  maxZoom: 18,
  detectRetina: true,
  crossOrigin: true,
  noWrap: true,
  bounds: WORLD_BOUNDS
};

let leafletPromise: Promise<LeafletModule> | null = null;

const ensureLeaflet = (): Promise<LeafletModule> => {
  if (leafletPromise) {
    return leafletPromise;
  }
  leafletPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Leaflet requires a browser environment"));
      return;
    }

    const existing = (window as unknown as { L?: LeafletModule }).L;
    if (existing) {
      resolve(existing);
      return;
    }

    if (!document.querySelector("link[data-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_STYLES;
      link.setAttribute("data-leaflet", "true");
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = LEAFLET_SCRIPT;
    script.async = true;
    script.onload = () => {
      const globalLeaflet = (window as unknown as { L?: LeafletModule }).L;
      if (globalLeaflet) {
        resolve(globalLeaflet);
      } else {
        reject(new Error("Leaflet script loaded but global L is undefined"));
      }
    };
    script.onerror = () => reject(new Error("No se pudo cargar Leaflet"));
    document.head.appendChild(script);
  });

  return leafletPromise;
};

export const WorldMap: React.FC<WorldMapProps> = ({ provider = DEFAULT_PROVIDER, className }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LeafletTileLayer | null>(null);
  const moduleRef = useRef<LeafletModule | null>(null);

  useEffect(() => {
    let cancelled = false;

    const mount = async () => {
      try {
        const leaflet = await ensureLeaflet();
        if (cancelled || mapRef.current || !containerRef.current) {
          return;
        }
        moduleRef.current = leaflet;
        const map = leaflet.map(containerRef.current, {
          zoomControl: false,
          dragging: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          touchZoom: false,
          boxZoom: false,
          keyboard: false,
          attributionControl: false,
          maxBoundsViscosity: 1
        });
        mapRef.current = map;

        const tileUrl = TILE_PROVIDERS[provider] ?? TILE_PROVIDERS[DEFAULT_PROVIDER];
        const layer = leaflet.tileLayer(tileUrl, TILE_LAYER_OPTIONS);
        layer.addTo(map);
        layerRef.current = layer;

        map.setMaxBounds(WORLD_BOUNDS);
        map.fitBounds(PORTRAIT_BOUNDS, {
          padding: PORTRAIT_PADDING,
          duration: 0
        });
        window.setTimeout(() => map.invalidateSize(), 0);
      } catch (error) {
        console.error(error);
      }
    };

    void mount();

    return () => {
      cancelled = true;
      layerRef.current?.remove();
      layerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = moduleRef.current;
    const map = mapRef.current;
    if (!leaflet || !map) {
      return;
    }
    const tileUrl = TILE_PROVIDERS[provider] ?? TILE_PROVIDERS[DEFAULT_PROVIDER];
    if (!layerRef.current) {
      const layer = leaflet.tileLayer(tileUrl, TILE_LAYER_OPTIONS);
      layer.addTo(map);
      layerRef.current = layer;
      return;
    }
    layerRef.current.setUrl(tileUrl);
  }, [provider]);

  return <div ref={containerRef} className={`map-container${className ? ` ${className}` : ""}`} />;
};
