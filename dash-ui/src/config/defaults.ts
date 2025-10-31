import type {
  AEMETConfig,
  AIConfig,
  AppConfig,
  BlitzortungConfig,
  DisplayConfig,
  MapCinemaBand,
  MapCinemaConfig,
  MapConfig,
  MapIdlePanConfig,
  MapThemeConfig,
  MaptilerConfig,
  MapPreferences,
  NewsConfig,
  RotationConfig,
  StormModeConfig,
  UIConfig,
} from "../types/config";

const clampNumber = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const toNumber = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const sanitizeString = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
};

const sanitizeNullableString = (value: unknown, fallback: string | null): string | null => {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  return fallback;
};

const DEFAULT_CINEMA_BANDS: readonly MapCinemaBand[] = [
  { lat: 0, zoom: 2.8, pitch: 10, minZoom: 2.6, duration_sec: 900 },
  { lat: 18, zoom: 3.0, pitch: 8, minZoom: 2.8, duration_sec: 720 },
  { lat: 32, zoom: 3.3, pitch: 6, minZoom: 3.0, duration_sec: 600 },
  { lat: 42, zoom: 3.6, pitch: 6, minZoom: 3.2, duration_sec: 480 },
  { lat: -18, zoom: 3.0, pitch: 8, minZoom: 2.8, duration_sec: 720 },
  { lat: -32, zoom: 3.3, pitch: 6, minZoom: 3.0, duration_sec: 600 },
];

const DEFAULT_THEME: MapThemeConfig = {
  sea: "#0b3756",
  land: "#20262c",
  label: "#d6e7ff",
  contrast: 0.15,
  tint: "rgba(0,170,255,0.06)",
};

const DEFAULT_MAPTILER: MaptilerConfig = {
  key: null,
  styleUrlDark: "https://api.maptiler.com/maps/dark/style.json",
  styleUrlLight: "https://api.maptiler.com/maps/streets/style.json",
  styleUrlBright: "https://api.maptiler.com/maps/bright/style.json",
};

const sanitizeApiKey = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
};

export const createDefaultMapPreferences = (): MapPreferences => ({
  provider: "osm",
  maptiler_api_key: null,
});

export const createDefaultMapCinema = (): MapCinemaConfig => ({
  enabled: false,
  panLngDegPerSec: 0,
  bandTransition_sec: 8,
  bands: DEFAULT_CINEMA_BANDS.map((band) => ({ ...band })),
});

export const createDefaultMapIdlePan = (): MapIdlePanConfig => ({
  enabled: false,
  intervalSec: 300,
});

export const createDefaultMapSettings = (): MapConfig => ({
  engine: "maplibre",
  style: "vector-dark",
  provider: "osm",
  maptiler: { ...DEFAULT_MAPTILER },
  renderWorldCopies: true,
  interactive: false,
  controls: false,
  respectReducedMotion: false,
  cinema: createDefaultMapCinema(),
  idlePan: createDefaultMapIdlePan(),
  theme: { ...DEFAULT_THEME },
});

const mergeCinemaBand = (candidate: unknown, fallback: MapCinemaBand): MapCinemaBand => {
  const source = (candidate as Partial<MapCinemaBand>) ?? {};
  const zoom = toNumber(source.zoom, fallback.zoom);
  const minZoom = Math.min(toNumber(source.minZoom, fallback.minZoom), zoom);
  return {
    lat: toNumber(source.lat, fallback.lat),
    zoom,
    pitch: toNumber(source.pitch, fallback.pitch),
    minZoom,
    duration_sec: Math.max(1, Math.round(toNumber(source.duration_sec, fallback.duration_sec))),
  };
};

const mergeCinema = (candidate: unknown): MapCinemaConfig => {
  const fallback = createDefaultMapCinema();
  const source = (candidate as Partial<MapCinemaConfig>) ?? {};
  const bandsSource = Array.isArray(source.bands) ? source.bands : [];
  const bands = DEFAULT_CINEMA_BANDS.map((band, index) => mergeCinemaBand(bandsSource[index], band));
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    panLngDegPerSec: Math.max(0, toNumber(source.panLngDegPerSec, fallback.panLngDegPerSec)),
    bandTransition_sec: Math.max(1, Math.round(toNumber(source.bandTransition_sec, fallback.bandTransition_sec))),
    bands,
  };
};

const mergeIdlePan = (candidate: unknown): MapIdlePanConfig => {
  const fallback = createDefaultMapIdlePan();
  const source = (candidate as Partial<MapIdlePanConfig>) ?? {};
  const interval = Math.max(10, Math.round(toNumber(source.intervalSec, fallback.intervalSec)));
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    intervalSec: interval,
  };
};

