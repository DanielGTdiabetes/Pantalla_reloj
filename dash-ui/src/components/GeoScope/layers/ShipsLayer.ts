import { Map as MaptilerMap, Popup, type MapLayerMouseEvent } from "@maptiler/sdk";
import type { FeatureCollection } from "geojson";

import type { ShipsLayerCircleConfig, ShipsLayerRenderMode, ShipsLayerSymbolConfig } from "../../../types/config";
import type { Layer } from "./LayerRegistry";
import { getExistingPopup, isGeoJSONSource } from "./layerUtils";
import { registerShipIcon } from "../utils/shipIcon";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { withSafeMapStyle, withSafeMapStyleAsync, safeHasImage, waitForStyleLoaded } from "../../../lib/map/utils/safeMapOperations";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";

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
  private map?: MaptilerMap;
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
    this.maxAgeSeconds = options.maxAgeSeconds ?? 3600; // 1 hora por defecto (AIS es lento)
    this.cineFocus = options.cineFocus;
    this.styleScale = options.styleScale ?? 1.0;
    // Default a symbol_custom para usar icono personalizado (más fiable que depender del sprite)
    this.renderMode = options.renderMode ?? "symbol_custom";
    this.spriteAvailable = options.spriteAvailable ?? false;
    this.circleOptions = normalizeCircleOptions(options.circle, typeof window !== "undefined" ? window.innerHeight : 480);
    this.symbolOptions = options.symbol;
    this.iconImage = options.iconImage ?? DEFAULT_ICON_IMAGE;
    // Determinar modo de renderizado inicial
    // Si mode es symbol_custom o (auto sin sprite), usar symbol_custom
    // El icono se registrará en ensureShipsLayer()
    if (this.renderMode === "symbol_custom" || (this.renderMode === "auto" && !this.spriteAvailable)) {
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
      return this.ensureShipsLayer();
    }
  }

  /**
   * Asegura que la capa de barcos esté inicializada después de cambios de estilo.
   * Debe ser llamado en eventos 'styledata' y 'load'.
   * Completamente idempotente: puede ser llamado múltiples veces sin efectos secundarios.
   */
  async ensureShipsLayer(): Promise<void> {
    const layerId: LayerId = "ships";

    if (!this.map || !this.enabled) {
      if (!this.map) {
        layerDiagnostics.recordError(layerId, new Error("Map not available"), {
          phase: "ensureShipsLayer",
        });
      }
      return;
    }

    // CRÍTICO: Esperar a que el estilo esté completamente cargado antes de continuar
    // Esto evita el error "Style not loaded yet, skipping operation"
    const styleReady = await waitForStyleLoaded(this.map, 15000);
    if (!styleReady) {
      console.warn("[ShipsLayer] Timeout waiting for style, will retry on next call");
      layerDiagnostics.updatePreconditions(layerId, { styleLoaded: false });
      return;
    }
    layerDiagnostics.updatePreconditions(layerId, { styleLoaded: true });
    console.log("[ShipsLayer] Style is ready, proceeding with layer creation");

    try {
      // Intentar registrar el icono custom si es necesario
      if (this.renderMode === "symbol_custom" || (this.renderMode === "auto" && !this.spriteAvailable)) {
        try {
          const registered = await registerShipIcon(this.map);
          if (registered) {
            this.shipIconRegistered = true;
            // CRÍTICO: Actualizar el modo a symbol_custom después de registrar el icono
            this.currentRenderMode = "symbol_custom";
            console.log("[ShipsLayer] Ship icon registered, using symbol_custom mode");
            layerDiagnostics.updatePreconditions(layerId, {
              apiKeysConfigured: true,
            });
          } else {
            console.warn("[ShipsLayer] Failed to register ship icon, falling back to circle");
            this.currentRenderMode = "circle";
          }
        } catch (iconError) {
          const error = iconError instanceof Error ? iconError : new Error(String(iconError));
          layerDiagnostics.recordError(layerId, error, {
            phase: "icon_registration",
          });
          console.warn("[ShipsLayer] Failed to register ship icon:", iconError);
          this.currentRenderMode = "circle";
        }
      }

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
        console.warn("[ShipsLayer] Source still missing after ensureSource, skipping ensureLayersAsync");
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
        console.warn("[ShipsLayer] Error ensuring layer order:", orderError);
      }

      // Asegurar visibilidad según render_mode
      try {
        this.applyVisibilityByMode();
      } catch (visibilityError) {
        const error = visibilityError instanceof Error ? visibilityError : new Error(String(visibilityError));
        layerDiagnostics.recordError(layerId, error, {
          phase: "apply_visibility",
        });
        console.warn("[ShipsLayer] Error applying visibility:", visibilityError);
      }

      // Marcar como listo si llegamos aquí
      layerDiagnostics.setState(layerId, "ready");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      layerDiagnostics.recordError(layerId, err, {
        phase: "ensureShipsLayer",
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
    if (!this.map || this.currentRenderMode !== "symbol_custom" || !this.map.getLayer(this.id)) {
      return;
    }
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[ShipsLayer] Style not ready, skipping");
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
      console.warn("[ShipsLayer] layout skipped:", e);
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
    const layerId: LayerId = "ships";

    try {
      // Validar que los datos sean un FeatureCollection válido
      if (!data || typeof data !== "object" || data.type !== "FeatureCollection") {
        const error = new Error(`Invalid FeatureCollection: ${JSON.stringify(data).substring(0, 100)}`);
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_validation",
        });
        console.error("[ShipsLayer] Invalid data format:", data);
        // Resiliente: si no hay datos o features está vacío, usar EMPTY
        this.lastData = EMPTY;
        if (this.map) {
          const source = this.map.getSource(this.sourceId);
          if (isGeoJSONSource(source)) {
            try {
              source.setData(EMPTY);
            } catch (setDataError) {
              const err = setDataError instanceof Error ? setDataError : new Error(String(setDataError));
              layerDiagnostics.recordError(layerId, err, {
                phase: "updateData_setEmpty",
              });
            }
          }
        }
        return;
      }

      if (!Array.isArray(data.features)) {
        const error = new Error("Features array is missing or invalid");
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_validation",
        });
        console.error("[ShipsLayer] Features array is missing or invalid");
        this.lastData = EMPTY;
        if (this.map) {
          const source = this.map.getSource(this.sourceId);
          if (isGeoJSONSource(source)) {
            try {
              source.setData(EMPTY);
            } catch (setDataError) {
              const err = setDataError instanceof Error ? setDataError : new Error(String(setDataError));
              layerDiagnostics.recordError(layerId, err, {
                phase: "updateData_setEmpty",
              });
            }
          }
        }
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
                  // Force age to 0 to prevent issues with client clock synchronization
                  age_seconds: 0,
                  in_focus: inFocus,
                  stale: isStale ? true : undefined,
                },
              };
            } catch (featureError) {
              console.warn("[ShipsLayer] Error processing feature:", featureError);
              return null;
            }
          })
          .filter((f): f is NonNullable<typeof f> => f !== null),
      };

      this.lastData = featuresWithAge;

      if (!this.map) {
        console.warn("[ShipsLayer] Map not available for updateData");
        return;
      }

      // Intentar obtener el source, o crearlo si no existe
      let source = this.map.getSource(this.sourceId);

      // Si el source no existe, intentar crearlo
      if (!source) {
        try {
          this.map.addSource(this.sourceId, {
            type: "geojson",
            data: this.lastData,
            generateId: true,
          });
          source = this.map.getSource(this.sourceId);
          console.log("[ShipsLayer] Source created in updateData");
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
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          layerDiagnostics.recordError(layerId, err, {
            phase: "updateData_setData",
            featureCount: featuresWithAge.features.length,
          });
          console.warn("[ShipsLayer] Error updating data:", error);
        }
      } else if (source === undefined) {
        // Source aún no creado, los datos se guardan en lastData para cuando se cree
        console.log("[ShipsLayer] Source not yet available, data saved for later");
      } else {
        const error = new Error(`Source ${this.sourceId} is not a GeoJSON source`);
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_source_check",
        });
        console.warn("[ShipsLayer] Source is not a GeoJSON source:", source);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      layerDiagnostics.recordError(layerId, err, {
        phase: "updateData",
      });
      console.error("[ShipsLayer] Error in updateData:", error);
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
      if (this.shipIconRegistered && safeHasImage(this.map, "ship")) {
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
    if (this.shipIconRegistered && safeHasImage(this.map, "ship")) {
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
        source.setData(this.lastData);
      }
      return;
    }

    // El source no existe, crearlo
    // No necesitamos verificar el estilo para crear el source; MapLibre lo permite
    const sourceInit: maplibregl.GeoJSONSourceSpecification = {
      type: "geojson",
      data: this.lastData,
      generateId: true,
    };

    try {
      map.addSource(this.sourceId, sourceInit);
    } catch (error) {
      // Si falla (p. ej. source ya existe o estilo no listo), intentar actualizar datos si el source ya existe
      const source = map.getSource(this.sourceId);
      if (isGeoJSONSource(source)) {
        source.setData(this.lastData);
      } else {
        console.warn("[ShipsLayer] Could not add source, will retry later:", error);
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
      } catch (error) {
        // Si falla el movimiento, no es crítico
        console.warn("[ShipsLayer] Error al mover capas al tope:", error);
      }
    }
  }

  /**
   * Asegura que las capas existen. Completamente idempotente.
   * Verifica que el source exista antes de crear capas para evitar errores de MapLibre.
   * 
   * NOTA: Esta función asume que waitForStyleLoaded() ya se llamó en el nivel superior.
   * Por lo tanto, NO usa withSafeMapStyle() para evitar verificaciones redundantes.
   */
  private async ensureLayersAsync(): Promise<void> {
    if (!this.map) {
      return;
    }
    const map = this.map;

    // No intentar crear capas si el source no existe aún
    const src = map.getSource(this.sourceId);
    if (!src) {
      console.warn("[ShipsLayer] Source not ready, skipping ensureLayersAsync");
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
              "icon-rotate": ["coalesce", ["get", "course"], ["get", "heading"], 0],
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
                ["coalesce", ["get", "age_seconds"], 0],
                0, this.opacity,
                this.maxAgeSeconds / 2, this.opacity * 0.5,
                this.maxAgeSeconds, 0.0
              ],
            },
          }, beforeId);
          console.log("[ShipsLayer] Symbol layer added successfully");
        } catch (e) {
          console.warn("[ShipsLayer] Could not add symbol layer:", e);
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
                ["coalesce", ["get", "age_seconds"], 0],
                0, this.opacity * this.circleOptions.opacity,
                this.maxAgeSeconds / 2, this.opacity * this.circleOptions.opacity * 0.5,
                this.maxAgeSeconds, 0.0
              ],
            },
          }, beforeId);
          console.log("[ShipsLayer] Circle layer added successfully");
        } catch (e) {
          console.warn("[ShipsLayer] Could not add circle layer:", e);
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
        console.warn("[ShipsLayer] paint/layout skipped:", error);
      }
    }

    // Aplicar propiedades comunes
    if (map.getLayer(this.id)) {
      this.applyCirclePaintProperties();
      this.applyOpacity();
      this.applyStyleScale();
    }
  }

  private removeLayers(map: MaptilerMap): void {
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

    // Asegurar tamaño mínimo para evitar que desaparezcan en pantallas pequeñas
    const effectiveSizePixels = Math.max(sizePixels, 32);

    // El icono base es de 64x64 (definido en shipIcon.ts)
    // MapLibre usa icon-size como factor de escala sobre el tamaño original
    const scaleFactor = effectiveSizePixels / 64;

    // Retornar como número literal (ExpressionSpecification puede ser un número)
    return scaleFactor as unknown as maplibregl.ExpressionSpecification;
  }

  private applyStyleScale(): void {
    if (!this.map || (this.currentRenderMode !== "symbol" && this.currentRenderMode !== "symbol_custom")) {
      return;
    }
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[ShipsLayer] Style not ready, skipping");
      return;
    }
    if (this.map.getLayer(this.id)) {
      try {
        if (this.currentRenderMode === "symbol_custom") {
          this.map.setLayoutProperty(this.id, "icon-size", this.getCustomSymbolSizeExpression());
        } else {
          this.map.setLayoutProperty(this.id, "icon-size", this.getIconSizeExpression());
        }
      } catch (e) {
        console.warn("[ShipsLayer] layout skipped:", e);
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
      console.warn("[ShipsLayer] Style not ready, skipping");
      return;
    }
    const map = this.map;
    const baseVisibility = this.enabled ? "visible" : "none";

    // Asegurar que la capa principal esté visible según el modo
    if (map.getLayer(this.id)) {
      try {
        map.setLayoutProperty(this.id, "visibility", baseVisibility);
      } catch (e) {
        console.warn("[ShipsLayer] layout skipped:", e);
      }
    }
  }

  private applyVisibility(): void {
    if (!this.map) {
      return;
    }
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[ShipsLayer] Style not ready, skipping");
      return;
    }
    const visibility = this.enabled ? "visible" : "none";
    if (this.map.getLayer(this.id)) {
      try {
        this.map.setLayoutProperty(this.id, "visibility", visibility);
      } catch (e) {
        console.warn("[ShipsLayer] layout skipped:", e);
      }
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
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[ShipsLayer] Style not ready, skipping");
      return;
    }
    if (!this.map.getLayer(this.id)) {
      return;
    }
    try {
      this.map.setPaintProperty(this.id, "circle-radius", this.getCircleRadiusExpression());
      this.map.setPaintProperty(this.id, "circle-color", this.circleOptions.color);
      this.map.setPaintProperty(this.id, "circle-stroke-color", this.circleOptions.strokeColor);
      this.map.setPaintProperty(this.id, "circle-stroke-width", this.circleOptions.strokeWidth);
    } catch (e) {
      console.warn("[ShipsLayer] paint skipped:", e);
    }
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

    map.on("mouseenter", this.id, this.onMouseEnter as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mouseleave", this.id, this.onMouseLeave as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mousemove", this.id, this.onMouseMove as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    this.eventsRegistered = true;
  }

  private unregisterEvents(map: MaptilerMap) {
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
