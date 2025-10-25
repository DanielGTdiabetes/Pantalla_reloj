export type DisplayModule = {
  name: string;
  enabled: boolean;
  duration_seconds: number;
};

export type DisplaySettings = {
  timezone: string;
  rotation: string;
  module_cycle_seconds: number;
  modules: DisplayModule[];
};

export type APIKeys = {
  weather: string | null;
  news: string | null;
  astronomy: string | null;
  calendar: string | null;
};

export type MQTTSettings = {
  enabled: boolean;
  host: string;
  port: number;
  topic: string;
  username: string | null;
  password: string | null;
};

export type WiFiSettings = {
  interface: string;
  ssid: string | null;
  psk: string | null;
};

export type StormMode = {
  enabled: boolean;
  last_triggered: string | null;
};

export type AppConfig = {
  display: DisplaySettings;
  api_keys: APIKeys;
  mqtt: MQTTSettings;
  wifi: WiFiSettings;
  storm_mode: StormMode;
};

export const DEFAULT_CONFIG: AppConfig = {
  display: {
    timezone: "Europe/Madrid",
    rotation: "left",
    module_cycle_seconds: 20,
    modules: [
      { name: "clock", enabled: true, duration_seconds: 20 },
      { name: "weather", enabled: true, duration_seconds: 20 },
      { name: "moon", enabled: true, duration_seconds: 20 },
      { name: "news", enabled: true, duration_seconds: 20 },
      { name: "events", enabled: true, duration_seconds: 20 },
      { name: "calendar", enabled: true, duration_seconds: 20 }
    ]
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
  }
};
