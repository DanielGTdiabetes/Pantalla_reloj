import maplibregl from "maplibre-gl";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";

export interface Layer {
  id: string;
  zIndex: number;
  add(map: maplibregl.Map): void;
  remove(map: maplibregl.Map): void;
  setEnabled?(on: boolean): void;
  destroy?(): void;
}

export class LayerRegistry {
  private map: maplibregl.Map;
  private layers: Layer[] = [];

  constructor(map: maplibregl.Map) {
    this.map = map;
  }

  add(layer: Layer) {
    this.layers.push(layer);
    this.layers.sort((a, b) => a.zIndex - b.zIndex);

    // Check if style is ready before adding
    const style = getSafeMapStyle(this.map);
    if (style) {
      try {
        layer.add(this.map);
      } catch (err) {
        console.warn(`[LayerRegistry] Failed to add layer ${layer.id}`, err);
      }
    } else {
      console.warn(`[LayerRegistry] Style not ready, skipping add for ${layer.id} (will be added on styledata)`);
    }
  }

  reapply() {
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[LayerRegistry] Style not ready, skipping reapply");
      return;
    }

    for (const layer of this.layers) {
      try {
        layer.remove(this.map);
      } catch (err) {
        console.warn(`[LayerRegistry] Failed to remove layer ${layer.id}`, err);
      }
    }

    for (const layer of this.layers) {
      try {
        layer.add(this.map);
      } catch (err) {
        console.warn(`[LayerRegistry] Failed to reapply layer ${layer.id}`, err);
      }
    }
  }

  removeById(layerId: string) {
    const index = this.layers.findIndex((layer) => layer.id === layerId);
    if (index === -1) {
      return;
    }

    const [layer] = this.layers.splice(index, 1);
    try {
      layer.remove(this.map);
    } catch (err) {
      console.warn(`[LayerRegistry] Failed to remove layer ${layer.id}`, err);
    }

    try {
      layer.destroy?.();
    } catch (err) {
      console.warn(`[LayerRegistry] Failed to destroy layer ${layer.id}`, err);
    }
  }

  destroy() {
    for (const layer of this.layers) {
      try {
        layer.remove(this.map);
        layer.destroy?.();
      } catch (err) {
        console.warn(`[LayerRegistry] Failed to clean layer ${layer.id}`, err);
      }
    }
    this.layers = [];
  }
}
