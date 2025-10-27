import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";

interface ShipsLayerOptions {
  enabled?: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class ShipsLayer implements Layer {
  public readonly id = "geoscope-ships";
  public readonly zIndex = 30;

  private enabled: boolean;
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-ships-source";

  constructor(options: ShipsLayerOptions = {}) {
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
        type: "circle",
        source: this.sourceId,
        paint: {
          "circle-radius": 4,
          "circle-color": "#38bdf8",
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1
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
