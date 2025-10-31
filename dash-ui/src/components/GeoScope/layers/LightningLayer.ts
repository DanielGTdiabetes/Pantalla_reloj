import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";
import { isGeoJSONSource } from "./layerUtils";

interface LightningLayerOptions {
  enabled?: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class LightningLayer implements Layer {
  public readonly id = "geoscope-lightning";
  public readonly zIndex = 50;

  private enabled: boolean;
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-lightning-source";
  private lastData: FeatureCollection = EMPTY;

  constructor(options: LightningLayerOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    if (!map.getSource(this.sourceId)) {
      map.addSource(this.sourceId, {
        type: "geojson",
        data: this.lastData
      });
    }

    const source = map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      source.setData(this.lastData);
    }

    if (!map.getLayer(this.id)) {
      map.addLayer({
        id: this.id,
        type: "circle",
        source: this.sourceId,
        paint: {
          "circle-radius": 6,
          "circle-color": "#fcd34d",
          "circle-opacity": 0.65,
          "circle-blur": 0.35
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

  updateData(data: FeatureCollection): void {
    this.lastData = data ?? EMPTY;
    if (!this.map) return;
    const source = this.map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      source.setData(this.lastData);
    }
  }

  getData(): FeatureCollection {
    return this.lastData;
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
