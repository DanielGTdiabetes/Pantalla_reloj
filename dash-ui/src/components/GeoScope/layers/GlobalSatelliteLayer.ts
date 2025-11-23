import { Map as MaptilerMap } from "@maptiler/sdk";
import type { MapLibreEvent as MaptilerMapLibreEvent } from "@maptiler/sdk";

import type { Layer } from "./LayerRegistry";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";

interface GlobalSatelliteLayerOptions {
  enabled?: boolean;
  opacity?: number;
  currentTimestamp?: number;
  tileUrl?: string; // URL template del frame actual (ej: https://gibs.earthdata.nasa.gov/.../{z}/{y}/{x}.jpg)
  baseUrl?: string; // Deprecated: mantener por compatibilidad pero no usar
  minZoom?: number; // min_zoom del frame (default: 1)
  maxZoom?: number; // max_zoom del frame (default: 9 para GoogleMapsCompatible_Level9)
}

export default class GlobalSatelliteLayer implements Layer {
  public readonly id = "geoscope-global-satellite";
  public readonly zIndex = 10; // Debajo de AEMET (15), por encima del mapa base (0)

  private enabled: boolean;
  private opacity: number;
  private currentTimestamp?: number;
  private tileUrl?: string; // URL template actual del frame
  private minZoom: number; // minzoom para la source (default: 1)
  private maxZoom: number; // maxzoom para la source (default: 9)
  private map?: MaptilerMap;
  private readonly sourceId = "geoscope-global-satellite-source";
  private errorCount: number = 0; // Contador de errores 400 consecutivos
  private readonly MAX_ERRORS = 10; // Máximo de errores antes de deshabilitar temporalmente

  constructor(options: GlobalSatelliteLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 0.7;
    this.currentTimestamp = options.currentTimestamp;
    this.tileUrl = options.tileUrl;
    // minzoom: usar frame.min_zoom si existe, si no 1 por defecto
    this.minZoom = options.minZoom ?? 1;
    // maxzoom: usar frame.max_zoom si existe, si no 9 por defecto (GoogleMapsCompatible_Level9)
    // Asegurar que nunca exceda 9 para este tile_matrix_set
    this.maxZoom = options.maxZoom !== undefined ? Math.min(options.maxZoom, 9) : 9;
    // Mantener baseUrl por compatibilidad pero preferir tileUrl
    if (!this.tileUrl && options.baseUrl) {
      // Si no hay tileUrl pero hay baseUrl y timestamp, construir URL legacy
      this.tileUrl = options.currentTimestamp 
        ? `${options.baseUrl}/${options.currentTimestamp}/{z}/{x}/{y}.png`
        : undefined;
    }
  }

  add(map: MaptilerMap): void {
    this.map = map;
    this.setupErrorHandlers();
    this.ensureLayer();
    this.applyVisibility();
    this.applyOpacity();
  }

  private errorHandler: ((e: MaptilerMapLibreEvent & { error?: unknown }) => void) | null = null;

  private setupErrorHandlers(): void {
    if (!this.map) return;

    // Limpiar handler anterior si existe
    if (this.errorHandler) {
      this.map.off("error", this.errorHandler);
      this.errorHandler = null;
    }

    // Crear nuevo handler que solo capture errores específicos de GIBS
    this.errorHandler = (e: MaptilerMapLibreEvent & { error?: unknown }) => {
      const error = e.error as { status?: number; message?: string; url?: string; source?: { id?: string } } | undefined;
      
      // Verificar que el error sea específicamente de la source de GIBS
      const isGIBSource = error?.source?.id === this.sourceId || 
                          (error?.url && error.url.includes("gibs.earthdata.nasa.gov"));
      
      if (error?.status === 400 && isGIBSource) {
        // Extraer z, x, y de la URL si es posible
        const urlMatch = error.url?.match(/\/Level\d+\/(\d+)\/(\d+)\/(\d+)/);
        const z = urlMatch ? urlMatch[1] : "?";
        const x = urlMatch ? urlMatch[2] : "?";
        const y = urlMatch ? urlMatch[3] : "?";
        
        console.warn(
          `[GlobalSatelliteLayer] GIBS tile error (HTTP 400) en z=${z} x=${x} y=${y}`
        );
        
        this.errorCount++;
        
        // Si hay demasiados errores, deshabilitar solo la capa GIBS sin tocar el mapa base
        if (this.errorCount >= this.MAX_ERRORS) {
          console.warn(
            `[GlobalSatelliteLayer] too many GIBS errors (${this.errorCount}), disabling satellite overlay (base map intact)`
          );
          // Deshabilitar solo la capa GIBS, sin tocar el estilo base
          this.enabled = false;
          this.applyVisibility();
          // Resetear contador después de un tiempo
          setTimeout(() => {
            this.errorCount = 0;
          }, 60000); // 1 minuto
        }
      }
      // NO hacer nada más - no cambiar el estilo base, no lanzar excepciones
    };

    // Registrar el handler
    this.map.on("error", this.errorHandler);
  }

