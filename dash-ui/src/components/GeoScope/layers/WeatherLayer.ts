import { Map as MaptilerMap } from "@maptiler/sdk";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";
import { isGeoJSONSource } from "./layerUtils";
import { withSafeMapStyle, waitForStyleLoaded } from "../../../lib/map/utils/safeMapOperations";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";

interface WeatherLayerOptions {
  enabled?: boolean;
  opacity?: number;
  refreshSeconds?: number;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class WeatherLayer implements Layer {
  public readonly id = "geoscope-weather";
  public readonly zIndex = 12; // Por encima de radar/satélite (10), debajo de AEMET warnings (15)

  private enabled: boolean;
  private opacity: number;
  private refreshSeconds: number;
  private map?: MaptilerMap;
  private readonly sourceId = "geoscope-weather-source";
  private lastData: FeatureCollection = EMPTY;
  private refreshTimer?: number;

  constructor(options: WeatherLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 0.3;
    this.refreshSeconds = options.refreshSeconds ?? 900; // 15 minutos por defecto
  }

  add(map: MaptilerMap): void | Promise<void> {
    this.map = map;

    // Iniciar refresco periódico inmediatamente
    this.startRefresh();

    // Inicializar la capa de forma asíncrona si está habilitada
    if (this.enabled) {
      return this.ensureWeatherLayer();
    }
  }

  /**
   * Asegura que la capa esté inicializada después de que el estilo esté listo.
   */
  async ensureWeatherLayer(): Promise<void> {
    const layerId: LayerId = "weather";

    if (!this.map || !this.enabled) {
      return;
    }

    // Esperar a que el estilo esté listo
    const styleReady = await waitForStyleLoaded(this.map, 15000);
    if (!styleReady) {
      layerDiagnostics.setState(layerId, "waiting_style", {
        reason: "timeout",
      });
      console.warn("[WeatherLayer] Timeout waiting for style, will retry on next call");
      return;
    }

    const map = this.map;

    try {
      // Añadir source de forma segura
      const sourceAdded = withSafeMapStyle(
        map,
        () => {
          if (!map.getSource(this.sourceId)) {
            map.addSource(this.sourceId, {
              type: "geojson",
              data: this.lastData,
              generateId: true
            });
          }
        },
        "WeatherLayer"
      );

      if (!sourceAdded) {
        layerDiagnostics.setState(layerId, "waiting_style", {
          reason: "source_not_added",
        });
        console.warn("[WeatherLayer] Could not add source, style not ready");
        return;
      }

      // Añadir capa de forma segura
      const layerAdded = withSafeMapStyle(
        map,
        () => {
          if (!map.getLayer(this.id)) {
            map.addLayer({
              id: this.id,
              type: "fill",
              source: this.sourceId,
              paint: {
                "fill-color": "#60a5fa",
                "fill-opacity": this.opacity
              }
            });
          }
        },
        "WeatherLayer"
      );

      if (!layerAdded) {
        layerDiagnostics.setState(layerId, "waiting_style", {
          reason: "layer_not_added",
        });
        console.warn("[WeatherLayer] Could not add layer, style not ready");
        return;
      }

      this.applyVisibility();

      layerDiagnostics.setState(layerId, "ready");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      layerDiagnostics.recordError(layerId, err, {
        phase: "add",
      });
      console.error("[WeatherLayer] Error in add:", error);
    }
  }

  remove(map: MaptilerMap): void {
    this.stopRefresh();

    if (map.getLayer(this.id)) {
      map.removeLayer(this.id);
    }
    if (map.getSource(this.sourceId)) {
      map.removeSource(this.sourceId);
    }
    this.map = undefined;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVisibility();
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
    this.applyOpacity();
  }

  setRefreshSeconds(seconds: number): void {
    this.refreshSeconds = Math.max(60, Math.min(3600, seconds));
    this.stopRefresh();
    this.startRefresh();
  }

  updateData(data: FeatureCollection): void {
    const layerId: LayerId = "weather";

    try {
      // Validar que los datos sean un FeatureCollection válido
      if (!data || typeof data !== "object" || data.type !== "FeatureCollection") {
        const error = new Error(`Invalid FeatureCollection: ${JSON.stringify(data).substring(0, 100)}`);
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_validation",
        });
        console.error("[WeatherLayer] Invalid data format:", data);
        return;
      }

      if (!Array.isArray(data.features)) {
        const error = new Error("Features array is missing or invalid");
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_validation",
        });
        console.error("[WeatherLayer] Features array is missing or invalid");
        return;
      }

      this.lastData = data;

      if (!this.map) {
        console.warn("[WeatherLayer] Map not available for updateData");
        return;
      }

      const source = this.map.getSource(this.sourceId);
      if (isGeoJSONSource(source)) {
        try {
          source.setData(this.lastData);
          // Registrar actualización exitosa
          layerDiagnostics.recordDataUpdate(layerId, data.features.length);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          layerDiagnostics.recordError(layerId, err, {
            phase: "updateData_setData",
            featureCount: data.features.length,
          });
          console.error("[WeatherLayer] Error setting data to source:", error);
        }
      } else {
        const error = new Error(`Source ${this.sourceId} is not a GeoJSON source`);
        layerDiagnostics.recordError(layerId, error, {
          phase: "updateData_source_check",
        });
        console.warn("[WeatherLayer] Source is not a GeoJSON source:", source);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      layerDiagnostics.recordError(layerId, err, {
        phase: "updateData",
      });
      console.error("[WeatherLayer] Error in updateData:", error);
    }
  }

  getData(): FeatureCollection {
    return this.lastData;
  }

  destroy(): void {
    this.stopRefresh();
    this.map = undefined;
  }

  private applyVisibility() {
    if (!this.map) return;
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[WeatherLayer] Style not ready, skipping");
      return;
    }
    const visibility = this.enabled ? "visible" : "none";
    if (this.map.getLayer(this.id)) {
      try {
        this.map.setLayoutProperty(this.id, "visibility", visibility);
      } catch (e) {
        console.warn("[WeatherLayer] layout skipped:", e);
      }
    }
  }

  private applyOpacity(): void {
    if (!this.map) return;
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[WeatherLayer] Style not ready, skipping");
      return;
    }
    if (this.map.getLayer(this.id)) {
      try {
        this.map.setPaintProperty(this.id, "fill-opacity", this.opacity);
      } catch (e) {
        console.warn("[WeatherLayer] paint skipped:", e);
      }
    }
  }

  private async fetchWeatherData(): Promise<void> {
    const layerId: LayerId = "weather";

    try {
      const response = await fetch("/api/weather/alerts");
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        layerDiagnostics.recordError(layerId, error, {
          phase: "fetchWeatherData",
          httpStatus: response.status,
        });
        console.warn("[WeatherLayer] Failed to fetch weather data:", response.status);
        return;
      }

      const data = await response.json() as FeatureCollection;
      this.updateData(data);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      layerDiagnostics.recordError(layerId, err, {
        phase: "fetchWeatherData",
      });
      console.error("[WeatherLayer] Error fetching weather data:", error);
    }
  }

  private startRefresh(): void {
    this.stopRefresh();

    if (this.refreshSeconds <= 0) {
      return;
    }

    // Cargar datos iniciales
    void this.fetchWeatherData();

    // Refrescar periódicamente
    this.refreshTimer = window.setInterval(() => {
      void this.fetchWeatherData();
    }, this.refreshSeconds * 1000) as unknown as number;
  }

  private stopRefresh(): void {
    if (this.refreshTimer !== undefined) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}
