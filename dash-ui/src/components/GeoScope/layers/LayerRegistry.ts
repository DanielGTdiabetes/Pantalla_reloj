import maplibregl from "maplibre-gl";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";

export interface Layer {
  id: string;
  zIndex: number;
  add(map: maplibregl.Map): void | Promise<void>;
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

  add(layer: Layer): boolean {
    // Validaciones estrictas antes de añadir
    if (!this.map) {
      console.warn(`[LayerRegistry] Map is null, skipping add for ${layer.id}`);
      return false;
    }

    if (!this.map.isStyleLoaded()) {
      console.warn(`[LayerRegistry] Map style not loaded, skipping add for ${layer.id}`);
      return false;
    }

    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn(`[LayerRegistry] Style not ready (getSafeMapStyle returned null), skipping add for ${layer.id}`);
      return false;
    }

    // Añadir a la lista y ordenar
    this.layers.push(layer);
    this.layers.sort((a, b) => a.zIndex - b.zIndex);

    // Intentar añadir la capa al mapa (puede ser síncrono o async)
    try {
      const result = layer.add(this.map);
      // Si es una Promise, manejarla de forma asíncrona (no bloquear)
      if (result && typeof result === "object" && "then" in result) {
        result.catch((err) => {
          console.warn(`[LayerRegistry] Failed to add layer ${layer.id} (async)`, err);
        });
      }
      return true;
    } catch (err) {
      console.warn(`[LayerRegistry] Failed to add layer ${layer.id}`, err);
      return false;
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
