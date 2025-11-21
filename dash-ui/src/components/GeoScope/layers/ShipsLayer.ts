import maplibregl from "maplibre-gl";
import type { MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { ShipsLayerCircleConfig, ShipsLayerRenderMode, ShipsLayerSymbolConfig } from "../../../types/config";
import type { Layer } from "./LayerRegistry";
import { getExistingPopup, isGeoJSONSource } from "./layerUtils";
import { registerShipIcon } from "../utils/shipIcon";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";

type EffectiveRenderMode = "symbol" | "symbol_custom" | "circle";

type CircleOptions = {
  radiusVh: number; // Radio en % de viewport height
  opacity: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
};

interface ShipsLayerOptions {
  enabled?: boolean;
  opacity?: number;
  maxAgeSeconds?: number;
  cineFocus?: {
    enabled: boolean;
    outsideDimOpacity: number;
    hardHideOutside: boolean;
  };
  styleScale?: number;
  renderMode?: ShipsLayerRenderMode;
  circle?: ShipsLayerCircleConfig;
  symbol?: ShipsLayerSymbolConfig;
  spriteAvailable?: boolean;
  iconImage?: string;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const DEFAULT_ICON_IMAGE = "ship-15";
const DEFAULT_CIRCLE_OPTIONS: CircleOptions = {
  radiusVh: 0.8, // 0.8% de viewport height
  opacity: 1.0,
  color: "#38bdf8",
  strokeColor: "#0f172a",
  strokeWidth: 1.5,
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

const normalizeCircleOptions = (options?: ShipsLayerCircleConfig, viewportHeight?: number): CircleOptions => {
  const source = options ?? {
    radius_vh: DEFAULT_CIRCLE_OPTIONS.radiusVh,
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

  const radiusVh = clamp(coerceNumber(source.radius_vh, DEFAULT_CIRCLE_OPTIONS.radiusVh), 0.1, 10.0);

  return {
    radiusVh, // Guardamos vh % para cálculo dinámico
    opacity: clamp(coerceNumber(source.opacity, DEFAULT_CIRCLE_OPTIONS.opacity), 0.0, 1.0),
    color,
    strokeColor,
    strokeWidth: clamp(coerceNumber(source.stroke_width, DEFAULT_CIRCLE_OPTIONS.strokeWidth), 0.0, 10.0),
  };
};

export default class ShipsLayer implements Layer {
  public readonly id = "geoscope-ships";
  public readonly zIndex = 30;

  private static autoSpriteWarned = false;
  private static forcedSymbolWarned = false;

  private enabled: boolean;
  private opacity: number;
  private maxAgeSeconds: number;
  private cineFocus?: ShipsLayerOptions["cineFocus"];
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-ships-source";
  private lastData: FeatureCollection = EMPTY;
  private styleScale: number;
  private renderMode: ShipsLayerRenderMode;
  private spriteAvailable: boolean;
  private circleOptions: CircleOptions;
  private symbolOptions: ShipsLayerSymbolConfig | undefined;
  private iconImage: string;
  private currentRenderMode: EffectiveRenderMode;
  private shipIconRegistered: boolean = false;
  private eventsRegistered = false;
  private onMouseEnter?: (event: MapLayerMouseEvent) => void;
  private onMouseLeave?: (event: MapLayerMouseEvent) => void;
  private onMouseMove?: (event: MapLayerMouseEvent) => void;
  private hoveredFeatureId: string | null = null;

  constructor(options: ShipsLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 1.0;
    this.maxAgeSeconds = options.maxAgeSeconds ?? 180;
    this.cineFocus = options.cineFocus;
    this.styleScale = options.styleScale ?? 1.0;
    this.renderMode = options.renderMode ?? "auto";
    this.spriteAvailable = options.spriteAvailable ?? false;
    this.circleOptions = normalizeCircleOptions(options.circle, typeof window !== "undefined" ? window.innerHeight : 480);
    this.symbolOptions = options.symbol;
    this.iconImage = options.iconImage ?? DEFAULT_ICON_IMAGE;
    this.currentRenderMode = this.determineRenderMode(false);
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    this.updateRenderState(true);
    this.registerEvents(map);
  }

  /**
   * Asegura que la capa de barcos esté inicializada después de cambios de estilo.
   * Debe ser llamado en eventos 'styledata' y 'load'.
   * Completamente idempotente: puede ser llamado múltiples veces sin efectos secundarios.
   */
  async ensureShipsLayer(): Promise<void> {
    if (!this.map || !this.enabled) {
      return;
    }

    // Intentar registrar el icono custom si es necesario
    if (this.renderMode === "symbol_custom" || (this.renderMode === "auto" && !this.spriteAvailable)) {
      const registered = await registerShipIcon(this.map);
      if (registered) {
        this.shipIconRegistered = true;
      }
    }

    // Asegurar que el source existe (idempotente)
    this.ensureSource();

    // Asegurar que las capas existen (idempotente)
    await this.ensureLayersAsync();

    // Asegurar que las capas están en el orden correcto
    this.ensureLayerOrder();

    // Asegurar visibilidad según render_mode
    this.applyVisibilityByMode();
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

  setStyleScale(scale: number): void {
    const clamped = clamp(scale, 0.1, 4);
    if (this.styleScale === clamped) {
      return;
    }
    this.styleScale = clamped;
    this.applyStyleScale();
  }

  setRenderMode(mode: ShipsLayerRenderMode): void {
    if (this.renderMode === mode) {
      this.updateRenderState(true);
      return;
    }
    this.renderMode = mode;
    this.updateRenderState(true);
  }

  setCircleOptions(circle: ShipsLayerCircleConfig | undefined): void {
    this.circleOptions = normalizeCircleOptions(circle, typeof window !== "undefined" ? window.innerHeight : 480);
    this.applyCirclePaintProperties();
    this.applyOpacity();
  }

  setSymbolOptions(symbol: ShipsLayerSymbolConfig | undefined): void {
    this.symbolOptions = symbol;
    if (this.map && this.currentRenderMode === "symbol_custom" && this.map.getLayer(this.id)) {
      this.map.setLayoutProperty(this.id, "icon-size", this.getCustomSymbolSizeExpression());
      this.map.setLayoutProperty(
        this.id,
        "icon-allow-overlap",
        symbol?.allow_overlap ?? true,
      );
    }
  }

  setSpriteAvailability(available: boolean): void {
    if (this.spriteAvailable === available) {
      return;
    }
    this.spriteAvailable = available;
    this.updateRenderState(true);
  }

  updateData(data: FeatureCollection): void {
    // Resiliente: si no hay datos o features está vacío, usar EMPTY
    if (!data || !Array.isArray(data.features)) {
      this.lastData = EMPTY;
      if (this.map) {
        const source = this.map.getSource(this.sourceId);
        if (isGeoJSONSource(source)) {
          source.setData(EMPTY);
        }
      }
      return;
    }

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
      try {
        source.setData(this.lastData);
      } catch (error) {
        // Resiliente: si falla, no romper nada
        console.warn("[ShipsLayer] Error updating data:", error);
      }
    }
  }

  getData(): FeatureCollection {
    return this.lastData;
  }

  private async updateRenderStateAsync(shouldLog: boolean): Promise<void> {
    const nextMode = await this.determineRenderModeAsync(shouldLog);
    const modeChanged = nextMode !== this.currentRenderMode;
    this.currentRenderMode = nextMode;

    if (!this.map) {
      return;
    }

    this.ensureSource();
    const layerExists = Boolean(this.map.getLayer(this.id));
    
    // Si cambió el modo o no existe la capa, recrearla
    if (modeChanged || !layerExists) {
      await this.ensureLayersAsync();
      this.applyVisibility();
    }

    this.applyCirclePaintProperties();
    this.applyOpacity();
    this.applyStyleScale();
  }

  private updateRenderState(shouldLog: boolean): void {
    // Versión síncrona para compatibilidad
    const nextMode = this.determineRenderMode(shouldLog);
    const modeChanged = nextMode !== this.currentRenderMode;
    this.currentRenderMode = nextMode;

    if (!this.map) {
      return;
    }

    this.ensureSource();
    const layerExists = Boolean(this.map.getLayer(this.id));
    
    // Si cambió el modo o no existe la capa, recrearla
    if (modeChanged || !layerExists) {
      // Usar versión async si es necesario
      this.updateRenderStateAsync(shouldLog).catch((error) => {
        console.warn("[ShipsLayer] Error en updateRenderStateAsync:", error);
      });
      return;
    }

    this.applyCirclePaintProperties();
    this.applyOpacity();
    this.applyStyleScale();
  }

  private async determineRenderModeAsync(shouldLog: boolean): Promise<EffectiveRenderMode> {
    if (this.renderMode === "circle") {
      return "circle";
    }
    if (this.renderMode === "symbol_custom") {
      if (!this.map) {
        return "circle";
      }
      const registered = await registerShipIcon(this.map);
      if (registered) {
        this.shipIconRegistered = true;
        return "symbol_custom";
      }
      if (shouldLog) {
        console.warn("Ships: no se pudo registrar icono custom; usando circle");
      }
      return "circle";
    }
    if (this.renderMode === "symbol") {
      if (this.spriteAvailable) {
        return "symbol";
      }
      if (shouldLog && !ShipsLayer.forcedSymbolWarned) {
        console.warn("Ships: sprite no disponible con mode=symbol; degradando a circle");
        ShipsLayer.forcedSymbolWarned = true;
      }
      return "circle";
    }
    // render_mode === "auto"
    if (this.spriteAvailable) {
      return "symbol";
    }
    // Intentar usar icono custom como fallback
    if (this.map) {
      const registered = await registerShipIcon(this.map);
      if (registered) {
        this.shipIconRegistered = true;
        return "symbol_custom";
      }
    }
    if (shouldLog && !ShipsLayer.autoSpriteWarned) {
      console.warn("Ships: sprite no disponible; usando fallback circle");
      ShipsLayer.autoSpriteWarned = true;
    }
    return "circle";
  }

  private determineRenderMode(shouldLog: boolean): EffectiveRenderMode {
    // Versión síncrona (para compatibilidad inicial)
    if (this.renderMode === "circle") {
      return "circle";
    }
    if (this.renderMode === "symbol_custom") {
      // En modo síncrono, verificar si ya está registrado
      if (this.shipIconRegistered && this.map?.hasImage("ship")) {
        return "symbol_custom";
      }
      return "circle";
    }
    if (this.renderMode === "symbol") {
      if (this.spriteAvailable) {
        return "symbol";
      }
      if (shouldLog && !ShipsLayer.forcedSymbolWarned) {
        console.warn("Ships: sprite no disponible con mode=symbol; degradando a circle");
        ShipsLayer.forcedSymbolWarned = true;
      }
      return "circle";
    }
    // render_mode === "auto"
    if (this.spriteAvailable) {
      return "symbol";
    }
    // Para auto sin sprite, verificar si el icono custom ya está registrado
    if (this.shipIconRegistered && this.map?.hasImage("ship")) {
      return "symbol_custom";
    }
    return "circle";
  }

  /**
   * Asegura que el source existe. Completamente idempotente.
   */
  private ensureSource(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;
    
    // Si el source ya existe, solo actualizar datos si es necesario
    if (map.getSource(this.sourceId)) {
      const source = map.getSource(this.sourceId);
      if (isGeoJSONSource(source)) {
        source.setData(this.lastData);
      }
      return;
    }

    // Verificar que el estilo esté listo antes de crear el source
    const style = getSafeMapStyle(map);
    if (!style) {
      console.warn("[ShipsLayer] style not ready, skipping ensureSource");
      return;
    }

    // El source no existe, crearlo
    const sourceInit: maplibregl.GeoJSONSourceSpecification = {
      type: "geojson",
      data: this.lastData,
      generateId: true,
    };

    try {
      map.addSource(this.sourceId, sourceInit);
    } catch (error) {
      // Si falla (p. ej. source ya existe), solo actualizar datos
      const source = map.getSource(this.sourceId);
      if (isGeoJSONSource(source)) {
        source.setData(this.lastData);
      }
    }
  }

  /**
   * Encuentra el ID de la primera capa de símbolos de etiquetas para colocar nuestras capas antes de ella.
   * Retorna undefined si no se encuentra.
   */
  private findBeforeId(map: maplibregl.Map): string | undefined {
    const style = getSafeMapStyle(map);
    if (!style || !Array.isArray(style.layers)) {
      return undefined;
    }
    
    // Buscar el primer layer de tipo "symbol" que contenga "label", "place-", "country-", "text", o "name"
    for (const layer of style.layers) {
      if (layer.type === "symbol") {
        const layerId = (layer.id || "").toLowerCase();
        if (
          layerId.includes("label") ||
          layerId.includes("place-") ||
          layerId.includes("country-") ||
          layerId.includes("text") ||
          layerId.includes("name")
        ) {
          return layer.id;
        }
      }
    }
    
    return undefined;
  }

  /**
   * Asegura que las capas están en el orden correcto.
   * Si beforeId no existe o no se encontró, mueve las capas al tope.
   */
  private ensureLayerOrder(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;
    const beforeId = this.findBeforeId(map);

    // Si se encontró beforeId, las capas ya deberían estar antes (se añadieron con beforeId)
    // Si no se encontró, mover las capas al tope
    if (!beforeId) {
      try {
        if (map.getLayer(this.id)) {
          // Mover al tope (sin beforeId)
          const style = getSafeMapStyle(map);
          const layers = Array.isArray(style?.layers) ? (style!.layers as Array<{ id?: string }>) : [];
          if (Array.isArray(layers) && layers.length > 0) {
            // Intentar mover después de la última capa
            const lastLayer = layers[layers.length - 1] as { id?: string } | undefined;
            if (lastLayer && lastLayer.id !== this.id) {
              map.moveLayer(this.id, lastLayer.id);
            }
          }
        }
      } catch (error) {
        // Si falla el movimiento, no es crítico
        console.warn("[ShipsLayer] Error al mover capas al tope:", error);
      }
    }
  }

  /**
   * Asegura que las capas existen. Completamente idempotente.
   */
  private async ensureLayersAsync(): Promise<void> {
    if (!this.map) {
      return;
    }
    const map = this.map;

    // Verificar que el estilo esté listo antes de manipular layers
    const style = getSafeMapStyle(map);
    if (!style) {
      console.warn("[ShipsLayer] style not ready, skipping ensureLayersAsync");
      return;
    }

    // Determinar el modo de renderizado actual
    const nextMode = await this.determineRenderModeAsync(false);
    const modeChanged = nextMode !== this.currentRenderMode;
    this.currentRenderMode = nextMode;

    const beforeId = this.findBeforeId(map);

    // Remover la capa anterior si cambió el modo
    if (modeChanged && map.getLayer(this.id)) {
      try {
        map.removeLayer(this.id);
      } catch (error) {
        // Si falla, continuar
        console.warn("[ShipsLayer] Error al remover capa anterior:", error);
      }
    }

    // Asegurar que la capa principal existe
    if (!map.getLayer(this.id)) {
      if (this.currentRenderMode === "symbol" || this.currentRenderMode === "symbol_custom") {
        // Capa de símbolos
        const iconImage = this.currentRenderMode === "symbol_custom" ? "ship" : this.iconImage;
        const sizeExpression = this.currentRenderMode === "symbol_custom"
          ? this.getCustomSymbolSizeExpression()
          : this.getIconSizeExpression();

        try {
          map.addLayer({
            id: this.id,
            type: "symbol",
            source: this.sourceId,
            layout: {
              "icon-image": iconImage,
              "icon-size": sizeExpression,
              "icon-rotate": ["get", "course"],
              "icon-rotation-alignment": "map",
              "icon-allow-overlap": this.symbolOptions?.allow_overlap ?? true,
              "icon-ignore-placement": false,
              "visibility": this.enabled ? "visible" : "none",
            },
            paint: {
              "icon-color": this.circleOptions.color,
              "icon-halo-color": this.circleOptions.strokeColor,
              "icon-halo-width": 0.4,
              "icon-opacity": [
                "interpolate",
                ["linear"],
                ["get", "age_seconds"],
                0,
                [
                  "case",
                  ["get", "in_focus"],
                  this.opacity,
                  this.cineFocus?.enabled
                    ? this.opacity * this.cineFocus.outsideDimOpacity
                    : this.opacity
                ],
                this.maxAgeSeconds / 2,
                [
                  "case",
                  ["get", "in_focus"],
                  this.opacity * 0.5,
                  this.cineFocus?.enabled
                    ? this.opacity * this.cineFocus.outsideDimOpacity * 0.5
                    : this.opacity * 0.5
                ],
                this.maxAgeSeconds,
                0.0
              ],
            },
          }, beforeId);

          // Si se registró el icono custom después de añadir la capa, actualizar tamaño
          if (this.currentRenderMode === "symbol_custom") {
            map.setLayoutProperty(this.id, "icon-size", this.getCustomSymbolSizeExpression());
            map.setLayoutProperty(this.id, "icon-allow-overlap", this.symbolOptions?.allow_overlap ?? true);
          } else {
            map.setLayoutProperty(this.id, "icon-size", this.getIconSizeExpression());
            map.setLayoutProperty(this.id, "icon-allow-overlap", true);
          }
        } catch (error) {
          console.warn("[ShipsLayer] Error al añadir symbol layer:", error);
        }
      } else {
        // Capa de círculos
        try {
          map.addLayer({
            id: this.id,
            type: "circle",
            source: this.sourceId,
            layout: {
              "visibility": this.enabled ? "visible" : "none",
            },
            paint: {
              "circle-radius": this.getCircleRadiusExpression(),
              "circle-color": this.circleOptions.color,
              "circle-stroke-color": this.circleOptions.strokeColor,
              "circle-stroke-width": this.circleOptions.strokeWidth,
              "circle-opacity": [
                "interpolate",
                ["linear"],
                ["get", "age_seconds"],
                0,
                [
                  "case",
                  ["get", "in_focus"],
                  this.opacity * this.circleOptions.opacity,
                  this.cineFocus?.enabled
                    ? this.opacity * this.circleOptions.opacity * this.cineFocus.outsideDimOpacity
                    : this.opacity * this.circleOptions.opacity
                ],
                this.maxAgeSeconds / 2,
                [
                  "case",
                  ["get", "in_focus"],
                  this.opacity * this.circleOptions.opacity * 0.5,
                  this.cineFocus?.enabled
                    ? this.opacity * this.circleOptions.opacity * this.cineFocus.outsideDimOpacity * 0.5
                    : this.opacity * this.circleOptions.opacity * 0.5
                ],
                this.maxAgeSeconds,
                0.0
              ],
            },
          }, beforeId);
        } catch (error) {
          console.warn("[ShipsLayer] Error al añadir circle layer:", error);
        }
      }
    } else if (modeChanged) {
      // Si cambió el modo, actualizar propiedades de la capa existente
      try {
        if (this.currentRenderMode === "symbol" || this.currentRenderMode === "symbol_custom") {
          const iconImage = this.currentRenderMode === "symbol_custom" ? "ship" : this.iconImage;
          map.setLayoutProperty(this.id, "icon-image", iconImage);
          map.setLayoutProperty(
            this.id,
            "icon-size",
            this.currentRenderMode === "symbol_custom"
              ? this.getCustomSymbolSizeExpression()
              : this.getIconSizeExpression()
          );
          map.setLayoutProperty(this.id, "icon-allow-overlap", this.symbolOptions?.allow_overlap ?? true);
          map.setPaintProperty(this.id, "icon-color", this.circleOptions.color);
          map.setPaintProperty(this.id, "icon-halo-color", this.circleOptions.strokeColor);
          map.setPaintProperty(this.id, "icon-halo-width", 0.4);
        } else {
          map.setPaintProperty(this.id, "circle-radius", this.getCircleRadiusExpression());
          map.setPaintProperty(this.id, "circle-color", this.circleOptions.color);
          map.setPaintProperty(this.id, "circle-stroke-color", this.circleOptions.strokeColor);
          map.setPaintProperty(this.id, "circle-stroke-width", this.circleOptions.strokeWidth);
        }
      } catch (error) {
        console.warn("[ShipsLayer] Error al actualizar capa:", error);
      }
    }

    // Aplicar propiedades comunes
    this.applyCirclePaintProperties();
    this.applyOpacity();
    this.applyStyleScale();
  }

  private removeLayers(map: maplibregl.Map): void {
    if (map.getLayer(this.id)) {
      map.removeLayer(this.id);
    }
  }

  private getIconSizeExpression(): maplibregl.ExpressionSpecification {
    const scale = clamp(this.styleScale, 0.1, 4);
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      2,
      0.6 * scale,
      8,
      1.0 * scale,
      22,
      1.4 * scale,
    ];
  }

  private getCircleRadiusExpression(): maplibregl.ExpressionSpecification {
    // Calcular radio en pixels basado en viewport height
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 480;
    const radiusVh = this.circleOptions.radiusVh;
    const radiusPixels = (radiusVh / 100) * viewportHeight;
    // Retornar como número literal (ExpressionSpecification puede ser un número)
    return radiusPixels as unknown as maplibregl.ExpressionSpecification;
  }

  private getCustomSymbolSizeExpression(): maplibregl.ExpressionSpecification {
    // Calcular tamaño en pixels basado en viewport height
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 480;
    const sizeVh = this.symbolOptions?.size_vh ?? 1.4;
    const sizePixels = (sizeVh / 100) * viewportHeight;
    // Retornar como número literal (ExpressionSpecification puede ser un número)
    return sizePixels as unknown as maplibregl.ExpressionSpecification;
  }

  private applyStyleScale(): void {
    if (!this.map || (this.currentRenderMode !== "symbol" && this.currentRenderMode !== "symbol_custom")) {
      return;
    }
    if (this.map.getLayer(this.id)) {
      if (this.currentRenderMode === "symbol_custom") {
        this.map.setLayoutProperty(this.id, "icon-size", this.getCustomSymbolSizeExpression());
      } else {
        this.map.setLayoutProperty(this.id, "icon-size", this.getIconSizeExpression());
      }
    }
  }

  /**
   * Aplica visibilidad según el render_mode.
   * Asegura que siempre haya una capa visible (nunca ambas ocultas).
   */
  private applyVisibilityByMode(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;
    const baseVisibility = this.enabled ? "visible" : "none";

    // Asegurar que la capa principal esté visible según el modo
    if (map.getLayer(this.id)) {
      map.setLayoutProperty(this.id, "visibility", baseVisibility);
    }
  }

  private applyVisibility(): void {
    if (!this.map) {
      return;
    }
    const visibility = this.enabled ? "visible" : "none";
    if (this.map.getLayer(this.id)) {
      this.map.setLayoutProperty(this.id, "visibility", visibility);
    }
  }

  private applyOpacity(): void {
    if (!this.map || !this.map.getLayer(this.id)) {
      return;
    }
    const baseOpacity = this.currentRenderMode === "circle"
      ? this.opacity * this.circleOptions.opacity
      : this.opacity * this.circleOptions.opacity;
    // La opacidad se aplica en las expresiones paint/layout según el modo
    // Este método existe para compatibilidad, pero la lógica real está en las expresiones
  }

  private applyCirclePaintProperties(): void {
    if (!this.map || this.currentRenderMode !== "circle") {
      return;
    }
    if (!this.map.getLayer(this.id)) {
      return;
    }
    this.map.setPaintProperty(this.id, "circle-radius", this.getCircleRadiusExpression());
    this.map.setPaintProperty(this.id, "circle-color", this.circleOptions.color);
    this.map.setPaintProperty(this.id, "circle-stroke-color", this.circleOptions.strokeColor);
    this.map.setPaintProperty(this.id, "circle-stroke-width", this.circleOptions.strokeWidth);
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
      if (!feature.properties) {
        return;
      }
      this.hoveredFeatureId = feature.id as string;
      const name = feature.properties.name || feature.properties.mmsi || "N/A";
      const mmsi = feature.properties.mmsi || "N/A";
      const speed = feature.properties.speed ? `${Math.round(feature.properties.speed)} knots` : "N/A";
      const course = feature.properties.course ? `${Math.round(feature.properties.course)}°` : "N/A";
      const timestamp = feature.properties.timestamp
        ? new Date(feature.properties.timestamp * 1000).toLocaleTimeString()
        : "N/A";
      const content = `<strong>${name}</strong><br/>MMSI: ${mmsi}<br/>Velocidad: ${speed}<br/>Curso: ${course}<br/>Última actualización: ${timestamp}`;

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

    map.on("mouseenter", this.id, this.onMouseEnter as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mouseleave", this.id, this.onMouseLeave as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mousemove", this.id, this.onMouseMove as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    this.eventsRegistered = true;
  }

  private unregisterEvents(map: maplibregl.Map) {
    if (!this.eventsRegistered) {
      return;
    }
    if (this.onMouseEnter) {
      map.off("mouseenter", this.id, this.onMouseEnter as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }
    if (this.onMouseLeave) {
      map.off("mouseleave", this.id, this.onMouseLeave as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }
    if (this.onMouseMove) {
      map.off("mousemove", this.id, this.onMouseMove as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }
    const popup = getExistingPopup(map);
    if (popup) {
      popup.remove();
    }
    map.getCanvas().style.cursor = "";
    this.hoveredFeatureId = null;
    this.onMouseEnter = undefined;
    this.onMouseLeave = undefined;
    this.onMouseMove = undefined;
    this.eventsRegistered = false;
  }
}
