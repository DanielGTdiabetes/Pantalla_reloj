/*
 * Lightweight stub of the MapLibre GL JS API used by the dashboard.
 * It renders a static raster tile grid based on the provided style
 * so the application can display a world map without the npm dependency.
 */

type RasterSource = {
  type: "raster";
  tiles?: string[];
  tileSize?: number;
  attribution?: string;
};

type RasterLayer = {
  id: string;
  type: "raster";
  source: string;
};

export type StyleSpecification = {
  version: number;
  sources: Record<string, RasterSource>;
  layers: RasterLayer[];
};

type MapOptions = {
  container: HTMLElement;
  style: StyleSpecification;
  center?: [number, number];
  zoom?: number;
  bearing?: number;
  pitch?: number;
  interactive?: boolean;
  attributionControl?: boolean;
};

const MAX_LATITUDE = 85.05112878;
const TILE_SIZE = 256;

const clampLatitude = (lat: number): number => {
  if (Number.isNaN(lat)) {
    return 0;
  }
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
};

const wrapLongitude = (lng: number): number => {
  if (Number.isNaN(lng)) {
    return 0;
  }
  const normalized = ((lng + 180) % 360 + 360) % 360 - 180;
  return normalized;
};

const clampZoom = (zoom: number | undefined): number => {
  if (typeof zoom !== "number" || Number.isNaN(zoom)) {
    return 0;
  }
  const max = 19;
  const min = 0;
  return Math.max(min, Math.min(max, Math.round(zoom)));
};

const mercatorY = (lat: number, zoomLevel: number): number => {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoomLevel);
  return (
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
    2
  ) * n;
};

const resolveTileTemplates = (style: StyleSpecification): string[] => {
  for (const layer of style.layers) {
    if (layer.type !== "raster") {
      continue;
    }
    const source = style.sources[layer.source];
    if (source?.type === "raster" && source.tiles && source.tiles.length > 0) {
      return source.tiles;
    }
  }

  return [];
};

const buildTileUrl = (template: string, z: number, x: number, y: number): string => {
  return template
    .replace(/\{z\}/g, z.toString())
    .replace(/\{x\}/g, x.toString())
    .replace(/\{y\}/g, y.toString());
};

class StaticMap {
  private readonly container: HTMLElement;
  private readonly layer: HTMLDivElement;
  private readonly tiles: string[];
  private readonly center: [number, number];
  private readonly zoom: number;

  constructor(options: MapOptions) {
    this.container = options.container;
    this.center = [
      wrapLongitude(options.center?.[0] ?? 0),
      clampLatitude(options.center?.[1] ?? 0)
    ];
    this.zoom = clampZoom(options.zoom);
    this.tiles = resolveTileTemplates(options.style);

    this.layer = document.createElement("div");
    this.layer.className = "maplibre-gl-canvas";
    this.layer.setAttribute("aria-hidden", "true");
    this.layer.style.position = "absolute";
    this.layer.style.inset = "0";
    this.layer.style.overflow = "hidden";

    this.container.classList.add("maplibre-gl-container");
    this.container.innerHTML = "";
    this.container.appendChild(this.layer);

    this.render();
  }

  private render(): void {
    const width = Math.max(1, Math.round(this.container.clientWidth || 512));
    const height = Math.max(1, Math.round(this.container.clientHeight || 512));

    this.layer.replaceChildren();

    if (this.tiles.length === 0) {
      this.layer.style.background = "#0f172a";
      return;
    }

    const zoomLevel = this.zoom;
    const n = Math.pow(2, zoomLevel);
    const tileXFraction = ((wrapLongitude(this.center[0]) + 180) / 360) * n;
    const tileYFraction = mercatorY(this.center[1], zoomLevel);
    const pixelX = tileXFraction * TILE_SIZE;
    const pixelY = tileYFraction * TILE_SIZE;

    const startPixelX = pixelX - width / 2;
    const startPixelY = pixelY - height / 2;
    const endPixelX = pixelX + width / 2;
    const endPixelY = pixelY + height / 2;

    const startTileX = Math.floor(startPixelX / TILE_SIZE);
    const startTileY = Math.floor(startPixelY / TILE_SIZE);
    const endTileX = Math.floor(endPixelX / TILE_SIZE);
    const endTileY = Math.floor(endPixelY / TILE_SIZE);

    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
        if (tileY < 0 || tileY >= n) {
          continue;
        }

        const wrappedX = ((tileX % n) + n) % n;
        const tileIndex = Math.abs(tileX + tileY) % this.tiles.length;
        const template = this.tiles[tileIndex];
        const url = buildTileUrl(template, zoomLevel, wrappedX, tileY);

        const left = tileX * TILE_SIZE - startPixelX;
        const top = tileY * TILE_SIZE - startPixelY;

        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.loading = "lazy";
        img.draggable = false;
        img.style.position = "absolute";
        img.style.width = `${TILE_SIZE}px`;
        img.style.height = `${TILE_SIZE}px`;
        img.style.left = `${left}px`;
        img.style.top = `${top}px`;
        img.style.pointerEvents = "none";
        img.src = url;

        this.layer.appendChild(img);
      }
    }
  }

  resize(): void {
    this.render();
  }

  remove(): void {
    this.layer.replaceChildren();
    this.layer.remove();
    this.container.classList.remove("maplibre-gl-container");
  }
}

export type Map = StaticMap;

const maplibregl = {
  Map: StaticMap,
  supported: () => true
};

export default maplibregl;
