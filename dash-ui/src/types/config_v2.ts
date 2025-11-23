/**
 * Esquema v2 de configuración - limpio y mínimo para Fase 2.
 */

export type MapCenter = {
  lat: number;
  lon: number;
};

export type LocalRasterConfig = {
  tileUrl: string;
  minzoom: number;
  maxzoom: number;
};

export type MapTilerConfig = {
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

export type MapRegion = {
  postalCode?: string | null;
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
  maptiler?: MapTilerConfig;
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

export type UIRotationConfigV2 = {
  enabled: boolean;
  duration_sec: number;
  panels: string[];
};

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

export type OpenSkyBBoxConfig = {
  lamin: number;
  lamax: number;
  lomin: number;
  lomax: number;
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

export type CalendarConfig = {
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
  calendar?: CalendarConfig;
};
