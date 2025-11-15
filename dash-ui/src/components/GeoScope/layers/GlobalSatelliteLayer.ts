import maplibregl from "maplibre-gl";

import type { Layer } from "./LayerRegistry";

interface GlobalSatelliteLayerOptions {
  enabled?: boolean;
  opacity?: number;
  currentTimestamp?: number;
  tileUrl?: string; // URL template del frame actual (ej: https://gibs.earthdata.nasa.gov/.../{z}/{y}/{x}.jpg)
  baseUrl?: string; // Deprecated: mantener por compatibilidad pero no usar
}

export default class GlobalSatelliteLayer implements Layer {
  public readonly id = "geoscope-global-satellite";
  public readonly zIndex = 10; // Debajo de AEMET (15), por encima del mapa base (0)

  private enabled: boolean;
  private opacity: number;
  private currentTimestamp?: number;
  private tileUrl?: string; // URL template actual del frame
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-global-satellite-source";

  constructor(options: GlobalSatelliteLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 0.7;
    this.currentTimestamp = options.currentTimestamp;
    this.tileUrl = options.tileUrl;
    // Mantener baseUrl por compatibilidad pero preferir tileUrl
    if (!this.tileUrl && options.baseUrl) {
      // Si no hay tileUrl pero hay baseUrl y timestamp, construir URL legacy
      this.tileUrl = options.currentTimestamp 
        ? `${options.baseUrl}/${options.currentTimestamp}/{z}/{x}/{y}.png`
        : undefined;
    }
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

  update(opts: Partial<GlobalSatelliteLayerOptions>): void {
    if (opts.enabled !== undefined) {
      this.enabled = opts.enabled;
      this.ensureLayer();
      this.applyVisibility();
    }
    if (opts.opacity !== undefined) {
      this.opacity = opts.opacity;
      this.applyOpacity();
    }
    // Actualizar tileUrl si se proporciona
    if (opts.tileUrl !== undefined) {
      this.tileUrl = opts.tileUrl;
      // Si hay tileUrl y está habilitado, recrear la capa
      if (this.enabled && this.tileUrl) {
        this.updateTileUrl();
      }
    }
    // Mantener compatibilidad con currentTimestamp (legacy)
    if (opts.currentTimestamp !== undefined && opts.currentTimestamp !== this.currentTimestamp) {
      this.currentTimestamp = opts.currentTimestamp;
      // Si no hay tileUrl pero hay timestamp y baseUrl, usar lógica legacy
      if (!this.tileUrl && this.currentTimestamp) {
        this.updateTimestamp(this.currentTimestamp);
      }
    }
  }

  private updateTimestamp(timestamp: number): void {
    if (!this.map) return;
    
    this.currentTimestamp = timestamp;
    if (!this.enabled) {
      return;
    }
    
    // Actualizar la fuente con nuevo timestamp (legacy: solo si no hay tileUrl)
    if (this.tileUrl) {
      // Si hay tileUrl, usar updateTileUrl en su lugar
      this.updateTileUrl();
      return;
    }
    
    const source = this.map.getSource(this.sourceId);
    if (!source) {
      this.ensureLayer();
      this.applyVisibility();
      this.applyOpacity();
      return;
    }

    if (source.type === "raster") {
      // Eliminar y recrear la fuente con el nuevo timestamp (legacy)
      if (this.map.getLayer(this.id)) {
        this.map.removeLayer(this.id);
      }
      this.map.removeSource(this.sourceId);
      
      // Recrear con nuevo timestamp (legacy)
      const legacyBaseUrl = "/api/global/satellite/tiles";
      this.map.addSource(this.sourceId, {
        type: "raster",
        tiles: [
          `${legacyBaseUrl}/${timestamp}/{z}/{x}/{y}.png`
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

  private updateTileUrl(): void {
    if (!this.map || !this.enabled || !this.tileUrl) {
      return;
    }
    
    // Eliminar capa y fuente existentes si existen
    if (this.map.getLayer(this.id)) {
      this.map.removeLayer(this.id);
    }
    const source = this.map.getSource(this.sourceId);
    if (source) {
      this.map.removeSource(this.sourceId);
    }
    
    // Crear nueva fuente con tileUrl del frame
    this.map.addSource(this.sourceId, {
      type: "raster",
      tiles: [this.tileUrl],
      tileSize: 256,
      scheme: "xyz"
    });
    
    // Añadir capa
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
    
    // Aplicar visibilidad y opacidad después de añadir la capa
    this.applyVisibility();
    this.applyOpacity();
  }

  private ensureLayer(): void {
    if (!this.map || !this.enabled) {
      return;
    }

    // Preferir tileUrl si está disponible
    if (this.tileUrl) {
      if (!this.map.getSource(this.sourceId)) {
        this.map.addSource(this.sourceId, {
          type: "raster",
          tiles: [this.tileUrl],
          tileSize: 256,
          scheme: "xyz"
        });
      }

      if (!this.map.getLayer(this.id)) {
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
      return;
    }

    // Fallback legacy: usar baseUrl + timestamp si está disponible
    if (this.currentTimestamp) {
      const legacyBaseUrl = "/api/global/satellite/tiles";
      if (!this.map.getSource(this.sourceId)) {
        this.map.addSource(this.sourceId, {
          type: "raster",
          tiles: [`${legacyBaseUrl}/${this.currentTimestamp}/{z}/{x}/{y}.png`],
          tileSize: 256,
          scheme: "xyz"
        });
      }

      if (!this.map.getLayer(this.id)) {
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
  }

  private applyVisibility(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;
    
    // La capa es visible si está habilitada y tiene tileUrl o timestamp
    if (this.enabled && (this.tileUrl || this.currentTimestamp)) {
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

