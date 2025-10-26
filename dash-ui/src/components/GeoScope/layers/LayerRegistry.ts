import maplibregl from "maplibre-gl";

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
