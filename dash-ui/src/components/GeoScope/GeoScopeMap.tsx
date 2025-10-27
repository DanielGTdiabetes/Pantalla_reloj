import L from "leaflet";
import { useEffect, useRef } from "react";

import AircraftLayer from "./layers/AircraftLayer";
import CyclonesLayer from "./layers/CyclonesLayer";
import { LayerRegistry } from "./layers/LayerRegistry";
import LightningLayer from "./layers/LightningLayer";
import ShipsLayer from "./layers/ShipsLayer";
import WeatherLayer from "./layers/WeatherLayer";

const FALLBACK_CENTER: L.LatLngExpression = [0, 0];
const FALLBACK_ZOOM = 2;

export default function GeoScopeMap() {
  const mapFillRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const registryRef = useRef<LayerRegistry | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const container = mapFillRef.current;
    if (!container) return;

    const createMap = () => {
      if (mapRef.current) return;

      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const map = L.map(container, {
        zoomControl: false,
        attributionControl: true,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        worldCopyJump: false
      });

      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", {
        subdomains: ["a", "b", "c"],
        minZoom: 0,
        maxZoom: 19,
        noWrap: true,
        continuousWorld: false,
        attribution: "© OpenStreetMap contributors, © CARTO"
      }).addTo(map);

      try {
        map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
      } catch (error) {
        console.warn("[GeoScopeMap] Failed to apply initial view, falling back", error);
        map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
      }

      map.invalidateSize();

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

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const { width, height } = entry?.contentRect ?? container.getBoundingClientRect();

      if (width <= 0 || height <= 0) {
        return;
      }

      if (!mapRef.current) {
        createMap();
        return;
      }

      mapRef.current.invalidateSize();
    });

    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    createMap();

    return () => {
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
      registryRef.current?.destroy();
      registryRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="map-host">
      <div ref={mapFillRef} className="map-fill" />
    </div>
  );
}
