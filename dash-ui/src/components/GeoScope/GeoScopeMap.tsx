import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

import AircraftLayer from "./layers/AircraftLayer";
import CyclonesLayer from "./layers/CyclonesLayer";
import { LayerRegistry } from "./layers/LayerRegistry";
import LightningLayer from "./layers/LightningLayer";
import ShipsLayer from "./layers/ShipsLayer";
import WeatherLayer from "./layers/WeatherLayer";

const VOYAGER = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors, © CARTO"
    }
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }]
} satisfies StyleSpecification;

const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-180, -60],
  [180, 85]
];

const MIN_DIMENSION = 120;
const SAFE_PADDING = 8;

export default function GeoScopeMap() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const registryRef = useRef<LayerRegistry | null>(null);
  const mapReadyRef = useRef(false);
  const lastRectRef = useRef<DOMRectReadOnly | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let destroyed = false;

    const resetView = (map: maplibregl.Map) => {
      map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
      map.jumpTo({ center: [0, 0], zoom: 1 });
    };

    const safeFit = (rect: DOMRectReadOnly) => {
      const map = mapRef.current;
      if (!map) return;

      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      console.log(`[GeoScopeMap] host size: ${width}x${height}`);

      if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
        console.log(`[GeoScopeMap] safeFit fallback: host too small (${width}x${height})`);
        resetView(map);
        return;
      }

      map.setPadding({ top: SAFE_PADDING, right: SAFE_PADDING, bottom: SAFE_PADDING, left: SAFE_PADDING });

      try {
        map.fitBounds(WORLD_BOUNDS, { animate: false });
      } catch (error) {
        console.warn("[GeoScopeMap] safeFit fallback via jumpTo", error);
        resetView(map);
      }
    };

    const attachLayers = (map: maplibregl.Map) => {
      registryRef.current?.destroy();

      const registry = new LayerRegistry(map);
      registryRef.current = registry;

      const layers = [
        new WeatherLayer({ enabled: false }),
        new CyclonesLayer({ enabled: false }),
        new ShipsLayer({ enabled: false }),
        new AircraftLayer({ enabled: false }),
        new LightningLayer({ enabled: true })
      ];

      for (const layer of layers) {
        try {
          registry.add(layer);
        } catch (error) {
          console.warn(`[GeoScopeMap] Failed to register layer ${layer.id}`, error);
        }
      }
    };

    const initializeMap = (rect: DOMRectReadOnly) => {
      if (mapRef.current || destroyed) {
        return;
      }
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      console.log(
        `[GeoScopeMap] initializing map (${Math.round(rect.width)}x${Math.round(rect.height)})`
      );

      const map = new maplibregl.Map({
        container: host,
        style: VOYAGER,
        center: [0, 0],
        zoom: 1,
        interactive: false,
        renderWorldCopies: true
      });

      mapRef.current = map;
      mapReadyRef.current = false;

      map.on("load", () => {
        if (destroyed) {
          return;
        }

        mapReadyRef.current = true;
        console.log("[GeoScopeMap] map loaded");

        if (lastRectRef.current) {
          safeFit(lastRectRef.current);
        }

        attachLayers(map);
      });
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== host) {
          continue;
        }

        const rect = entry.contentRect;
        lastRectRef.current = rect;
        console.log(
          `[GeoScopeMap] resize event: ${Math.round(rect.width)}x${Math.round(rect.height)}`
        );

        if (!mapRef.current) {
          initializeMap(rect);
        }

        const map = mapRef.current;
        if (map) {
          map.resize();
          if (mapReadyRef.current) {
            safeFit(rect);
          }
        }
      }
    });

    observer.observe(host);
    observerRef.current = observer;

    const initialRect = host.getBoundingClientRect();
    lastRectRef.current = initialRect;
    if (!mapRef.current && initialRect.width > 0 && initialRect.height > 0) {
      initializeMap(initialRect);
    }

    return () => {
      destroyed = true;
      observer.disconnect();
      observerRef.current = null;

      registryRef.current?.destroy();
      registryRef.current = null;

      mapRef.current?.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

  return <div ref={hostRef} className="w-full h-full block min-h-[240px]" />;
}
