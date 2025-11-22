import maplibregl from "maplibre-gl";
import { config as maptilerSdkConfig } from "@maptiler/sdk";

import type { Layer } from "./LayerRegistry";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { waitForMapReady } from "../../../lib/map/utils/waitForMapReady";
import { getRainViewerFrames } from "../../../lib/api";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";

interface GlobalRadarLayerOptions {
  enabled?: boolean;
  opacity?: number;
  currentTimestamp?: number;
  baseUrl?: string;
  provider?: "rainviewer" | "maptiler_weather" | string;
}

interface FramesInfo {
  frames: number[];
  activeTimestamp: number;
  hasFrames: boolean;
}

/**
 * Cache global para frames de RainViewer (evita llamadas duplicadas)
 */
let framesCache: {
  frames: number[];
  timestamp: number;
  expiresAt: number;
} | null = null;

const CACHE_TTL_MS = 60000; // 1 minuto de cache

/**
 * Flags estáticos para evitar spam de logs
 */
let warnedStyleNotReady = false;
let warnedNoFrames = false;
let warnedSourceError = false;
let warnedLayerError = false;

/**
 * Capa de radar global que muestra datos de RainViewer sobre el mapa base.
 * 
 * ⚠️ LEGACY: Esta capa está marcada como legacy y solo se usa cuando el provider es "rainviewer".
 * El proyecto ahora usa MapTiler Weather (@maptiler/weather) como fuente principal de radar
 * mediante WeatherRadarLayer.tsx, que usa RadarLayer de @maptiler/weather.
 * 
 * Esta capa solo se inicializa cuando config.layers.global.radar.provider === "rainviewer".
 * Para usar MapTiler Weather, configurar provider === "maptiler_weather" (default).
 * 
 * Características:
 * - Fetch centralizado de frames con cache en memoria
 * - Inicialización robusta con waitForMapReady
 * - Source y layer idempotentes y seguros
 * - Reacciona bien a cambios de config y estilo base
 */
export default class GlobalRadarLayer implements Layer {
  public readonly id = "geoscope-global-radar";
  public readonly zIndex = 10; // Debajo de AEMET (15), por encima del mapa base (0)

  private enabled: boolean;
  private opacity: number;
  private currentTimestamp?: number;
  private baseUrl: string;
  private provider: "rainviewer" | "maptiler_weather" | string;
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-global-radar-source";
  private registeredInRegistry: boolean = false;
  private static warnedDisabled = false;

  constructor(options: GlobalRadarLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 0.7;
    this.currentTimestamp = options.currentTimestamp;
    this.baseUrl = options.baseUrl ?? "/api/rainviewer/tiles";
    this.provider = options.provider ?? "rainviewer";
  }

