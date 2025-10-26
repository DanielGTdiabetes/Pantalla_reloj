declare module "maplibre-gl" {
  export type LngLatLike = [number, number];

  export interface MapOptions {
    container: string | HTMLElement;
    style: StyleSpecification;
    center?: LngLatLike;
    zoom?: number;
    bearing?: number;
    pitch?: number;
    interactive?: boolean;
    attributionControl?: boolean;
  }

  export interface MapInstance {
    resize(): void;
    remove(): void;
  }

  export interface MapLibreGL {
    Map: new (options: MapOptions) => MapInstance;
  }

  export type StyleSpecification = Record<string, unknown>;

  const loadMapLibre: () => Promise<MapLibreGL>;
  export default loadMapLibre;
}

declare global {
  interface Window {
    maplibregl?: import("maplibre-gl").MapLibreGL;
  }
}

export {};
