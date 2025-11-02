import type maplibregl from "maplibre-gl";
import type { GeoJSONSource, Popup } from "maplibre-gl";

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function";

type GeoJSONSourceWithData = GeoJSONSource & {
  type: "geojson";
  setData(data: unknown): void;
};

type SourceCandidate = {
  type?: string;
};

export const isGeoJSONSource = (
  source: unknown,
): source is GeoJSONSourceWithData => {
  if (!source || typeof source !== "object") {
    return false;
  }
  return (source as SourceCandidate).type === "geojson";
};

type PopupWithMethods = Popup & {
  remove(): void;
  setLngLat(lngLat: { lng: number; lat: number }): PopupWithMethods;
};

export const getExistingPopup = (map: maplibregl.Map): PopupWithMethods | undefined => {
  const candidate = (map as maplibregl.Map & { getPopup?: () => Popup | null }).getPopup;
  if (!isFunction(candidate)) {
    return undefined;
  }
  const popup = candidate.call(map);
  return popup ? (popup as PopupWithMethods) : undefined;
};
