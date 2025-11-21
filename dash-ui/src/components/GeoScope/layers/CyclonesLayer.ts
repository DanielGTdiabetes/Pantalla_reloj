import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";
import { withSafeMapStyle } from "../../../lib/map/utils/safeMapOperations";

interface CyclonesLayerOptions {
  enabled?: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class CyclonesLayer implements Layer {
  public readonly id = "geoscope-cyclones";
  public readonly zIndex = 20;

  private enabled: boolean;
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-cyclones-source";

  constructor(options: CyclonesLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    
    // Añadir source de forma segura
    const sourceAdded = withSafeMapStyle(
      map,
      () => {
        if (!map.getSource(this.sourceId)) {
          map.addSource(this.sourceId, {
            type: "geojson",
            data: EMPTY
          });
        }
      },
      "CyclonesLayer"
    );

    if (!sourceAdded) {
      console.warn("[CyclonesLayer] Could not add source, style not ready");
      return;
    }

    // Añadir capa de forma segura
    const layerAdded = withSafeMapStyle(
      map,
      () => {
        if (!map.getLayer(this.id)) {
          map.addLayer({
            id: this.id,
            type: "line",
            source: this.sourceId,
            paint: {
              "line-color": "#34d399",
              "line-width": 2,
              "line-dasharray": [2, 2]
            }
          });
        }
      },
      "CyclonesLayer"
    );

    if (!layerAdded) {
      console.warn("[CyclonesLayer] Could not add layer, style not ready");
      return;
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
