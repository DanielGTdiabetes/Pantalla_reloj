import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

const VOYAGER = {
  version: 8,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '© OpenStreetMap contributors, © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: "carto", type: "raster" as const, source: "carto" }],
};

const OSM_FALLBACK = {
  version: 8,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

export default function GeoScopeMap(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    let fallbackApplied = false;
    const map = new maplibregl.Map({
      container: hostRef.current,
      style: VOYAGER,
      center: [0, 20],
      zoom: 2.2,
      bearing: 0,
      pitch: 0,
      interactive: false,
      renderWorldCopies: true,
      preserveDrawingBuffer: false,
    });

    mapRef.current = map;

    map.on("error", () => {
      if (!fallbackApplied) {
        fallbackApplied = true;
        map.setStyle(OSM_FALLBACK);
      }
    });

    const updatePadding = () => {
      const aside = document.querySelector("aside");
      const padRight = aside instanceof HTMLElement ? aside.offsetWidth : 0;
      map.setPadding({ top: 0, left: 0, bottom: 0, right: padRight });
    };

    updatePadding();

    map.once("load", () => {
      const canvas = map.getCanvas();
      canvas.style.transformOrigin = "center center";
      canvas.style.transform = "scaleX(1.8)";
    });

    const handleResize = () => {
      updatePadding();
      map.resize();

      const ratio = window.innerWidth / window.innerHeight;
      if (ratio > 3.5) {
        map.setZoom(2.3);
      } else {
        map.setZoom(2.0);
      }
    };

    if (typeof ResizeObserver !== "undefined" && hostRef.current) {
      resizeObserverRef.current = new ResizeObserver(handleResize);
      resizeObserverRef.current.observe(hostRef.current);
    } else {
      window.addEventListener("resize", handleResize);
    }

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (typeof ResizeObserver === "undefined") {
        window.removeEventListener("resize", handleResize);
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={hostRef} className="w-full h-full" />
      <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-white/50">
        © OpenStreetMap contributors · © CARTO
      </div>
    </div>
  );
}

export { GeoScopeMap };
