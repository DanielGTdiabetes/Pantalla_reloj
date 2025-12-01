/**
 * Defaults para Esquema v2 de configuración.
 */
import type {
  AppConfig,
  MapConfig,
  UIGlobalConfig,
  LayersConfig,
  FlightsLayerConfig,
  ShipsLayerConfig,
  GlobalRadarLayerConfig,
  PanelsConfig,
  CalendarConfig,
  UIRotationConfig,
} from "../types/config";
import {
  DEFAULT_LABELS_STYLE_URL,
  DEFAULT_NORMALIZED_LABELS_OVERLAY,
  normalizeLabelsOverlay,
} from "../lib/map/labelsOverlay";

// Coordenadas por defecto: España
export // Centro de España - Consistente con DEFAULT_VIEW en GeoScopeMap.tsx
  const DEFAULT_MAP_CENTER = {
    lat: 40.0,
    lon: -3.5,
  };

export const DEFAULT_LOCAL_RASTER_CONFIG = {
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  minzoom: 0,
  maxzoom: 19,
};

export const DEFAULT_MAP_CONFIG: MapConfig = {
  engine: "maplibre",
  provider: "maptiler_vector",
  renderWorldCopies: true,
  interactive: false,
  controls: false,
  local: DEFAULT_LOCAL_RASTER_CONFIG,
  maptiler: {
    api_key: null,
    apiKey: null,
    key: null,
    style: "vector-bright",
    styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json?key=fBZDqPrUD4EwoZLV4L6A",
  },
  satellite: {
    enabled: false,
    opacity: 0.85,
    labels_enabled: true,
    labels_overlay: DEFAULT_NORMALIZED_LABELS_OVERLAY,
    provider: "maptiler",
    style_raster: "https://api.maptiler.com/maps/satellite/style.json",
    style_labels: "https://api.maptiler.com/maps/streets/style.json",
    labels_style_url: DEFAULT_LABELS_STYLE_URL,
  },
  customXyz: {
    tileUrl: null,
    minzoom: 0,
    maxzoom: 19,
  },
  viewMode: "fixed",
  fixed: {
    center: DEFAULT_MAP_CENTER,
    zoom: 3.6, // Zoom para ver toda la península ibérica en pantalla vertical
    bearing: 0,
    pitch: 0,
  },
  region: {
    postalCode: undefined,
  },
};

export const DEFAULT_UI_GLOBAL_CONFIG: UIGlobalConfig = {
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

export const DEFAULT_FLIGHTS_LAYER_CONFIG: FlightsLayerConfig = {
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
  render_mode: "symbol_custom",
  circle: {
    radius_base: 7.5,
    radius_zoom_scale: 1.7,
    opacity: 1.0,
    color: "#FFD400",
    stroke_color: "#000000",
    stroke_width: 2.0,
  },
  symbol: {
    size_vh: 2.0,
    allow_overlap: true,
  },
};

import { OpenSkyConfig } from "../types/config";

export const DEFAULT_OPENSKY_CONFIG: OpenSkyConfig = {
  enabled: true,
  mode: "bbox" as const,
  poll_seconds: 10,
  max_aircraft: 400,
  cluster: true,
  extended: 0,
  bbox: {
    lamin: 36.0,
    lamax: 44.0,
    lomin: -10.0,
    lomax: 5.0,
  },
  oauth2: {
    client_id: "danigt-api-client",
    client_secret: "Mph0txbYD1udcExVL7OrsLoxDjl3eKbQ",
    token_url:
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    scope: null,
  },
};

export const DEFAULT_SHIPS_LAYER_CONFIG: ShipsLayerConfig = {
  enabled: true,
  provider: "aisstream",
  refresh_seconds: 10,
  max_age_seconds: 180,
  max_items_global: 1500,
  max_items_view: 420,
  rate_limit_per_min: 4,
  decimate: "grid",
  grid_px: 24,
  styleScale: 1.4,
  aisstream: {
    ws_url: "wss://stream.aisstream.io/v0/stream",
    bbox: {
      lamin: 36.0,
      lamax: 44.0,
      lomin: -10.0,
      lomax: 5.0,
    },
  },
};

export const DEFAULT_GLOBAL_RADAR_CONFIG: GlobalRadarLayerConfig = {
  enabled: true,
  provider: "maptiler_weather",
  opacity: 0.7,
  animation_speed: 1.0,
};

export const DEFAULT_LAYERS_CONFIG: LayersConfig = {
  flights: DEFAULT_FLIGHTS_LAYER_CONFIG,
  ships: DEFAULT_SHIPS_LAYER_CONFIG,
  global: {
    radar: DEFAULT_GLOBAL_RADAR_CONFIG,
  },
};

export const ROTATION_PANEL_IDS = [
  "clock",
  "weather",
  "astronomy",
  "santoral",
  "calendar",
  "harvest",
  "news",
  "historicalEvents",
] as const;

const ROTATION_LEGACY_MAP: Record<string, string> = {
  time: "clock",
  clock: "clock",
  weather: "weather",
  forecast: "weather",
  moon: "astronomy",
  astronomy: "astronomy",
  ephemerides: "astronomy",
  saints: "santoral",
  santoral: "santoral",
  calendar: "calendar",
  news: "news",
  historicalevents: "historicalEvents",
  historicalEvents: "historicalEvents",
  // Variaciones en español (mapeo a harvest)
  harvest: "harvest",
  cosecha: "harvest",
  cosechas: "harvest",
  hortaliza: "harvest",
  hortalizas: "harvest",
  verdura: "harvest",
  verduras: "harvest",
  fruta: "harvest",
  frutas: "harvest",
  siembra: "harvest",
  siembras: "harvest",
  cultivo: "harvest",
  cultivos: "harvest",
} as const;

const ROTATION_DEFAULT_ORDER = [...ROTATION_PANEL_IDS];

export const DEFAULT_UI_ROTATION_CONFIG: UIRotationConfig = {
  enabled: true,
  duration_sec: 60,
  panels: ROTATION_DEFAULT_ORDER,
};

export const DEFAULT_PANELS_CONFIG: PanelsConfig = {
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
  harvest: {
    enabled: true,
  },
  historicalEvents: {
    enabled: true,
    provider: "wikimedia",
    lang: "es",
  },
};

export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  enabled: false,
  source: "google",
  provider: "google",
  days_ahead: 14,
};

