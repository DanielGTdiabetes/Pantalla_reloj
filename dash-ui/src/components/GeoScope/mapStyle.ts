import type { StyleSpecification } from "maplibre-gl";

import type { UIMapSettings } from "../../types/config";

const CARTO_ATTRIBUTION = "© OpenStreetMap contributors, © CARTO";
const CARTO_DARK_TILES = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const CARTO_LIGHT_TILES = "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

export type MapStyleVariant = "dark" | "light" | "bright";

export type MapStyleDefinition = {
  type: "vector" | "raster";
  style: StyleSpecification;
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

const sanitizeOptionalString = (value?: string | null): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const selectMaptilerUrl = (
  mapSettings: UIMapSettings,
  variant: MapStyleVariant
): string | null => {
  const config = mapSettings.maptiler;
  if (!config) {
    return null;
  }

  if (variant === "dark") {
    return sanitizeOptionalString(config.styleUrlDark) ?? sanitizeOptionalString(config.styleUrlLight);
  }

  if (variant === "bright") {
    return (
      sanitizeOptionalString(config.styleUrlBright) ??
      sanitizeOptionalString(config.styleUrlLight) ??
      sanitizeOptionalString(config.styleUrlDark)
    );
  }

  return sanitizeOptionalString(config.styleUrlLight) ?? sanitizeOptionalString(config.styleUrlDark);
};

const injectKeyIntoUrl = (baseUrl: string, key: string): string => {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("key", key);
    return url.toString();
  } catch {
    const delimiter = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${delimiter}key=${encodeURIComponent(key)}`;
  }
};

const injectKeyPlaceholders = (payload: string, key: string): string => {
  if (!key) {
    return payload;
  }
  return payload.replace(/{key}/g, key);
};

export const loadMapStyle = async (mapSettings: UIMapSettings): Promise<MapStyleResult> => {
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

  if (styleName.startsWith("vector-")) {
    const key = sanitizeOptionalString(mapSettings.maptiler?.key) ?? "";
    const baseUrl = selectMaptilerUrl(mapSettings, variant);

    if (key && baseUrl) {
      const styleUrl = injectKeyIntoUrl(baseUrl, key);
      try {
        const response = await fetch(styleUrl);
        if (!response.ok) {
          throw new Error(`Failed to load style: HTTP ${response.status}`);
        }
        const styleText = await response.text();
        const parsed = JSON.parse(injectKeyPlaceholders(styleText, key)) as StyleSpecification;
        resolvedStyle = {
          type: "vector",
          style: parsed,
          variant,
          name: styleName
        };
      } catch (error) {
        console.warn("[map] vector style failed, using raster fallback", error);
        usedFallback = true;
      }
    } else {
      console.warn("[map] vector style failed, using raster fallback");
      usedFallback = true;
    }
  }

  return {
    resolved: resolvedStyle,
    fallback: fallbackStyle,
    usedFallback
  };
};

export default loadMapStyle;
