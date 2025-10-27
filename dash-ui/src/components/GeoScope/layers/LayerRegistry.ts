import type { Map as LeafletMap } from "leaflet";

export interface Layer {
  id: string;
  zIndex: number;
  add(map: LeafletMap): void;
  remove(map: LeafletMap): void;
  setEnabled?(on: boolean): void;
  destroy?(): void;
}

export class LayerRegistry {
  private map: LeafletMap;
  private layers: Layer[] = [];

  constructor(map: LeafletMap) {
    this.map = map;
  }

  add(layer: Layer) {
    this.layers.push(layer);
    this.layers.sort((a, b) => a.zIndex - b.zIndex);
    layer.add(this.map);
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