export const DEFAULT_CONFIG: AppConfig = {
  version: 2,
  ui_map: DEFAULT_MAP_CONFIG,
  ui: {
    rotation: DEFAULT_UI_ROTATION_CONFIG,
  },
  ui_global: DEFAULT_UI_GLOBAL_CONFIG,
  opensky: DEFAULT_OPENSKY_CONFIG,
  layers: DEFAULT_LAYERS_CONFIG,
  panels: DEFAULT_PANELS_CONFIG,
  secrets: {
    aisstream: {
      api_key: "38dd87bbfef35a1f4dc6133293bed27f0e2c9ff7",
    },
    opensky: {
      oauth2: {
        client_id: "danigt-api-client",
        client_secret: "Mph0txbYD1udcExVL7OrsLoxDjl3eKbQ",
      }
    },
    openweathermap: {
      api_key: null,
    }
  },
  calendar: DEFAULT_CALENDAR_CONFIG,
};

/**
 * Función helper para mergear configuración v2 con defaults.
 */
export function withConfigDefaults(
  config?: Partial<AppConfig>
): AppConfig {
  if (!config) {
    return DEFAULT_CONFIG;
  }

  const uiMapInput: Partial<MapConfig> = config.ui_map ?? {};

  const mergedLocal = {
    ...DEFAULT_LOCAL_RASTER_CONFIG,
    ...(uiMapInput.local ?? {}),
  };

  const mergedMaptiler = {
    ...DEFAULT_MAP_CONFIG.maptiler!,
    ...(uiMapInput.maptiler ?? {}),
    // Force default styleUrl if input is null/empty
    styleUrl: uiMapInput.maptiler?.styleUrl || DEFAULT_MAP_CONFIG.maptiler?.styleUrl || null,
  };

  const mergedSatellite = {
    ...DEFAULT_MAP_CONFIG.satellite!,
    ...(uiMapInput.satellite ?? {}),
  };

  const overlayRaw =
    uiMapInput.satellite?.labels_overlay ??
    (typeof uiMapInput.satellite?.labels_enabled === "boolean"
      ? uiMapInput.satellite.labels_enabled
      : undefined);

  const normalizedOverlay = normalizeLabelsOverlay(
    overlayRaw,
    uiMapInput.satellite?.labels_style_url ?? mergedSatellite.labels_style_url ?? DEFAULT_LABELS_STYLE_URL,
  );

  mergedSatellite.labels_overlay = normalizedOverlay;
  mergedSatellite.labels_enabled = normalizedOverlay.enabled;
  mergedSatellite.labels_style_url = normalizedOverlay.style_url;
  mergedSatellite.opacity =
    typeof mergedSatellite.opacity === "number" && Number.isFinite(mergedSatellite.opacity)
      ? Math.min(1, Math.max(0, mergedSatellite.opacity))
      : DEFAULT_MAP_CONFIG.satellite!.opacity;

  const mergedCustomXyz = {
    ...DEFAULT_MAP_CONFIG.customXyz!,
    ...(uiMapInput.customXyz ?? {}),
  };

  const mergeRotationConfig = (candidate?: Partial<UIRotationConfig>): UIRotationConfig => {
    const source = candidate ?? {};
    const enabled = source.enabled ?? true;

    const rawPanels = Array.isArray(source.panels) ? source.panels : [];
    const normalizedPanels: string[] = [];
    for (const panel of rawPanels) {
      if (typeof panel !== "string") {
        continue;
      }
      const trimmed = panel.trim();
      if (!trimmed) {
        continue;
      }
      const lower = trimmed.toLowerCase();
      const mapped = ROTATION_LEGACY_MAP[lower as keyof typeof ROTATION_LEGACY_MAP] ?? trimmed;
      if (
        ROTATION_PANEL_IDS.includes(mapped as (typeof ROTATION_PANEL_IDS)[number]) &&
        !normalizedPanels.includes(mapped)
      ) {
        normalizedPanels.push(mapped);
      }
    }

    const panels = normalizedPanels.length > 0 ? normalizedPanels : ROTATION_DEFAULT_ORDER;
    const durationCandidate = Number(source.duration_sec);
    const duration = Number.isFinite(durationCandidate)
      ? Math.min(3600, Math.max(3, Math.round(durationCandidate)))
      : DEFAULT_UI_ROTATION_CONFIG.duration_sec;

    return {
      enabled,
      duration_sec: duration,
      panels,
    };
  };

  return {
    version: 2,
    ui_map: {
      ...DEFAULT_MAP_CONFIG,
      ...uiMapInput,
      local: mergedLocal,
      maptiler: mergedMaptiler,
      satellite: mergedSatellite,
      customXyz: mergedCustomXyz,
      fixed: uiMapInput.fixed ?? DEFAULT_MAP_CONFIG.fixed,
      region: uiMapInput.region ?? DEFAULT_MAP_CONFIG.region,
    },
    ui: {
      rotation: mergeRotationConfig(config.ui?.rotation),
    },
    ui_global: config.ui_global ?? DEFAULT_UI_GLOBAL_CONFIG,
    opensky: {
      ...DEFAULT_OPENSKY_CONFIG,
      ...config.opensky,
      bbox: {
        ...DEFAULT_OPENSKY_CONFIG.bbox!,
        ...(config.opensky?.bbox ?? {}),
      },
      oauth2: {
        ...DEFAULT_OPENSKY_CONFIG.oauth2!,
        ...(config.opensky?.oauth2 ?? {}),
      },
    },
    layers: {
      flights: {
        ...DEFAULT_FLIGHTS_LAYER_CONFIG,
        ...config.layers?.flights,
        circle: config.layers?.flights?.circle ?? DEFAULT_FLIGHTS_LAYER_CONFIG.circle,
        symbol: config.layers?.flights?.symbol ?? DEFAULT_FLIGHTS_LAYER_CONFIG.symbol,
      },
      ships: {
        ...DEFAULT_SHIPS_LAYER_CONFIG,
        ...config.layers?.ships,
      },
      global: {
        radar: {
          ...DEFAULT_GLOBAL_RADAR_CONFIG,
          ...config.layers?.global?.radar,
          ...config.layers?.global_?.radar,
        },
        ...config.layers?.global,
        ...config.layers?.global_,
      },
      global_: {
        radar: {
          ...DEFAULT_GLOBAL_RADAR_CONFIG,
          ...config.layers?.global?.radar,
          ...config.layers?.global_?.radar,
        },
        ...config.layers?.global,
        ...config.layers?.global_,
      },
    },
    panels: config.panels ?? DEFAULT_PANELS_CONFIG,
    calendar: config.calendar ?? DEFAULT_CALENDAR_CONFIG,
    secrets: config.secrets ?? {},
  };
}
