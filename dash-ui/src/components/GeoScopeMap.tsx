import { useEffect, useMemo, useRef, useState } from "react";

import maplibregl, { type Map as MapInstance, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type GeoScopeMapProps = {
  className?: string;
  center?: [number, number];
  zoom?: number;
};

const STYLE: StyleSpecification = {
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
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm"
    }
  ]
};

export const GeoScopeMap = ({ className, center, zoom = 1.6 }: GeoScopeMapProps): JSX.Element => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const [lng, lat] = useMemo(() => {
    const [cx, cy] = center ?? [0, 20];
    return [cx, cy];
  }, [center?.[0], center?.[1]]);

  useEffect(() => {
    const container = mapContainer.current;
    if (!container) {
      return undefined;
    }

    setError(null);
    setIsReady(false);

    let disposed = false;
    const map = new maplibregl.Map({
      container,
      style: STYLE,
      center: [lng, lat],
      zoom,
      bearing: 0,
      pitch: 0,
      interactive: false,
      attributionControl: false
    });

    mapRef.current = map;

    const handleLoad = () => {
      if (!disposed) {
        setIsReady(true);
        map.setRenderWorldCopies(false);
      }
    };

    const handleError = (event: unknown) => {
      if (!disposed) {
        const message = event instanceof Error ? event.message : "No se pudo cargar el mapa";
        setError(message);
      }
    };

    map.once("load", handleLoad);
    map.on("error", handleError);

    const handleResize = () => {
      mapRef.current?.resize();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      map.off("error", handleError);
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom]);

  const classes = useMemo(() => {
    return ["geo-scope-map", className].filter(Boolean).join(" ");
  }, [className]);

  return (
    <div className={classes}>
      {error ? (
        <div className="geo-scope-map__fallback" role="alert">
          <p>No se pudo cargar el mapa global.</p>
          <p className="geo-scope-map__hint">{error}</p>
        </div>
      ) : (
        <>
          <div ref={mapContainer} className="geo-scope-map__canvas" aria-hidden={!isReady} />
          <div className="geo-scope-map__attribution">© OpenStreetMap contributors</div>
        </>
      )}
    </div>
  );
};

export default GeoScopeMap;
