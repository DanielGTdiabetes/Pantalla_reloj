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
  apiKey?: string | null;
  styleUrl?: string | null;
  styleUrlDark: string | null;
  styleUrlLight: string | null;
  styleUrlBright: string | null;
};

export type XyzConfig = {
  urlTemplate: string;
  attribution: string;
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  labelsOverlay?: boolean;
};

export type MapViewMode = "fixed" | "aoiCycle";

export type MapCenter = {
  lat: number;
  lon: number;
};

export type MapViewState = {
  center: MapCenter;
  zoom: number;
  bearing: number;
  pitch: number;
};

export type MapRegion = {
  postalCode?: string;
};

export type MapFixedView = {
  center: MapCenter;
  zoom: number;
  bearing: number;
  pitch: number;
};

export type MapAoiCycleStop = {
  center: MapCenter;
  zoom: number;
  bearing: number;
  pitch: number;
  duration_sec?: number;
};

export type MapAoiCycle = {
  intervalSec: number;
  stops: MapAoiCycleStop[];
};

export type MapConfig = {
  engine: "maplibre";
  style:
  | "vector-dark"
  | "vector-light"
  | "vector-bright"
  | "raster-carto-dark"
  | "raster-carto-light"
  | "dark"
  | "light"
  | "bright"
  | "streets"
  | "streets-v4"
  | "satellite";
  provider: "maptiler" | "osm" | "openstreetmap" | "xyz";
  maptiler: MaptilerConfig;
  xyz?: XyzConfig;
  viewMode?: MapViewMode;
  fixed?: MapFixedView;
  aoiCycle?: MapAoiCycle;
  region?: MapRegion;
  renderWorldCopies: boolean;
  interactive: boolean;
  controls: boolean;
  respectReducedMotion: boolean;
  cinema: MapCinemaConfig;
  idlePan: MapIdlePanConfig;
  theme: MapThemeConfig;
  model?: string | null;
};

export type UIMapSettings = MapConfig;

