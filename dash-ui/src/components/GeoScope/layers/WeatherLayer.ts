import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";
import { isGeoJSONSource } from "./layerUtils";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";

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
    this.map = map;
    
    // Verificar que el estilo esté listo antes de manipular sources/layers
    const style = getSafeMapStyle(map);
    if (!style) {
      console.warn("[WeatherLayer] style not ready, skipping add");
      return;
    }
    
    if (!map.getSource(this.sourceId)) {
      map.addSource(this.sourceId, {
        type: "geojson",
        data: this.lastData,
        generateId: true
      });
    }

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

    // Iniciar refresco periódico
    this.startRefresh();

    this.applyVisibility();
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
    this.lastData = data;

    if (!this.map) {
      return;
    }

    const source = this.map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      source.setData(this.lastData);
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
    try {
      const response = await fetch("/api/aemet/warnings");
      if (!response.ok) {
        console.warn("[WeatherLayer] Failed to fetch weather data:", response.status);
        return;
      }

      const data = await response.json() as FeatureCollection;
      this.updateData(data);
    } catch (error) {
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
