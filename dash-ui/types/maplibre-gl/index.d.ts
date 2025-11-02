declare module "maplibre-gl" {
  export type Map = any;
  export type LngLatLike = any;
  export type StyleSpecification = {
    sprite?: string | null;
    [key: string]: unknown;
  };
  export type MapLibreEvent = Record<string, unknown>;
  export type MapLayerMouseEvent = Record<string, unknown>;
  export type GeoJSONSource = Record<string, unknown>;
  export type Popup = Record<string, unknown>;
  const maplibregl: any;
  export default maplibregl;
}

declare module "maplibre-gl/dist/maplibre-gl.css" {
  const content: unknown;
  export default content;
}
