import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";
import { isGeoJSONSource } from "./layerUtils";
import { withSafeMapStyle } from "../../../lib/map/utils/safeMapOperations";
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
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-weather-source";
  private lastData: FeatureCollection = EMPTY;
  private refreshTimer?: number;

  constructor(options: WeatherLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 0.3;
    this.refreshSeconds = options.refreshSeconds ?? 900; // 15 minutos por defecto
  }

  add(map: maplibregl.Map): void {
    const layerId: LayerId = "weather";
    this.map = map;
    
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

      // Iniciar refresco periódico
      this.startRefresh();

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

  remove(map: maplibregl.Map): void {
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
    const visibility = this.enabled ? "visible" : "none";
    if (this.map.getLayer(this.id)) {
      this.map.setLayoutProperty(this.id, "visibility", visibility);
    }
  }

  private applyOpacity(): void {
    if (!this.map) return;
    if (this.map.getLayer(this.id)) {
      this.map.setPaintProperty(this.id, "fill-opacity", this.opacity);
    }
  }

  private async fetchWeatherData(): Promise<void> {
    const layerId: LayerId = "weather";
    
    try {
      const response = await fetch("/api/aemet/warnings");
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
