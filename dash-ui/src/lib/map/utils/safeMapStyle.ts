import type { Map as MaptilerMap } from "@maptiler/sdk";
import type { StyleSpecification } from "maplibre-gl";

export const getSafeMapStyle = (
  map?: MaptilerMap | null
): StyleSpecification | null => {
  if (!map) {
    return null;
  }
  try {
    const style = map.getStyle() as StyleSpecification | null | undefined;
    if (!style || typeof style !== "object") {
      return null;
    }
    const version = (style as { version?: unknown }).version;
    if (typeof version !== "number") {
      return null;
    }
    return style;
  } catch {
    return null;
  }
};
