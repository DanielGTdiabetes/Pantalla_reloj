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
      tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors, © CARTO"
    }
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }]
} satisfies StyleSpecification;

export default function GeoScopeMap() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapFillRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const registryRef = useRef<LayerRegistry | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);

  useEffect(() => {
    const host = mapFillRef.current;
    if (!host) return;

    const defaultView = { center: [0, 0] as maplibregl.LngLatLike, zoom: 2 };
    const worldBounds: maplibregl.LngLatBoundsLike = [
      [-180, -85],
      [180, 85]
    ];

    const safeFit = (map: maplibregl.Map, hostElement: HTMLDivElement | null) => {
      if (!hostElement) return;

      const { width, height } = hostElement.getBoundingClientRect();
      if (width <= 0 || height <= 0) {
        return;
      }

      map.resize();
      map.jumpTo(defaultView);

      try {
        map.fitBounds(worldBounds, { padding: 24, animate: false });
      } catch (error) {
        console.warn("[map] safeFit fallback", error);
        map.jumpTo(defaultView);
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
      const container = mapFillRef.current;
      if (mapRef.current || !container) {
        return;
      }

      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) {
        return;
      }

      const map = new maplibregl.Map({
        container,
        style: VOYAGER,
        center: defaultView.center,
        zoom: defaultView.zoom,
        pitch: 0,
        bearing: 0,
        interactive: false,
        attributionControl: false,
        renderWorldCopies: false,
        maxBounds: worldBounds
      });

      mapRef.current = map;

      map.on("load", () => {
        mapReadyRef.current = true;
        map.setRenderWorldCopies(false);
        safeFit(map, mapFillRef.current);
        initLayers(map);
      });
    };

    resizeObserverRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];
      const { width, height } = entry?.contentRect ?? host.getBoundingClientRect();

      if (width <= 0 || height <= 0) {
        return;
      }

      if (!mapRef.current) {
        ensureMap();
        return;
      }

      if (mapReadyRef.current && mapFillRef.current) {
        safeFit(mapRef.current, mapFillRef.current);
      } else {
        mapRef.current.resize();
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

  return (
    <div ref={hostRef} className="map-host">
      <div ref={mapFillRef} className="map-fill" />
    </div>
  );
}