  /**
   * Añade la capa al mapa siguiendo una secuencia limpia:
   * 1. Verifica que enabled=true (si no, aborta sin hacer nada)
   * 2. Espera a que el mapa esté listo (waitForMapReady)
   * 3. Verifica que el estilo esté cargado
   * 4. Obtiene frames disponibles
   * 5. Crea source y layer si hay frames
   */
  async add(map: maplibregl.Map): Promise<void> {
    this.map = map;

    console.log(`[GlobalRadarLayer] Using provider: ${this.provider}`);

    // Rama MapTiler Weather: no depende de RainViewer
    if (this.provider === "maptiler_weather") {
      console.log("[GlobalRadarLayer] Initializing MapTiler Weather radar layer");

      const layerId: LayerId = "radar";
      try {
        await waitForMapReady(map);

        layerDiagnostics.setEnabled(layerId, true);
        layerDiagnostics.recordInitializationAttempt(layerId);
        layerDiagnostics.setState(layerId, "initializing", { provider: this.provider });

        const style = getSafeMapStyle(map);
        if (!style) {
          layerDiagnostics.recordError(layerId, new Error("Map style not ready"), {
            provider: this.provider,
          });
          return;
        }

        const maptilerKey = this.extractMaptilerKey(style) ?? maptilerSdkConfig.apiKey ?? null;
        if (!maptilerKey) {
          layerDiagnostics.recordError(layerId, new Error("MapTiler API key unavailable"), {
            provider: this.provider,
          });
          return;
        }

        // Limpiar instancias previas
        if (map.getLayer(this.id)) {
          map.removeLayer(this.id);
        }
        if (map.getSource(this.sourceId)) {
          map.removeSource(this.sourceId);
        }

        const tilesUrl = `https://api.maptiler.com/weather/tiles/v2/precipitation/{z}/{x}/{y}.png?key=${maptilerKey}`;

        map.addSource(this.sourceId, {
          type: "raster",
          tiles: [tilesUrl],
          tileSize: 256,
          maxzoom: 12,
        });

        const beforeId = this.findBeforeId();
        map.addLayer({
          id: this.id,
          type: "raster",
          source: this.sourceId,
          paint: {
            "raster-opacity": this.opacity ?? 0.7,
          },
        }, beforeId);

        layerDiagnostics.setState(layerId, "ready", { provider: this.provider });
        layerDiagnostics.recordDataUpdate(layerId);
        console.log("[GlobalRadarLayer] MapTiler Weather radar initialized successfully");
      } catch (error) {
        layerDiagnostics.recordError(layerId, error as Error, { provider: this.provider });
        console.warn("[GlobalRadarLayer] Failed to initialize MapTiler Weather radar layer", error);
      }

      return;
    }

    // Si está deshabilitado, no hacer nada
    if (!this.enabled) {
      if (!GlobalRadarLayer.warnedDisabled) {
        console.log("[GlobalRadarLayer] Radar disabled or unsupported provider, skipping initialization");
        GlobalRadarLayer.warnedDisabled = true;
      }
      return;
    }

    try {
      // Paso 1: Esperar a que el mapa esté completamente listo
      await waitForMapReady(map);

      // Paso 2: Verificar que el estilo esté listo
      const style = getSafeMapStyle(map);
      if (!style) {
        if (!warnedStyleNotReady) {
          console.warn("[GlobalRadarLayer] style not ready after waitForMapReady, aborting init");
          warnedStyleNotReady = true;
        }
        return;
      }

      // Paso 3: Obtener frames disponibles (con cache)
      const framesInfo = await this.fetchFramesOnce();
      if (!framesInfo || !framesInfo.hasFrames) {
        if (!warnedNoFrames) {
          console.warn("[GlobalRadarLayer] no frames available, skipping layer creation");
          warnedNoFrames = true;
        }
        return;
      }

      // Paso 4: Crear source y layer
      await this.ensureSource(framesInfo);
      await this.ensureLayer(framesInfo);
      
      this.registeredInRegistry = true;
      
      // Reset flags de warning después de éxito
      warnedStyleNotReady = false;
      warnedNoFrames = false;
    } catch (error) {
      console.warn("[GlobalRadarLayer] error during add():", error);
    }
  }

  remove(map: maplibregl.Map): void {
    try {
      if (map.getLayer(this.id)) {
        map.removeLayer(this.id);
      }
      if (map.getSource(this.sourceId)) {
        map.removeSource(this.sourceId);
      }
      this.registeredInRegistry = false;
    } catch (error) {
      console.warn("[GlobalRadarLayer] error during remove():", error);
    }
  }

  /**
   * Actualiza la configuración de la capa.
   * 
   * Comportamiento:
   * - Si enabled pasa a false: oculta la capa (visibility: none)
   * - Si enabled pasa a true: muestra la capa (visibility: visible)
   * - Si la capa no existe y enabled=true: reinicializa (add())
   */
  update(opts: Partial<GlobalRadarLayerOptions>): void {
    const wasEnabled = this.enabled;

    if (opts.enabled !== undefined) {
      this.enabled = opts.enabled;
    }
    if (opts.opacity !== undefined) {
      this.opacity = opts.opacity;
    }
    if (opts.currentTimestamp !== undefined && opts.currentTimestamp !== this.currentTimestamp) {
      this.currentTimestamp = opts.currentTimestamp;
    }

    // Si se desactivó, simplemente ocultar (no borrar)
    if (wasEnabled && !this.enabled) {
      this.applyVisibility();
      return;
    }

    // Si se activó después de estar desactivado, mostrar
    if (!wasEnabled && this.enabled) {
      this.applyVisibility();
      
      // Si la capa no existe, reinicializar
      if (this.map && !this.map.getLayer(this.id)) {
        // Reinicializar de forma asíncrona
        void this.reinitialize();
      }
      return;
    }

    // Actualizar opacidad si cambió
    if (opts.opacity !== undefined) {
      this.applyOpacity();
    }

    // Actualizar timestamp si cambió
    if (opts.currentTimestamp !== undefined && opts.currentTimestamp !== this.currentTimestamp) {
      void this.updateTimestamp(opts.currentTimestamp);
    }
  }

  /**
   * Establece el estado enabled de la capa
   */
  setEnabled(enabled: boolean): void {
    this.update({ enabled });
  }

  /**
   * Establece la opacidad de la capa
   */
  setOpacity(opacity: number): void {
    this.update({ opacity });
  }

