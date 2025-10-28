import type { StyleSpecification } from "maplibre-gl";

import type { ResolvedMapConfig, UIMapSettings } from "../../types/config";

const CARTO_ATTRIBUTION = "© OpenStreetMap contributors, © CARTO";
const CARTO_DARK_TILES = "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const CARTO_LIGHT_TILES = "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

export type MapStyleVariant = "dark" | "light" | "bright";

export type MapStyleDefinition = {
  type: "vector" | "raster";
  style: StyleSpecification | string;
  variant: MapStyleVariant;
  name: string;
};

export type MapStyleResult = {
  resolved: MapStyleDefinition;
  fallback: MapStyleDefinition;
  usedFallback: boolean;
};

const determineVariant = (styleName: string): MapStyleVariant => {
  const normalized = styleName.toLowerCase();
  if (normalized.includes("bright")) {
    return "bright";
  }
  if (normalized.includes("light")) {
    return "light";
  }
  return "dark";
};

const getFallbackTiles = (variant: MapStyleVariant): string => {
  if (variant === "dark") {
    return CARTO_DARK_TILES;
  }
  return CARTO_LIGHT_TILES;
};

const createCartoStyle = (tilesUrl: string): StyleSpecification => ({
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [tilesUrl],
      tileSize: 256,
      attribution: CARTO_ATTRIBUTION
    }
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }]
});

const ensureStyleName = (mapSettings: UIMapSettings): string => {
  const candidate = mapSettings.style;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }
  return "raster-carto-dark";
};

export const loadMapStyle = async (
  mapSettings: UIMapSettings,
  resolvedMap: ResolvedMapConfig
): Promise<MapStyleResult> => {
  const styleName = ensureStyleName(mapSettings);
  const variant = determineVariant(styleName);
  const fallbackStyle: MapStyleDefinition = {
    type: "raster",
    style: createCartoStyle(getFallbackTiles(variant === "bright" ? "light" : variant)),
    variant,
    name: styleName
  };

  let resolvedStyle = fallbackStyle;
  let usedFallback = false;

  if (resolvedMap.type === "vector") {
    resolvedStyle = {
      type: "vector",
      style: resolvedMap.style_url,
      variant,
      name: styleName
    };
  } else {
    const rasterStyle = createCartoStyle(resolvedMap.style_url);
    resolvedStyle = {
      type: "raster",
      style: rasterStyle,
      variant,
      name: styleName
    };
    fallbackStyle.style = rasterStyle;
    fallbackStyle.type = "raster";
    fallbackStyle.variant = variant;
    fallbackStyle.name = styleName;
    usedFallback = styleName.startsWith("vector-");
  }

  return {
    resolved: resolvedStyle,
    fallback: fallbackStyle,
    usedFallback
  };
};

export default loadMapStyle;
