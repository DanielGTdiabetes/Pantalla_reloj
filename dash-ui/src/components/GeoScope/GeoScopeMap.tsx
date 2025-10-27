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

export default function GeoScopeMap() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const registryRef = useRef<LayerRegistry | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const safeFit = (map: maplibregl.Map, hostElement: HTMLDivElement) => {
      const rect = hostElement.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      console.log("[GeoScopeMap] safeFit -> host", { width, height });

      if (width < 120 || height < 120) {
        map.setPadding(0);
        map.jumpTo({ center: [0, 0], zoom: 1 });
        console.log("[GeoScopeMap] safeFit fallback: host too small");
        return;
      }

      map.setPadding({ top: 8, left: 8, right: 8, bottom: 8 });

      try {
        map.fitBounds(
          [
            [-180, -60],
            [180, 85]
          ],
          { animate: false }
        );
      } catch (error) {
        console.warn("[GeoScopeMap] safeFit fitBounds failed, using jumpTo fallback", error);
        map.setPadding(0);
        map.jumpTo({ center: [0, 0], zoom: 1 });
        console.log("[GeoScopeMap] safeFit fallback: fitBounds error");
      }
    };

    const initLayers = (map: maplibregl.Map) => {
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

    const ensureMap = () => {
      if (mapRef.current || !hostRef.current) {
        return;
      }

      const rect = hostRef.current.getBoundingClientRect();
      const { width, height } = rect;
      console.log("[GeoScopeMap] measuring host before map init", { width, height });

      if (width <= 0 || height <= 0) {
        console.log("[GeoScopeMap] host size is zero, delaying map creation");
        return;
      }

      const map = new maplibregl.Map({
        container: hostRef.current,
        style: VOYAGER,
        center: [0, 0],
        zoom: 1,
        interactive: false,
        renderWorldCopies: true
      });

      mapRef.current = map;
      console.log("[GeoScopeMap] map instance created");

      map.on("load", () => {
        console.log("[GeoScopeMap] map loaded");
        mapReadyRef.current = true;
        safeFit(map, hostRef.current!);
        initLayers(map);
      });
    };

    resizeObserverRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];
      const { width, height } = entry?.contentRect ?? host.getBoundingClientRect();
      console.log("[GeoScopeMap] resize", { width, height });

      if (!mapRef.current) {
        ensureMap();
        return;
      }

      mapRef.current.resize();
      if (mapReadyRef.current && hostRef.current) {
        safeFit(mapRef.current, hostRef.current);
      }
    });

    resizeObserverRef.current.observe(host);
    ensureMap();

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      registryRef.current?.destroy();
      registryRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

  return <div ref={hostRef} className="w-full h-full block min-h-[240px]" />;
}
