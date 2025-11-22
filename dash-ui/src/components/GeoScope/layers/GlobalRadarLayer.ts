import maplibregl from "maplibre-gl";

import type { Layer } from "./LayerRegistry";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { withSafeMapStyle } from "../../../lib/map/utils/safeMapOperations";

interface GlobalRadarLayerOptions {
  enabled?: boolean;
  opacity?: number;
  currentTimestamp?: number;
  baseUrl?: string;
}

export default class GlobalRadarLayer implements Layer {
  public readonly id = "geoscope-global-radar";
  public readonly zIndex = 10; // Debajo de AEMET (15), por encima del mapa base (0)

  private enabled: boolean;
  private opacity: number;
  private currentTimestamp?: number;
  private baseUrl: string;
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-global-radar-source";

  constructor(options: GlobalRadarLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 0.7;
    this.currentTimestamp = options.currentTimestamp;
    this.baseUrl = options.baseUrl ?? "/api/rainviewer/tiles";
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    this.ensureLayer();
    this.applyVisibility();
    this.applyOpacity();
  }

  remove(map: maplibregl.Map): void {
    if (map.getLayer(this.id)) {
      map.removeLayer(this.id);
    }
    if (map.getSource(this.sourceId)) {
      map.removeSource(this.sourceId);
    }
  }

  update(opts: Partial<GlobalRadarLayerOptions>): void {
    if (opts.enabled !== undefined) {
      this.enabled = opts.enabled;
      this.ensureLayer();
      this.applyVisibility();
    }
    if (opts.opacity !== undefined) {
      this.opacity = opts.opacity;
      this.applyOpacity();
    }
    if (opts.currentTimestamp !== undefined && opts.currentTimestamp !== this.currentTimestamp) {
      this.updateTimestamp(opts.currentTimestamp);
    }
  }

  private updateTimestamp(timestamp: number): void {
    if (!this.map) return;
    
    this.currentTimestamp = timestamp;
    if (!this.enabled) {
      return;
    }
    
    // Verificar que el mapa esté completamente cargado
    if (!this.map.isStyleLoaded()) {
      // Si el estilo no está cargado, esperar a que se cargue
      this.map.once('styledata', () => {
        this.updateTimestamp(timestamp);
      });
      return;
    }
    
    // Actualizar la fuente con nuevo timestamp
    const source = this.map.getSource(this.sourceId);
    if (!source) {
      // Si no existe la fuente, crearla
      this.ensureLayer();
      this.applyVisibility();
      this.applyOpacity();
      return;
    }

    if (source.type === "raster") {
      // Eliminar y recrear la fuente con el nuevo timestamp de forma segura
      const updated = withSafeMapStyle(
        this.map,
        () => {
          if (this.map!.getLayer(this.id)) {
            this.map!.removeLayer(this.id);
          }
          this.map!.removeSource(this.sourceId);
          
          // Recrear con nuevo timestamp
          this.map!.addSource(this.sourceId, {
            type: "raster",
            tiles: [
              `${this.baseUrl}/${timestamp}/{z}/{x}/{y}.png`
            ],
            tileSize: 256
          });
          
          const beforeId = this.findBeforeId();
          this.map!.addLayer({
            id: this.id,
            type: "raster",
            source: this.sourceId,
            paint: {
              "raster-opacity": this.opacity
            },
            minzoom: 0,
            maxzoom: 18
          }, beforeId);
        },
        "GlobalRadarLayer"
      );

      if (!updated) {
        console.warn("[GlobalRadarLayer] Could not update timestamp, will retry on styledata");
        // Reintentar cuando el mapa esté listo
        if (this.map) {
          this.map.once('styledata', () => {
            this.updateTimestamp(timestamp);
          });
        }
      }
    }
  }

