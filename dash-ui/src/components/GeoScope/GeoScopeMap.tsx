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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const map = new maplibregl.Map({
      container: host,
      style: VOYAGER,
      center: [0, 0],
      zoom: 1,
      interactive: false,
      renderWorldCopies: true
    });

    const fitWorld = () => {
      const aside = document.querySelector("aside") as HTMLElement | null;
      const rect = host.getBoundingClientRect();

      const W = Math.max(0, rect.width);
      const H = Math.max(0, rect.height);

      const basePad = 10;
      const rightAside = aside ? aside.offsetWidth : 0;

      const maxHorizontalPad = Math.max(0, W - 60);
      const maxVerticalPad = Math.max(0, H - 60);

      const padLeft = Math.min(basePad, maxHorizontalPad);
      const padRight = Math.min(rightAside + basePad, Math.max(0, maxHorizontalPad - padLeft));
      const padTop = Math.min(basePad, maxVerticalPad);
      const padBottom = Math.min(basePad, Math.max(0, maxVerticalPad - padTop));

      const tooSmall =
        W < 120 ||
        H < 120 ||
        padLeft + padRight >= W ||
        padTop + padBottom >= H;

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
    };

    const onStyleReady = (cb: () => void) => {
      if (map.isStyleLoaded()) cb();
      else map.once("load", cb);
    };

    onStyleReady(() => {
      fitWorld();

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

      resizeObserverRef.current = new ResizeObserver(() => {
        map.resize();
        fitWorld();
      });
      resizeObserverRef.current.observe(host);
    });

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      registryRef.current?.destroy();
      registryRef.current = null;
      map.remove();
    };
  }, []);

  return <div ref={hostRef} className="w-full h-full" />;
}
