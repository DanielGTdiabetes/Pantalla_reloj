import type { StyleSpecification } from "maplibre-gl";

import type { MapConfigV2 } from "../../types/config_v2";

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

const createRasterStyle = (
  tileUrl: string,
  attribution: string,
  name: string,
  minzoom?: number,
  maxzoom?: number,
  tileSize?: number
): StyleSpecification => {
  const baseSource: Record<string, unknown> = {
    type: "raster",
    tiles: [tileUrl],
    tileSize: tileSize ?? 256,
    attribution,
  };
  if (typeof minzoom === "number") {
    baseSource.minzoom = minzoom;
  }
  if (typeof maxzoom === "number") {
    baseSource.maxzoom = maxzoom;
  }

  const sources: Record<string, unknown> = {
    base: baseSource,
  };

  const baseLayer: { id: string; type: "raster"; source: string; minzoom?: number; maxzoom?: number } = {
    id: "base",
    type: "raster",
    source: "base"
  };
  const layers: Array<{ id: string; type: "raster"; source: string; minzoom?: number; maxzoom?: number }> = [baseLayer];

  return {
    version: 8,
    name,
    sources: sources as StyleSpecification["sources"],
    layers: layers as StyleSpecification["layers"],
  };
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
  mapConfig: MapConfigV2
): Promise<MapStyleResult> => {
  const variant: MapStyleVariant = "dark";
  const fallbackStyle: MapStyleDefinition = {
    type: "raster",
    style: createRasterStyle(OSM_TILES, OSM_ATTRIBUTION, "OpenStreetMap"),
    variant,
    name: "OpenStreetMap"
  };

  let resolvedStyle = fallbackStyle;
  let usedFallback = true;

  const provider = mapConfig.provider || "local_raster_xyz";

  // Manejar proveedor local_raster_xyz (default)
  if (provider === "local_raster_xyz") {
    const localConfig = mapConfig.local;
    const tileUrl = localConfig?.tileUrl || OSM_TILES;
    const attribution = OSM_ATTRIBUTION;
    
    resolvedStyle = {
      type: "raster",
      style: createRasterStyle(
        tileUrl,
        attribution,
        "OSM Raster",
        localConfig?.minzoom,
        localConfig?.maxzoom
      ),
      variant,
      name: "local_raster_xyz",
    };
    usedFallback = false;
  }
  // Manejar proveedor maptiler_vector
  else if (provider === "maptiler_vector") {
    const maptilerConfig = mapConfig.maptiler;
    let styleUrl = sanitizeOptionalString(maptilerConfig?.styleUrl);

    if (styleUrl) {
      try {
        // Preflight: verificar que el styleUrl es válido antes de usarlo
        // Intentar HEAD primero, luego GET si es necesario
        let preflightResponse: Response;
        let needsBody = false;
        try {
          preflightResponse = await fetch(styleUrl, {
            method: "HEAD",
            cache: "no-store",
          });
          needsBody = true; // Si HEAD funciona, necesitamos GET para obtener el body
        } catch {
          // Si HEAD falla, intentar GET directamente
          preflightResponse = await fetch(styleUrl, {
            method: "GET",
            cache: "no-store",
          });
          needsBody = false; // Ya tenemos el body
        }

        // Si el status no es 200, usar fallback
        if (preflightResponse.status !== 200) {
          throw new Error(`Preflight failed: HTTP ${preflightResponse.status}`);
        }

        // Si es HEAD, obtener el body con GET
        let response: Response = preflightResponse;
        if (needsBody) {
          response = await fetch(styleUrl, {
            method: "GET",
            cache: "no-store",
          });
          if (!response.ok) {
            throw new Error(`Failed to load style: HTTP ${response.status}`);
          }
        }

        const styleText = await response.text();
        
        // Verificar que el body es >= 1 KB
        if (styleText.length < 1024) {
          throw new Error(`Style body too small: ${styleText.length} bytes`);
        }

        const parsed = JSON.parse(styleText) as StyleSpecification;
        resolvedStyle = {
          type: "vector",
          style: parsed,
          variant,
          name: "maptiler_vector",
        };
        usedFallback = false;
      } catch (error) {
        console.warn("[map] MapTiler style failed, using fallback", error);
        // Cambiar a fallback de MapLibre
        const fallbackUrl = "https://demotiles.maplibre.org/style.json";
        usedFallback = true;
        
        try {
          const fallbackResponse = await fetch(fallbackUrl, {
            cache: "no-store",
          });
          if (fallbackResponse.ok) {
            const styleText = await fallbackResponse.text();
            const parsed = JSON.parse(styleText) as StyleSpecification;
            resolvedStyle = {
              type: "vector",
              style: parsed,
              variant,
              name: "maptiler_vector_fallback",
            };
          }
        } catch (fallbackError) {
          console.warn("[map] MapLibre fallback also failed", fallbackError);
        }
      }
    } else {
      console.warn("[map] MapTiler provider requires styleUrl, using fallback");
      usedFallback = true;
    }
  }
  // Manejar proveedor custom_xyz
  else if (provider === "custom_xyz") {
    const customConfig = mapConfig.customXyz;
    const tileUrl = sanitizeOptionalString(customConfig?.tileUrl);

    if (tileUrl) {
      resolvedStyle = {
        type: "raster",
        style: createRasterStyle(
          tileUrl,
          "© Custom Provider",
          "custom_xyz",
          customConfig?.minzoom,
          customConfig?.maxzoom
        ),
        variant,
        name: "custom_xyz",
      };
      usedFallback = false;
    } else {
      console.warn("[map] Custom XYZ provider requires tileUrl, using fallback");
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
