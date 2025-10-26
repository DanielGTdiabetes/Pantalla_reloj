import { useEffect, useMemo, useRef, useState } from "react";

type GeoScopeMapProps = {
  className?: string;
  center?: [number, number];
  zoom?: number;
};

const STATIC_MAP_BASE_URL = "https://staticmap.openstreetmap.de/staticmap.php";
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;
const MIN_LAT = -85;
const MAX_LAT = 85;
const MIN_LNG = -180;
const MAX_LNG = 180;
const MAX_DIMENSION = 1280;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

export const GeoScopeMap = ({ className, center, zoom = 1.6 }: GeoScopeMapProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 600, height: 900 });

  const [lng, lat] = useMemo(() => {
    const [cx, cy] = center ?? [0, 20];
    const safeLng = clamp(cx, MIN_LNG, MAX_LNG);
    const safeLat = clamp(cy, MIN_LAT, MAX_LAT);
    return [safeLng, safeLat];
  }, [center?.[0], center?.[1]]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const updateSize = (rect: DOMRectReadOnly | DOMRect) => {
      const { width, height } = rect;
      if (width === 0 || height === 0) {
        return;
      }

      setDimensions((prev) => {
        const nextWidth = clamp(Math.round(width), 200, MAX_DIMENSION);
        const nextHeight = clamp(Math.round(height), 200, MAX_DIMENSION);
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }

        return { width: nextWidth, height: nextHeight };
      });
    };

    updateSize(container.getBoundingClientRect());

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      updateSize(entry.contentRect);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setError(null);
    setIsReady(false);
  }, [lat, lng, zoom, dimensions.width, dimensions.height]);

  const staticMapUrl = useMemo(() => {
    const zoomLevel = clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
    const { width, height } = dimensions;
    const sizeParam = `${width}x${height}`;
    const markerParam = `${lat},${lng},lightblue1`;

    const query = new URLSearchParams({
      center: `${lat},${lng}`,
      zoom: String(zoomLevel),
      size: sizeParam,
      maptype: "mapnik",
      markers: markerParam
    });

    return `${STATIC_MAP_BASE_URL}?${query.toString()}`;
  }, [dimensions, lat, lng, zoom]);

  const handleImageLoad = () => {
    setIsReady(true);
  };

  const handleImageError = () => {
    setError("No se pudo cargar el mapa");
  };

  const classes = useMemo(() => {
    return ["geo-scope-map", className].filter(Boolean).join(" ");
  }, [className]);

  return (
    <div ref={containerRef} className={classes}>
      {error ? (
        <div className="geo-scope-map__fallback" role="alert">
          <p>No se pudo cargar el mapa global.</p>
          <p className="geo-scope-map__hint">{error}</p>
        </div>
      ) : (
        <>
          <img
            key={staticMapUrl}
            src={staticMapUrl}
            alt="Mapa global con la posición seleccionada"
            className="geo-scope-map__image"
            onLoad={handleImageLoad}
            onError={handleImageError}
            aria-hidden={!isReady}
          />
          <div className="geo-scope-map__attribution">© OpenStreetMap contributors</div>
        </>
      )}
    </div>
  );
};

export default GeoScopeMap;
