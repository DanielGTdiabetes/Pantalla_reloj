import type { StyleSpecification } from "maplibre-gl";

import type { MapPreferences, UIMapSettings } from "../../types/config";

const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

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

const createOsmStyle = (): StyleSpecification => ({
  version: 8,
  name: "OpenStreetMap",
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: [OSM_TILES],
      tileSize: 256,
      attribution: OSM_ATTRIBUTION
    }
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }]
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

const sanitizeApiKey = (value?: string | null): string | null => {
  const trimmed = sanitizeOptionalString(value);
  if (!trimmed) {
    return null;
  }
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
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

export const loadMapStyle = async (
  mapSettings: UIMapSettings,
  mapPreferences: MapPreferences
): Promise<MapStyleResult> => {
  const styleName = ensureStyleName(mapSettings);
  const variant = determineVariant(styleName);
  const fallbackStyle: MapStyleDefinition = {
    type: "raster",
    style: createOsmStyle(),
    variant,
    name: styleName
  };

  let resolvedStyle = fallbackStyle;
  let usedFallback = mapPreferences.provider !== "maptiler";

  if (mapPreferences.provider === "maptiler") {
    if (styleName.startsWith("vector-")) {
      const key =
        sanitizeApiKey(mapPreferences.maptiler_api_key) ?? sanitizeApiKey(mapSettings.maptiler?.key) ?? null;
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
          usedFallback = false;
        } catch (error) {
          console.warn("[map] MapTiler style failed, using OpenStreetMap fallback", error);
          usedFallback = true;
        }
      } else {
        console.warn("[map] MapTiler requiere una API key válida, usando OpenStreetMap");
        usedFallback = true;
      }
    } else {
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
