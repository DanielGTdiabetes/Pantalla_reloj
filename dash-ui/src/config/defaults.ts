import type {
  AppConfig,
  DisplayModule,
  UISettings,
  UIScrollSettings,
  UIScrollSpeed,
} from "../types/config";

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
  map: {
    provider: "osm",
    center: [0, 20],
    zoom: 1.6,
    interactive: false,
    controls: false
  },
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
      map: {
        ...UI_DEFAULTS.map,
        ...(payload.ui?.map ?? {})
      },
      text: mergedScroll,
      layout: payload.ui?.layout,
      side_panel: payload.ui?.side_panel,
      show_config: payload.ui?.show_config,
      enable_demo: payload.ui?.enable_demo,
      carousel: payload.ui?.carousel
    }
  };
};
