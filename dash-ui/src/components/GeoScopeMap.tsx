import { useEffect, useMemo, useRef, useState } from "react";

type TileDefinition = {
  key: string;
  x: number;
  y: number;
  primaryUrl: string;
  fallbackUrl: string;
};

const TILE_SIZE = 256;
const ZOOM_LEVEL = 2;
const TILE_COUNT = 2 ** ZOOM_LEVEL;
const CARTO_HOSTS = ["a", "b", "c"] as const;
const OSM_HOSTS = ["a", "b", "c"] as const;

function buildVoyagerTile(x: number, y: number, hostIndex: number): string {
  const host = CARTO_HOSTS[hostIndex % CARTO_HOSTS.length];
  return `https://${host}.basemaps.cartocdn.com/rastertiles/voyager/${ZOOM_LEVEL}/${x}/${y}.png`;
}

function buildOsmTile(x: number, y: number, hostIndex: number): string {
  const host = OSM_HOSTS[hostIndex % OSM_HOSTS.length];
  return `https://${host}.tile.openstreetmap.org/${ZOOM_LEVEL}/${x}/${y}.png`;
}

function createTileMatrix(): TileDefinition[] {
  const tiles: TileDefinition[] = [];
  const tileTotal = TILE_COUNT;

  for (let y = 0; y < tileTotal; y += 1) {
    for (let x = 0; x < tileTotal; x += 1) {
      const hostIndex = (x + y) % CARTO_HOSTS.length;
      tiles.push({
        key: `${x}-${y}`,
        x,
        y,
        primaryUrl: buildVoyagerTile(x, y, hostIndex),
        fallbackUrl: buildOsmTile(x, y, hostIndex),
      });
    }
  }

  return tiles;
}

export default function GeoScopeMap(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [paddingRight, setPaddingRight] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);

  const tiles = useMemo(() => createTileMatrix(), []);

  useEffect(() => {
    const updateLayout = () => {
      const aside = document.querySelector("aside");
      const padRight = aside instanceof HTMLElement ? aside.offsetWidth : 0;
      setPaddingRight(padRight);

      const ratio = window.innerWidth / Math.max(window.innerHeight, 1);
      setZoomScale(ratio > 3.5 ? 1.15 : 1);
    };

    updateLayout();

    if (typeof ResizeObserver !== "undefined" && hostRef.current) {
      resizeObserverRef.current = new ResizeObserver(updateLayout);
      resizeObserverRef.current.observe(hostRef.current);
    } else {
      window.addEventListener("resize", updateLayout);
    }

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (typeof ResizeObserver === "undefined") {
        window.removeEventListener("resize", updateLayout);
      }
    };
  }, []);

  const baseSize = TILE_SIZE * TILE_COUNT;
  const transform = `translate(-50%, -50%) scaleX(${(1.8 * zoomScale).toFixed(3)}) scaleY(${zoomScale.toFixed(3)})`;

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden"
      style={{ paddingRight: `${paddingRight}px` }}
    >
      <div className="w-full h-full relative">
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: `${baseSize}px`,
            height: `${baseSize}px`,
            transformOrigin: "center center",
            transform,
          }}
        >
          {tiles.map((tile) => (
            <img
              key={tile.key}
              src={tile.primaryUrl}
              data-fallback={tile.fallbackUrl}
              data-tile={`${tile.x}:${tile.y}`}
              alt="World map tile"
              className="absolute"
              loading="lazy"
              style={{
                width: `${TILE_SIZE}px`,
                height: `${TILE_SIZE}px`,
                left: `${tile.x * TILE_SIZE}px`,
                top: `${tile.y * TILE_SIZE}px`,
                imageRendering: "crisp-edges",
              }}
              onError={(event) => {
                const img = event.currentTarget;
                if (img.dataset.fallbackApplied === "true") {
                  img.onerror = null;
                  return;
                }

                img.dataset.fallbackApplied = "true";
                if (img.dataset.fallback) {
                  img.src = img.dataset.fallback;
                } else {
                  img.style.visibility = "hidden";
                }
              }}
            />
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-white/50">
        © OpenStreetMap contributors · © CARTO
      </div>
    </div>
  );
}

export { GeoScopeMap };