  remove(map: MaptilerMap): void {
    // Limpiar error handler primero
    if (this.map && this.errorHandler) {
      this.map.off("error", this.errorHandler);
      this.errorHandler = null;
    }

    // Quitar capa y source
    if (map.getLayer(this.id)) {
      map.removeLayer(this.id);
    }
    if (map.getSource(this.sourceId)) {
      map.removeSource(this.sourceId);
    }
    
    // Limpiar estado interno
    this.errorCount = 0;
    this.tileUrl = undefined;
    this.currentTimestamp = undefined;
    this.map = undefined;
  }

  update(opts: Partial<GlobalSatelliteLayerOptions>): void {
    if (opts.enabled !== undefined) {
      const wasEnabled = this.enabled;
      this.enabled = opts.enabled;
      
      if (!this.enabled && wasEnabled) {
        // Deshabilitar: quitar capa y source, limpiar estado
        if (this.map) {
          this.remove(this.map);
        }
      } else if (this.enabled && !wasEnabled) {
        // Habilitar: recrear capa si hay tileUrl válido
        this.ensureLayer();
        this.applyVisibility();
      } else {
        this.ensureLayer();
        this.applyVisibility();
      }
    }
    if (opts.opacity !== undefined) {
      this.opacity = opts.opacity;
      this.applyOpacity();
    }
    
    // Actualizar minZoom/maxZoom si se proporcionan
    if (opts.minZoom !== undefined) {
      this.minZoom = opts.minZoom;
    }
    if (opts.maxZoom !== undefined) {
      // Asegurar que maxzoom nunca exceda 9 para GoogleMapsCompatible_Level9
      this.maxZoom = Math.min(opts.maxZoom, 9);
    }
    
    // Actualizar tileUrl si se proporciona
    if (opts.tileUrl !== undefined) {
      this.tileUrl = opts.tileUrl;
      // Resetear contador de errores cuando se actualiza el tileUrl
      this.errorCount = 0;
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
      try {
        this.map.addSource(this.sourceId, {
          type: "raster",
          tiles: [
            `${legacyBaseUrl}/${timestamp}/{z}/{x}/{y}.png`
          ],
          tileSize: 256,
          scheme: "xyz",
          minzoom: this.minZoom,
          maxzoom: this.maxZoom
        });
        
        this.map.addLayer({
          id: this.id,
          type: "raster",
          source: this.sourceId,
          paint: {
            "raster-opacity": this.opacity
          },
          minzoom: this.minZoom,
          maxzoom: this.maxZoom
        });
      } catch (error) {
        console.error("[GlobalSatelliteLayer] Error al actualizar timestamp:", error);
      }
    }
  }

