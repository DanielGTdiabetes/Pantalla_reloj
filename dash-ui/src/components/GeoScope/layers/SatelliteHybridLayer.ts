import maplibregl from "maplibre-gl";
import type {
  LayerSpecification,
  SymbolLayerSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";

import type { Layer } from "./LayerRegistry";

export type SatelliteLabelsStyle = "maptiler-streets-v4-labels" | "none" | "custom-url";

export type SatelliteHybridLayerOptions = {
  apiKey?: string | null;
  enabled?: boolean;
  opacity?: number;
  labelsEnabled?: boolean;
  labelsStyle?: SatelliteLabelsStyle;
  labelsStyleUrl?: string | null; // URL del estilo para overlay de etiquetas
  layerFilter?: string | null; // Filtro JSON para seleccionar capas
  zIndex?: number;
};

const clampOpacity = (value: unknown, fallback: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, numeric));
};

const OVERLAY_LAYER_PREFERENCE = [
  "geoscope-global-radar",
  "geoscope-global-satellite",
  "geoscope-weather",
  "geoscope-aemet-warnings",
  "geoscope-lightning",
  "geoscope-aircraft",
  "geoscope-ships",
];

const SATELLITE_TILE_URL = "https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=";

const ATTRIBUTION = "© MapTiler © OpenStreetMap contributors";

/**
 * Capa híbrida satélite + labels vectoriales sobre MapLibre.
 * Inserta textura satélite MapTiler con opacidad configurable y duplica
 * las capas de labels del estilo activo para mostrarlas por encima.
 */
export default class SatelliteHybridLayer implements Layer {
  public readonly id = "geoscope-satellite-hybrid";
  public readonly zIndex: number;

  private enabled: boolean;
  private opacity: number;
  private labelsStyle: SatelliteLabelsStyle;
  private apiKey: string | null;
  private labelsEnabled: boolean;
  private labelsStyleUrl: string | null;
  private layerFilter: string | null;
  private map?: maplibregl.Map;
  private warnedMissingKey = false;
  private readonly rasterSourceId = `${this.id}-raster-source`;
  private readonly rasterLayerId = `${this.id}-raster-layer`;
  private readonly labelLayerPrefix = `${this.id}-label-`;
  private labelLayerIds: string[] = [];
  private labelsSourceId = `${this.id}-labels-source`;
  private labelsLoaded = false;

  constructor(options: SatelliteHybridLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = clampOpacity(options.opacity, 0.85);
    const initialLabelsEnabled = options.labelsEnabled ?? true;
    this.labelsStyleUrl = options.labelsStyleUrl?.trim() ?? null;
    this.layerFilter = options.layerFilter ?? null;
    this.labelsStyle =
      options.labelsStyle ??
      (this.labelsStyleUrl ? "custom-url" :
      (initialLabelsEnabled ? "maptiler-streets-v4-labels" : "none"));
    this.labelsEnabled = this.labelsStyle !== "none";
    this.apiKey = options.apiKey?.trim() ?? null;
    this.zIndex = options.zIndex ?? 5;
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    this.syncState();
  }

  remove(map: maplibregl.Map): void {
    this.removeLabelLayers(map);
    this.removeRaster(map);
  }

