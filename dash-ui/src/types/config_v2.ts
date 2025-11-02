/**
 * Esquema v2 de configuración - limpio y mínimo para Fase 2.
 */

export type MapCenter = {
  lat: number;
  lon: number;
};

export type XyzConfig = {
  urlTemplate: string;
  attribution: string;
  minzoom: number;
  maxzoom: number;
  tileSize: number;
};

export type LabelsOverlayConfig = {
  enabled: boolean;
  style: string;
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
  provider: "xyz" | "osm";
  xyz?: XyzConfig;
  labelsOverlay?: LabelsOverlayConfig;
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

export type UIGlobalConfigV2 = {
  satellite?: SatelliteConfig;
  radar?: RadarConfig;
};

export type FlightsLayerCircleConfigV2 = {
  radius_base: number;
  radius_zoom_scale: number;
  opacity: number;
  color: string;
  stroke_color: string;
  stroke_width: number;
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
};

export type ShipsLayerConfigV2 = {
  enabled: boolean;
  provider: "aisstream" | "aishub" | "ais_generic" | "custom";
  refresh_seconds: number;
  max_age_seconds: number;
  max_items_global: number;
  max_items_view: number;
  decimate: "grid" | "none";
  grid_px: number;
  styleScale: number;
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

export type PanelCalendarConfig = {
  enabled: boolean;
  provider?: "google" | "ics" | "disabled";
};

export type PanelsConfigV2 = {
  weatherWeekly?: PanelWeatherWeeklyConfig;
  ephemerides?: PanelEphemeridesConfig;
  news?: PanelNewsConfig;
  calendar?: PanelCalendarConfig;
};

export type SecretsConfig = {
  opensky?: Record<string, unknown>;
  google?: Record<string, unknown>;
  aemet?: Record<string, unknown>;
  calendar_ics?: Record<string, unknown>;
};

export type AppConfigV2 = {
  version: 2;
  ui_map: MapConfigV2;
  ui_global?: UIGlobalConfigV2;
  layers?: LayersConfigV2;
  panels?: PanelsConfigV2;
  secrets?: SecretsConfig;
};
