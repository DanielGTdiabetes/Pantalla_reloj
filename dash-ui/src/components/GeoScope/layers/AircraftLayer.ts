import { Map as MaptilerMap, Popup } from "@maptiler/sdk";
import type { MapLayerMouseEvent } from "maplibre-gl";

// @ts-expect-error - MapGeoJSONFeature exists but has export issues
type GeoJSONFeature = import("maplibre-gl").MapGeoJSONFeature;
import type { FeatureCollection } from "geojson";

import type { FlightsLayerCircleConfig, FlightsLayerRenderMode, FlightsLayerSymbolConfig } from "../../../types/config";
import type { Layer } from "./LayerRegistry";
import { getExistingPopup, isGeoJSONSource } from "./layerUtils";
import { registerPlaneIcon } from "../utils/planeIcon";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { withSafeMapStyle, withSafeMapStyleAsync, safeHasImage, waitForStyleLoaded } from "../../../lib/map/utils/safeMapOperations";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";

type EffectiveRenderMode = "symbol" | "symbol_custom" | "circle";

type CircleOptions = {
  radiusBase: number; // Radio base en pixels
  radiusZoomScale: number; // Factor de escala por zoom
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
  symbol?: FlightsLayerSymbolConfig;
  spriteAvailable?: boolean;
  iconImage?: string;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const DEFAULT_ICON_IMAGE = "airplane-15";
const DEFAULT_CIRCLE_OPTIONS: CircleOptions = {
  radiusBase: 7.5, // Radio base en pixels
  radiusZoomScale: 1.7, // Factor de escala por zoom
  opacity: 1.0,
  color: "#FFD400",
  strokeColor: "#000000",
  strokeWidth: 2.0,
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

const normalizeCircleOptions = (options?: FlightsLayerCircleConfig, viewportHeight?: number): CircleOptions => {
  // Soporte para v2 (radius_base, radius_zoom_scale) y v1 legacy (radius_vh)
  const source = (options ?? {}) as Partial<FlightsLayerCircleConfig>;

  // Intentar leer parámetros v2 primero
  const hasV2Params = 'radius_base' in source || 'radius_zoom_scale' in source;

  let radiusBase = DEFAULT_CIRCLE_OPTIONS.radiusBase;
  let radiusZoomScale = DEFAULT_CIRCLE_OPTIONS.radiusZoomScale;

  if (hasV2Params) {
    // V2: usar radius_base y radius_zoom_scale
    radiusBase = clamp(coerceNumber((source as any).radius_base, DEFAULT_CIRCLE_OPTIONS.radiusBase), 1.0, 50.0);
    radiusZoomScale = clamp(coerceNumber((source as any).radius_zoom_scale, DEFAULT_CIRCLE_OPTIONS.radiusZoomScale), 0.1, 5.0);
  } else if ('radius_vh' in source) {
    // V1 legacy: convertir radius_vh a radius_base (aproximación)
    const radiusVh = clamp(coerceNumber((source as any).radius_vh, 0.9), 0.1, 10.0);
    // Convertir vh a base: asumir viewport 480px y zoom 5 como referencia
    const viewportH = viewportHeight ?? 480;
    radiusBase = (radiusVh / 100) * viewportH * 0.1; // Aproximación
    radiusZoomScale = 1.7; // Default para v2
  }

  const color = typeof source.color === "string" && source.color.trim().length > 0
    ? source.color.trim()
    : DEFAULT_CIRCLE_OPTIONS.color;
  const strokeColor = typeof source.stroke_color === "string" && source.stroke_color.trim().length > 0
    ? source.stroke_color.trim()
    : DEFAULT_CIRCLE_OPTIONS.strokeColor;

  return {
    radiusBase,
    radiusZoomScale,
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
  private map?: MaptilerMap;
  private readonly sourceId = "geoscope-aircraft-source";
  private lastData: FeatureCollection = EMPTY;
  private clusterEnabled: boolean;
  private readonly clusterLayerId: string;
  private readonly clusterCountLayerId: string;
  private styleScale: number;
  private renderMode: FlightsLayerRenderMode;
  private spriteAvailable: boolean;
  private circleOptions: CircleOptions;
  private symbolOptions: FlightsLayerSymbolConfig | undefined;
  private iconImage: string;
  private currentRenderMode: EffectiveRenderMode;
  private planeIconRegistered: boolean = false;
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
    this.circleOptions = normalizeCircleOptions(options.circle, typeof window !== "undefined" ? window.innerHeight : 480);
    this.symbolOptions = options.symbol;
    this.iconImage = options.iconImage ?? DEFAULT_ICON_IMAGE;
    // Determinar modo de renderizado inicial
    // Si mode es auto y no hay sprite, intentar usar symbol_custom (icono personalizado)
    // El icono se registrará en ensureFlightsLayer()
    if (this.renderMode === "auto" && !this.spriteAvailable) {
      this.currentRenderMode = "symbol_custom";
    } else {
      this.currentRenderMode = this.determineRenderMode(false);
    }
  }

  add(map: MaptilerMap): void | Promise<void> {
    this.map = map;
    this.registerEvents(map);
    
    // Inicializar la capa de forma asíncrona si está habilitada
    if (this.enabled) {
      return this.ensureFlightsLayer();
    }
  }

  /**
   * Asegura que la capa de vuelos esté inicializada después de cambios de estilo.
   * Debe ser llamado en eventos 'styledata' y 'load'.
   * Completamente idempotente: puede ser llamado múltiples veces sin efectos secundarios.
   */
  async ensureFlightsLayer(): Promise<void> {
    const layerId: LayerId = "flights";

    console.log("[AircraftLayer] ensureFlightsLayer() called");

    if (!this.map || !this.enabled) {
      if (!this.map) {
        layerDiagnostics.recordError(layerId, new Error("Map not available"), {
          phase: "ensureFlightsLayer",
        });
      }
      return;
    }

    // CRÍTICO: Esperar a que el estilo esté completamente cargado antes de continuar
    // Esto evita el error "Style not loaded yet, skipping operation"
    const styleReady = await waitForStyleLoaded(this.map, 15000);
    if (!styleReady) {
      console.warn("[AircraftLayer] Timeout waiting for style, will retry on next call");
      layerDiagnostics.updatePreconditions(layerId, { styleLoaded: false });
      return;
    }
    layerDiagnostics.updatePreconditions(layerId, { styleLoaded: true });
    console.log("[AircraftLayer] Style is ready, proceeding with layer creation");

    try {
      // Intentar registrar el icono custom si es necesario
      if (this.renderMode === "symbol_custom" || (this.renderMode === "auto" && !this.spriteAvailable)) {
        try {
          const registered = await registerPlaneIcon(this.map);
          if (registered) {
            this.planeIconRegistered = true;
            layerDiagnostics.updatePreconditions(layerId, {
              apiKeysConfigured: true, // Asumimos que si el icono se registró, las keys están bien
            });
          }
        } catch (iconError) {
          const error = iconError instanceof Error ? iconError : new Error(String(iconError));
          layerDiagnostics.recordError(layerId, error, {
            phase: "icon_registration",
          });
          console.warn("[AircraftLayer] Failed to register plane icon:", iconError);
        }
      }

      console.log("[AircraftLayer] ensureFlightsLayer - creating/updating source+layers");

      // Asegurar que el source existe (idempotente)
      try {
        this.ensureSource();
      } catch (sourceError) {
        const error = sourceError instanceof Error ? sourceError : new Error(String(sourceError));
        layerDiagnostics.recordError(layerId, error, {
          phase: "ensure_source",
        });
        throw error;
      }

      // Verificar que el source existe antes de crear capas
      // Esto evita errores de MapLibre tipo "source not found"
      if (!this.map.getSource(this.sourceId)) {
        const error = new Error("Source still missing after ensureSource");
        layerDiagnostics.recordError(layerId, error, {
          phase: "source_verification",
        });
        console.warn("[AircraftLayer] Source still missing after ensureSource, skipping ensureLayersAsync");
        return;
      }

      // Asegurar que las capas existen (idempotente)
      try {
        await this.ensureLayersAsync();
      } catch (layersError) {
        const error = layersError instanceof Error ? layersError : new Error(String(layersError));
        layerDiagnostics.recordError(layerId, error, {
          phase: "ensure_layers",
        });
        throw error;
      }

      // Asegurar que las capas están en el orden correcto
      try {
        this.ensureLayerOrder();
      } catch (orderError) {
        const error = orderError instanceof Error ? orderError : new Error(String(orderError));
        layerDiagnostics.recordError(layerId, error, {
          phase: "ensure_layer_order",
        });
        console.warn("[AircraftLayer] Error ensuring layer order:", orderError);
      }

      // Asegurar visibilidad según render_mode
      try {
        this.applyVisibilityByMode();
      } catch (visibilityError) {
        const error = visibilityError instanceof Error ? visibilityError : new Error(String(visibilityError));
        layerDiagnostics.recordError(layerId, error, {
          phase: "apply_visibility",
        });
        console.warn("[AircraftLayer] Error applying visibility:", visibilityError);
      }

      // Marcar como listo si llegamos aquí
      layerDiagnostics.setState(layerId, "ready");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      layerDiagnostics.recordError(layerId, err, {
        phase: "ensureFlightsLayer",
      });
      throw error;
    }
  }

  remove(map: MaptilerMap): void {
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
    this.circleOptions = normalizeCircleOptions(circle, typeof window !== "undefined" ? window.innerHeight : 480);
    this.applyCirclePaintProperties();
    this.applyOpacity();
  }

  setSymbolOptions(symbol: FlightsLayerSymbolConfig | undefined): void {
    this.symbolOptions = symbol;
    if (!this.map || this.currentRenderMode !== "symbol_custom" || !this.map.getLayer(this.id)) {
      return;
    }
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[AircraftLayer] Style not ready, skipping");
      return;
    }
    try {
      this.map.setLayoutProperty(this.id, "icon-size", this.getCustomSymbolSizeExpression());
      this.map.setLayoutProperty(
        this.id,
        "icon-allow-overlap",
        symbol?.allow_overlap ?? true,
      );
    } catch (e) {
      console.warn("[AircraftLayer] layout skipped:", e);
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
    const layerId: LayerId = "flights";

    console.log("[AircraftLayer] updateData called, features:", Array.isArray((data as any)?.features)
      ? (data as any).features.length
      : 0);

    try {
      // Validar que los datos sean un FeatureCollection válido
      if (!data || typeof data !== "object" || data.type !== "FeatureCollection") {
        const error = new Error(`Invalid FeatureCollection: ${JSON.stringify(data).substring(0, 100)}`);
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_validation",
        });
        console.error("[AircraftLayer] Invalid data format:", data);
        return;
      }

      if (!Array.isArray(data.features)) {
        const error = new Error("Features array is missing or invalid");
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_validation",
        });
        console.error("[AircraftLayer] Features array is missing or invalid");
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const featuresWithAge = {
        ...data,
        features: data.features
          .map((feature) => {
            try {
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
            } catch (featureError) {
              console.warn("[AircraftLayer] Error processing feature:", featureError);
              return null;
            }
          })
          .filter((f): f is NonNullable<typeof f> => f !== null),
      };

      this.lastData = featuresWithAge;

      if (!this.map) {
        console.warn("[AircraftLayer] Map not available for updateData");
        return;
      }

      // Intentar obtener el source, o crearlo si no existe
      let source = this.map.getSource(this.sourceId);
      
      // Si el source no existe, intentar crearlo
      if (!source) {
        try {
          const expectedCluster = this.shouldUseClusters();
          const sourceInit: maplibregl.GeoJSONSourceSpecification = {
            type: "geojson",
            data: this.lastData,
            generateId: true,
          };
          if (expectedCluster) {
            sourceInit.cluster = true;
            sourceInit.clusterRadius = 40;
            sourceInit.clusterMaxZoom = 10;
          }
          this.map.addSource(this.sourceId, sourceInit);
          source = this.map.getSource(this.sourceId);
          console.log("[AircraftLayer] Source created in updateData");
        } catch (e) {
          // El source puede existir o el estilo no estar listo
          source = this.map.getSource(this.sourceId);
        }
      }
      
      if (isGeoJSONSource(source)) {
        try {
          source.setData(this.lastData);
          // Registrar actualización exitosa
          layerDiagnostics.recordDataUpdate(layerId, featuresWithAge.features.length);
        } catch (setDataError) {
          const error = setDataError instanceof Error ? setDataError : new Error(String(setDataError));
          layerDiagnostics.recordError(layerId, error, {
            phase: "updateData_setData",
            featureCount: featuresWithAge.features.length,
          });
          console.error("[AircraftLayer] Error setting data to source:", setDataError);
        }
      } else if (source === undefined) {
        // Source aún no creado, los datos se guardan en lastData para cuando se cree
        console.log("[AircraftLayer] Source not yet available, data saved for later");
      } else {
        const error = new Error(`Source ${this.sourceId} is not a GeoJSON source`);
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_source_check",
        });
        console.warn("[AircraftLayer] Source is not a GeoJSON source:", source);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      layerDiagnostics.recordError(layerId, err, {
        phase: "updateData",
      });
      console.error("[AircraftLayer] Error in updateData:", error);
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
      this.ensureLayers();
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
      this.ensureLayers();
      this.applyVisibility();
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
      // Intentar registrar el icono custom
      if (!this.map) {
        return "circle";
      }
      const registered = await registerPlaneIcon(this.map);
      if (registered) {
        this.planeIconRegistered = true;
        return "symbol_custom";
      }
      if (shouldLog) {
        console.warn("Flights: no se pudo registrar icono custom; usando circle");
      }
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
    // render_mode === "auto"
    if (this.spriteAvailable) {
      return "symbol";
    }
    // Intentar usar icono custom como fallback
    if (this.map) {
      const registered = await registerPlaneIcon(this.map);
      if (registered) {
        this.planeIconRegistered = true;
        return "symbol_custom";
      }
    }
    if (shouldLog && !AircraftLayer.autoSpriteWarned) {
      console.warn("Flights: sprite no disponible; usando fallback circle");
      AircraftLayer.autoSpriteWarned = true;
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
      if (this.planeIconRegistered && safeHasImage(this.map, "plane")) {
        return "symbol_custom";
      }
      // Si no está registrado, usar circle temporalmente hasta que se registre
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
    // render_mode === "auto"
    if (this.spriteAvailable) {
      return "symbol";
    }
    // Para auto sin sprite, verificar si el icono custom ya está registrado
    if (this.planeIconRegistered && safeHasImage(this.map, "plane")) {
      return "symbol_custom";
    }
    return "circle";
  }

  /**
   * Asegura que el source existe. Completamente idempotente.
   * MapLibre permite añadir sources incluso si el estilo aún no está completamente cargado.
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
        // Actualizar datos si hay nuevos
        source.setData(this.lastData);
      }
      return;
    }

    // El source no existe, crearlo
    // No necesitamos verificar el estilo para crear el source; MapLibre lo permite
    const expectedCluster = this.shouldUseClusters();
    const sourceInit: maplibregl.GeoJSONSourceSpecification = {
      type: "geojson",
      data: this.lastData,
      generateId: true,
    };
    if (expectedCluster) {
      sourceInit.cluster = true;
      sourceInit.clusterRadius = 40;
      sourceInit.clusterMaxZoom = 10;
    }

    try {
      map.addSource(this.sourceId, sourceInit);
    } catch (error) {
      // Si falla (p. ej. source ya existe o estilo no listo), intentar actualizar datos si el source ya existe
      const source = map.getSource(this.sourceId);
      if (isGeoJSONSource(source)) {
        source.setData(this.lastData);
      } else {
        console.warn("[AircraftLayer] Could not add source, will retry later:", error);
      }
    }
  }

  /**
   * Encuentra el ID de la primera capa de símbolos de etiquetas para colocar nuestras capas antes de ella.
   * Retorna undefined si no se encuentra.
   */
  private findBeforeId(map: MaptilerMap): string | undefined {
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
        if (map.getLayer(this.clusterLayerId)) {
          const style2 = getSafeMapStyle(map);
          const layers2 = Array.isArray(style2?.layers) ? (style2!.layers as Array<{ id?: string }>) : [];
          if (Array.isArray(layers2) && layers2.length > 0) {
            const lastLayer = layers2[layers2.length - 1] as { id?: string } | undefined;
            if (lastLayer && lastLayer.id !== this.clusterLayerId) {
              map.moveLayer(this.clusterLayerId, lastLayer.id);
            }
          }
        }
        if (map.getLayer(this.clusterCountLayerId)) {
          const style3 = getSafeMapStyle(map);
          const layers3 = Array.isArray(style3?.layers) ? (style3!.layers as Array<{ id?: string }>) : [];
          if (Array.isArray(layers3) && layers3.length > 0) {
            const lastLayer = layers3[layers3.length - 1] as { id?: string } | undefined;
            if (lastLayer && lastLayer.id !== this.clusterCountLayerId) {
              map.moveLayer(this.clusterCountLayerId, lastLayer.id);
            }
          }
        }
      } catch (error) {
        // Si falla el movimiento, no es crítico
        console.warn("[AircraftLayer] Error al mover capas al tope:", error);
      }
    }
  }

  /**
   * Asegura que las capas existen. Completamente idempotente.
   * Verifica que el source exista antes de crear capas para evitar errores de MapLibre.
   * 
   * NOTA: Esta función asume que waitForStyleLoaded() ya se llamó en el nivel superior.
   * Por lo tanto, NO usa withSafeMapStyle() para evitar verificaciones redundantes que pueden fallar
   * si el estilo está en transición.
   */
  private async ensureLayersAsync(): Promise<void> {
    if (!this.map) {
      return;
    }
    const map = this.map;

    // No intentar crear capas si el source no existe aún
    // Esto evita errores de MapLibre tipo "source not found"
    const src = map.getSource(this.sourceId);
    if (!src) {
      console.warn("[AircraftLayer] Source not ready, skipping ensureLayersAsync");
      return;
    }

    // Determinar el modo de renderizado actual
    const nextMode = await this.determineRenderModeAsync(false);
    const modeChanged = nextMode !== this.currentRenderMode;
    this.currentRenderMode = nextMode;

    const beforeId = this.findBeforeId(map);

    // Asegurar capas de cluster si es necesario
    if (this.shouldUseClusters()) {
      if (!map.getLayer(this.clusterLayerId)) {
        try {
          map.addLayer({
            id: this.clusterLayerId,
            type: "circle",
            source: this.sourceId,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#f97316",
              "circle-radius": 20,
            },
          }, beforeId);
        } catch (e) {
          console.warn("[AircraftLayer] Could not add cluster layer:", e);
        }
      }

      if (!map.getLayer(this.clusterCountLayerId)) {
        try {
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
          }, beforeId);
        } catch (e) {
          console.warn("[AircraftLayer] Could not add cluster count layer:", e);
        }
      }
    } else {
      // Eliminar capas de cluster si no se necesitan
      if (map.getLayer(this.clusterLayerId)) {
        try {
          map.removeLayer(this.clusterLayerId);
        } catch { }
      }
      if (map.getLayer(this.clusterCountLayerId)) {
        try {
          map.removeLayer(this.clusterCountLayerId);
        } catch { }
      }
    }

    // Asegurar capa principal (circle o symbol)
    if (this.currentRenderMode === "symbol" || this.currentRenderMode === "symbol_custom") {
      // Capa symbol
      if (!map.getLayer(this.id)) {
        const iconImage = this.currentRenderMode === "symbol_custom" ? "plane" : this.iconImage;
        const allowOverlap = this.currentRenderMode === "symbol_custom"
          ? (this.symbolOptions?.allow_overlap ?? true)
          : true;
        const sizeExpression = this.currentRenderMode === "symbol_custom"
          ? this.getCustomSymbolSizeExpression()
          : this.getIconSizeExpression();

        try {
          map.addLayer({
            id: this.id,
            type: "symbol",
            source: this.sourceId,
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": iconImage,
              "icon-size": sizeExpression,
              "icon-allow-overlap": allowOverlap,
              "icon-rotate": ["coalesce", ["get", "track"], ["get", "true_track"], ["get", "heading"], 0],
              "icon-rotation-alignment": "map",
              visibility: this.enabled ? "visible" : "none",
            },
            paint: {
              "icon-color": "#f97316",
              "icon-halo-color": "#111827",
              "icon-halo-width": 0.25,
              "icon-opacity": this.opacity,
            },
          }, beforeId);
          console.log("[AircraftLayer] Symbol layer added successfully");
        } catch (e) {
          console.warn("[AircraftLayer] Could not add symbol layer:", e);
        }
      } else if (modeChanged) {
        // Si cambió el modo, actualizar propiedades de la capa existente
        if (map.getLayer(this.id)) {
          try {
            const iconImage = this.currentRenderMode === "symbol_custom" ? "plane" : this.iconImage;
            map.setLayoutProperty(this.id, "icon-image", iconImage);
            if (this.currentRenderMode === "symbol_custom") {
              map.setLayoutProperty(this.id, "icon-size", this.getCustomSymbolSizeExpression());
              map.setLayoutProperty(this.id, "icon-allow-overlap", this.symbolOptions?.allow_overlap ?? true);
            } else {
              map.setLayoutProperty(this.id, "icon-size", this.getIconSizeExpression());
              map.setLayoutProperty(this.id, "icon-allow-overlap", true);
            }
          } catch (error) {
            console.warn("[AircraftLayer] layout skipped:", error);
          }
        }
      }
    } else {
      // Capa circle
      if (!map.getLayer(this.id)) {
        try {
          map.addLayer({
            id: this.id,
            type: "circle",
            source: this.sourceId,
            filter: ["!", ["has", "point_count"]],
            layout: {
              visibility: this.enabled ? "visible" : "none",
            },
            paint: {
              "circle-radius": this.getCircleRadiusExpression(),
              "circle-color": this.circleOptions.color,
              "circle-stroke-color": this.circleOptions.strokeColor,
              "circle-stroke-width": this.circleOptions.strokeWidth,
            },
          }, beforeId);
          console.log("[AircraftLayer] Circle layer added successfully");
        } catch (e) {
          console.warn("[AircraftLayer] Could not add circle layer:", e);
        }
      } else if (modeChanged) {
        // Si cambió el modo, actualizar propiedades de la capa existente
        if (map.getLayer(this.id)) {
          try {
            map.setPaintProperty(this.id, "circle-radius", this.getCircleRadiusExpression());
            map.setPaintProperty(this.id, "circle-color", this.circleOptions.color);
            map.setPaintProperty(this.id, "circle-stroke-color", this.circleOptions.strokeColor);
            map.setPaintProperty(this.id, "circle-stroke-width", this.circleOptions.strokeWidth);
          } catch (error) {
            console.warn("[AircraftLayer] paint skipped:", error);
          }
        }
      }
    }

    // Aplicar propiedades comunes solo si la capa existe
    if (map.getLayer(this.id)) {
      this.applyCirclePaintProperties();
      this.applyOpacity();
      this.applyStyleScale();
    }
  }

  /**
   * Versión síncrona de ensureLayers (para compatibilidad).
   * @deprecated Usar ensureLayersAsync en su lugar.
   * Verifica que el source exista antes de crear capas para evitar errores de MapLibre.
   */
  private ensureLayers(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;

    // No intentar crear capas si el source no existe aún
    // Esto evita errores de MapLibre tipo "source not found"
    const src = map.getSource(this.sourceId);
    if (!src) {
      console.warn("[AircraftLayer] Source not ready, skipping ensureLayers");
      return;
    }

    // Verificar que el estilo esté listo antes de manipular layers
    const style = getSafeMapStyle(map);
    if (!style) {
      console.warn("[AircraftLayer] style not ready, skipping ensureLayers");
      return;
    }

    const beforeId = this.findBeforeId(map);

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
          layout: {
            visibility: this.enabled ? "visible" : "none",
          },
        }, beforeId);
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
            visibility: this.enabled ? "visible" : "none",
          },
          paint: {
            "text-color": "#ffffff",
          },
        }, beforeId);
      }
    } else {
      if (map.getLayer(this.clusterLayerId)) {
        map.removeLayer(this.clusterLayerId);
      }
      if (map.getLayer(this.clusterCountLayerId)) {
        map.removeLayer(this.clusterCountLayerId);
      }
    }

    // Asegurar capa principal (circle o symbol)
    if (this.currentRenderMode === "symbol" || this.currentRenderMode === "symbol_custom") {
      if (!map.getLayer(this.id)) {
        const iconImage = this.currentRenderMode === "symbol_custom" ? "plane" : this.iconImage;
        const allowOverlap = this.currentRenderMode === "symbol_custom"
          ? (this.symbolOptions?.allow_overlap ?? true)
          : true;
        const sizeExpression = this.currentRenderMode === "symbol_custom"
          ? this.getCustomSymbolSizeExpression()
          : this.getIconSizeExpression();

        map.addLayer({
          id: this.id,
          type: "symbol",
          source: this.sourceId,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": iconImage,
            "icon-size": sizeExpression,
            "icon-allow-overlap": allowOverlap,
            "icon-rotate": ["coalesce", ["get", "track"], ["get", "true_track"], ["get", "heading"], 0],
            "icon-rotation-alignment": "map",
            visibility: this.enabled ? "visible" : "none",
          },
          paint: {
            "icon-color": "#f97316",
            "icon-halo-color": "#111827",
            "icon-halo-width": 0.25,
            "icon-opacity": this.opacity,
          },
        }, beforeId);
      }
    } else {
      if (!map.getLayer(this.id)) {
        map.addLayer({
          id: this.id,
          type: "circle",
          source: this.sourceId,
          filter: ["!", ["has", "point_count"]],
          layout: {
            visibility: this.enabled ? "visible" : "none",
          },
          paint: {
            "circle-radius": this.getCircleRadiusExpression(),
            "circle-color": this.circleOptions.color,
            "circle-stroke-color": this.circleOptions.strokeColor,
            "circle-stroke-width": this.circleOptions.strokeWidth,
          },
        }, beforeId);
      }
    }

    this.applyCirclePaintProperties();
    this.applyOpacity();
    this.applyStyleScale();
  }

  private removeLayers(map: MaptilerMap): void {
    if (map.getLayer(this.id)) {
      map.removeLayer(this.id);
    }
    if (map.getLayer(this.clusterLayerId)) {
      map.removeLayer(this.clusterLayerId);
    }
    if (map.getLayer(this.clusterCountLayerId)) {
      map.removeLayer(this.clusterCountLayerId);
    }
  }

  private shouldUseClusters(): boolean {
    return this.clusterEnabled && this.currentRenderMode === "circle";
  }

  private getFeatureOpacityExpression(baseOpacity: number): maplibregl.ExpressionSpecification {
    return [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "age_seconds"], 0],
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
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[AircraftLayer] Style not ready, skipping");
      return;
    }

    try {
      const baseOpacity = (this.currentRenderMode === "symbol" || this.currentRenderMode === "symbol_custom")
        ? this.opacity
        : this.opacity * this.circleOptions.opacity;
      const expression = this.getFeatureOpacityExpression(baseOpacity);
      if (this.currentRenderMode === "symbol" || this.currentRenderMode === "symbol_custom") {
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
    } catch (error) {
      console.warn("[AircraftLayer] paint skipped:", error);
    }
  }

  private applyCirclePaintProperties(): void {
    if (!this.map || this.currentRenderMode !== "circle" || !this.map.getLayer(this.id)) {
      return;
    }
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[AircraftLayer] Style not ready, skipping");
      return;
    }
    try {
      this.map.setPaintProperty(this.id, "circle-radius", this.getCircleRadiusExpression());
      this.map.setPaintProperty(this.id, "circle-color", this.circleOptions.color);
      this.map.setPaintProperty(this.id, "circle-stroke-color", this.circleOptions.strokeColor);
      this.map.setPaintProperty(this.id, "circle-stroke-width", this.circleOptions.strokeWidth);
    } catch (error) {
      console.warn("[AircraftLayer] paint skipped:", error);
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
    // V2: calcular radio basado en zoom usando radius_base y radius_zoom_scale
    // Reescrito usando interpolate para cumplir las reglas de MapLibre:
    // "zoom" solo puede aparecer como input de una expresión ["step", ...] o ["interpolate", ...] de primer nivel
    const radiusBase = this.circleOptions.radiusBase;
    const radiusZoomScale = this.circleOptions.radiusZoomScale;

    // Calcular factor de escala
    const scaleFactor = radiusZoomScale / 10; // Dividir por 10 para hacerlo más razonable

    // Función helper para calcular radio en un zoom dado
    // Fórmula: radius = radius_base * (1 + (zoom - 5) * scale_factor)
    const radiusAt = (zoom: number): number => {
      return radiusBase * (1 + (zoom - 5) * scaleFactor);
    };

    // Calcular stops en diferentes niveles de zoom
    // Asegurar que todos los radios sean >= 1 para evitar errores
    const r2 = Math.max(1, radiusAt(2));
    const r6 = Math.max(1, radiusAt(6));
    const r10 = Math.max(1, radiusAt(10));
    const r14 = Math.max(1, radiusAt(14));

    // Devolver expresión interpolate válida de MapLibre
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      2, r2,
      6, r6,
      10, r10,
      14, r14,
    ] as maplibregl.ExpressionSpecification;
  }

  private getCustomSymbolSizeExpression(): maplibregl.ExpressionSpecification {
    // Calcular tamaño en pixels basado en viewport height
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 480;
    const sizeVh = this.symbolOptions?.size_vh ?? 1.6;
    const sizePixels = (sizeVh / 100) * viewportHeight;
    // Retornar como número literal (ExpressionSpecification puede ser un número)
    return sizePixels as unknown as maplibregl.ExpressionSpecification;
  }

  private applyStyleScale(): void {
    if (!this.map || (this.currentRenderMode !== "symbol" && this.currentRenderMode !== "symbol_custom")) {
      return;
    }
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[AircraftLayer] Style not ready, skipping");
      return;
    }
    if (this.map.getLayer(this.id)) {
      try {
        if (this.currentRenderMode === "symbol_custom") {
          this.map.setLayoutProperty(this.id, "icon-size", this.getCustomSymbolSizeExpression());
        } else {
          this.map.setLayoutProperty(this.id, "icon-size", this.getIconSizeExpression());
        }
      } catch (error) {
        console.warn("[AircraftLayer] layout skipped:", error);
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
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[AircraftLayer] Style not ready, skipping");
      return;
    }
    const map = this.map;
    const baseVisibility = this.enabled ? "visible" : "none";

    try {
      // Asegurar que la capa principal esté visible según el modo
      if (map.getLayer(this.id)) {
        map.setLayoutProperty(this.id, "visibility", baseVisibility);
      }

      // Capas de cluster
      if (map.getLayer(this.clusterLayerId)) {
        map.setLayoutProperty(this.clusterLayerId, "visibility", baseVisibility);
      }
      if (map.getLayer(this.clusterCountLayerId)) {
        map.setLayoutProperty(this.clusterCountLayerId, "visibility", baseVisibility);
      }
    } catch (e) {
      console.warn("[AircraftLayer] layout skipped:", e);
    }
  }

  /**
   * Aplica visibilidad simple (para compatibilidad).
   */
  private applyVisibility(): void {
    this.applyVisibilityByMode();
  }

  private registerEvents(map: MaptilerMap) {
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
          const popup = new Popup();
          popup.setLngLat(event.lngLat as { lng: number; lat: number });
          popup.setHTML(content);
          popup.addTo(map);
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

    map.on("mouseenter", this.id, this.onMouseEnter as unknown as (ev: MapLayerMouseEvent & { features?: GeoJSONFeature[] }) => void);
    map.on("mouseleave", this.id, this.onMouseLeave as unknown as (ev: MapLayerMouseEvent & { features?: GeoJSONFeature[] }) => void);
    map.on("mousemove", this.id, this.onMouseMove as unknown as (ev: MapLayerMouseEvent & { features?: GeoJSONFeature[] }) => void);
    this.eventsRegistered = true;
  }

  private unregisterEvents(map: MaptilerMap) {
    if (!this.eventsRegistered) {
      return;
    }
    if (this.onMouseEnter) {
      map.off("mouseenter", this.id, this.onMouseEnter as unknown as (ev: MapLayerMouseEvent & { features?: GeoJSONFeature[] }) => void);
    }
    if (this.onMouseLeave) {
      map.off("mouseleave", this.id, this.onMouseLeave as unknown as (ev: MapLayerMouseEvent & { features?: GeoJSONFeature[] }) => void);
    }
    if (this.onMouseMove) {
      map.off("mousemove", this.id, this.onMouseMove as unknown as (ev: MapLayerMouseEvent & { features?: GeoJSONFeature[] }) => void);
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
