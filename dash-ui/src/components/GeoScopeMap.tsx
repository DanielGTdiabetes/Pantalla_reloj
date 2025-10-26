import { useEffect, useMemo, useRef, useState } from "react";

import loadMapLibre, { type MapInstance, type StyleSpecification } from "maplibre-gl";

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
      map?.remove();
      map = null;
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
        <div
          ref={mapContainer}
          className="geo-scope-map__canvas"
          aria-hidden={!isReady}
          data-ready={isReady}
        />
      )}
    </div>
  );
};

export default GeoScopeMap;