export type MapPreferences = {
  provider: "maptiler" | "osm" | "openstreetmap" | "xyz";
  maptiler_api_key: string | null;
  model?: string | null;
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
  bbox?: OpenSkyBBoxConfig;
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

export type FlightsLayerRenderMode = "auto" | "symbol" | "symbol_custom" | "circle";

export type FlightsLayerCircleConfig = {
  radius_vh: number; // Radio en viewport height (%)
  opacity: number;
  color: string;
  stroke_color: string;
  stroke_width: number;
};

export type FlightsLayerSymbolConfig = {
  size_vh: number; // Tamaño en viewport height (%)
  allow_overlap: boolean;
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
  render_mode: FlightsLayerRenderMode;
  circle: FlightsLayerCircleConfig;
  symbol?: FlightsLayerSymbolConfig;
  cine_focus: CineFocusConfig;
  opensky?: OpenSkyAuthConfig;
  aviationstack?: AviationStackConfig;
  custom?: CustomFlightConfig;
};

export type ShipsLayerRenderMode = "auto" | "symbol" | "symbol_custom" | "circle";

export type ShipsLayerCircleConfig = {
  radius_vh: number; // Radio en viewport height (%)
  opacity: number;
  color: string;
  stroke_color: string;
  stroke_width: number;
};

export type ShipsLayerSymbolConfig = {
  size_vh: number; // Tamaño en viewport height (%)
  allow_overlap: boolean;
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
  render_mode: ShipsLayerRenderMode;
  circle: ShipsLayerCircleConfig;
  symbol?: ShipsLayerSymbolConfig;
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
  provider: "rainviewer" | "openweathermap" | "maptiler_weather";
  layer_type?: "precipitation_new" | "precipitation" | "temp_new" | "clouds" | "rain" | "wind" | "pressure";
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

// ==========================================
// V2 TYPES (Migrated from config_v2.ts)
// ==========================================

export type LocalRasterConfig = {
  tileUrl: string;
  minzoom: number;
  maxzoom: number;
};

export type MapTilerConfigV2 = {
  api_key: string | null;
  style?: string | null;
  styleUrl: string | null;
  // Legacy fields (read but not write)
  apiKey?: string | null;
  key?: string | null;
  styleUrlDark?: string | null;
  styleUrlLight?: string | null;
  styleUrlBright?: string | null;
  urls?: {
    styleUrlDark?: string | null;
    styleUrlLight?: string | null;
    styleUrlBright?: string | null;
  };
};

export type CustomXyzConfig = {
  tileUrl: string | null;
  minzoom: number;
  maxzoom: number;
};

export type SatelliteLabelsOverlay = {
  enabled: boolean;
  style_url?: string | null;
  layer_filter?: string | null;
  opacity?: number | null;
};

export type MapSatelliteConfig = {
  enabled: boolean;
  opacity: number;
  style_url?: string; // URL del estilo satélite (para obtener tiles raster)
  labels_enabled?: boolean; // Legacy
  labels_overlay?: boolean | SatelliteLabelsOverlay; // Soporta ambos formatos para migración
  provider: "maptiler";
  style_raster?: string; // Legacy
  style_labels?: string; // Legacy
  labels_style_url?: string; // Legacy, deprecated
};

export type MapConfigV2 = {
  engine: "maplibre";
  provider: "local_raster_xyz" | "maptiler_vector" | "custom_xyz";
  renderWorldCopies: boolean;
  interactive: boolean;
  controls: boolean;
  local?: LocalRasterConfig;
  maptiler?: MapTilerConfigV2;
  customXyz?: CustomXyzConfig;
  satellite?: MapSatelliteConfig;
  viewMode: "fixed" | "aoiCycle";
  fixed?: MapFixedView;
  aoiCycle?: MapAoiCycle;
  region?: MapRegion;
};

export type SatelliteConfig = {
  enabled: boolean;
  provider: "gibs";
  opacity: number;
};

export type RadarConfig = {
  enabled: boolean;
  provider: "rainviewer" | "aemet" | "maptiler_weather";
};

export type RotatorDurationsConfig = {
  clock: number;
  weather: number;
  astronomy: number;
  santoral: number;
  calendar: number;
  harvest: number;
  news: number;
  historicalEvents: number;
};

export type RotatorConfig = {
  enabled: boolean;
  order: string[];
  durations_sec?: RotatorDurationsConfig;
  transition_ms: number;
  pause_on_alert: boolean;
};

export type OverlayConfig = {
  rotator?: RotatorConfig;
};

export type UIRotationConfigV2 = RotationConfig;

export type UIConfigV2 = {
  rotation?: UIRotationConfigV2;
};

export type UIGlobalConfigV2 = {
  satellite?: SatelliteConfig;
  radar?: RadarConfig;
  overlay?: OverlayConfig;
};

export type FlightsLayerCircleConfigV2 = {
  radius_base: number;
  radius_zoom_scale: number;
  opacity: number;
  color: string;
  stroke_color: string;
  stroke_width: number;
};

export type FlightsLayerSymbolConfigV2 = {
  size_vh: number;
  allow_overlap: boolean;
};

export type OpenSkyProviderConfig = {
  mode: "oauth2" | "basic";
  bbox?: OpenSkyBBoxConfig;
  extended: number;
  token_url?: string | null;
  scope?: string | null;
};

export type OpenSkyOAuthConfigV2 = {
  client_id?: string | null;
  client_secret?: string | null;
  token_url?: string | null;
  scope?: string | null;
};

export type OpenSkyConfigV2 = {
  enabled: boolean;
  mode: "bbox" | "global";
  poll_seconds: number;
  max_aircraft: number;
  cluster: boolean;
  extended: number;
  bbox?: OpenSkyBBoxConfig;
  oauth2?: OpenSkyOAuthConfigV2;
};

export type AviationStackProviderConfig = {
  base_url: string;
};

export type CustomFlightProviderConfig = {
  api_url?: string | null;
  api_key?: string | null;
};

export type FlightsLayerConfigV2 = {
  enabled: boolean;
  provider: "opensky" | "aviationstack" | "custom";
  refresh_seconds: number;
  max_age_seconds: number;
  max_items_global: number;
  max_items_view: number;
  rate_limit_per_min: number;
  decimate: "none" | "grid";
  grid_px: number;
  styleScale: number;
  render_mode: "circle" | "symbol" | "symbol_custom" | "auto";
  circle?: FlightsLayerCircleConfigV2;
  symbol?: FlightsLayerSymbolConfigV2;
  opensky?: OpenSkyProviderConfig;
  aviationstack?: AviationStackProviderConfig;
  custom?: CustomFlightProviderConfig;
};

export type AISStreamProviderConfig = {
  ws_url: string;
  bbox?: OpenSkyBBoxConfig;
};

export type AISHubProviderConfig = {
  base_url: string;
};

export type AISGenericProviderConfig = {
  api_url?: string | null;
};

export type CustomShipProviderConfig = {
  api_url?: string | null;
  api_key?: string | null;
};

export type ShipsLayerConfigV2 = {
  enabled: boolean;
  provider: "aisstream" | "aishub" | "ais_generic" | "custom";
  refresh_seconds: number;
  max_age_seconds: number;
  max_items_global: number;
  max_items_view: number;
  rate_limit_per_min: number;
  decimate: "grid" | "none";
  grid_px: number;
  styleScale: number;
  aisstream?: AISStreamProviderConfig;
  aishub?: AISHubProviderConfig;
  ais_generic?: AISGenericProviderConfig;
  custom?: CustomShipProviderConfig;
};

export type GlobalRadarLayerConfigV2 = {
  enabled: boolean;
  provider: "rainviewer" | "maptiler_weather";
  opacity: number;
  layer_type?: string;
  refresh_minutes?: number;
  history_minutes?: number;
  frame_step?: number;
  animation_speed?: number;
  // Campos calculados automáticamente por el backend (no se persisten)
  has_api_key?: boolean;
  api_key_last4?: string | null;
};

export type GlobalSatelliteLayerConfigV2 = {
  enabled: boolean;
  provider: "gibs";
  refresh_minutes?: number;
  history_minutes?: number;
  frame_step?: number;
  layer?: string;
  tile_matrix_set?: string;
  min_zoom?: number;
  max_zoom?: number;
  default_zoom?: number;
  opacity?: number;
};

export type GlobalLayersConfigV2 = {
  satellite?: GlobalSatelliteLayerConfigV2;
  radar?: GlobalRadarLayerConfigV2;
};

export type LayersConfigV2 = {
  flights?: FlightsLayerConfigV2;
  ships?: ShipsLayerConfigV2;
  global?: GlobalLayersConfigV2;
  global_?: GlobalLayersConfigV2; // Alias para compatibilidad con backend
};

export type PanelWeatherWeeklyConfig = {
  enabled: boolean;
};

export type PanelEphemeridesConfig = {
  enabled: boolean;
};

export type PanelNewsConfig = {
  enabled: boolean;
  feeds: string[];
};

export type CalendarICSConfig = {
  filename?: string | null;
  stored_path?: string | null;  // Solo backend, no se expone en GET
  max_events?: number;
  days_ahead?: number;
  // Legacy fields
  mode?: "upload" | "url";
  file_path?: string | null;
  url?: string | null;
  last_ok?: string | null;
  last_error?: string | null;
};

export type CalendarGoogleConfig = {
  api_key?: string | null;
  calendar_id?: string | null;
};

export type CalendarConfigV2 = {
  enabled: boolean;
  source: "google" | "ics";
  ics?: CalendarICSConfig;
  google?: CalendarGoogleConfig;
  // Legacy fields
  google_api_key?: string | null;
  google_calendar_id?: string | null;
  days_ahead?: number;
  provider?: "google" | "ics" | "disabled";
  ics_path?: string;
};

export type PanelCalendarConfig = {
  enabled: boolean;
  provider?: "google" | "ics" | "disabled";
  ics_path?: string;
};

export type PanelHarvestConfig = {
  enabled: boolean;
};

export type PanelHistoricalEventsConfig = {
  enabled: boolean;
  rotation_seconds?: number;
  provider?: string;
  [key: string]: unknown;
};

export type PanelsConfigV2 = {
  weatherWeekly?: PanelWeatherWeeklyConfig;
  ephemerides?: PanelEphemeridesConfig;
  news?: PanelNewsConfig;
  calendar?: PanelCalendarConfig;
  harvest?: PanelHarvestConfig;
  historicalEvents?: PanelHistoricalEventsConfig;
};

export type HarvestConfigV2 = {
  enabled: boolean;
  custom_items?: Array<Record<string, string>>;
};

export type OpenSkyOAuth2SecretsConfig = {
  client_id?: string | null;
  client_secret?: string | null;
  token_url?: string | null;
  scope?: string | null;
};

export type OpenSkyBasicSecretsConfig = {
  username?: string | null;
  password?: string | null;
};

export type OpenSkySecretsConfig = {
  oauth2?: OpenSkyOAuth2SecretsConfig;
  basic?: OpenSkyBasicSecretsConfig;
};

export type AviationStackSecretsConfig = {
  api_key?: string | null;
};

export type AISStreamSecretsConfig = {
  api_key?: string | null;
};

export type AISHubSecretsConfig = {
  api_key?: string | null;
};

export type SecretsConfig = {
  opensky?: OpenSkySecretsConfig;
  google?: Record<string, unknown>;
  aemet?: Record<string, unknown>;
  calendar_ics?: Record<string, unknown>;
  aviationstack?: AviationStackSecretsConfig;
  aisstream?: AISStreamSecretsConfig;
  aishub?: AISHubSecretsConfig;
};

export type AppConfigV2 = {
  version: 2;
  ui_map: MapConfigV2;
  ui?: UIConfigV2;
  ui_global?: UIGlobalConfigV2;
  opensky: OpenSkyConfigV2;
  layers?: LayersConfigV2;
  panels?: PanelsConfigV2;
  secrets?: SecretsConfig;
  harvest?: HarvestConfigV2;
  calendar?: CalendarConfigV2;
};
