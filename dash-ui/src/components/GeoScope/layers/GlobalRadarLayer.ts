import maplibregl from "maplibre-gl";

import type { Layer } from "./LayerRegistry";

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
    this.baseUrl = options.baseUrl ?? "/api/global/radar/tiles";
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    
    if (!this.enabled || !this.currentTimestamp) {
      return;
    }

    // Crear fuente de tipo raster con tiles
    if (!map.getSource(this.sourceId)) {
      map.addSource(this.sourceId, {
        type: "raster",
        tiles: [
          `${this.baseUrl}/${this.currentTimestamp}/{z}/{x}/{y}.png`
        ],
        tileSize: 256,
        scheme: "xyz"
      });
    }

    if (!map.getLayer(this.id)) {
      map.addLayer({
        id: this.id,
        type: "raster",
        source: this.sourceId,
        paint: {
          "raster-opacity": this.opacity
        },
        minzoom: 0,
        maxzoom: 18
      });
    }

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
    
    // Actualizar la fuente con nuevo timestamp
    const source = this.map.getSource(this.sourceId);
    if (source && source.type === "raster") {
      // Eliminar y recrear la fuente con el nuevo timestamp
      if (this.map.getLayer(this.id)) {
        this.map.removeLayer(this.id);
      }
      this.map.removeSource(this.sourceId);
      
      // Recrear con nuevo timestamp
      this.map.addSource(this.sourceId, {
        type: "raster",
        tiles: [
          `${this.baseUrl}/${timestamp}/{z}/{x}/{y}.png`
        ],
        tileSize: 256,
        scheme: "xyz"
      });
      
      this.map.addLayer({
        id: this.id,
        type: "raster",
        source: this.sourceId,
        paint: {
          "raster-opacity": this.opacity
        },
        minzoom: 0,
        maxzoom: 18
      });
    }
  }

  private applyVisibility(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;
    
    if (this.enabled && this.currentTimestamp) {
      this.map.setLayoutProperty(this.id, "visibility", "visible");
    } else {
      this.map.setLayoutProperty(this.id, "visibility", "none");
    }
  }

  private applyOpacity(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;
    
    this.map.setPaintProperty(this.id, "raster-opacity", this.opacity);
  }
}