  destroy(): void {
    this.map = undefined;
    this.labelLayerIds = [];
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) {
      return;
    }
    this.enabled = on;
    this.syncState();
  }

  setOpacity(opacity: number): void {
    const clamped = clampOpacity(opacity, this.opacity);
    if (this.opacity === clamped) {
      return;
    }
    this.opacity = clamped;
    if (!this.map) {
      return;
    }
    if (this.map.getLayer(this.rasterLayerId)) {
      try {
        this.map.setPaintProperty(this.rasterLayerId, "raster-opacity", this.opacity);
      } catch (error) {
        console.warn("[SatelliteHybrid] No se pudo actualizar la opacidad del raster", error);
      }
    }
  }

  setLabelsStyleUrl(url: string | null | undefined): void {
    const normalized = url?.trim() ?? null;
    if (this.labelsStyleUrl === normalized) {
      return;
    }
    this.labelsStyleUrl = normalized;
    this.labelsLoaded = false;
    this.syncState();
  }

  setLayerFilter(filter: string | null | undefined): void {
    const normalized = filter?.trim() ?? null;
    if (this.layerFilter === normalized) {
      return;
    }
    this.layerFilter = normalized;
    this.syncState();
  }

  setLabelsStyle(style: SatelliteLabelsStyle): void {
    if (this.labelsStyle === style) {
      return;
    }
    this.labelsStyle = style;
    this.labelsEnabled = style !== "none";
    this.syncState();
  }

  setLabelsEnabled(enabled: boolean): void {
    if (this.labelsEnabled === enabled) {
      return;
    }
    this.labelsEnabled = enabled;
    const targetStyle: SatelliteLabelsStyle = enabled
      ? "maptiler-streets-v4-labels"
      : "none";
    this.setLabelsStyle(targetStyle);
  }

  setApiKey(key: string | null | undefined): void {
    const normalized = key?.trim() ?? null;
    if (this.apiKey === normalized) {
      return;
    }
    this.apiKey = normalized;
    this.warnedMissingKey = false;
    this.syncState();
  }

  private syncState(): void {
    const map = this.map;
    if (!map) {
      return;
    }

    if (!this.enabled) {
      this.removeLabelLayers(map);
      this.removeRaster(map);
      return;
    }

    if (!this.apiKey) {
      this.warnMissingKey();
      this.removeLabelLayers(map);
      this.removeRaster(map);
      return;
    }

    this.ensureRasterLayer(map);

    if (this.labelsEnabled) {
      if (this.labelsStyle === "custom-url" && this.labelsStyleUrl) {
        // Usar estilo desde URL personalizada
        this.ensureLabelLayersFromUrl(map);
      } else if (this.labelsStyle === "maptiler-streets-v4-labels") {
        // Usar estilo hardcodeado (legacy)
        this.ensureLabelLayers(map);
      } else {
        this.removeLabelLayers(map);
      }
    } else {
      this.removeLabelLayers(map);
    }
  }

  private ensureRasterLayer(map: maplibregl.Map): void {
    const expectedTileUrl = `${SATELLITE_TILE_URL}${this.apiKey}`;
    const existingSource = map.getSource(this.rasterSourceId) as maplibregl.Source | undefined;

    if (existingSource) {
      const tiles = (existingSource as unknown as { tiles?: string[] }).tiles ?? [];
      if (!tiles.some((tile) => tile.includes(this.apiKey ?? ""))) {
        this.removeRaster(map);
      }
    }

    if (!map.getSource(this.rasterSourceId)) {
      map.addSource(this.rasterSourceId, {
        type: "raster",
        tiles: [expectedTileUrl],
        tileSize: 256,
        scheme: "xyz",
        attribution: ATTRIBUTION,
      });
    }

    const beforeId = this.findOverlayBeforeId(map);
    if (!map.getLayer(this.rasterLayerId)) {
      map.addLayer(
        {
          id: this.rasterLayerId,
          type: "raster",
          source: this.rasterSourceId,
          paint: { "raster-opacity": this.opacity },
          minzoom: 0,
          maxzoom: 22,
        },
        beforeId,
      );
    } else {
      map.setPaintProperty(this.rasterLayerId, "raster-opacity", this.opacity);
    }
  }

  private ensureLabelLayersFromUrl(map: maplibregl.Map): void {
    if (this.labelsLoaded && this.labelLayerIds.length > 0) {
      // Ya están cargadas
      return;
    }

    if (!this.labelsStyleUrl || !this.apiKey) {
      return;
    }

    // Cargar estilo desde URL
    const loadStyle = async () => {
      try {
        // Firmar URL si falta ?key=
        let url = this.labelsStyleUrl!;
        if (!url.includes("?key=") && !url.includes("&key=")) {
          const separator = url.includes("?") ? "&" : "?";
          url = `${url}${separator}key=${this.apiKey}`;
        }

        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to load labels style: HTTP ${response.status}`);
        }

        const style = await response.json() as StyleSpecification;
        if (!style.sources || !style.layers) {
          throw new Error("Invalid style format");
        }

        // Obtener primera fuente vectorial
        const sourceKeys = Object.keys(style.sources);
        if (sourceKeys.length === 0) {
          throw new Error("No sources in style");
        }

        const firstSourceKey = sourceKeys[0];
        const firstSource = style.sources[firstSourceKey];
        if (firstSource.type !== "vector") {
          throw new Error("Source is not vector type");
        }

        // Añadir fuente si no existe
        if (!map.getSource(this.labelsSourceId)) {
          const sourceUrl = (firstSource as { url?: string; tiles?: string[] }).url || 
                           (firstSource as { tiles?: string[] }).tiles?.[0];
          if (!sourceUrl) {
            throw new Error("No valid source URL found");
          }
          
          // Firmar URL de fuente si es MapTiler
          let signedSourceUrl = sourceUrl;
          if (sourceUrl.includes("api.maptiler.com") && !sourceUrl.includes("?key=")) {
            const sep = sourceUrl.includes("?") ? "&" : "?";
            signedSourceUrl = `${sourceUrl}${sep}key=${this.apiKey}`;
          }

          map.addSource(this.labelsSourceId, {
            type: "vector",
            url: signedSourceUrl,
            ...((firstSource as { tiles?: string[] }).tiles ? { tiles: (firstSource as { tiles?: string[] }).tiles } : {}),
          });
        }

        // Parsear layer_filter si existe
        let parsedFilter: unknown[] | null = null;
        if (this.layerFilter) {
          try {
            parsedFilter = JSON.parse(this.layerFilter);
          } catch {
            console.warn("[SatelliteHybrid] Invalid layer_filter JSON, ignoring");
          }
        }

        // Filtrar y añadir capas de labels
        const labelLayers = style.layers.filter((layer) => {
          if (layer.type !== "symbol") {
            return false;
          }
          
          // Aplicar layer_filter si existe
          if (parsedFilter && Array.isArray(parsedFilter)) {
            // El filtro debe aplicarse a source-layer
            const sourceLayer = (layer as SymbolLayerSpecification)["source-layer"];
            if (sourceLayer && Array.isArray(parsedFilter) && parsedFilter.length >= 3) {
              // Ejemplo: ["==", ["get", "layer"], "poi_label"]
              const [op, getExpr, value] = parsedFilter;
              if (op === "==" && Array.isArray(getExpr) && getExpr[0] === "get" && getExpr[1] === "layer") {
                if (sourceLayer !== value) {
                  return false;
                }
              }
            }
          }

          const id = (layer.id ?? "").toLowerCase();
          const layout = layer.layout ?? {};
          const hasTextField = typeof (layout as Record<string, unknown>)["text-field"] !== "undefined";
          const looksLikeLabel =
            id.includes("label") || id.includes("name") || id.includes("text") || id.includes("poi");

          return hasTextField || looksLikeLabel;
        });

        const beforeId = this.findOverlayBeforeId(map);
        let index = 0;
        for (const layer of labelLayers) {
          const layerId = `${this.labelLayerPrefix}${index++}`;
          if (map.getLayer(layerId)) {
            continue;
          }

          try {
            const symbolLayer = layer as SymbolLayerSpecification;
            const filterValue: unknown = parsedFilter || symbolLayer.filter;
            // Asegurar que el filtro sea válido para MapLibre
            const validFilter = Array.isArray(filterValue) ? filterValue : undefined;
            
            map.addLayer(
              {
                id: layerId,
                type: "symbol",
                source: this.labelsSourceId,
                "source-layer": symbolLayer["source-layer"],
                layout: symbolLayer.layout ?? {},
                paint: symbolLayer.paint ?? {},
                filter: validFilter,
                minzoom: symbolLayer.minzoom,
                maxzoom: symbolLayer.maxzoom,
              },
              beforeId
            );
            this.labelLayerIds.push(layerId);
          } catch (error) {
            console.warn(`[SatelliteHybrid] No se pudo añadir capa de label ${layerId}`, error);
          }
        }

        this.labelsLoaded = true;
      } catch (error) {
        console.error("[SatelliteHybrid] Error cargando estilo de labels desde URL:", error);
        this.labelsLoaded = false;
      }
    };

    // Esperar a que el estilo del mapa esté cargado
    if (map.isStyleLoaded()) {
      void loadStyle();
    } else {
      map.once("style.load", () => {
        void loadStyle();
      });
    }
  }

  private ensureLabelLayers(map: maplibregl.Map): void {
    // Eliminar referencias a capas que ya no existen (p.ej. tras reload del estilo)
    this.labelLayerIds = this.labelLayerIds.filter((layerId) => map.getLayer(layerId));

    if (this.labelLayerIds.length > 0) {
      // Ya existen (visibilidad queda gestionada por raster)
      return;
    }

    const style = map.getStyle() as StyleSpecification | undefined;
    if (!style?.layers || !Array.isArray(style.layers)) {
      return;
    }

    const beforeId = this.findOverlayBeforeId(map);
    let index = 0;
    for (const layer of style.layers) {
      if (!this.isLabelCandidate(layer)) {
        continue;
      }

      const clone = this.cloneLabelLayer(layer as LayerSpecification, index++);
      if (!clone) {
        continue;
      }

      try {
        map.addLayer(clone, beforeId);
        this.labelLayerIds.push(clone.id);
      } catch (error) {
        console.warn(`[SatelliteHybrid] No se pudo añadir capa de etiqueta (${clone.id})`, error);
      }
    }
  }

  private removeRaster(map: maplibregl.Map): void {
    if (map.getLayer(this.rasterLayerId)) {
      try {
        map.removeLayer(this.rasterLayerId);
      } catch (error) {
        console.warn("[SatelliteHybrid] Fallo al eliminar capa raster", error);
      }
    }
    if (map.getSource(this.rasterSourceId)) {
      try {
        map.removeSource(this.rasterSourceId);
      } catch (error) {
        console.warn("[SatelliteHybrid] Fallo al eliminar source raster", error);
      }
    }
  }

  private removeLabelLayers(map: maplibregl.Map): void {
    for (const layerId of this.labelLayerIds) {
      if (!map.getLayer(layerId)) {
        continue;
      }
      try {
        map.removeLayer(layerId);
      } catch (error) {
        console.warn(`[SatelliteHybrid] Fallo al eliminar capa ${layerId}`, error);
      }
    }
    this.labelLayerIds = [];
  }

  private cloneLabelLayer(layer: LayerSpecification, index: number): LayerSpecification | null {
    if (layer.type !== "symbol" || !("source" in layer)) {
      return null;
    }

    const source = layer.source;
    if (typeof source !== "string" || !source.trim()) {
      return null;
    }

    const newId = `${this.labelLayerPrefix}${index}`;

    const cloned: SymbolLayerSpecification = {
      id: newId,
      type: "symbol",
      source,
      layout: {
        ...(layer.layout ?? {}),
        visibility: "visible",
      },
      paint: layer.paint ? { ...layer.paint } : undefined,
      filter: Array.isArray(layer.filter) ? [...layer.filter] : layer.filter,
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      metadata: layer.metadata ? { ...layer.metadata } : undefined,
      "source-layer": (layer as SymbolLayerSpecification)["source-layer"],
    };

    return cloned;
  }

  private isLabelCandidate(layer: LayerSpecification): layer is SymbolLayerSpecification {
    if (layer.id?.startsWith(this.labelLayerPrefix)) {
      return false;
    }
    if (layer.type !== "symbol") {
      return false;
    }
    const layout = layer.layout ?? {};
    const hasTextField =
      typeof (layout as Record<string, unknown>)["text-field"] !== "undefined";
    const id = (layer.id ?? "").toLowerCase();
    const looksLikeLabel =
      id.includes("label") || id.includes("name") || id.includes("text") || id.includes("poi");

    return hasTextField || looksLikeLabel;
  }

  private findOverlayBeforeId(map: maplibregl.Map): string | undefined {
    for (const layerId of OVERLAY_LAYER_PREFERENCE) {
      if (map.getLayer(layerId)) {
        return layerId;
      }
    }
    return undefined;
  }

  private warnMissingKey(): void {
    if (this.warnedMissingKey) {
      return;
    }
    console.warn("[SatelliteHybrid] disabled (missing MapTiler key)");
    this.warnedMissingKey = true;
  }
}