  /**
   * Fetch centralizado de frames con cache en memoria.
   * Evita llamadas duplicadas si hay varios intentos de inicialización.
   */
  private async fetchFramesOnce(): Promise<FramesInfo | null> {
    try {
      // Verificar cache
      if (framesCache && Date.now() < framesCache.expiresAt) {
        const activeTimestamp = framesCache.frames[framesCache.frames.length - 1] || 0;
        return {
          frames: framesCache.frames,
          activeTimestamp,
          hasFrames: framesCache.frames.length > 0
        };
      }

      // Verificar health endpoint primero
      const healthResponse = await fetch("/api/health/full", { cache: "no-store" });
      const healthData = await healthResponse.json().catch(() => null);
      const globalRadar = healthData?.global_radar;
      const hasFrames = globalRadar?.status === "ok" && (globalRadar?.frames_count ?? 0) > 0;

      if (!hasFrames) {
        return null;
      }

      // Obtener frames (usar valores por defecto si no se especifican)
      const frames = await getRainViewerFrames(90, 5);

      if (!frames || frames.length === 0) {
        return null;
      }

      // Actualizar cache
      framesCache = {
        frames,
        timestamp: Date.now(),
        expiresAt: Date.now() + CACHE_TTL_MS
      };

      // Usar el último frame (más reciente)
      const activeTimestamp = frames[frames.length - 1];

      return {
        frames,
        activeTimestamp,
        hasFrames: true
      };
    } catch (error) {
      console.warn("[GlobalRadarLayer] error fetching frames:", error);
      return null;
    }
  }

  /**
   * Reinicializa la capa cuando se detecta que no existe
   * (útil después de cambios de estilo base)
   */
  private async reinitialize(): Promise<void> {
    if (!this.map) return;

    try {
      await waitForMapReady(this.map);
      
      const style = getSafeMapStyle(this.map);
      if (!style) {
        console.warn("[GlobalRadarLayer] style not ready during reinitialize, will retry on styledata");
        this.map.once('styledata', () => {
          void this.reinitialize();
        });
        return;
      }

      const framesInfo = await this.fetchFramesOnce();
      if (!framesInfo || !framesInfo.hasFrames) {
        return;
      }

      await this.ensureSource(framesInfo);
      await this.ensureLayer(framesInfo);
    } catch (error) {
      console.warn("[GlobalRadarLayer] error during reinitialize():", error);
    }
  }

  /**
   * Asegura que el source existe. Idempotente y seguro.
   * 
   * - No ejecuta si !this.map o !getSafeMapStyle(this.map)
   * - Si ya existe, solo actualiza tiles/url si cambió el timestamp activo
   */
  private async ensureSource(framesInfo: FramesInfo): Promise<void> {
    if (!this.map) return;

    const style = getSafeMapStyle(this.map);
    if (!style) {
      if (!warnedStyleNotReady) {
        console.warn("[GlobalRadarLayer] ensureSource: style not ready, skipping");
        warnedStyleNotReady = true;
      }
      return;
    }

    try {
      const existing = this.map.getSource(this.sourceId);
      const tileUrlTemplate = `${this.baseUrl}/${framesInfo.activeTimestamp}/{z}/{x}/{y}.png`;

      if (existing && existing.type === "raster") {
        // Si ya existe, verificar si necesita actualización
        // En raster sources, no podemos actualizar tiles directamente
        // Si el timestamp cambió, necesitamos recrear (pero esto se maneja en updateTimestamp)
        return;
      }

      // Crear source si no existe
      this.map.addSource(this.sourceId, {
        type: "raster",
        tiles: [tileUrlTemplate],
        tileSize: 256,
      });

      // Guardar timestamp actual para futuras comparaciones
      this.currentTimestamp = framesInfo.activeTimestamp;

      // Reset warning flag después de éxito
      warnedStyleNotReady = false;
      warnedSourceError = false;
    } catch (error) {
      if (!warnedSourceError) {
        console.warn("[GlobalRadarLayer] ensureSource: error adding source:", error);
        warnedSourceError = true;
      }
    }
  }

  /**
   * Asegura que el layer existe. Idempotente y seguro.
   * 
   * - Solo se ejecuta si getSafeMapStyle(map) es válido
   * - Crea la capa si no existe, con beforeId opcional
   * - Si ya existe, actualiza solo raster-opacity si cambió
   */
  private async ensureLayer(framesInfo: FramesInfo): Promise<void> {
    if (!this.map) return;

    const style = getSafeMapStyle(this.map);
    if (!style) {
      if (!warnedStyleNotReady) {
        console.warn("[GlobalRadarLayer] ensureLayer: style not ready, skipping");
        warnedStyleNotReady = true;
      }
      return;
    }

    try {
      const existing = this.map.getLayer(this.id);

      if (!existing) {
        // Crear layer si no existe
        const beforeId = this.findBeforeId();

        this.map.addLayer({
          id: this.id,
          type: "raster",
          source: this.sourceId,
          paint: {
            "raster-opacity": this.opacity
          },
          layout: {
            visibility: this.enabled ? "visible" : "none"
          },
          minzoom: 0,
          maxzoom: 18
        }, beforeId);

        // Reset warning flag después de éxito
        warnedStyleNotReady = false;
        warnedLayerError = false;
      } else {
        // Si ya existe, solo actualizar propiedades si cambiaron
        // La opacidad se actualiza en applyOpacity()
        // La visibilidad se actualiza en applyVisibility()
      }
    } catch (error) {
      if (!warnedLayerError) {
        console.warn("[GlobalRadarLayer] ensureLayer: error adding layer:", error);
        warnedLayerError = true;
      }
    }
  }

