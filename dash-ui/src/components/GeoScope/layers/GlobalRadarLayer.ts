import { Map as MaptilerMap } from "@maptiler/sdk";
import { RadarLayer } from "@maptiler/weather";
import type { StyleSpecification } from "maplibre-gl";

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
 * Capa de radar global que muestra datos de precipitación sobre el mapa base.
 *
 * Soporta dos proveedores:
 * - "maptiler_weather": Usa tiles raster de MapTiler Weather API (recomendado, default)
 * - "rainviewer": Legacy, deprecated (se fuerza automáticamente a maptiler_weather)
 *
 * Características:
 * - Inicialización robusta con waitForMapReady
 * - Source y layer raster idempotentes y seguros
 * - Reacciona bien a cambios de config y estilo base
 * - Detección automática de API key de MapTiler con múltiples fallbacks
 */
export default class GlobalRadarLayer implements Layer {
  public readonly id = "geoscope-global-radar";
  public readonly zIndex = 10; // Debajo de AEMET (15), por encima del mapa base (0)

  private enabled: boolean;
  private opacity: number;
  private currentTimestamp?: number;
  private baseUrl: string;
  private provider: "rainviewer" | "maptiler_weather" | string;
  private map?: MaptilerMap;
  private readonly sourceId = "geoscope-global-radar-source";
  private readonly maptilerSourceId = "radar-maptiler-source";
  private readonly maptilerLayerId = "global-radar-maptiler";
  private registeredInRegistry: boolean = false;
  private static warnedDisabled = false;
  private radarLayer?: RadarLayer | null = null;

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
  async add(map: MaptilerMap): Promise<void> {
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

    // Inicializar radar de MapTiler Weather (provider maptiler_weather)
    // NUNCA ejecutar código legacy de RainViewer si el provider es maptiler_weather
    if (provider === "maptiler_weather") {
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
          console.error(
            "[GlobalRadarLayer] ❌ MapTiler Weather: Falta API key de MapTiler para la capa de Radar. " +
            "La capa no se inicializará. " +
            "Configura VITE_MAPTILER_KEY en .env o asegúrate de que el mapa base use MapTiler con API key."
          );
          layerDiagnostics.updatePreconditions(layerId, { apiKeysConfigured: false });
          layerDiagnostics.recordError(layerId, new Error("MapTiler Weather: missing API key"), {
            provider: "maptiler_weather",
            hint: "Configure VITE_MAPTILER_KEY environment variable or ensure map base uses MapTiler with API key",
          });
          return;
        }
        
        console.log("[GlobalRadarLayer] ✓ MapTiler API key encontrada, procediendo con inicialización del radar");

        layerDiagnostics.updatePreconditions(layerId, { apiKeysConfigured: true });

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
      // Provider desconocido o legacy RainViewer (que ya fue forzado a maptiler_weather arriba)
      console.log("[GlobalRadarLayer] Unknown radar provider:", provider, "→ skipping");
      layerDiagnostics.recordError(layerId, new Error("Unknown radar provider"), { provider });
      layerDiagnostics.setEnabled(layerId, false);
      return;
    }
  }

  remove(map: MaptilerMap): void {
    try {
      // Limpiar RadarLayer del SDK de MapTiler Weather
      if (this.radarLayer) {
        console.log("[GlobalRadarLayer] Removing RadarLayer from map");
        // El SDK maneja la limpieza internamente
        this.radarLayer = null;
      }

      // Limpiar capas legacy (raster manual) si existen
      const existingMaptilerLayer = map.getLayer(this.maptilerLayerId);
      const existingLegacyLayer = map.getLayer(this.id);

      if (existingMaptilerLayer) {
        map.removeLayer(this.maptilerLayerId);
      }
      if (existingLegacyLayer) {
        map.removeLayer(this.id);
      }

      // Remover source solo si pertenece al radar (no borrar sources compartidas)
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
        // Limpiar capa de MapTiler Weather si existe
        if (this.map.getLayer(this.maptilerLayerId)) {
          this.map.removeLayer(this.maptilerLayerId);
        }
        if (this.map.getSource(this.maptilerSourceId)) {
          this.map.removeSource(this.maptilerSourceId);
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
    }

    // Actualizar timestamp si cambió
    // Solo para RainViewer legacy; MapTiler Weather maneja el timestamp automáticamente
    if (opts.currentTimestamp !== undefined && opts.currentTimestamp !== this.currentTimestamp) {
      // Verificar provider efectivo antes de actualizar timestamp
      const providerRaw = this.provider ?? "rainviewer";
      let provider = providerRaw;
      if (provider === "rainviewer") {
        provider = "maptiler_weather";
      }
      
      // Solo actualizar timestamp para RainViewer legacy
      if (provider !== "maptiler_weather") {
        void this.updateTimestamp(opts.currentTimestamp);
      } else {
        // Para MapTiler Weather, solo actualizar la referencia interna
        this.currentTimestamp = opts.currentTimestamp;
      }
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
   * 
   * ⚠️ LEGACY: Solo para RainViewer. NUNCA se debe llamar cuando provider === "maptiler_weather".
   * Esta función hace fetch a /api/health/full y /api/rainviewer/frames, que NO son necesarios
   * para MapTiler Weather.
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

    // Si el provider es maptiler_weather, NUNCA ejecutar código legacy de RainViewer
    if (provider === "maptiler_weather") {
      console.log("[GlobalRadarLayer] reinitialize: MapTiler Weather provider, skipping legacy RainViewer reinit");
      // Para MapTiler Weather, la reinicialización se maneja en add() si es necesario
      return;
    }

    // Código legacy de RainViewer (solo se ejecuta si provider !== "maptiler_weather")
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
   * 
   * ⚠️ LEGACY: Solo para RainViewer. NUNCA se debe llamar cuando provider === "maptiler_weather".
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
   * 
   * ⚠️ LEGACY: Solo para RainViewer. NUNCA se debe llamar cuando provider === "maptiler_weather".
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
   * 
   * ⚠️ LEGACY: Solo funciona para RainViewer. Para MapTiler Weather, el timestamp
   * se maneja automáticamente por el SDK y no requiere actualización manual.
   */
  private async updateTimestamp(timestamp: number): Promise<void> {
    if (!this.map || !this.enabled) return;

    // Verificar provider efectivo (forzado si era rainviewer)
    const providerRaw = this.provider ?? "rainviewer";
    let provider = providerRaw;
    if (provider === "rainviewer") {
      provider = "maptiler_weather";
    }

    // Si el provider es maptiler_weather, NO ejecutar código legacy de RainViewer
    if (provider === "maptiler_weather") {
      // Para MapTiler Weather, el SDK maneja el timestamp automáticamente
      // Solo actualizamos la referencia interna si es necesario
      this.currentTimestamp = timestamp;
      return;
    }

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
   * Encuentra el ID de la primera capa de símbolo (etiquetas) para usar como beforeId.
   * Esto asegura que el radar se añada debajo de las etiquetas pero por encima del mapa base.
   * 
   * Prioridad:
   * 1. Primera capa de tipo "symbol" (etiquetas)
   * 2. Si no hay símbolos, retorna undefined (se añade al final)
   */
  private findBeforeId(): string | undefined {
    if (!this.map) {
      return undefined;
    }

    const style = getSafeMapStyle(this.map);
    if (!style || !style.layers || !Array.isArray(style.layers)) {
      return undefined;
    }

    // Buscar primera capa de símbolo (etiquetas) para insertar el radar debajo
    for (const layer of style.layers) {
      if (layer.type === "symbol") {
        return layer.id;
      }
    }

    // Si no hay capas de símbolo, retornar undefined (se añade al final)
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

    // Determinar qué capa usar (maptiler_weather o legacy)
    const targetLayerId = this.map.getLayer(this.maptilerLayerId)
      ? this.maptilerLayerId
      : this.id;

    if (!this.map.getLayer(targetLayerId)) return;

    const style = getSafeMapStyle(this.map);
    if (!style) {
      return;
    }

    try {
      // Actualizar opacidad de la capa raster
      this.map.setPaintProperty(targetLayerId, "raster-opacity", this.opacity);
    } catch (e) {
      console.warn("[GlobalRadarLayer] error applying opacity:", e);
    }
  }

  /**
   * Extrae la API key de MapTiler siguiendo un orden de prioridad:
   * 1. VITE_MAPTILER_KEY (prioridad máxima)
   * 2. URLs del estilo del mapa (sprite, glyphs, sources)
   * 
   * Si no encuentra la key, retorna null y registra un error claro en consola
   * pero no rompe la aplicación.
   */
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

    // Prioridad 1: Variable de entorno VITE_MAPTILER_KEY (prioridad máxima)
    const envKey = (import.meta.env as Record<string, string | undefined>).VITE_MAPTILER_KEY;
    if (envKey?.trim()) {
      console.log("[GlobalRadarLayer] MapTiler API key found from VITE_MAPTILER_KEY environment variable");
      return envKey.trim();
    }

    // Prioridad 2: Extraer del estilo del mapa (sprite, glyphs, sources)
    if (style) {
      const candidates: (string | null)[] = [];
      
      // Buscar en sprite
      if (typeof style.sprite === "string") {
        candidates.push(style.sprite);
      }
      
      // Buscar en glyphs
      if (typeof style.glyphs === "string") {
        candidates.push(style.glyphs);
      }

      // Buscar en sources (url y tiles)
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

      // Intentar extraer key de cada candidato
      for (const candidate of candidates) {
        const key = extractFromUrl(candidate);
        if (key) {
          console.log("[GlobalRadarLayer] MapTiler API key extracted from map style URLs");
          return key;
        }
      }
    }

    // Si no se encontró ninguna key, abortar con error claro pero no romper la app
    console.error(
      "[GlobalRadarLayer] ❌ MapTiler API key no encontrada. " +
      "La capa de radar no se inicializará. " +
      "Configura VITE_MAPTILER_KEY en .env o asegúrate de que el mapa base use MapTiler con API key."
    );
    
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

  /**
   * Inicializa la capa de radar de MapTiler Weather usando el SDK oficial de @maptiler/weather.
   * 
   * Usa la API oficial del paquete:
   * - new RadarLayer({ id, opacity })
   * - map.addLayer(radarLayer)
   * 
   * La capa se inserta debajo de las etiquetas (symbol layers) para mantener el orden correcto.
   */
  private async initializeMaptilerWeatherLayer(map: MaptilerMap, apiKey: string): Promise<void> {
    const opacity = this.opacity ?? 0.7;

    // Logs de diagnóstico antes de la inicialización
    console.log("[GlobalRadarLayer] MapTiler Weather - using API key:", this.sanitizeApiKey(apiKey));
    console.log("[GlobalRadarLayer] Initializing MapTiler Weather RadarLayer");

    // Verificar que el mapa y el estilo estén listos
    const style = getSafeMapStyle(map);
    if (!style) {
      console.error("[GlobalRadarLayer] MapTiler Weather: map style not ready");
      throw new Error("MapTiler Weather: map style not ready");
    }

    // Limpiar capa existente si existe
    try {
      if (this.radarLayer) {
        console.log("[GlobalRadarLayer] Cleaning up existing RadarLayer");
        // El SDK de Weather maneja la limpieza internamente cuando se añade una nueva capa
        this.radarLayer = null;
      }
    } catch (e) {
      console.warn("[GlobalRadarLayer] Error cleaning up existing radar layer:", e);
    }

    try {
      // Crear RadarLayer con el ID y opacidad
      // Nota: El SDK de MapTiler Weather usa la API key configurada globalmente en el mapa
      console.log("[GlobalRadarLayer] Creating RadarLayer with opacity:", opacity);
      this.radarLayer = new RadarLayer({
        id: this.maptilerLayerId,
        opacity,
      });

      // Buscar capa de referencia para insertar el radar debajo de las etiquetas (symbol layers)
      const beforeId = this.findBeforeId();
      
      if (beforeId) {
        console.log("[GlobalRadarLayer] Adding RadarLayer before", beforeId);
      } else {
        console.log("[GlobalRadarLayer] Adding RadarLayer (no anchor layer found)");
      }

      // Añadir la capa al mapa usando el método del SDK
      // @ts-ignore - El SDK de MapTiler tiene compatibilidad con capas personalizadas
      map.addLayer(this.radarLayer, beforeId);

      console.log("[GlobalRadarLayer] MapTiler Weather radar initialized successfully", {
        opacity,
        beforeId: beforeId || "none",
      });

    } catch (error) {
      console.error("[GlobalRadarLayer] MapTiler Weather - failed to initialize:", error);
      
      // Limpiar referencias en caso de error
      this.radarLayer = null;
      
      const diagnosticLayerId: LayerId = "radar";
      layerDiagnostics.recordError(
        diagnosticLayerId,
        new Error(`MapTiler Weather failed to initialize: ${String(error)}`),
        {
          provider: "maptiler_weather",
        },
      );
      throw error;
    }
  }
}
