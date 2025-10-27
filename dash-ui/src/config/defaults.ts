import type {
  AppConfig,
  DisplayModule,
  UIMapCinemaBand,
  UIMapCinemaSettings,
  UIMapProviderMapTiler,
  UIMapSettings,
  UIMapThemeSettings,
  UISettings,
  UIScrollSettings,
  UIScrollSpeed,
} from "../types/config";

const sanitizeString = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
};

const sanitizeNumber = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const sanitizePositive = (value: unknown, fallback: number, min = 0): number => {
  const numeric = sanitizeNumber(value, fallback);
  return numeric > min ? numeric : fallback;
};

const sanitizeNonNegative = (value: unknown, fallback: number): number => {
  const numeric = sanitizeNumber(value, fallback);
  return numeric >= 0 ? numeric : fallback;
};

const CINEMA_BANDS_PRESET: readonly UIMapCinemaBand[] = [
  { lat: 0, zoom: 2.8, pitch: 10, minZoom: 2.6, duration_sec: 900 },
  { lat: 18, zoom: 3.0, pitch: 8, minZoom: 2.8, duration_sec: 720 },
  { lat: 32, zoom: 3.3, pitch: 6, minZoom: 3.0, duration_sec: 600 },
  { lat: 42, zoom: 3.6, pitch: 6, minZoom: 3.2, duration_sec: 480 },
  { lat: -18, zoom: 3.0, pitch: 8, minZoom: 2.8, duration_sec: 720 },
  { lat: -32, zoom: 3.3, pitch: 6, minZoom: 3.0, duration_sec: 600 }
];

const DEFAULT_MAP_THEME: UIMapThemeSettings = {
  sea: "#0b3756",
  land: "#20262c",
  label: "#d6e7ff",
  contrast: 0.15,
  tint: "rgba(0,170,255,0.06)",
};

const DEFAULT_MAPTILER: UIMapProviderMapTiler = {
  key: null,
  styleUrlDark: "https://api.maptiler.com/maps/dark/style.json",
  styleUrlLight: "https://api.maptiler.com/maps/streets/style.json",
  styleUrlBright: "https://api.maptiler.com/maps/bright/style.json",
};

const createDefaultMapTheme = (): UIMapThemeSettings => ({ ...DEFAULT_MAP_THEME });

const createDefaultMaptiler = (): UIMapProviderMapTiler => ({ ...DEFAULT_MAPTILER });

export const createDefaultMapCinema = (): UIMapCinemaSettings => ({
  enabled: true,
  panLngDegPerSec: 0.3,
  bands: CINEMA_BANDS_PRESET.map((band) => ({ ...band })),
  bandTransition_sec: 8
});

export const createDefaultMapSettings = (): UIMapSettings => ({
  engine: "maplibre",
  provider: "carto",
  center: [0, 0],
  zoom: 2.6,
  interactive: false,
  controls: false,
  renderWorldCopies: true,
  cinema: createDefaultMapCinema(),
  style: "raster-carto-dark",
  theme: createDefaultMapTheme(),
  maptiler: createDefaultMaptiler()
});