  private updateTileUrl(): void {
    if (!this.map || !this.enabled || !this.tileUrl) {
      return;
    }
    
    // Verificar que el estilo esté listo antes de manipular sources/layers
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[GlobalSatelliteLayer] style not ready, skipping updateTileUrl");
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
    
    // Crear nueva fuente con tileUrl del frame y minzoom/maxzoom
    try {
      this.map.addSource(this.sourceId, {
        type: "raster",
        tiles: [this.tileUrl],
        tileSize: 256,
        scheme: "xyz",
        minzoom: this.minZoom,
        maxzoom: this.maxZoom
      });
      
      // Añadir capa con minzoom/maxzoom
      this.map.addLayer({
        id: this.id,
        type: "raster",
        source: this.sourceId,
        paint: {
          "raster-opacity": this.opacity
        },
        minzoom: this.minZoom,
        maxzoom: this.maxZoom
      });
      
      // Aplicar visibilidad y opacidad después de añadir la capa
      this.applyVisibility();
      this.applyOpacity();
      
      console.info("[GlobalSatelliteLayer] update frame", {
        minzoom: this.minZoom,
        maxzoom: this.maxZoom,
        tileUrl: this.tileUrl.substring(0, 80) + "..."
      });
    } catch (error) {
      console.error("[GlobalSatelliteLayer] Error al actualizar tileUrl:", error);
      // No lanzar la excepción para evitar romper el mapa
    }
  }

  private ensureLayer(): void {
    if (!this.map || !this.enabled) {
      return;
    }

    // Verificar que el estilo esté listo antes de manipular sources/layers
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[GlobalSatelliteLayer] style not ready, skipping ensureLayer");
      return;
    }

    // Preferir tileUrl si está disponible
    if (this.tileUrl) {
      if (!this.map.getSource(this.sourceId)) {
        try {
          this.map.addSource(this.sourceId, {
            type: "raster",
            tiles: [this.tileUrl],
            tileSize: 256,
            scheme: "xyz",
            minzoom: this.minZoom,
            maxzoom: this.maxZoom
          });
        } catch (error) {
          console.error("[GlobalSatelliteLayer] Error al crear source:", error);
          return;
        }
      }

      if (!this.map.getLayer(this.id)) {
        try {
          this.map.addLayer({
            id: this.id,
            type: "raster",
            source: this.sourceId,
            paint: {
              "raster-opacity": this.opacity
            },
            minzoom: this.minZoom,
            maxzoom: this.maxZoom
          });
        } catch (error) {
          console.error("[GlobalSatelliteLayer] Error al crear layer:", error);
          return;
        }
      }
      return;
    }

    // Fallback legacy: usar baseUrl + timestamp si está disponible
    if (this.currentTimestamp) {
      const legacyBaseUrl = "/api/global/satellite/tiles";
      if (!this.map.getSource(this.sourceId)) {
        try {
          this.map.addSource(this.sourceId, {
            type: "raster",
            tiles: [`${legacyBaseUrl}/${this.currentTimestamp}/{z}/{x}/{y}.png`],
            tileSize: 256,
            scheme: "xyz",
            minzoom: this.minZoom,
            maxzoom: this.maxZoom
          });
        } catch (error) {
          console.error("[GlobalSatelliteLayer] Error al crear source legacy:", error);
          return;
        }
      }

      if (!this.map.getLayer(this.id)) {
        try {
          this.map.addLayer({
            id: this.id,
            type: "raster",
            source: this.sourceId,
            paint: {
              "raster-opacity": this.opacity
            },
            minzoom: this.minZoom,
            maxzoom: this.maxZoom
          });
        } catch (error) {
          console.error("[GlobalSatelliteLayer] Error al crear layer legacy:", error);
          return;
        }
      }
    }
  }

  private applyVisibility(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[GlobalSatelliteLayer] Style not ready, skipping");
      return;
    }
    
    try {
      // La capa es visible si está habilitada y tiene tileUrl o timestamp
      if (this.enabled && (this.tileUrl || this.currentTimestamp)) {
        this.map.setLayoutProperty(this.id, "visibility", "visible");
      } else {
        this.map.setLayoutProperty(this.id, "visibility", "none");
      }
    } catch (e) {
      console.warn("[GlobalSatelliteLayer] layout skipped:", e);
    }
  }

  private applyOpacity(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[GlobalSatelliteLayer] Style not ready, skipping");
      return;
    }
    
    try {
      this.map.setPaintProperty(this.id, "raster-opacity", this.opacity);
    } catch (e) {
      console.warn("[GlobalSatelliteLayer] paint skipped:", e);
    }
  }
}

