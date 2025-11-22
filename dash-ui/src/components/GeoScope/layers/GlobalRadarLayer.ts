import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import { config as maptilerSdkConfig } from "@maptiler/sdk";

import type { Layer } from "./LayerRegistry";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { waitForMapReady } from "../../../lib/map/utils/waitForMapReady";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";

interface GlobalRadarLayerOptions {
  enabled?: boolean;
  opacity?: number;
  currentTimestamp?: number;
  baseUrl?: string;
  provider?: "rainviewer" | "maptiler_weather" | string;
}

/**
 * Capa de radar global que ahora fuerza el uso de MapTiler Weather.
 *
 * ⚠️ RainViewer está deprecado: cualquier configuración distinta de "maptiler_weather"
 * se fuerza automáticamente a MapTiler Weather mientras dura la migración.
 *
 * Características:
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
  private provider: "rainviewer" | "maptiler_weather" | string;
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-global-radar-source";
  private registeredInRegistry: boolean = false;

  constructor(options: GlobalRadarLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 0.7;
    this.currentTimestamp = options.currentTimestamp;
    this.provider = options.provider ?? "rainviewer";
  }

  /**
   * Añade la capa al mapa siguiendo una secuencia limpia:
   * 1. Verifica que enabled=true (si no, aborta sin hacer nada)
   * 2. Espera a que el mapa esté listo (waitForMapReady)
   * 3. Verifica que el estilo esté cargado
   * 4. Crea source y layer
   */
  async add(map: maplibregl.Map): Promise<void> {
    this.map = map;

    console.log("[GlobalRadarLayer] useEffect enter, checking radar configuration");

    const providerRaw = this.provider ?? "rainviewer";
    let provider = providerRaw;

    if (provider !== "maptiler_weather") {
      console.log("[GlobalRadarLayer] Forcing provider to maptiler_weather (RainViewer deprecated)");
      provider = "maptiler_weather";
    }

    this.provider = provider;

    console.log(`[GlobalRadarLayer] Using provider: ${provider}`);

    const layerId: LayerId = "radar";

    if (!this.enabled) {
      layerDiagnostics.setEnabled(layerId, false);
      layerDiagnostics.setState(layerId, "disabled", { provider });
      console.log("[GlobalRadarLayer] Radar disabled in config, skipping initialization");
      return;
    }

    if (provider === "maptiler_weather") {
      await this.initializeMapTilerWeatherLayer(map, layerId);
      return;
    }

    console.warn("[GlobalRadarLayer] Unsupported radar provider after forcing, skipping initialization");
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
        void this.add(this.map);
      }
      return;
    }

    // Actualizar opacidad si cambió
    if (opts.opacity !== undefined) {
      this.applyOpacity();
    }

    // Actualizar timestamp si cambió
    if (opts.currentTimestamp !== undefined && opts.currentTimestamp !== this.currentTimestamp) {
      this.currentTimestamp = opts.currentTimestamp;
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

  private async initializeMapTilerWeatherLayer(map: maplibregl.Map, layerId: LayerId): Promise<void> {
    console.log("[GlobalRadarLayer] Initializing MapTiler Weather radar layer");

    try {
      await waitForMapReady(map);

      layerDiagnostics.setEnabled(layerId, true);
      layerDiagnostics.recordInitializationAttempt(layerId);
      layerDiagnostics.setState(layerId, "initializing", { provider: this.provider });

      const style = getSafeMapStyle(map);
      if (!style) {
        layerDiagnostics.updatePreconditions(layerId, {
          styleLoaded: false,
          configAvailable: true,
          configEnabled: true,
        });
        layerDiagnostics.recordError(layerId, new Error("Map style not ready"), {
          provider: this.provider,
        });
        return;
      }

      const maptilerKey = this.extractMaptilerKey(style) ?? maptilerSdkConfig.apiKey ?? null;
      if (!maptilerKey) {
        layerDiagnostics.updatePreconditions(layerId, {
          styleLoaded: true,
          configAvailable: true,
          configEnabled: true,
          apiKeysConfigured: false,
        });
        layerDiagnostics.recordError(layerId, new Error("MapTiler Weather: missing API key"), {
          provider: this.provider,
        });
        return;
      }

      layerDiagnostics.updatePreconditions(layerId, {
        styleLoaded: true,
        configAvailable: true,
        configEnabled: true,
        backendAvailable: true,
        apiKeysConfigured: true,
      });

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
        layout: {
          visibility: this.enabled ? "visible" : "none",
        },
      }, beforeId);

      this.currentTimestamp = Date.now();
      this.registeredInRegistry = true;

      const diagnostic = layerDiagnostics.getDiagnostic(layerId);
      if (diagnostic) {
        diagnostic.errorCount = 0;
        diagnostic.lastError = null;
      }

      layerDiagnostics.setState(layerId, "ready", { provider: this.provider });
      layerDiagnostics.recordDataUpdate(layerId);
      console.log("[GlobalRadarLayer] MapTiler Weather radar initialized successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      layerDiagnostics.recordError(layerId, new Error(`MapTiler Weather: error adding source/layer (${message})`), {
        provider: this.provider,
      });
      console.warn("[GlobalRadarLayer] Failed to initialize MapTiler Weather radar layer", error);
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
  private extractMaptilerKey(style: StyleSpecification | null): string | null {
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
      if (this.enabled) {
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
