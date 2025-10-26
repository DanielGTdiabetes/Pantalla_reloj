import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";

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

  constructor(options: LightningLayerOptions = {}) {
    this.enabled = options.enabled ?? true;
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
