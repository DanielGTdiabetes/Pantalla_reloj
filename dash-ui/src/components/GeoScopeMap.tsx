import { useCallback, useEffect, useRef, useState } from "react";

const VOYAGER_TILE_URL = "https://a.basemaps.cartocdn.com/rastertiles/voyager/0/0/0.png";
const OSM_TILE_URL = "https://tile.openstreetmap.org/0/0/0.png";
const FALLBACK_TIMEOUT = 8000;

function GeoScopeMap(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const [paddingRight, setPaddingRight] = useState(0);
  const [imageSrc, setImageSrc] = useState<string>(VOYAGER_TILE_URL);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const updatePadding = useCallback(() => {
    const aside = document.querySelector("aside");
    const padRight = aside instanceof HTMLElement ? aside.offsetWidth : 0;
    setPaddingRight(padRight);
  }, []);

  useEffect(() => {
    updatePadding();

    const handleResize = () => {
      updatePadding();
    };

    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      resizeObserverRef.current = new ResizeObserver(handleResize);
      resizeObserverRef.current.observe(containerRef.current);
    } else {
      window.addEventListener("resize", handleResize);
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      } else {
        window.removeEventListener("resize", handleResize);
      }
    };
  }, [updatePadding]);

  useEffect(() => {
    let cancelled = false;

    const preload = new Image();
    preload.onload = () => {
      if (!cancelled) {
        setImageSrc(VOYAGER_TILE_URL);
        clearFallbackTimer();
      }
    };
    preload.onerror = () => {
      if (!cancelled) {
        setImageSrc(OSM_TILE_URL);
        clearFallbackTimer();
      }
    };
    preload.src = VOYAGER_TILE_URL;

    fallbackTimerRef.current = window.setTimeout(() => {
      if (!cancelled) {
        setImageSrc(OSM_TILE_URL);
      }
    }, FALLBACK_TIMEOUT);

    return () => {
      cancelled = true;
      clearFallbackTimer();
    };
  }, [clearFallbackTimer]);

  const handleImageError = useCallback(() => {
    setImageSrc((current) => (current === OSM_TILE_URL ? current : OSM_TILE_URL));
    clearFallbackTimer();
  }, [clearFallbackTimer]);

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
        style={{ paddingRight: `${paddingRight}px` }}
      >
        <img
          src={imageSrc}
          alt="Mapa mundial"
          className="pointer-events-none h-full w-full select-none object-cover brightness-[0.75]"
          onError={handleImageError}
          draggable={false}
        />
      </div>
      <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-white/50">
        © OpenStreetMap contributors · © CARTO
      </div>
    </div>
  );
}

export { GeoScopeMap };
export default GeoScopeMap;
