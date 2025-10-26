import { useEffect, useMemo, useRef, useState } from "react";
import type { MapInstance, StyleSpecification } from "../types/maplibre-gl";
import { loadMapLibre } from "../utils/loadMapLibre";

type GeoScopeMapProps = {
  className?: string;
  center?: [number, number];
  zoom?: number;
};

const CDN_STYLE: StyleSpecification = {
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
    { id: "osm", type: "raster", source: "osm" }
  ]
};

export const GeoScopeMap = ({ className, center, zoom = 1.6 }: GeoScopeMapProps): JSX.Element => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const [lng, lat] = useMemo(() => center ?? [0, 20], [center]);

  useEffect(() => {
    const container = mapContainer.current;
    if (!container) {
      return () => {
        /* noop */
      };
    }

    let disposed = false;
    let map: MapInstance | null = null;

    setIsReady(false);
    setError(null);

    const initialize = async () => {
      try {
        const maplibre = await loadMapLibre();
        if (disposed || !mapContainer.current) {
          return;
        }

        map = new maplibre.Map({
          container: mapContainer.current,
          style: CDN_STYLE,
          center: [lng, lat],
          zoom,
          bearing: 0,
          pitch: 0,
          interactive: false,
          attributionControl: false
        });

        mapRef.current = map;
        setIsReady(true);
        setError(null);
      } catch (err) {
        console.error(err);
        if (!disposed) {
          setError(err instanceof Error ? err.message : "No se pudo cargar el mapa");
        }
      }
    };

    initialize();

    const handleResize = () => {
      mapRef.current?.resize();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      mapRef.current?.remove();
      mapRef.current = null;
      map = null;
    };
  }, [lat, lng, zoom]);

  return (
    <div className={["world-map", className].filter(Boolean).join(" ")}> 
      <div ref={mapContainer} className="world-map__canvas" aria-hidden="true" />
      <div className="absolute bottom-1 right-2 text-[10px] text-white/50">
        © OpenStreetMap contributors
      </div>
      {error ? (
        <div className="world-map__overlay" role="alert">
          <div className="world-map__overlay-card">
            <p>No se pudo cargar el mapa global.</p>
            <p className="world-map__overlay-hint">{error}</p>
          </div>
        </div>
      ) : null}
      {!error && !isReady ? (
        <div className="world-map__overlay" aria-live="polite">
          <div className="world-map__overlay-card">
            <p>Cargando el mapa global…</p>
            <p className="world-map__overlay-hint">Conectando con MapLibre</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default GeoScopeMap;