  /**
   * Encuentra el ID de la primera capa de aviones o barcos para usar como beforeId.
   * Esto asegura que el radar se añada por debajo de aviones/barcos pero por encima del mapa base.
   */
  private findBeforeId(): string | undefined {
    if (!this.map) {
      return undefined;
    }

    // Usar getSafeMapStyle para evitar crashes si style es null
    const style = getSafeMapStyle(this.map);
    if (!style || !style.layers) {
      return undefined;
    }

    // Verificar que layers es un array antes de iterar
    const layers = style.layers;
    if (!Array.isArray(layers)) {
      return undefined;
    }

    for (const layer of layers) {
      // Buscar capas de aviones (geoscope-aircraft) o barcos (geoscope-ships)
      if (layer.id === "geoscope-aircraft" || layer.id === "geoscope-ships") {
        return layer.id;
      }
    }

    return undefined;
  }

  private ensureLayer(): void {
    if (!this.map || !this.enabled || !this.currentTimestamp) {
      console.debug("[GlobalRadarLayer] ensureLayer skipped", {
        hasMap: !!this.map,
        enabled: this.enabled,
        hasTimestamp: !!this.currentTimestamp
      });
      return;
    }
    
    // Verificar que el mapa esté completamente cargado
    if (!this.map.isStyleLoaded()) {
      console.debug("[GlobalRadarLayer] Map style not loaded, waiting for styledata");
      // Esperar a que el estilo se cargue antes de añadir la capa
      this.map.once('styledata', () => {
        this.ensureLayer();
      });
      return;
    }

    // Verificar que el estilo esté completamente cargado antes de acceder a sources/layers
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[GlobalRadarLayer] Style not ready, waiting for styledata");
      this.map.once('styledata', () => {
        this.ensureLayer();
      });
      return;
    }

    // Añadir source de forma segura
    if (!this.map.getSource(this.sourceId)) {
      const tileUrlTemplate = `${this.baseUrl}/${this.currentTimestamp}/{z}/{x}/{y}.png`;
      console.log("[GlobalRadarLayer] Adding RainViewer raster source", {
        sourceId: this.sourceId,
        tileUrlTemplate,
        timestamp: this.currentTimestamp
      });
      
      const sourceAdded = withSafeMapStyle(
        this.map,
        () => {
          this.map!.addSource(this.sourceId, {
            type: "raster",
            tiles: [tileUrlTemplate],
            tileSize: 256
          });
        },
        "GlobalRadarLayer"
      );

      if (!sourceAdded) {
        console.error("[GlobalRadarLayer] Could not add source, style not ready");
        return;
      }
      console.log("[GlobalRadarLayer] Source added successfully");
    }

    // Añadir layer de forma segura
    if (!this.map.getLayer(this.id)) {
      const beforeId = this.findBeforeId();
      console.log("[GlobalRadarLayer] Adding RainViewer raster layer", {
        layerId: this.id,
        sourceId: this.sourceId,
        opacity: this.opacity,
        beforeId
      });
      
      const layerAdded = withSafeMapStyle(
        this.map,
        () => {
          this.map!.addLayer({
            id: this.id,
            type: "raster",
            source: this.sourceId,
            paint: {
              "raster-opacity": this.opacity
            },
            minzoom: 0,
            maxzoom: 18
          }, beforeId);
        },
        "GlobalRadarLayer"
      );

      if (!layerAdded) {
        console.error("[GlobalRadarLayer] Could not add layer, style not ready");
        return;
      }
      console.log("[GlobalRadarLayer] Layer added successfully");
    }
  }

  private applyVisibility(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[GlobalRadarLayer] Style not ready, skipping");
      return;
    }
    
    try {
      if (this.enabled && this.currentTimestamp) {
        this.map.setLayoutProperty(this.id, "visibility", "visible");
      } else {
        this.map.setLayoutProperty(this.id, "visibility", "none");
      }
    } catch (e) {
      console.warn("[GlobalRadarLayer] layout skipped:", e);
    }
  }

  private applyOpacity(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[GlobalRadarLayer] Style not ready, skipping");
      return;
    }
    
    try {
      this.map.setPaintProperty(this.id, "raster-opacity", this.opacity);
    } catch (e) {
      console.warn("[GlobalRadarLayer] paint skipped:", e);
    }
  }
}

