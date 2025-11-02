/**
 * Defaults para Esquema v2 de configuración.
 */
import type {
  AppConfigV2,
  UIConfigV2,
  MapConfigV2,
  AemetConfigV2,
  PanelConfig,
  LayersConfigV2,
  FlightsLayerConfigV2,
  ShipsLayerConfigV2,
} from "../types/config_v2";

export const DEFAULT_MAP_CENTER = {
  lat: 39.98,
  lon: 0.20,
};

export const DEFAULT_XYZ_CONFIG = {
  urlTemplate: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "© Esri, Maxar, Earthstar, CNES/Airbus, USDA, USGS, IGN, GIS User Community",
  minzoom: 0,
  maxzoom: 19,
  tileSize: 256,
};

export const DEFAULT_MAP_CONFIG: MapConfigV2 = {
  engine: "maplibre",
  provider: "xyz",
  xyz: DEFAULT_XYZ_CONFIG,
  labelsOverlay: {
    enabled: true,
    style: "carto-only-labels",
  },
  viewMode: "fixed",
  fixed: {
    center: DEFAULT_MAP_CENTER,
    zoom: 7.8,
    bearing: 0,
    pitch: 0,
  },
  region: {
    postalCode: "12001",
  },
};

export const DEFAULT_AEMET_CONFIG: AemetConfigV2 = {
  enabled: true,
  warnings: {
    enabled: true,
    min_severity: "yellow",
  },
  radar: {
    enabled: true,
    opacity: 0.6,
    speed: 1.0,
  },
  sat: {
    enabled: false,
    opacity: 0.5,
  },
};

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  rotate: {
    enabled: true,
    order: [
      "weather_now",
      "forecast_week",
      "luna",
      "harvest",
      "efemerides",
      "news",
      "calendar",
    ],
    intervalSec: 12,
  },
  news: {
    feeds: [
      "https://www.elperiodicomediterraneo.com/rss.html",
      "https://www.xataka.com/feed",
    ],
  },
  efemerides: {
    source: "built-in",
  },
};

export const DEFAULT_UI_CONFIG: UIConfigV2 = {
  layout: "grid-2-1",
  map: DEFAULT_MAP_CONFIG,
  aemet: DEFAULT_AEMET_CONFIG,
  panel: DEFAULT_PANEL_CONFIG,
};

export const DEFAULT_FLIGHTS_LAYER_CONFIG: FlightsLayerConfigV2 = {
  enabled: true,
  provider: "opensky",
  render_mode: "symbol_custom",
  max_items_view: 1200,
  symbol: {
    size_vh: 1.6,
    allow_overlap: true,
  },
  circle: {
    radius_vh: 0.9,
    color: "#FFD400",
    stroke_color: "#000000",
    stroke_width: 2.0,
  },
};

export const DEFAULT_SHIPS_LAYER_CONFIG: ShipsLayerConfigV2 = {
  enabled: true,
  provider: "aisstream",
  decimate: "grid",
  grid_px: 24,
  max_items_view: 420,
  symbol: {
    size_vh: 1.4,
    allow_overlap: true,
  },
  circle: {
    radius_vh: 0.8,
    color: "#5ad35a",
    stroke_color: "#002200",
    stroke_width: 2.0,
  },
};

export const DEFAULT_LAYERS_CONFIG: LayersConfigV2 = {
  flights: DEFAULT_FLIGHTS_LAYER_CONFIG,
  ships: DEFAULT_SHIPS_LAYER_CONFIG,
};

export const DEFAULT_CONFIG_V2: AppConfigV2 = {
  version: 2,
  ui: DEFAULT_UI_CONFIG,
  layers: DEFAULT_LAYERS_CONFIG,
  secrets: {},
};

/**
 * Función helper para mergear configuración v2 con defaults.
 */
export function withConfigDefaultsV2(
  config?: Partial<AppConfigV2>
): AppConfigV2 {
  if (!config) {
    return DEFAULT_CONFIG_V2;
  }

  return {
    version: 2,
    ui: {
      layout: config.ui?.layout ?? DEFAULT_UI_CONFIG.layout,
      map: {
        ...DEFAULT_MAP_CONFIG,
        ...config.ui?.map,
        xyz: {
          ...DEFAULT_XYZ_CONFIG,
          ...config.ui?.map?.xyz,
        },
        labelsOverlay: config.ui?.map?.labelsOverlay ?? DEFAULT_MAP_CONFIG.labelsOverlay,
        fixed: config.ui?.map?.fixed ?? DEFAULT_MAP_CONFIG.fixed,
        region: config.ui?.map?.region ?? DEFAULT_MAP_CONFIG.region,
      },
      aemet: config.ui?.aemet ?? DEFAULT_AEMET_CONFIG,
      panel: config.ui?.panel ?? DEFAULT_PANEL_CONFIG,
    },
    layers: {
      flights: {
        ...DEFAULT_FLIGHTS_LAYER_CONFIG,
        ...config.layers?.flights,
        symbol: config.layers?.flights?.symbol ?? DEFAULT_FLIGHTS_LAYER_CONFIG.symbol,
        circle: config.layers?.flights?.circle ?? DEFAULT_FLIGHTS_LAYER_CONFIG.circle,
      },
      ships: {
        ...DEFAULT_SHIPS_LAYER_CONFIG,
        ...config.layers?.ships,
        symbol: config.layers?.ships?.symbol ?? DEFAULT_SHIPS_LAYER_CONFIG.symbol,
        circle: config.layers?.ships?.circle ?? DEFAULT_SHIPS_LAYER_CONFIG.circle,
      },
    },
    secrets: config.secrets ?? {},
  };
}

