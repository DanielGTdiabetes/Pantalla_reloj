/**
 * Defaults para Esquema v2 de configuración.
 */
import type {
  AppConfigV2,
  MapConfigV2,
  UIGlobalConfigV2,
  LayersConfigV2,
  FlightsLayerConfigV2,
  ShipsLayerConfigV2,
  PanelsConfigV2,
  CalendarConfig,
} from "../types/config_v2";

export const DEFAULT_MAP_CENTER = {
  lat: 39.98,
  lon: 0.20,
};

export const DEFAULT_LOCAL_RASTER_CONFIG = {
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  minzoom: 0,
  maxzoom: 19,
};

export const DEFAULT_MAP_CONFIG: MapConfigV2 = {
  engine: "maplibre",
  provider: "local_raster_xyz",
  renderWorldCopies: true,
  interactive: false,
  controls: false,
  local: DEFAULT_LOCAL_RASTER_CONFIG,
  maptiler: {
    apiKey: null,
    styleUrl: null,
  },
  customXyz: {
    tileUrl: null,
    minzoom: 0,
    maxzoom: 19,
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

export const DEFAULT_UI_GLOBAL_CONFIG: UIGlobalConfigV2 = {
  satellite: {
    enabled: true,
    provider: "gibs",
    opacity: 1.0,
  },
  radar: {
    enabled: false,
    provider: "rainviewer",
  },
};

export const DEFAULT_FLIGHTS_LAYER_CONFIG: FlightsLayerConfigV2 = {
  enabled: true,
  provider: "opensky",
  refresh_seconds: 12,
  max_age_seconds: 120,
  max_items_global: 2000,
  max_items_view: 1500,
  rate_limit_per_min: 6,
  decimate: "none",
  grid_px: 24,
  styleScale: 3.2,
  render_mode: "circle",
  circle: {
    radius_base: 7.5,
    radius_zoom_scale: 1.7,
    opacity: 1.0,
    color: "#FFD400",
    stroke_color: "#000000",
    stroke_width: 2.0,
  },
};

export const DEFAULT_SHIPS_LAYER_CONFIG: ShipsLayerConfigV2 = {
  enabled: false,
  provider: "aisstream",
  refresh_seconds: 10,
  max_age_seconds: 180,
  max_items_global: 1500,
  max_items_view: 420,
  rate_limit_per_min: 4,
  decimate: "grid",
  grid_px: 24,
  styleScale: 1.4,
};

export const DEFAULT_LAYERS_CONFIG: LayersConfigV2 = {
  flights: DEFAULT_FLIGHTS_LAYER_CONFIG,
  ships: DEFAULT_SHIPS_LAYER_CONFIG,
};

export const DEFAULT_PANELS_CONFIG: PanelsConfigV2 = {
  weatherWeekly: {
    enabled: true,
  },
  ephemerides: {
    enabled: true,
  },
  news: {
    enabled: true,
    feeds: [],
  },
  calendar: {
    enabled: false,
    provider: "google",
  },
};

export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  enabled: false,
  source: "google",
  provider: "google",
  days_ahead: 14,
};

export const DEFAULT_CONFIG_V2: AppConfigV2 = {
  version: 2,
  ui_map: DEFAULT_MAP_CONFIG,
  ui_global: DEFAULT_UI_GLOBAL_CONFIG,
  layers: DEFAULT_LAYERS_CONFIG,
  panels: DEFAULT_PANELS_CONFIG,
  secrets: {},
  calendar: DEFAULT_CALENDAR_CONFIG,
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
    ui_map: {
      ...DEFAULT_MAP_CONFIG,
      ...config.ui_map,
      local: {
        ...DEFAULT_LOCAL_RASTER_CONFIG,
        ...config.ui_map?.local,
      },
      maptiler: config.ui_map?.maptiler ?? DEFAULT_MAP_CONFIG.maptiler,
      customXyz: {
        ...DEFAULT_MAP_CONFIG.customXyz!,
        ...config.ui_map?.customXyz,
      },
      fixed: config.ui_map?.fixed ?? DEFAULT_MAP_CONFIG.fixed,
      region: config.ui_map?.region ?? DEFAULT_MAP_CONFIG.region,
    },
    ui_global: config.ui_global ?? DEFAULT_UI_GLOBAL_CONFIG,
    layers: {
      flights: {
        ...DEFAULT_FLIGHTS_LAYER_CONFIG,
        ...config.layers?.flights,
        circle: config.layers?.flights?.circle ?? DEFAULT_FLIGHTS_LAYER_CONFIG.circle,
      },
      ships: {
        ...DEFAULT_SHIPS_LAYER_CONFIG,
        ...config.layers?.ships,
      },
    },
    panels: config.panels ?? DEFAULT_PANELS_CONFIG,
    calendar: config.calendar ?? DEFAULT_CALENDAR_CONFIG,
    secrets: config.secrets ?? {},
  };
}
