import { Map as MaptilerMap } from "@maptiler/sdk";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";

export interface Layer {
  id: string;
  zIndex: number;
  add(map: MaptilerMap): void | Promise<void>;
  remove(map: MaptilerMap): void;
  setEnabled?(on: boolean): void;
  destroy?(): void;
}

export class LayerRegistry {
  private map: MaptilerMap;
  private layers: Layer[] = [];

  constructor(map: MaptilerMap) {
    this.map = map;
  }

  get(layerId: string): Layer | undefined {
    return this.layers.find((layer) => layer.id === layerId);
  }

  register(layerId: string, layer: Layer): boolean {
    if (layer.id !== layerId) {
      console.warn(`[LayerRegistry] Layer id mismatch (expected ${layerId}, got ${layer.id}), continuing with provided id`);
    }

    if (this.get(layerId)) {
      console.warn(`[LayerRegistry] Layer ${layerId} already exists in registry, skipping register`);
      return false;
    }

    return this.add(layer);
  }

  /**
   * Espera a que el estilo del mapa esté disponible.
   * Si ya está disponible, resuelve inmediatamente.
   * Si no, espera al evento 'styledata' una vez.
   */
  private async ensureMapStyleLoaded(): Promise<void> {
    const style = getSafeMapStyle(this.map);
    if (style) {
      return;
    }

    // Espera a styledata una sola vez, sin bloquear la app
    return new Promise<void>((resolve) => {
      const onStyleData = () => {
        this.map.off("styledata", onStyleData);
        resolve();
      };

      this.map.once("styledata", onStyleData);
    });
  }

  /**
   * Añade una capa al registro y al mapa.
   * Si el estilo no está disponible, espera a que esté disponible antes de añadir.
   * 
   * @param layer - La capa a añadir
   * @returns true si la capa se añadió (o se está añadiendo de forma asíncrona), false si hay un error crítico
   */
  add(layer: Layer): boolean {
    // Validaciones básicas
    if (!this.map) {
      console.warn(`[LayerRegistry] Map is null, skipping add for ${layer.id}`);
      return false;
    }

    // Verificar si el estilo ya está disponible
    const style = getSafeMapStyle(this.map);
    const styleLoaded = !!style;

    if (!styleLoaded) {
      // El estilo no está disponible, pero NO hacemos return false.
      // En su lugar, esperamos al estilo de forma asíncrona y luego añadimos la capa.
      console.log(`[LayerRegistry] Map style not yet available, waiting for styledata before adding ${layer.id}`);
      
      // Iniciar el proceso de espera y añadido de forma asíncrona
      void this.ensureMapStyleLoaded().then(() => {
        // Una vez que el estilo está disponible, añadir la capa
        this.addLayerToMap(layer);
      }).catch((err) => {
        console.warn(`[LayerRegistry] Failed to wait for style for layer ${layer.id}:`, err);
      });

      // Retornar true porque hemos iniciado el proceso de añadido
      return true;
    }

    // El estilo está disponible, añadir inmediatamente
    return this.addLayerToMap(layer);
  }

  /**
   * Añade la capa al registro y al mapa (asume que el estilo ya está disponible).
   * Este método es llamado internamente después de asegurar que el estilo está cargado.
   */
  private addLayerToMap(layer: Layer): boolean {
    // Verificar que la capa no esté ya en el registro
    if (this.layers.some((l) => l.id === layer.id)) {
      console.warn(`[LayerRegistry] Layer ${layer.id} already exists in registry, skipping add`);
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
        result
          .then(() => {
            console.log(`[LayerRegistry] Added layer ${layer.id} successfully`);
          })
          .catch((err) => {
            console.warn(`[LayerRegistry] Failed to add layer ${layer.id} (async)`, err);
          });
      } else {
        console.log(`[LayerRegistry] Added layer ${layer.id} successfully`);
      }
      return true;
    } catch (err) {
      console.warn(`[LayerRegistry] Failed to add layer ${layer.id}`, err);
      // Remover de la lista si falló
      const index = this.layers.findIndex((l) => l.id === layer.id);
      if (index !== -1) {
        this.layers.splice(index, 1);
      }
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
