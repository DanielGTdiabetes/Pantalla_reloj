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
  provider: "xyz";
  xyz: XyzConfig;
  labelsOverlay?: LabelsOverlayConfig;
  viewMode: "fixed" | "aoiCycle";
  fixed?: MapFixedView;
  aoiCycle?: MapAoiCycle;
  region?: MapRegion;
};

export type AemetWarningsConfig = {
  enabled: boolean;
  min_severity: "yellow" | "orange" | "red" | "extreme";
};

export type AemetRadarConfig = {
  enabled: boolean;
  opacity: number;
  speed: number;
};

export type AemetSatConfig = {
  enabled: boolean;
  opacity: number;
};

export type AemetConfigV2 = {
  enabled: boolean;
  warnings?: AemetWarningsConfig;
  radar?: AemetRadarConfig;
  sat?: AemetSatConfig;
};

export type PanelRotateConfig = {
  enabled: boolean;
  order: string[];
  intervalSec: number;
};

export type PanelNewsConfig = {
  feeds: string[];
};

export type PanelEphemeridesConfig = {
  source: "built-in" | "api";
};

export type PanelConfig = {
  rotate?: PanelRotateConfig;
  news?: PanelNewsConfig;
  efemerides?: PanelEphemeridesConfig;
};

export type UIConfigV2 = {
  layout: "grid-2-1" | "grid-1-1" | "full";
  map: MapConfigV2;
  aemet?: AemetConfigV2;
  panel?: PanelConfig;
};

export type FlightsLayerSymbolConfigV2 = {
  size_vh: number;
  allow_overlap: boolean;
};

export type FlightsLayerCircleConfigV2 = {
  radius_vh: number;
  color: string;
  stroke_color: string;
  stroke_width: number;
};

export type FlightsLayerConfigV2 = {
  enabled: boolean;
  provider: "opensky" | "aviationstack" | "custom";
  render_mode: "auto" | "symbol" | "symbol_custom" | "circle";
  max_items_view: number;
  symbol?: FlightsLayerSymbolConfigV2;
  circle?: FlightsLayerCircleConfigV2;
};

export type ShipsLayerSymbolConfigV2 = {
  size_vh: number;
  allow_overlap: boolean;
};

export type ShipsLayerCircleConfigV2 = {
  radius_vh: number;
  color: string;
  stroke_color: string;
  stroke_width: number;
};

export type ShipsLayerConfigV2 = {
  enabled: boolean;
  provider: "aisstream" | "aishub" | "ais_generic" | "custom";
  decimate: "grid" | "none";
  grid_px: number;
  max_items_view: number;
  symbol?: ShipsLayerSymbolConfigV2;
  circle?: ShipsLayerCircleConfigV2;
};

export type LayersConfigV2 = {
  flights?: FlightsLayerConfigV2;
  ships?: ShipsLayerConfigV2;
};

export type SecretsConfig = {
  opensky?: Record<string, unknown>;
  google?: Record<string, unknown>;
  aemet?: Record<string, unknown>;
};

export type AppConfigV2 = {
  version: 2;
  ui: UIConfigV2;
  layers?: LayersConfigV2;
  secrets?: SecretsConfig;
};

