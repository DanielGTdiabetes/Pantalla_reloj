import type maplibregl from "maplibre-gl";
import type { GeoJSONSource, Popup } from "maplibre-gl";

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function";

type GeoJSONSourceWithData = GeoJSONSource & {
  type: "geojson";
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

export const getExistingPopup = (map: maplibregl.Map): Popup | undefined => {
  const candidate = (map as maplibregl.Map & { getPopup?: () => Popup | null }).getPopup;
  if (!isFunction(candidate)) {
    return undefined;
  }
  const popup = candidate.call(map);
  return popup ?? undefined;
};
