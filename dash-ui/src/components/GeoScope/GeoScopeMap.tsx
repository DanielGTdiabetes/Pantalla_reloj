import maplibregl from "maplibre-gl";
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
} as const;

export default function GeoScopeMap() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const registryRef = useRef<LayerRegistry | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const map = new maplibregl.Map({
      container: hostRef.current,
      style: VOYAGER,
      center: [0, 0],
      zoom: 1,
      interactive: false,
      renderWorldCopies: true
    });
    mapRef.current = map;

    function fitWorld() {
      const aside = document.querySelector("aside") as HTMLElement | null;
      const rightPad = aside ? aside.offsetWidth : 0;
      map.setPadding({ top: 10, left: 10, bottom: 10, right: rightPad + 10 });
      map.fitBounds(
        [
          [-180, -60],
          [180, 85]
        ],
        { animate: false }
      );
    }

    map.on("load", fitWorld);

    const registry = new LayerRegistry(map);
    registryRef.current = registry;
    registry.add(new WeatherLayer({ enabled: false }));
    registry.add(new CyclonesLayer({ enabled: false }));
    registry.add(new ShipsLayer({ enabled: false }));
    registry.add(new AircraftLayer({ enabled: false }));
    registry.add(new LightningLayer({ enabled: true }));

    roRef.current = new ResizeObserver(() => {
      map.resize();
      fitWorld();
    });
    roRef.current.observe(hostRef.current);

    return () => {
      roRef.current?.disconnect();
      registry.destroy();
      map.remove();
    };
  }, []);

  return <div ref={hostRef} className="w-full h-full" />;
}