const mergeCinema = (cinema?: UIMapCinemaSettings): UIMapCinemaSettings => {
  const defaults = createDefaultMapCinema();
  if (!cinema) {
    return createDefaultMapCinema();
  }

  const bands = defaults.bands.map((fallback, index) => {
    const candidate = cinema.bands?.[index];
    return {
      lat: sanitizeNumber(candidate?.lat, fallback.lat),
      zoom: sanitizeNumber(candidate?.zoom, fallback.zoom),
      pitch: sanitizeNumber(candidate?.pitch, fallback.pitch),
      minZoom: sanitizeNonNegative(candidate?.minZoom, fallback.minZoom),
      duration_sec: sanitizePositive(candidate?.duration_sec, fallback.duration_sec)
    } as UIMapCinemaBand;
  });

  return {
    enabled: cinema.enabled ?? defaults.enabled,
    panLngDegPerSec: sanitizePositive(cinema.panLngDegPerSec, defaults.panLngDegPerSec),
    bands,
    bandTransition_sec: sanitizePositive(cinema.bandTransition_sec, defaults.bandTransition_sec)
  };
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

const mergeTheme = (theme?: UIMapThemeSettings): UIMapThemeSettings => {
  const defaults = createDefaultMapTheme();
  if (!theme) {
    return createDefaultMapTheme();
  }

  return {
    sea: sanitizeNullableString(theme.sea, defaults.sea ?? null),
    land: sanitizeNullableString(theme.land, defaults.land ?? null),
    label: sanitizeNullableString(theme.label, defaults.label ?? null),
    contrast: theme.contrast ?? defaults.contrast ?? 0,
    tint: sanitizeNullableString(theme.tint, defaults.tint ?? null)
  };
};

const mergeMaptiler = (maptiler?: UIMapProviderMapTiler): UIMapProviderMapTiler => {
  const defaults = createDefaultMaptiler();
  if (!maptiler) {
    return createDefaultMaptiler();
  }

  return {
    key: sanitizeNullableString(maptiler.key, defaults.key ?? null),
    styleUrlDark: sanitizeNullableString(maptiler.styleUrlDark, defaults.styleUrlDark ?? null),
    styleUrlLight: sanitizeNullableString(maptiler.styleUrlLight, defaults.styleUrlLight ?? null),
    styleUrlBright: sanitizeNullableString(maptiler.styleUrlBright, defaults.styleUrlBright ?? null)
  };
};

const mergeMapSettings = (map?: UIMapSettings): UIMapSettings => {
  const defaults = createDefaultMapSettings();
  const source = map ?? defaults;
  const center = source.center ?? defaults.center;
  const sanitizedCenter: [number, number] = [
    sanitizeNumber(center?.[0], defaults.center[0]),
    sanitizeNumber(center?.[1], defaults.center[1])
  ];

  return {
    engine: source.engine ?? defaults.engine,
    provider: sanitizeString(source.provider, defaults.provider),
    center: sanitizedCenter,
    zoom: sanitizeNumber(source.zoom, defaults.zoom),
    interactive: source.interactive ?? defaults.interactive,
    controls: source.controls ?? defaults.controls,
    renderWorldCopies: source.renderWorldCopies ?? defaults.renderWorldCopies,
    cinema: mergeCinema(source.cinema),
    style: sanitizeString(source.style ?? defaults.style ?? "raster-carto-dark", "raster-carto-dark"),
    theme: mergeTheme(source.theme),
    maptiler: mergeMaptiler(source.maptiler)
  };
};

const createDefaultModules = (): DisplayModule[] => [
  { name: "clock", enabled: true, duration_seconds: 20 },
  { name: "weather", enabled: true, duration_seconds: 20 },
  { name: "moon", enabled: true, duration_seconds: 20 },
  { name: "news", enabled: true, duration_seconds: 20 },
  { name: "events", enabled: true, duration_seconds: 20 },
  { name: "calendar", enabled: true, duration_seconds: 20 }
];

const createScrollDefaults = (): Record<string, UIScrollSettings> => ({
  news: { enabled: true, direction: "left", speed: "normal", gap_px: 48 },
  ephemerides: { enabled: true, direction: "up", speed: "slow", gap_px: 24 },
  forecast: { enabled: true, direction: "up", speed: "slow", gap_px: 24 }
});

export const UI_DEFAULTS: UISettings = {
  rotation: {
    enabled: true,
    duration_sec: 10,
    panels: ["news", "ephemerides", "moon", "forecast", "calendar"]
  },
  fixed: {
    clock: { format: "HH:mm" },
    temperature: { unit: "C" }
  },
  map: createDefaultMapSettings(),
  text: {
    scroll: createScrollDefaults()
  }
};

export const DEFAULT_CONFIG: AppConfig = {
  display: {
    timezone: "Europe/Madrid",
    rotation: "left",
    module_cycle_seconds: 20,
    modules: createDefaultModules()
  },
  api_keys: {
    weather: null,
    news: null,
    astronomy: null,
    calendar: null
  },
  mqtt: {
    enabled: false,
    host: "localhost",
    port: 1883,
    topic: "pantalla/reloj",
    username: null,
    password: null
  },
  wifi: {
    interface: "wlan2",
    ssid: null,
    psk: null
  },
  storm_mode: {
    enabled: false,
    last_triggered: null
  },
  ui: UI_DEFAULTS
};

export const withConfigDefaults = (payload?: Partial<AppConfig>): AppConfig => {
  if (!payload) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig;
  }

  const displayModules = payload.display?.modules ?? DEFAULT_CONFIG.display.modules;

  const mergeScroll = (scroll?: UISettings["text"]["scroll"]): UISettings["text"] => {
    const defaults = createScrollDefaults();
    if (!scroll) {
      return { scroll: defaults };
    }
    const result: Record<string, UIScrollSettings> = { ...defaults };
    for (const [key, value] of Object.entries(scroll)) {
      result[key] = { ...defaults[key], ...value };
    }
    return { scroll: result };
  };

  const mergeSpeed = (speed: UIScrollSpeed | undefined): UIScrollSpeed => {
    if (speed === undefined || speed === null) {
      return "normal";
    }
    if (typeof speed === "string" && ["slow", "normal", "fast"].includes(speed)) {
      return speed;
    }
    if (Number.isFinite(Number(speed))) {
      return Number(speed);
    }
    return "normal";
  };

  const mergedScroll = mergeScroll(payload.ui?.text?.scroll);
  for (const [key, value] of Object.entries(mergedScroll.scroll)) {
    value.speed = mergeSpeed(value.speed);
    const gap = Number(value.gap_px);
    const fallback = createScrollDefaults()[key]?.gap_px ?? 48;
    value.gap_px = Number.isFinite(gap) && gap >= 0 ? gap : fallback;
  }

  return {
    display: {
      ...DEFAULT_CONFIG.display,
      ...payload.display,
      modules: displayModules.map((module) => ({ ...module }))
    },
    api_keys: {
      ...DEFAULT_CONFIG.api_keys,
      ...payload.api_keys
    },
    mqtt: {
      ...DEFAULT_CONFIG.mqtt,
      ...payload.mqtt
    },
    wifi: {
      ...DEFAULT_CONFIG.wifi,
      ...payload.wifi
    },
    storm_mode: {
      ...DEFAULT_CONFIG.storm_mode,
      ...payload.storm_mode
    },
    ui: {
      rotation: {
        ...UI_DEFAULTS.rotation,
        ...(payload.ui?.rotation ?? {})
      },
      fixed: {
        clock: {
          ...UI_DEFAULTS.fixed.clock,
          ...(payload.ui?.fixed?.clock ?? {})
        },
        temperature: {
          ...UI_DEFAULTS.fixed.temperature,
          ...(payload.ui?.fixed?.temperature ?? {})
        }
      },
      map: mergeMapSettings(payload.ui?.map),
      text: mergedScroll,
      layout: payload.ui?.layout,
      side_panel: payload.ui?.side_panel,
      show_config: payload.ui?.show_config,
      enable_demo: payload.ui?.enable_demo,
      carousel: payload.ui?.carousel
    }
  };
};
