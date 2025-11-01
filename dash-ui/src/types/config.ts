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

export type MapCinemaMotionConfig = {
  speedPreset: "slow" | "medium" | "fast";
  amplitudeDeg: number;
  easing: "linear" | "ease-in-out";
  pauseWithOverlay: boolean;
  phaseOffsetDeg: number;
};

export type UIScrollSpeed = number | "slow" | "normal" | "fast";

export type MapCinemaConfig = {
  enabled: boolean;
  panLngDegPerSec: number;
  debug: boolean;
  bandTransition_sec: number;
  fsmEnabled: boolean;
  bands: MapCinemaBand[];
  motion: MapCinemaMotionConfig;
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
  cineMode?: boolean;
};

export type DisplayModule = {
  id: string;
  enabled: boolean;
  [key: string]: unknown;
};

export type NewsConfig = {
  enabled: boolean;
  rss_feeds: string[];
  max_items_per_feed: number;
  refresh_minutes: number;
};

export type CalendarConfig = {
  enabled: boolean;
  google_api_key: string | null;
  google_calendar_id: string | null;
  days_ahead: number;
};

export type HarvestConfig = {
  enabled: boolean;
  custom_items: Array<Record<string, string>>;
};

export type SaintsConfig = {
  enabled: boolean;
  include_namedays: boolean;
  locale: string;
};

export type EphemeridesConfig = {
  enabled: boolean;
  latitude: number;
  longitude: number;
  timezone: string;
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
  api_key?: string | null;
  cap_enabled: boolean;
  radar_enabled: boolean;
  satellite_enabled: boolean;
  cache_minutes: number;
  has_api_key?: boolean;
  api_key_last4?: string | null;
};

export type BlitzortungConfig = {
  enabled: boolean;
  mqtt_host: string;
  mqtt_port: number;
  mqtt_topic: string;
  ws_enabled: boolean;
  ws_url: string | null;
};

export type CineFocusConfig = {
  enabled: boolean;
  mode: "cap" | "radar" | "both";
  min_severity: "yellow" | "orange" | "red";
  radar_dbz_threshold: number;
  buffer_km: number;
  outside_dim_opacity: number;
  hard_hide_outside: boolean;
};

export type OpenSkyOAuthConfig = {
  token_url: string;
  scope: string | null;
  has_credentials: boolean;
  client_id_last4: string | null;
  client_id?: string | null;
  client_secret?: string | null;
};

export type OpenSkyBBoxConfig = {
  lamin: number;
  lamax: number;
  lomin: number;
  lomax: number;
};

export type OpenSkyConfig = {
  enabled: boolean;
  mode: "bbox" | "global";
  bbox: OpenSkyBBoxConfig;
  poll_seconds: number;
  extended: 0 | 1;
  max_aircraft: number;
  cluster: boolean;
  oauth2: OpenSkyOAuthConfig;
};

export type OpenSkyAuthConfig = {
  username?: string | null;
  password?: string | null;
};

export type AviationStackConfig = {
  base_url?: string | null;
  api_key?: string | null;
};

export type AISStreamConfig = {
  ws_url?: string | null;
  api_key?: string | null;
  has_api_key?: boolean;
  api_key_last4?: string | null;
};

export type AISHubConfig = {
  base_url?: string | null;
  api_key?: string | null;
};

export type GenericAISConfig = {
  api_url?: string | null;
  api_key?: string | null;
};

export type CustomFlightConfig = {
  api_url?: string | null;
  api_key?: string | null;
};

export type CustomShipConfig = {
  api_url?: string | null;
  api_key?: string | null;
};

export type FlightsLayerConfig = {
  enabled: boolean;
  opacity: number;
  provider: "opensky" | "aviationstack" | "custom";
  refresh_seconds: number;
  max_age_seconds: number;
  max_items_global: number;
  max_items_view: number;
  rate_limit_per_min: number;
  decimate: "grid" | "none";
  grid_px: number;
  styleScale: number;
  cine_focus: CineFocusConfig;
  opensky?: OpenSkyAuthConfig;
  aviationstack?: AviationStackConfig;
  custom?: CustomFlightConfig;
};

export type ShipsLayerConfig = {
  enabled: boolean;
  opacity: number;
  provider: "ais_generic" | "aisstream" | "aishub" | "custom";
  update_interval: number;
  refresh_seconds: number;
  max_age_seconds: number;
  max_items_global: number;
  max_items_view: number;
  min_speed_knots: number;
  rate_limit_per_min: number;
  decimate: "grid" | "none";
  grid_px: number;
  styleScale: number;
  cine_focus: CineFocusConfig;
  ais_generic?: GenericAISConfig;
  aisstream?: AISStreamConfig;
  aishub?: AISHubConfig;
  custom?: CustomShipConfig;
};

export type GlobalSatelliteLayerConfig = {
  enabled: boolean;
  provider: "gibs";
  refresh_minutes: number;
  history_minutes: number;
  frame_step: number;
  opacity: number;
};

export type GlobalRadarLayerConfig = {
  enabled: boolean;
  provider: "rainviewer" | "openweathermap";
  refresh_minutes: number;
  history_minutes: number;
  frame_step: number;
  opacity: number;
  has_api_key?: boolean;
  api_key_last4?: string | null;
};

export type GlobalLayersConfig = {
  satellite: GlobalSatelliteLayerConfig;
  radar: GlobalRadarLayerConfig;
};

export type LayersConfig = {
  flights: FlightsLayerConfig;
  ships: ShipsLayerConfig;
  global?: GlobalLayersConfig;
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
  calendar: CalendarConfig;
  harvest: HarvestConfig;
  saints: SaintsConfig;
  ephemerides: EphemeridesConfig;
  opensky: OpenSkyConfig;
  layers: LayersConfig;
};
