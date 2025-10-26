import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

const VOYAGER: StyleSpecification = {
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
      attribution:
        '© OpenStreetMap contributors, © <a href="https://carto.com/attributions">CARTO</a>'
    }
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }]
};

const OSM_FALLBACK: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }]
};

const FALLBACK_TIMEOUT = 8000;

function GeoScopeMap(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    let style: StyleSpecification = VOYAGER;

    try {
      // Voyager es el estilo principal; MapLibre gestionará errores de tiles automáticamente.
      style = VOYAGER;
    } catch {
      style = OSM_FALLBACK;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [0, 20],
      zoom: 2.2,
      bearing: 0,
      pitch: 0,
      interactive: false,
      renderWorldCopies: true,
      preserveDrawingBuffer: false
    });

    mapRef.current = map;

    const updatePadding = () => {
      const aside = document.querySelector("aside");
      const padRight = aside instanceof HTMLElement ? aside.offsetWidth : 0;
      map.setPadding({ top: 0, right: padRight, bottom: 0, left: 0 });
    };

    updatePadding();

    map.once("load", () => {
      updatePadding();
      map.resize();
    });

    const handleResize = () => {
      updatePadding();
      map.resize();
    };

    if (typeof ResizeObserver !== "undefined") {
      resizeObserverRef.current = new ResizeObserver(handleResize);
      resizeObserverRef.current.observe(containerRef.current);
    } else {
      window.addEventListener("resize", handleResize);
    }

    fallbackTimerRef.current = window.setTimeout(() => {
      if (mapRef.current && !map.areTilesLoaded()) {
        mapRef.current.setStyle(OSM_FALLBACK);
        mapRef.current.once("styledata", () => {
          updatePadding();
          mapRef.current?.resize();
        });
      }
    }, FALLBACK_TIMEOUT);

    return () => {
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      } else {
        window.removeEventListener("resize", handleResize);
      }

      mapRef.current = null;
      map.remove();
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
      <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-white/50">
        © OpenStreetMap contributors · © CARTO
      </div>
    </div>
  );
}

export { GeoScopeMap };
export default GeoScopeMap;