const mergeTheme = (candidate: unknown): MapThemeConfig => {
  const fallback = { ...DEFAULT_THEME };
  const source = (candidate as Partial<MapThemeConfig>) ?? {};
  return {
    sea: sanitizeString(source.sea, fallback.sea),
    land: sanitizeString(source.land, fallback.land),
    label: sanitizeString(source.label, fallback.label),
    contrast: toNumber(source.contrast, fallback.contrast),
    tint: sanitizeString(source.tint, fallback.tint),
  };
};

const mergeMaptiler = (candidate: unknown): MaptilerConfig => {
  const fallback = { ...DEFAULT_MAPTILER };
  const source = (candidate as Partial<MaptilerConfig>) ?? {};
  return {
    key: sanitizeNullableString(source.key, fallback.key),
    styleUrlDark: sanitizeNullableString(source.styleUrlDark, fallback.styleUrlDark),
    styleUrlLight: sanitizeNullableString(source.styleUrlLight, fallback.styleUrlLight),
    styleUrlBright: sanitizeNullableString(source.styleUrlBright, fallback.styleUrlBright),
  };
};

const mergeMap = (candidate: unknown): MapConfig => {
  const fallback = createDefaultMapSettings();
  const source = (candidate as Partial<MapConfig>) ?? {};
  const allowedStyles: MapConfig["style"][] = [
    "vector-dark",
    "vector-light",
    "vector-bright",
    "raster-carto-dark",
    "raster-carto-light",
  ];
  const allowedProviders: MapConfig["provider"][] = ["maptiler", "osm"];
  const style = allowedStyles.includes(source.style ?? fallback.style)
    ? (source.style as MapConfig["style"])
    : fallback.style;
  const provider = allowedProviders.includes(source.provider ?? fallback.provider)
    ? (source.provider as MapConfig["provider"])
    : fallback.provider;
  return {
    engine: "maplibre",
    style,
    provider,
    maptiler: mergeMaptiler(source.maptiler),
    renderWorldCopies: toBoolean(source.renderWorldCopies, fallback.renderWorldCopies),
    interactive: toBoolean(source.interactive, fallback.interactive),
    controls: toBoolean(source.controls, fallback.controls),
    respectReducedMotion: toBoolean(
      (source as { respectReducedMotion?: unknown })?.respectReducedMotion,
      fallback.respectReducedMotion
    ),
    cinema: mergeCinema(source.cinema),
    idlePan: mergeIdlePan((source as { idlePan?: unknown })?.idlePan),
    theme: mergeTheme(source.theme),
  };
};

const mergeMapPreferences = (candidate: unknown): MapPreferences => {
  const fallback = createDefaultMapPreferences();
  const source = (candidate as Partial<MapPreferences>) ?? {};
  const provider: MapPreferences["provider"] = source.provider === "maptiler" ? "maptiler" : fallback.provider;
  const key = sanitizeApiKey(source.maptiler_api_key);
  return {
    provider,
    maptiler_api_key: provider === "maptiler" ? key : null,
  };
};

const mergeRotation = (candidate: unknown): RotationConfig => {
  const fallback: RotationConfig = {
    enabled: false,
    duration_sec: 10,
    panels: ["news", "ephemerides", "moon", "forecast", "calendar"],
  };
  const source = (candidate as Partial<RotationConfig>) ?? {};
  const panels = Array.isArray(source.panels)
    ? source.panels.filter((panel): panel is string => typeof panel === "string" && panel.trim().length > 0)
    : fallback.panels;
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    duration_sec: clampNumber(Math.round(toNumber(source.duration_sec, fallback.duration_sec)), 3, 3600),
    panels: panels.length > 0 ? panels : fallback.panels,
  };
};

export const createDefaultStormMode = (): StormModeConfig => ({
  enabled: false,
  center_lat: 39.986,
  center_lng: -0.051,
  zoom: 9.0,
  auto_enable: false,
  auto_disable_after_minutes: 60,
});

export const createDefaultAEMET = (): AEMETConfig => ({
  enabled: false,
  api_key: null,
  cap_enabled: true,
  radar_enabled: true,
  satellite_enabled: false,
  cache_minutes: 15,
});

export const createDefaultBlitzortung = (): BlitzortungConfig => ({
  enabled: false,
  mqtt_host: "127.0.0.1",
  mqtt_port: 1883,
  mqtt_topic: "blitzortung/1",
  ws_enabled: false,
  ws_url: null,
});

