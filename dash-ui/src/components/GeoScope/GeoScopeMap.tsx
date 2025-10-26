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
      const host = hostRef.current;
      if (!host) return;

      const aside = document.querySelector("aside") as HTMLElement | null;
      const rect = host.getBoundingClientRect();

      const width = Math.max(0, rect.width);
      const height = Math.max(0, rect.height);

      const basePad = 10;
      const rightAside = aside ? aside.offsetWidth : 0;

      const maxHorizontalPad = Math.max(0, width - 60);
      const maxVerticalPad = Math.max(0, height - 60);

      const padLeft = Math.min(basePad, maxHorizontalPad);
      const padRight = Math.min(rightAside + basePad, Math.max(0, maxHorizontalPad - padLeft));
      const padTop = Math.min(basePad, maxVerticalPad);
      const padBottom = Math.min(basePad, Math.max(0, maxVerticalPad - padTop));

      const paddingWidth = padLeft + padRight;
      const paddingHeight = padTop + padBottom;
      const tooSmall =
        width < 120 ||
        height < 120 ||
        paddingWidth >= width ||
        paddingHeight >= height;

      const resetView = () => {
        map.setPadding({ top: 0, left: 0, bottom: 0, right: 0 });
        map.jumpTo({ center: [0, 0], zoom: 1 });
      };

      if (tooSmall) {
        resetView();
        return;
      }

      map.setPadding({ top: padTop, left: padLeft, bottom: padBottom, right: padRight });

      const world: [[number, number], [number, number]] = [
        [-180, -60],
        [180, 85]
      ];

      try {
        map.fitBounds(world, { animate: false });
      } catch (error) {
        console.warn("[GeoScopeMap] fitBounds failed, falling back to jumpTo", error);
        resetView();
      }
    }

    function onStyleReady(cb: () => void) {
      if (map.isStyleLoaded()) cb();
      else map.once("load", cb);
    }

    onStyleReady(() => {
      fitWorld();

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
      if (hostRef.current) {
        roRef.current.observe(hostRef.current);
      }
    });

    return () => {
      roRef.current?.disconnect();
      registryRef.current?.destroy();
      map.remove();
    };
  }, []);

  return <div ref={hostRef} className="w-full h-full" />;
}
