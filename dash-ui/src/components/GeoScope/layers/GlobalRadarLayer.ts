import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { RadarLayer } from "@maptiler/weather";
import { config as maptilerConfig } from "@maptiler/sdk";

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
  private readonly maptilerSourceId = "radar-maptiler-source";
  private readonly maptilerLayerId = "global-radar-maptiler";
  private radarLayerInstance: RadarLayer | null = null;
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

    const layerId: LayerId = "radar";
    const enabled = this.enabled;
    const providerRaw = this.provider ?? "rainviewer";

    console.log("[GlobalRadarLayer] useEffect enter, checking radar configuration");
    console.log("[GlobalRadarLayer] provider from config =", providerRaw, "enabled =", enabled);

    // Fuerza MapTiler Weather mientras RainViewer está deprecado
    let provider = providerRaw;
    if (provider === "rainviewer") {
      console.log("[GlobalRadarLayer] Forcing radar provider to maptiler_weather in init (RainViewer deprecated)");
      provider = "maptiler_weather";
    }

    console.log("[GlobalRadarLayer] Using provider:", provider);

    layerDiagnostics.setEnabled(layerId, enabled);
    layerDiagnostics.updatePreconditions(layerId, {
      configAvailable: true,
      configEnabled: enabled,
      backendAvailable: true,
      apiKeysConfigured: true,
    });

    if (!enabled) {
      layerDiagnostics.setState(layerId, "disabled", { provider });
      console.log("[GlobalRadarLayer] Radar disabled in config, skipping initialization");
      return;
    }

    // Legacy RainViewer (desactivado por ahora)
    if (provider === "rainviewer") {
      console.log("[GlobalRadarLayer] RainViewer init path disabled (legacy)");
      layerDiagnostics.recordInitializationAttempt(layerId);
      layerDiagnostics.setState(layerId, "disabled", {
        provider: "rainviewer",
        reason: "RainViewer deprecated",
      });
      return;
    } else if (provider === "maptiler_weather") {
      layerDiagnostics.recordInitializationAttempt(layerId);

      try {
        await waitForMapReady(map);

        const style = getSafeMapStyle(map);
        if (!style) {
          layerDiagnostics.updatePreconditions(layerId, { styleLoaded: false });
          layerDiagnostics.recordError(layerId, new Error("Map style not ready for MapTiler Weather"), {
            provider: "maptiler_weather",
          });
          return;
        }

        layerDiagnostics.updatePreconditions(layerId, { styleLoaded: true });

        const maptilerKey = this.extractMaptilerApiKey(style);
        if (!maptilerKey) {
          console.log("[GlobalRadarLayer] MapTiler Weather: missing API key, aborting radar init");
          layerDiagnostics.updatePreconditions(layerId, { apiKeysConfigured: false });
          layerDiagnostics.recordError(layerId, "MapTiler Weather: missing API key", {
            provider: "maptiler_weather",
          });
          return;
        }

        layerDiagnostics.updatePreconditions(layerId, { apiKeysConfigured: true });

        // Configurar MapTiler SDK globalmente con la API key
        maptilerConfig.apiKey = maptilerKey;

        console.log("[GlobalRadarLayer] Initializing MapTiler Weather radar layer");
        await this.initializeMaptilerWeatherLayer(map, maptilerKey);

        this.currentTimestamp = this.currentTimestamp ?? Date.now();

        this.registeredInRegistry = true;

        layerDiagnostics.setState(layerId, "ready", {
          enabled: true,
          provider: "maptiler_weather",
        });
        console.log("[GlobalRadarLayer] MapTiler Weather radar initialized successfully");
      } catch (error) {
        console.log("[GlobalRadarLayer] MapTiler Weather init failed", error);
        const diagnostic = layerDiagnostics.getDiagnostic(layerId);
        const previousErrors = diagnostic?.errorCount ?? 0;
        layerDiagnostics.recordError(
          layerId,
          new Error(`MapTiler Weather init failed: ${String(error)}`),
          {
            enabled: true,
            provider: "maptiler_weather",
            previousErrors,
          },
        );
      }
      return;
    } else {
      console.log("[GlobalRadarLayer] Unknown radar provider:", provider, "→ skipping");
      layerDiagnostics.recordError(layerId, new Error("Unknown radar provider"), { provider });
      layerDiagnostics.setEnabled(layerId, false);
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
        layerDiagnostics.recordError(layerId, new Error("Map style not ready"), { provider });
        return;
      }

      // Paso 3: Obtener frames disponibles (con cache)
      const framesInfoRaw = await this.fetchFramesOnce();
      if (!framesInfoRaw) {
        if (!warnedNoFrames) {
          console.warn("[GlobalRadarLayer] no frames available, skipping layer creation");
          warnedNoFrames = true;
        }
        layerDiagnostics.recordError(layerId, new Error("No RainViewer frames available"), { provider });
        return;
      }
      // TypeScript: después del return anterior, framesInfoRaw no puede ser null
      if (!framesInfoRaw!.hasFrames) {
        if (!warnedNoFrames) {
          console.warn("[GlobalRadarLayer] no frames available, skipping layer creation");
          warnedNoFrames = true;
        }
        layerDiagnostics.recordError(layerId, new Error("No RainViewer frames available"), { provider });
        return;
      }

      // TypeScript: después de las verificaciones anteriores, framesInfoRaw no puede ser null y hasFrames es true
      // Usamos aserción de tipo no-null porque sabemos que framesInfoRaw es válido aquí
      const framesInfo = framesInfoRaw as FramesInfo;

      // Paso 4: Crear source y layer
      await this.ensureSource(framesInfo);
      await this.ensureLayer(framesInfo);

      this.registeredInRegistry = true;

      // Reset flags de warning después de éxito
      warnedStyleNotReady = false;
      warnedNoFrames = false;
      layerDiagnostics.setState(layerId, "ready", { provider });
      layerDiagnostics.recordDataUpdate(layerId, framesInfo.frames.length);
    } catch (error) {
      console.warn("[GlobalRadarLayer] error during add():", error);
      layerDiagnostics.recordError(layerId, error as Error, { provider });
    }
  }

  remove(map: maplibregl.Map): void {
    try {
      // Limpiar RadarLayer de MapTiler Weather si existe
      if (this.radarLayerInstance) {
        try {
          this.radarLayerInstance.animate(0); // Detener animación
        } catch (e) {
          // Ignorar errores al detener animación
        }
        this.radarLayerInstance = null;
      }

      const existingMaptilerLayer = map.getLayer(this.maptilerLayerId);
      const existingLegacyLayer = map.getLayer(this.id);

      if (existingMaptilerLayer) {
        map.removeLayer(this.maptilerLayerId);
      }
      if (existingLegacyLayer) {
        map.removeLayer(this.id);
      }

      // Remover source solo si pertenece al radar (no borrar sources compartidas)
      const maptilerSource = map.getSource(this.maptilerLayerId);
      if (maptilerSource) {
        map.removeSource(this.maptilerLayerId);
      }
      if (map.getSource(this.maptilerSourceId)) {
        map.removeSource(this.maptilerSourceId);
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

    // Si se desactivó, limpiar la capa si existe
    if (wasEnabled && !this.enabled) {
      if (this.map) {
        // Limpiar RadarLayer de MapTiler Weather si existe
        if (this.radarLayerInstance) {
          try {
            this.radarLayerInstance.animate(0); // Detener animación
            if (this.map.getLayer(this.maptilerLayerId)) {
              this.map.removeLayer(this.maptilerLayerId);
            }
            const source = this.map.getSource(this.maptilerLayerId);
            if (source) {
              this.map.removeSource(this.maptilerLayerId);
            }
          } catch (e) {
            console.warn("[GlobalRadarLayer] Error cleaning up radar layer:", e);
          }
          this.radarLayerInstance = null;
        }
        // También limpiar capa legacy si existe
        const existingLegacyLayer = this.map.getLayer(this.id);
        if (existingLegacyLayer) {
          this.map.removeLayer(this.id);
        }
        if (this.map.getSource(this.sourceId)) {
          this.map.removeSource(this.sourceId);
        }
      }
      return;
    }

    // Si se activó después de estar desactivado, mostrar
    if (!wasEnabled && this.enabled) {
      this.applyVisibility();

      // Si la capa no existe, reinicializar
      if (this.map) {
        // Verificar provider efectivo
        const providerRaw = this.provider ?? "rainviewer";
        let provider = providerRaw;
        if (provider === "rainviewer") {
          provider = "maptiler_weather";
        }

        // Para MapTiler Weather, verificar si existe la capa de MapTiler
        const maptilerLayerExists = this.map.getLayer(this.maptilerLayerId);
        const legacyLayerExists = this.map.getLayer(this.id);

        if (!maptilerLayerExists && !legacyLayerExists) {
          if (provider === "maptiler_weather") {
            // Para MapTiler Weather, llamar a add() para reinicializar correctamente
            void this.add(this.map);
          } else {
            // Para RainViewer legacy, usar reinitialize()
            void this.reinitialize();
          }
        }
      }
      return;
    }

    // Actualizar opacidad si cambió
    if (opts.opacity !== undefined) {
      this.applyOpacity();
      // Si es RadarLayer de MapTiler Weather, actualizar opacidad directamente
      if (this.radarLayerInstance) {
        try {
          this.radarLayerInstance.setOpacity(this.opacity);
        } catch (e) {
          console.warn("[GlobalRadarLayer] Error updating RadarLayer opacity:", e);
        }
      }
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
          hasFrames: framesCache.frames.length > 0,
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
        expiresAt: Date.now() + CACHE_TTL_MS,
      };

      // Usar el último frame (más reciente)
      const activeTimestamp = frames[frames.length - 1];

      return {
        frames,
        activeTimestamp,
        hasFrames: true,
      };
    } catch (error) {
      console.warn("[GlobalRadarLayer] error fetching frames:", error);
      return null;
    }
  }

  /**
   * Reinicializa la capa cuando se detecta que no existe
   * (útil después de cambios de estilo base)
   * 
   * ⚠️ LEGACY: Solo funciona para RainViewer. Para MapTiler Weather, la reinicialización
   * se maneja automáticamente por el sistema de capas.
   */
  private async reinitialize(): Promise<void> {
    if (!this.map) return;

    // Verificar provider efectivo (forzado si era rainviewer)
    const providerRaw = this.provider ?? "rainviewer";
    let provider = providerRaw;
    if (provider === "rainviewer") {
      provider = "maptiler_weather";
    }

    // Si el provider es maptiler_weather, no ejecutar código legacy de RainViewer
    if (provider === "maptiler_weather") {
      console.log("[GlobalRadarLayer] reinitialize: MapTiler Weather provider, skipping legacy RainViewer reinit");
      // Para MapTiler Weather, la reinicialización se maneja en add() si es necesario
      return;
    }

    // Código legacy de RainViewer (no debería ejecutarse nunca ahora)
    try {
      await waitForMapReady(this.map);

      const style = getSafeMapStyle(this.map);
      if (!style) {
        console.warn("[GlobalRadarLayer] style not ready during reinitialize, will retry on styledata");
        this.map.once("styledata", () => {
          void this.reinitialize();
        });
        return;
      }

      const framesInfoRaw = await this.fetchFramesOnce();
      if (!framesInfoRaw) {
        return;
      }
      // TypeScript: después del return anterior, framesInfoRaw no puede ser null
      if (!framesInfoRaw!.hasFrames) {
        return;
      }

      // TypeScript: después de las verificaciones anteriores, framesInfoRaw no puede ser null y hasFrames es true
      // Usamos aserción de tipo no-null porque sabemos que framesInfoRaw es válido aquí
      const framesInfo = framesInfoRaw as FramesInfo;

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

        this.map.addLayer(
          {
            id: this.id,
            type: "raster",
            source: this.sourceId,
            paint: {
              "raster-opacity": this.opacity,
            },
            layout: {
              visibility: this.enabled ? "visible" : "none",
            },
            minzoom: 0,
            maxzoom: 18,
          },
          beforeId,
        );

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
      this.map.once("styledata", () => {
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
          hasFrames: true,
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
   * Aplica la visibilidad de la capa según el estado enabled.
   * No borra la capa, solo cambia visibility a "none" o "visible".
   */
  private applyVisibility(): void {
    if (!this.map) return;

    const targetLayerId = this.map.getLayer(this.maptilerLayerId)
      ? this.maptilerLayerId
      : this.id;

    if (!this.map.getLayer(targetLayerId)) return;

    const style = getSafeMapStyle(this.map);
    if (!style) {
      return;
    }

    try {
      if (this.enabled && this.currentTimestamp) {
        this.map.setLayoutProperty(targetLayerId, "visibility", "visible");
      } else {
        this.map.setLayoutProperty(targetLayerId, "visibility", "none");
      }
    } catch (e) {
      console.warn("[GlobalRadarLayer] error applying visibility:", e);
    }
  }

  /**
   * Aplica la opacidad de la capa
   */
  private applyOpacity(): void {
    if (!this.map) return;

    // Si es RadarLayer de MapTiler Weather, usar su método setOpacity
    if (this.radarLayerInstance) {
      try {
        this.radarLayerInstance.setOpacity(this.opacity);
        return;
      } catch (e) {
        console.warn("[GlobalRadarLayer] error applying opacity via RadarLayer:", e);
      }
    }

    // Fallback para capa legacy
    const targetLayerId = this.map.getLayer(this.maptilerLayerId)
      ? this.maptilerLayerId
      : this.id;

    if (!this.map.getLayer(targetLayerId)) return;

    const style = getSafeMapStyle(this.map);
    if (!style) {
      return;
    }

    try {
      this.map.setPaintProperty(targetLayerId, "raster-opacity", this.opacity);
    } catch (e) {
      console.warn("[GlobalRadarLayer] error applying opacity:", e);
    }
  }

  private extractMaptilerApiKey(style: StyleSpecification | null | undefined): string | null {
    const extractFromUrl = (url: unknown): string | null => {
      if (!url || typeof url !== "string") return null;
      const match = url.match(/[?&]key=([^&]+)/);
      if (match && match[1]) {
        try {
          const decoded = decodeURIComponent(match[1]);
          return decoded.trim() || null;
        } catch {
          return match[1].trim() || null;
        }
      }
      return null;
    };

    if (!style) {
      return null;
    }

    const envKey = (import.meta.env as Record<string, string | undefined>).VITE_MAPTILER_KEY;
    if (envKey?.trim()) {
      return envKey.trim();
    }

    const candidates: (string | null)[] = [];
    if (typeof style.sprite === "string") {
      candidates.push(style.sprite);
    }
    if (typeof style.glyphs === "string") {
      candidates.push(style.glyphs);
    }

    if (style.sources && typeof style.sources === "object") {
      for (const source of Object.values(style.sources)) {
        if (!source || typeof source !== "object") continue;
        const typedSource = source as { url?: unknown; tiles?: unknown };
        if (typedSource.url) {
          candidates.push(typeof typedSource.url === "string" ? typedSource.url : null);
        }
        if (Array.isArray(typedSource.tiles)) {
          for (const tile of typedSource.tiles) {
            candidates.push(typeof tile === "string" ? tile : null);
          }
        }
      }
    }

    for (const candidate of candidates) {
      const key = extractFromUrl(candidate);
      if (key) {
        return key;
      }
    }

    return null;
  }

  /**
   * Sanitiza una API key para logging (muestra solo primeros caracteres y longitud)
   */
  private sanitizeApiKey(apiKey: string): string {
    if (apiKey.length <= 5) {
      return "****";
    }
    const prefix = apiKey.substring(0, 5);
    return `${prefix}**** (len=${apiKey.length})`;
  }

  private async initializeMaptilerWeatherLayer(map: maplibregl.Map, apiKey: string): Promise<void> {
    const layerId = this.maptilerLayerId;
    const opacity = this.opacity ?? 0.7;

    // Logs de diagnóstico antes de la inicialización
    console.log("[GlobalRadarLayer] MapTiler Weather - using API key:", this.sanitizeApiKey(apiKey));
    console.log("[GlobalRadarLayer] MapTiler Weather - layerId:", layerId);

    // Limpiar capa existente si existe
    if (this.radarLayerInstance) {
      try {
        this.radarLayerInstance.animate(0);
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
        const source = map.getSource(layerId);
        if (source) {
          map.removeSource(layerId);
        }
      } catch (e) {
        console.warn("[GlobalRadarLayer] Error cleaning up existing radar layer:", e);
      }
      this.radarLayerInstance = null;
    }

    // Buscar capa de agua para insertar el radar debajo
    const style = getSafeMapStyle(map);
    const styleLayers = Array.isArray(style?.layers) ? style!.layers : [];
    let anchorLayerId: string | undefined;

    // Buscar capa de agua por IDs comunes
    for (const layer of styleLayers) {
      const id = layer.id?.toLowerCase() || "";
      if (id.includes("water") || id.includes("ocean") || id.includes("sea")) {
        anchorLayerId = layer.id;
        break;
      }
    }

    // Si no se encuentra capa de agua, usar primera capa fill como fallback
    if (!anchorLayerId) {
      for (const layer of styleLayers) {
        if (layer.type === "fill") {
          anchorLayerId = layer.id;
          break;
        }
      }
    }

    // Si aún no hay anchor, usar "Water" como último recurso (puede no existir)
    if (!anchorLayerId) {
      anchorLayerId = "Water";
      console.log("[GlobalRadarLayer] No water layer found, using 'Water' as anchor (may not exist)");
    }

    // Crear instancia de RadarLayer
    try {
      const radarLayer = new RadarLayer({
        id: layerId,
        opacity: opacity,
      });

      // Añadir la capa al mapa debajo de la capa de agua (o anchor equivalente)
      // Type assertion necesaria porque RadarLayer es compatible pero los tipos no coinciden exactamente
      map.addLayer(radarLayer as any, anchorLayerId);

      console.log("[GlobalRadarLayer] MapTiler Weather RadarLayer initialized", {
        layerId,
        opacity,
        anchorLayerId,
      });

      // Guardar referencia a la instancia
      this.radarLayerInstance = radarLayer;

      // Verificación final del estado de la capa
      const hasLayer = !!map.getLayer(layerId);

      console.log("[GlobalRadarLayer] MapTiler Weather RadarLayer final state", {
        layerId,
        hasLayer,
        opacity,
      });

      // Si la capa no se adjuntó correctamente, marcar como error en diagnósticos
      if (!hasLayer) {
        const diagnosticLayerId: LayerId = "radar";
        layerDiagnostics.recordError(
          diagnosticLayerId,
          new Error("MapTiler Weather RadarLayer not attached to map"),
          {
            provider: "maptiler_weather",
            layerId,
            hasLayer,
          },
        );
        throw new Error(`MapTiler Weather RadarLayer not attached: hasLayer=${hasLayer}`);
      }
    } catch (error) {
      console.error("[GlobalRadarLayer] MapTiler Weather - addLayer failed:", error);
      const diagnosticLayerId: LayerId = "radar";
      layerDiagnostics.recordError(
        diagnosticLayerId,
        new Error(`MapTiler Weather RadarLayer addLayer failed: ${String(error)}`),
        {
          provider: "maptiler_weather",
          layerId,
        },
      );
      throw error; // Re-lanzar para que el catch superior lo maneje
    }
  }
}
