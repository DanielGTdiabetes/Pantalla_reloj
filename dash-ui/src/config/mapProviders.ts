type MapProvider = "maptiler" | "osm" | "openstreetmap" | string;

export type MapProviderRequest = {
  provider?: MapProvider | null;
  style?: string | null;
  model?: string | null;
  apiKeys?: {
    maptiler?: string | null;
  };
};

export type BaseStyleDefinition = {
  type: "maplibre" | "leaflet";
  styleUrl?: string;
  tileUrl?: string;
  attribution: string;
  name: string;
};

const MAPTILER_ATTRIBUTION = "© MapTiler © OpenStreetMap contributors";
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const sanitizeKey = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
};

const resolveMaptilerStyleSlug = (style?: string | null, model?: string | null): string => {
  const normalized = (style ?? model ?? "").toLowerCase();
  if (normalized.includes("satellite")) {
    return "satellite";
  }
  if (normalized.includes("bright")) {
    return "bright";
  }
  if (normalized.includes("street") || normalized.includes("light")) {
    return "streets";
  }
  if (normalized.includes("outdoor")) {
    return "outdoor";
  }
  return "dark";
};

export function getBaseStyle(request: MapProviderRequest): BaseStyleDefinition {
  const provider = (request.provider ?? "").toLowerCase();
  const style = request.style ?? null;
  const model = request.model ?? null;

  if (provider === "maptiler" || provider === "maptiler-cloud") {
    const apiKey = sanitizeKey(request.apiKeys?.maptiler);
    if (!apiKey) {
      console.warn("[mapProviders] Falta API key de MapTiler, usando OpenStreetMap como fallback");
      return {
        type: "maplibre",
        tileUrl: OSM_TILES,
        attribution: OSM_ATTRIBUTION,
        name: "openstreetmap",
      };
    }

    const styleSlug = resolveMaptilerStyleSlug(style, model);
    const styleUrl = `https://api.maptiler.com/maps/${styleSlug}/style.json?key=${apiKey}`;

    return {
      type: "maplibre",
      styleUrl,
      attribution: MAPTILER_ATTRIBUTION,
      name: `maptiler-${styleSlug}`,
    };
  }

  if (provider === "osm" || provider === "openstreetmap") {
    return {
      type: "maplibre",
      tileUrl: OSM_TILES,
      attribution: OSM_ATTRIBUTION,
      name: "openstreetmap",
    };
  }

  console.warn("[mapProviders] Proveedor de mapa desconocido, usando OpenStreetMap", {
    provider: request.provider,
    style: request.style,
    model: request.model,
  });

  return {
    type: "maplibre",
    tileUrl: OSM_TILES,
    attribution: OSM_ATTRIBUTION,
    name: "openstreetmap",
  };
}

export const MAP_PROVIDER_DEFAULTS = {
  attribution: {
    maptiler: MAPTILER_ATTRIBUTION,
    osm: OSM_ATTRIBUTION,
  },
  tiles: {
    osm: OSM_TILES,
  },
};
