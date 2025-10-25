import type { AppConfig, DisplayModule, UISettings } from "../types/config";

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", ""].includes(normalized)) {
    return false;
  }
  return fallback;
};

const layoutFromEnv = (value: string | undefined): UISettings["layout"] => {
  return value === "widgets" ? "widgets" : "full";
};

const sidePanelFromEnv = (value: string | undefined): UISettings["side_panel"] => {
  return value === "left" ? "left" : "right";
};

const createDefaultModules = (): DisplayModule[] => [
  { name: "clock", enabled: true, duration_seconds: 20 },
  { name: "weather", enabled: true, duration_seconds: 20 },
  { name: "moon", enabled: true, duration_seconds: 20 },
  { name: "news", enabled: true, duration_seconds: 20 },
  { name: "events", enabled: true, duration_seconds: 20 },
  { name: "calendar", enabled: true, duration_seconds: 20 }
];

export const UI_DEFAULTS: UISettings = {
  layout: layoutFromEnv(import.meta.env.VITE_DEFAULT_LAYOUT),
  side_panel: sidePanelFromEnv(import.meta.env.VITE_SIDE_PANEL),
  show_config: parseBoolean(import.meta.env.VITE_SHOW_CONFIG, false),
  enable_demo: parseBoolean(import.meta.env.VITE_ENABLE_DEMO, false),
  carousel: parseBoolean(import.meta.env.VITE_CAROUSEL, false)
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
      ...UI_DEFAULTS,
      ...(payload.ui ?? {})
    }
  };
};