export const DEFAULT_CONFIG: AppConfig = {
  display: {
    timezone: "Europe/Madrid",
    module_cycle_seconds: 20,
  },
  map: createDefaultMapPreferences(),
  ui: {
    layout: "grid-2-1",
    map: createDefaultMapSettings(),
    rotation: mergeRotation(undefined),
  },
  news: {
    enabled: true,
  },
  ai: {
    enabled: false,
  },
  storm: createDefaultStormMode(),
  aemet: createDefaultAEMET(),
  blitzortung: createDefaultBlitzortung(),
};

const mergeStormMode = (candidate: unknown): StormModeConfig => {
  const fallback = createDefaultStormMode();
  const source = (candidate as Partial<StormModeConfig>) ?? {};
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    center_lat: clampNumber(toNumber(source.center_lat, fallback.center_lat), -90, 90),
    center_lng: clampNumber(toNumber(source.center_lng, fallback.center_lng), -180, 180),
    zoom: clampNumber(toNumber(source.zoom, fallback.zoom), 1, 20),
    auto_enable: toBoolean(source.auto_enable, fallback.auto_enable),
    auto_disable_after_minutes: clampNumber(
      Math.round(toNumber(source.auto_disable_after_minutes, fallback.auto_disable_after_minutes)),
      5,
      1440,
    ),
  };
};

const mergeAEMET = (candidate: unknown): AEMETConfig => {
  const fallback = createDefaultAEMET();
  const source = (candidate as Partial<AEMETConfig>) ?? {};
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    api_key: sanitizeNullableString(source.api_key, fallback.api_key),
    cap_enabled: toBoolean(source.cap_enabled, fallback.cap_enabled),
    radar_enabled: toBoolean(source.radar_enabled, fallback.radar_enabled),
    satellite_enabled: toBoolean(source.satellite_enabled, fallback.satellite_enabled),
    cache_minutes: clampNumber(
      Math.round(toNumber(source.cache_minutes, fallback.cache_minutes)),
      1,
      60,
    ),
  };
};

const mergeBlitzortung = (candidate: unknown): BlitzortungConfig => {
  const fallback = createDefaultBlitzortung();
  const source = (candidate as Partial<BlitzortungConfig>) ?? {};
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    mqtt_host: sanitizeString(source.mqtt_host, fallback.mqtt_host),
    mqtt_port: clampNumber(Math.round(toNumber(source.mqtt_port, fallback.mqtt_port)), 1, 65535),
    mqtt_topic: sanitizeString(source.mqtt_topic, fallback.mqtt_topic),
    ws_enabled: toBoolean(source.ws_enabled, fallback.ws_enabled),
    ws_url: sanitizeNullableString(source.ws_url, fallback.ws_url),
  };
};

export const withConfigDefaults = (payload?: Partial<AppConfig>): AppConfig => {
  if (!payload) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig;
  }

  const display = (payload.display ?? {}) as Partial<DisplayConfig>;
  const map = (payload.map ?? {}) as Partial<MapPreferences>;
  const ui = (payload.ui ?? {}) as Partial<UIConfig>;
  const news = (payload.news ?? {}) as Partial<NewsConfig>;
  const ai = (payload.ai ?? {}) as Partial<AIConfig>;
  const storm = (payload.storm ?? {}) as Partial<StormModeConfig>;
  const aemet = (payload.aemet ?? {}) as Partial<AEMETConfig>;
  const blitzortung = (payload.blitzortung ?? {}) as Partial<BlitzortungConfig>;

  return {
    display: {
      timezone: sanitizeString(display.timezone, DEFAULT_CONFIG.display.timezone),
      module_cycle_seconds: clampNumber(
        Math.round(toNumber(display.module_cycle_seconds, DEFAULT_CONFIG.display.module_cycle_seconds)),
        5,
        600,
      ),
    },
    map: mergeMapPreferences(map),
    ui: {
      layout: "grid-2-1",
      map: mergeMap(ui.map),
      rotation: mergeRotation(ui.rotation),
    },
    news: {
      enabled: toBoolean(news.enabled, DEFAULT_CONFIG.news.enabled),
    },
    ai: {
      enabled: toBoolean(ai.enabled, DEFAULT_CONFIG.ai.enabled),
    },
    storm: mergeStormMode(storm),
    aemet: mergeAEMET(aemet),
    blitzortung: mergeBlitzortung(blitzortung),
  };
};
