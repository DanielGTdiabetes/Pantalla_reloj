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
  apiKey: string | null;
  styleUrl: string | null;
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

export type MapConfigV2 = {
  engine: "maplibre";
  provider: "local_raster_xyz" | "maptiler_vector" | "custom_xyz";
  renderWorldCopies: boolean;
  interactive: boolean;
  controls: boolean;
  local?: LocalRasterConfig;
  maptiler?: MapTilerConfig;
  customXyz?: CustomXyzConfig;
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
  provider: "rainviewer" | "aemet";
};

export type RotatorDurationsConfig = {
  clock: number;
  weather: number;
  astronomy: number;
  santoral: number;
  calendar: number;
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

export type LayersConfigV2 = {
  flights?: FlightsLayerConfigV2;
  ships?: ShipsLayerConfigV2;
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
  mode: "upload" | "url";
  file_path?: string | null;
  url?: string | null;
  last_ok?: string | null;
  last_error?: string | null;
};

export type CalendarConfig = {
  enabled: boolean;
  source: "google" | "ics";
  google_api_key?: string | null;
  google_calendar_id?: string | null;
  ics?: CalendarICSConfig;
  days_ahead?: number;
  // Legacy
  provider?: "google" | "ics" | "disabled";
  ics_path?: string;
};

export type PanelCalendarConfig = {
  enabled: boolean;
  provider?: "google" | "ics" | "disabled";
  ics_path?: string;
};

export type PanelsConfigV2 = {
  weatherWeekly?: PanelWeatherWeeklyConfig;
  ephemerides?: PanelEphemeridesConfig;
  news?: PanelNewsConfig;
  calendar?: PanelCalendarConfig;
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
  ui_global?: UIGlobalConfigV2;
  layers?: LayersConfigV2;
  panels?: PanelsConfigV2;
  secrets?: SecretsConfig;
  calendar?: CalendarConfig;
};
