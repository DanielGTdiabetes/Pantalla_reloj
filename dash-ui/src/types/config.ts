export type DisplayConfig = {
  timezone: string;
  module_cycle_seconds: number;
};

export type MapCinemaBand = {
  lat: number;
  zoom: number;
  pitch: number;
  minZoom: number;
  duration_sec: number;
};

export type UIScrollSpeed = number | "slow" | "normal" | "fast";

export type MapCinemaConfig = {
  enabled: boolean;
  panLngDegPerSec: number;
  bandTransition_sec: number;
  bands: MapCinemaBand[];
};

export type MapIdlePanConfig = {
  enabled: boolean;
  intervalSec: number;
};

export type MapThemeConfig = {
  sea: string;
  land: string;
  label: string;
  contrast: number;
  tint: string;
};

export type MaptilerConfig = {
  key: string | null;
  styleUrlDark: string | null;
  styleUrlLight: string | null;
  styleUrlBright: string | null;
};

export type MapConfig = {
  engine: "maplibre";
  style: "vector-dark" | "vector-light" | "vector-bright" | "raster-carto-dark" | "raster-carto-light";
  provider: "maptiler" | "osm";
  maptiler: MaptilerConfig;
  renderWorldCopies: boolean;
  interactive: boolean;
  controls: boolean;
  respectReducedMotion: boolean;
  cinema: MapCinemaConfig;
  idlePan: MapIdlePanConfig;
  theme: MapThemeConfig;
};

export type UIMapSettings = MapConfig;

export type MapPreferences = {
  provider: "maptiler" | "osm";
  maptiler_api_key: string | null;
};

export type RotationConfig = {
  enabled: boolean;
  duration_sec: number;
  panels: string[];
};

export type UIConfig = {
  layout: "grid-2-1";
  map: MapConfig;
  rotation: RotationConfig;
};

export type DisplayModule = {
  id: string;
  enabled: boolean;
  [key: string]: unknown;
};

export type NewsConfig = {
  enabled: boolean;
};

export type AIConfig = {
  enabled: boolean;
};

export type StormModeConfig = {
  enabled: boolean;
  center_lat: number;
  center_lng: number;
  zoom: number;
  auto_enable: boolean;
  auto_disable_after_minutes: number;
};

export type AEMETConfig = {
  enabled: boolean;
  api_key: string | null;
  cap_enabled: boolean;
  radar_enabled: boolean;
  satellite_enabled: boolean;
  cache_minutes: number;
};

export type BlitzortungConfig = {
  enabled: boolean;
  mqtt_host: string;
  mqtt_port: number;
  mqtt_topic: string;
  ws_enabled: boolean;
  ws_url: string | null;
};

export type AppConfig = {
  display: DisplayConfig;
  map: MapPreferences;
  ui: UIConfig;
  news: NewsConfig;
  ai: AIConfig;
  storm: StormModeConfig;
  aemet: AEMETConfig;
  blitzortung: BlitzortungConfig;
};
