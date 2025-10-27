import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";

interface WeatherLayerOptions {
  enabled?: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class WeatherLayer implements Layer {
  public readonly id = "geoscope-weather";
  public readonly zIndex = 10;

  private enabled: boolean;
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-weather-source";

  constructor(options: WeatherLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    if (!map.getSource(this.sourceId)) {
      map.addSource(this.sourceId, {
        type: "geojson",
        data: EMPTY
      });
    }

    if (!map.getLayer(this.id)) {
      map.addLayer({
        id: this.id,
        type: "fill",
        source: this.sourceId,
        paint: {
          "fill-color": "#60a5fa",
          "fill-opacity": 0.25
        }
      });
    }

    this.applyVisibility();
  }

  remove(map: maplibregl.Map): void {
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

  destroy(): void {
    this.map = undefined;
  }

  private applyVisibility() {
    if (!this.map) return;
    const visibility = this.enabled ? "visible" : "none";
    if (this.map.getLayer(this.id)) {
      this.map.setLayoutProperty(this.id, "visibility", visibility);
    }
  }
}
