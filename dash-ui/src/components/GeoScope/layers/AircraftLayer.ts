import maplibregl from "maplibre-gl";
import type { MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { FlightsLayerCircleConfig, FlightsLayerRenderMode } from "../../../types/config";
import type { Layer } from "./LayerRegistry";
import { getExistingPopup, isGeoJSONSource } from "./layerUtils";

type EffectiveRenderMode = "symbol" | "circle";

type CircleOptions = {
  radiusBase: number;
  radiusZoomScale: number;
  opacity: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
};

interface AircraftLayerOptions {
  enabled?: boolean;
  opacity?: number;
  maxAgeSeconds?: number;
  cineFocus?: {
    enabled: boolean;
    outsideDimOpacity: number;
    hardHideOutside: boolean;
  };
  cluster?: boolean;
  styleScale?: number;
  renderMode?: FlightsLayerRenderMode;
  circle?: FlightsLayerCircleConfig;
  spriteAvailable?: boolean;
  iconImage?: string;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const DEFAULT_ICON_IMAGE = "airplane-15";
const DEFAULT_CIRCLE_OPTIONS: CircleOptions = {
  radiusBase: 3.0,
  radiusZoomScale: 1.2,
  opacity: 1.0,
  color: "#00D1FF",
  strokeColor: "#002A33",
  strokeWidth: 1.0,
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const coerceNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeCircleOptions = (options?: FlightsLayerCircleConfig): CircleOptions => {
  const source = options ?? {
    radius_base: DEFAULT_CIRCLE_OPTIONS.radiusBase,
    radius_zoom_scale: DEFAULT_CIRCLE_OPTIONS.radiusZoomScale,
    opacity: DEFAULT_CIRCLE_OPTIONS.opacity,
    color: DEFAULT_CIRCLE_OPTIONS.color,
    stroke_color: DEFAULT_CIRCLE_OPTIONS.strokeColor,
    stroke_width: DEFAULT_CIRCLE_OPTIONS.strokeWidth,
  };

  const color = typeof source.color === "string" && source.color.trim().length > 0
    ? source.color.trim()
    : DEFAULT_CIRCLE_OPTIONS.color;
  const strokeColor = typeof source.stroke_color === "string" && source.stroke_color.trim().length > 0
    ? source.stroke_color.trim()
    : DEFAULT_CIRCLE_OPTIONS.strokeColor;

  return {
    radiusBase: clamp(coerceNumber(source.radius_base, DEFAULT_CIRCLE_OPTIONS.radiusBase), 0.5, 64),
    radiusZoomScale: clamp(
      coerceNumber(source.radius_zoom_scale, DEFAULT_CIRCLE_OPTIONS.radiusZoomScale),
      0.25,
      8,
    ),
    opacity: clamp(coerceNumber(source.opacity, DEFAULT_CIRCLE_OPTIONS.opacity), 0.0, 1.0),
    color,
    strokeColor,
    strokeWidth: clamp(coerceNumber(source.stroke_width, DEFAULT_CIRCLE_OPTIONS.strokeWidth), 0.0, 10.0),
  };
};

export default class AircraftLayer implements Layer {
  public readonly id = "geoscope-aircraft";
  public readonly zIndex = 40;

  private static autoSpriteWarned = false;
  private static forcedSymbolWarned = false;

  private enabled: boolean;
  private opacity: number;
  private maxAgeSeconds: number;
  private cineFocus?: AircraftLayerOptions["cineFocus"];
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-aircraft-source";
  private lastData: FeatureCollection = EMPTY;
  private clusterEnabled: boolean;
  private readonly clusterLayerId: string;
  private readonly clusterCountLayerId: string;
  private styleScale: number;
  private renderMode: FlightsLayerRenderMode;
  private spriteAvailable: boolean;
  private circleOptions: CircleOptions;
  private iconImage: string;
  private currentRenderMode: EffectiveRenderMode;
  private eventsRegistered = false;
  private onMouseEnter?: (event: MapLayerMouseEvent) => void;
  private onMouseLeave?: (event: MapLayerMouseEvent) => void;
  private onMouseMove?: (event: MapLayerMouseEvent) => void;
  private hoveredFeatureId: string | null = null;

  constructor(options: AircraftLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 1.0;
    this.maxAgeSeconds = options.maxAgeSeconds ?? 120;
    this.cineFocus = options.cineFocus;
    this.clusterEnabled = options.cluster ?? false;
    this.clusterLayerId = `${this.id}-clusters`;
    this.clusterCountLayerId = `${this.id}-cluster-count`;
    this.styleScale = options.styleScale ?? 1.0;
    this.renderMode = options.renderMode ?? "auto";
    this.spriteAvailable = options.spriteAvailable ?? false;
    this.circleOptions = normalizeCircleOptions(options.circle);
    this.iconImage = options.iconImage ?? DEFAULT_ICON_IMAGE;
    this.currentRenderMode = this.determineRenderMode(false);
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    this.updateRenderState(true);
    this.registerEvents(map);
  }

  remove(map: maplibregl.Map): void {
    this.unregisterEvents(map);
    this.removeLayers(map);
    if (map.getSource(this.sourceId)) {
      map.removeSource(this.sourceId);
    }
    this.map = undefined;
  }

  destroy(): void {
    this.map = undefined;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVisibility();
  }

  setOpacity(opacity: number): void {
    this.opacity = clamp(opacity, 0, 1);
    this.applyOpacity();
  }

  setMaxAgeSeconds(seconds: number): void {
    this.maxAgeSeconds = seconds;
    if (this.map) {
      const data = this.getData();
      this.updateData(data);
    }
    this.applyOpacity();
  }

  setCluster(enabled: boolean): void {
    if (this.clusterEnabled === enabled) {
      return;
    }
    this.clusterEnabled = enabled;
    this.updateRenderState(false);
  }

  setStyleScale(scale: number): void {
    const clamped = clamp(scale, 0.1, 4);
    if (this.styleScale === clamped) {
      return;
    }
    this.styleScale = clamped;
    this.applyStyleScale();
  }

  setRenderMode(mode: FlightsLayerRenderMode): void {
    if (this.renderMode === mode) {
      this.updateRenderState(true);
      return;
    }
    this.renderMode = mode;
    this.updateRenderState(true);
  }

  setCircleOptions(circle: FlightsLayerCircleConfig | undefined): void {
    this.circleOptions = normalizeCircleOptions(circle);
    this.applyCirclePaintProperties();
    this.applyOpacity();
  }

  setSpriteAvailability(available: boolean): void {
    if (this.spriteAvailable === available) {
      return;
    }
    this.spriteAvailable = available;
    this.updateRenderState(true);
  }

  updateData(data: FeatureCollection): void {
    const now = Math.floor(Date.now() / 1000);
    const featuresWithAge = {
      ...data,
      features: data.features
        .map((feature) => {
          const props = feature.properties || {};
          const timestamp = props.timestamp || now;
          const ageSeconds = Math.max(0, now - timestamp);
          const inFocus = Boolean(props.in_focus);
          const isStale = props.stale === true;

          if (this.cineFocus?.enabled && this.cineFocus.hardHideOutside && !inFocus) {
            return null;
          }

          return {
            ...feature,
            properties: {
              ...props,
              age_seconds: ageSeconds,
              in_focus: inFocus,
              stale: isStale ? true : undefined,
            },
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null),
    };

    this.lastData = featuresWithAge;

    if (!this.map) return;

    const source = this.map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      source.setData(this.lastData);
    }
  }

  getData(): FeatureCollection {
    return this.lastData;
  }

  private updateRenderState(shouldLog: boolean): void {
    const nextMode = this.determineRenderMode(shouldLog);
    const modeChanged = nextMode !== this.currentRenderMode;
    this.currentRenderMode = nextMode;

    if (!this.map) {
      return;
    }

    this.ensureSource();
    if (modeChanged) {
      this.ensureLayers();
      this.applyVisibility();
    }

    if (!modeChanged && !this.map.getLayer(this.id)) {
      this.ensureLayers();
      this.applyVisibility();
    }

    this.applyCirclePaintProperties();
    this.applyOpacity();
    this.applyStyleScale();
  }

  private determineRenderMode(shouldLog: boolean): EffectiveRenderMode {
    if (this.renderMode === "circle") {
      return "circle";
    }
    if (this.renderMode === "symbol") {
      if (this.spriteAvailable) {
        return "symbol";
      }
      if (shouldLog && !AircraftLayer.forcedSymbolWarned) {
        console.warn("Flights: sprite no disponible con mode=symbol; degradando a circle");
        AircraftLayer.forcedSymbolWarned = true;
      }
      return "circle";
    }
    if (this.spriteAvailable) {
      return "symbol";
    }
    if (shouldLog && !AircraftLayer.autoSpriteWarned) {
      console.warn("Flights: sprite no disponible; usando fallback circle");
      AircraftLayer.autoSpriteWarned = true;
    }
    return "circle";
  }

  private ensureSource(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;
    const existing = map.getSource(this.sourceId);
    const expectedCluster = this.shouldUseClusters();
    if (existing) {
      const anySource = existing as maplibregl.GeoJSONSource & { cluster?: boolean };
      const isCluster = Boolean(anySource.cluster);
      if (isCluster !== expectedCluster) {
        this.removeLayers(map);
        map.removeSource(this.sourceId);
      }
    }

    if (!map.getSource(this.sourceId)) {
      const sourceInit: maplibregl.GeoJSONSourceSpecification = {
        type: "geojson",
        data: this.lastData,
      };
      if (expectedCluster) {
        sourceInit.cluster = true;
        sourceInit.clusterRadius = 40;
        sourceInit.clusterMaxZoom = 10;
      }
      map.addSource(this.sourceId, sourceInit);
    } else {
      const source = map.getSource(this.sourceId);
      if (isGeoJSONSource(source)) {
        source.setData(this.lastData);
      }
    }
  }

  private ensureLayers(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;
    this.removeLayers(map);

    if (this.shouldUseClusters()) {
      if (!map.getLayer(this.clusterLayerId)) {
        map.addLayer({
          id: this.clusterLayerId,
          type: "circle",
          source: this.sourceId,
          filter: ["has", "point_count"],
          paint: {
            "circle-radius": 18,
            "circle-color": "rgba(249,115,22,0.7)",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#111827",
          },
        });
      }

      if (!map.getLayer(this.clusterCountLayerId)) {
        map.addLayer({
          id: this.clusterCountLayerId,
          type: "symbol",
          source: this.sourceId,
          filter: ["has", "point_count"],
          layout: {
            "text-field": "{point_count_abbreviated}",
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 12,
          },
          paint: {
            "text-color": "#ffffff",
          },
        });
      }
    }

    if (!map.getLayer(this.id)) {
      if (this.currentRenderMode === "symbol") {
        map.addLayer({
          id: this.id,
          type: "symbol",
          source: this.sourceId,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": this.iconImage,
            "icon-size": this.getIconSizeExpression(),
            "icon-allow-overlap": true,
            "icon-rotate": ["coalesce", ["get", "track"], 0],
            "icon-rotation-alignment": "map",
          },
          paint: {
            "icon-color": "#f97316",
            "icon-halo-color": "#111827",
            "icon-halo-width": 0.25,
          },
        });
      } else {
        map.addLayer({
          id: this.id,
          type: "circle",
          source: this.sourceId,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": this.getCircleRadiusExpression(),
            "circle-color": this.circleOptions.color,
            "circle-stroke-color": this.circleOptions.strokeColor,
            "circle-stroke-width": this.circleOptions.strokeWidth,
          },
        });
      }
    }
  }

  private removeLayers(map: maplibregl.Map): void {
    if (map.getLayer(this.clusterCountLayerId)) {
      map.removeLayer(this.clusterCountLayerId);
    }
    if (map.getLayer(this.clusterLayerId)) {
      map.removeLayer(this.clusterLayerId);
    }
    if (map.getLayer(this.id)) {
      map.removeLayer(this.id);
    }
  }

  private shouldUseClusters(): boolean {
    return this.clusterEnabled && this.currentRenderMode === "symbol";
  }

  private getFeatureOpacityExpression(baseOpacity: number): maplibregl.ExpressionSpecification {
    return [
      "interpolate",
      ["linear"],
      ["get", "age_seconds"],
      0,
      [
        "case",
        ["get", "in_focus"],
        baseOpacity,
        this.cineFocus?.enabled ? baseOpacity * this.cineFocus.outsideDimOpacity : baseOpacity,
      ],
      this.maxAgeSeconds / 2,
      [
        "case",
        ["get", "in_focus"],
        baseOpacity * 0.5,
        this.cineFocus?.enabled
          ? baseOpacity * this.cineFocus.outsideDimOpacity * 0.5
          : baseOpacity * 0.5,
      ],
      this.maxAgeSeconds,
      0.0,
    ];
  }

  private applyOpacity(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;
    const baseOpacity = this.currentRenderMode === "symbol"
      ? this.opacity
      : this.opacity * this.circleOptions.opacity;
    const expression = this.getFeatureOpacityExpression(baseOpacity);
    if (this.currentRenderMode === "symbol") {
      this.map.setPaintProperty(this.id, "icon-opacity", expression);
    } else {
      this.map.setPaintProperty(this.id, "circle-opacity", expression);
    }
    if (this.map.getLayer(this.clusterLayerId)) {
      this.map.setPaintProperty(this.clusterLayerId, "circle-opacity", this.opacity);
    }
    if (this.map.getLayer(this.clusterCountLayerId)) {
      this.map.setPaintProperty(this.clusterCountLayerId, "text-opacity", this.opacity);
    }
  }

  private applyCirclePaintProperties(): void {
    if (!this.map || this.currentRenderMode !== "circle" || !this.map.getLayer(this.id)) {
      return;
    }
    this.map.setPaintProperty(this.id, "circle-radius", this.getCircleRadiusExpression());
    this.map.setPaintProperty(this.id, "circle-color", this.circleOptions.color);
    this.map.setPaintProperty(this.id, "circle-stroke-color", this.circleOptions.strokeColor);
    this.map.setPaintProperty(this.id, "circle-stroke-width", this.circleOptions.strokeWidth);
  }

  private getIconSizeExpression(): maplibregl.ExpressionSpecification {
    const scale = clamp(this.styleScale, 0.1, 4);
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      2,
      0.6 * scale,
      4,
      0.8 * scale,
      6,
      1.0 * scale,
      8,
      1.2 * scale,
      10,
      1.4 * scale,
      22,
      1.4 * scale,
    ];
  }

  private getCircleRadiusExpression(): maplibregl.ExpressionSpecification {
    const base = this.circleOptions.radiusBase;
    const scale = this.circleOptions.radiusZoomScale;
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      2,
      base,
      8,
      base * scale,
      22,
      base * scale,
    ];
  }

  private applyStyleScale(): void {
    if (!this.map || this.currentRenderMode !== "symbol") {
      return;
    }
    if (this.map.getLayer(this.id)) {
      this.map.setLayoutProperty(this.id, "icon-size", this.getIconSizeExpression());
    }
  }

  private applyVisibility(): void {
    if (!this.map) return;
    const visibility = this.enabled ? "visible" : "none";
    if (this.map.getLayer(this.id)) {
      this.map.setLayoutProperty(this.id, "visibility", visibility);
    }
    if (this.map.getLayer(this.clusterLayerId)) {
      this.map.setLayoutProperty(this.clusterLayerId, "visibility", visibility);
    }
    if (this.map.getLayer(this.clusterCountLayerId)) {
      this.map.setLayoutProperty(this.clusterCountLayerId, "visibility", visibility);
    }
  }

  private registerEvents(map: maplibregl.Map) {
    if (this.eventsRegistered) {
      return;
    }

    this.onMouseEnter = (event) => {
      const features = Array.isArray(event.features) ? event.features : [];
      if (features.length === 0) {
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      const feature = features[0];
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      this.hoveredFeatureId = feature.id as string;
      const callsign = (properties.callsign as string | undefined)?.trim();
      const icao24 = (properties.icao24 as string | undefined)?.trim();
      const altitude = typeof properties.alt_baro === "number" ? Math.round(properties.alt_baro as number) : null;
      const speed = typeof properties.speed === "number" ? (properties.speed as number) : null;
      const origin = (properties.origin_country as string | undefined) ?? "N/A";
      const timestamp =
        (properties.timestamp as number | undefined) ?? (properties.last_contact as number | undefined);
      const nowSeconds = Math.floor(Date.now() / 1000);
      const age = typeof timestamp === "number" ? Math.max(0, nowSeconds - timestamp) : null;
      const content = `
          <strong>${callsign || icao24 || "Sin identificador"}</strong><br/>
          ICAO24: ${icao24 || "N/A"}<br/>
          Altitud: ${altitude !== null ? `${altitude} m` : "N/A"}<br/>
          Velocidad: ${speed !== null ? `${Math.round(speed)} m/s (${Math.round(speed * 3.6)} km/h)` : "N/A"}<br/>
          País: ${origin}<br/>
          Último contacto: ${age !== null ? `hace ${age}s` : "sin datos"}
        `;

      if (!getExistingPopup(map)) {
        if (event.lngLat && typeof event.lngLat === "object" && "lng" in event.lngLat && "lat" in event.lngLat) {
          new maplibregl.Popup({ closeOnClick: false, closeButton: true })
            .setLngLat(event.lngLat as { lng: number; lat: number })
            .setHTML(content)
            .addTo(map);
        }
      }
    };

    this.onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      const popup = getExistingPopup(map);
      if (popup) {
        popup.remove();
      }
      this.hoveredFeatureId = null;
    };

    this.onMouseMove = (event) => {
      const features = Array.isArray(event.features) ? event.features : [];
      if (features.length === 0 || !this.hoveredFeatureId) {
        return;
      }
      const popup = getExistingPopup(map);
      if (popup && event.lngLat && typeof event.lngLat === "object" && "lng" in event.lngLat && "lat" in event.lngLat) {
        popup.setLngLat(event.lngLat as { lng: number; lat: number });
      }
    };

    map.on("mouseenter", this.id, this.onMouseEnter as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mouseleave", this.id, this.onMouseLeave as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mousemove", this.id, this.onMouseMove as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    this.eventsRegistered = true;
  }

  private unregisterEvents(map: maplibregl.Map) {
    if (!this.eventsRegistered) {
      return;
    }
    if (this.onMouseEnter) {
      map.off("mouseenter", this.id, this.onMouseEnter as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }
    if (this.onMouseLeave) {
      map.off("mouseleave", this.id, this.onMouseLeave as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }
    if (this.onMouseMove) {
      map.off("mousemove", this.id, this.onMouseMove as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }
    map.getCanvas().style.cursor = "";
    const popup = getExistingPopup(map);
    if (popup) {
      popup.remove();
    }
    this.hoveredFeatureId = null;
    this.onMouseEnter = undefined;
    this.onMouseLeave = undefined;
    this.onMouseMove = undefined;
    this.eventsRegistered = false;
  }
}
