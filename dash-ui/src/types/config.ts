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

export type UISettings = {
  layout: "full" | "widgets";
  side_panel: "left" | "right";
  show_config: boolean;
  enable_demo: boolean;
  carousel: boolean;
};

export type AppConfig = {
  display: DisplaySettings;
  api_keys: APIKeys;
  mqtt: MQTTSettings;
  wifi: WiFiSettings;
  storm_mode: StormMode;
  ui: UISettings;
};