  /**
   * Actualiza el timestamp activo del radar
   */
  private async updateTimestamp(timestamp: number): Promise<void> {
    if (!this.map || !this.enabled) return;
    
    this.currentTimestamp = timestamp;

    const style = getSafeMapStyle(this.map);
    if (!style) {
      // Esperar a que el estilo esté listo
      this.map.once('styledata', () => {
        void this.updateTimestamp(timestamp);
      });
      return;
    }

    // Para actualizar el timestamp, necesitamos recrear el source
    // ya que las raster sources no permiten actualizar tiles directamente
    try {
      const existingLayer = this.map.getLayer(this.id);
      const existingSource = this.map.getSource(this.sourceId);

      if (existingLayer && existingSource) {
        // Remover layer y source
        this.map.removeLayer(this.id);
        this.map.removeSource(this.sourceId);

        // Recrear con nuevo timestamp
        const framesInfo: FramesInfo = {
          frames: [],
          activeTimestamp: timestamp,
          hasFrames: true
        };

        await this.ensureSource(framesInfo);
        await this.ensureLayer(framesInfo);
      }
    } catch (error) {
      console.warn("[GlobalRadarLayer] error updating timestamp:", error);
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

    const style = getSafeMapStyle(this.map);
    if (!style || !style.layers || !Array.isArray(style.layers)) {
      return undefined;
    }

    for (const layer of style.layers) {
      // Buscar capas de aviones (geoscope-aircraft) o barcos (geoscope-ships)
      if (layer.id === "geoscope-aircraft" || layer.id === "geoscope-ships") {
        return layer.id;
      }
    }

    // Si no hay aviones/barcos, añadir encima de todo (antes de etiquetas)
    // Buscar primera capa de símbolo (etiquetas)
    for (const layer of style.layers) {
      if (layer.type === "symbol") {
        return layer.id;
      }
    }

    return undefined;
  }

  /**
   * Intenta extraer la API key de MapTiler desde el estilo actual.
   */
  private extractMaptilerKey(style: maplibregl.StyleSpecification | null): string | null {
    if (!style) {
      return null;
    }

    const candidates: string[] = [];

    if (typeof style.sprite === "string") {
      candidates.push(style.sprite);
    }

    if (typeof style.glyphs === "string") {
      candidates.push(style.glyphs);
    }

    if (style.sources && typeof style.sources === "object") {
      for (const source of Object.values(style.sources)) {
        if (source && typeof source === "object") {
          const typed = source as { url?: string; tiles?: string[] };
          if (typeof typed.url === "string") {
            candidates.push(typed.url);
          }
          if (Array.isArray(typed.tiles)) {
            candidates.push(...typed.tiles.filter((t) => typeof t === "string"));
          }
        }
      }
    }

    for (const candidate of candidates) {
      const match = candidate.match(/[?&]key=([^&]+)/);
      if (match && match[1]) {
        try {
          return decodeURIComponent(match[1]);
        } catch {
          return match[1];
        }
      }
    }

    return null;
  }

  /**
   * Aplica la visibilidad de la capa según el estado enabled.
   * No borra la capa, solo cambia visibility a "none" o "visible".
   */
  private applyVisibility(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;

    const style = getSafeMapStyle(this.map);
    if (!style) {
      return;
    }
    
    try {
      if (this.enabled && this.currentTimestamp) {
        this.map.setLayoutProperty(this.id, "visibility", "visible");
      } else {
        this.map.setLayoutProperty(this.id, "visibility", "none");
      }
    } catch (e) {
      console.warn("[GlobalRadarLayer] error applying visibility:", e);
    }
  }

  /**
   * Aplica la opacidad de la capa
   */
  private applyOpacity(): void {
    if (!this.map || !this.map.getLayer(this.id)) return;

    const style = getSafeMapStyle(this.map);
    if (!style) {
      return;
    }
    
    try {
      this.map.setPaintProperty(this.id, "raster-opacity", this.opacity);
    } catch (e) {
      console.warn("[GlobalRadarLayer] error applying opacity:", e);
    }
  }
}
