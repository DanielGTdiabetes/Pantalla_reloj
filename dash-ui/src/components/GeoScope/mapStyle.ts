import type { StyleSpecification } from "maplibre-gl";

import { getBaseStyle } from "../../config/mapProviders";
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

const createRasterStyle = (tileUrl: string, attribution: string, name: string): StyleSpecification => ({
  version: 8,
  name,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    base: {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      attribution
    }
  },
  layers: [{ id: "base", type: "raster", source: "base" }]
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
    style: createRasterStyle(OSM_TILES, OSM_ATTRIBUTION, "OpenStreetMap"),
    variant,
    name: styleName
  };

  let resolvedStyle = fallbackStyle;
  let usedFallback = true;

  const intendedProvider = (mapSettings.provider ?? mapPreferences.provider ?? "").toLowerCase();

  const sanitizedKey =
    sanitizeApiKey(mapPreferences.maptiler_api_key) ?? sanitizeApiKey(mapSettings.maptiler?.key) ?? null;

  const providerBase = getBaseStyle({
    provider: mapSettings.provider ?? mapPreferences.provider,
    style: styleName,
    model: (mapSettings as unknown as { model?: string | null })?.model ?? null,
    apiKeys: { maptiler: sanitizedKey },
  });

  if (providerBase.type === "maplibre" && providerBase.styleUrl) {
    try {
      const response = await fetch(providerBase.styleUrl);
      if (!response.ok) {
        throw new Error(`Failed to load style: HTTP ${response.status}`);
      }
      const styleText = await response.text();
      const parsed = JSON.parse(
        sanitizedKey ? injectKeyPlaceholders(styleText, sanitizedKey) : styleText
      ) as StyleSpecification;
      resolvedStyle = {
        type: "vector",
        style: parsed,
        variant,
        name: providerBase.name,
      };
      usedFallback = false;
    } catch (error) {
      console.warn("[map] MapTiler style failed, using OpenStreetMap fallback", error);
      usedFallback = true;
    }
  } else if (providerBase.type === "maplibre" && providerBase.tileUrl) {
    resolvedStyle = {
      type: "raster",
      style: createRasterStyle(providerBase.tileUrl, providerBase.attribution, providerBase.name),
      variant,
      name: providerBase.name,
    };
    const isOsmTile = providerBase.tileUrl === OSM_TILES;
    const intendedOsm = intendedProvider === "osm" || intendedProvider === "openstreetmap";
    usedFallback = isOsmTile ? !intendedOsm : false;
  }

  return {
    resolved: resolvedStyle,
    fallback: fallbackStyle,
    usedFallback
  };
};

export default loadMapStyle;
