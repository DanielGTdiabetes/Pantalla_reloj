import { Map as MaptilerMap } from "@maptiler/sdk";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";
import { isGeoJSONSource } from "./layerUtils";

import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { withSafeMapStyle, waitForStyleLoaded } from "../../../lib/map/utils/safeMapOperations";

interface LightningLayerOptions {
  enabled?: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class LightningLayer implements Layer {
  public readonly id = "geoscope-lightning";
  public readonly zIndex = 50;

  private enabled: boolean;
  private map?: MaptilerMap;
  private readonly sourceId = "geoscope-lightning-source";
  private lastData: FeatureCollection = EMPTY;
  private refreshTimer?: number;
  private refreshSeconds = 15; // 15 seconds refresh for lightning is good

  constructor(options: LightningLayerOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  add(map: MaptilerMap): void | Promise<void> {
    this.map = map;

    // Start fetching data
    this.startRefresh();

    // Inicializar la capa de forma asíncrona
    if (this.enabled) {
      return this.ensureLightningLayer();
    }
  }

  /**
   * Asegura que la capa esté inicializada después de que el estilo esté listo.
   */
  async ensureLightningLayer(): Promise<void> {
    if (!this.map || !this.enabled) {
      return;
    }

    // Esperar a que el estilo esté listo
    const styleReady = await waitForStyleLoaded(this.map, 15000);
    if (!styleReady) {
      console.warn("[LightningLayer] Timeout waiting for style, will retry on next call");
      return;
    }

    const map = this.map;

    withSafeMapStyle(
      map,
      () => {
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
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "age_seconds"],
                0, 16,     // Flash grande al inicio
                1, 10,     // Reduce rápido
                600, 6     // Tamaño estable
              ],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "age_seconds"],
                0, "#FFFFFF",  // Blanco brillante (flash)
                2, "#FFD700",  // Amarillo eléctrico
                600, "#FFA500" // Naranja al envejecer
              ],
              "circle-opacity": [
                "interpolate",
                ["linear"],
                ["get", "age_seconds"],
                0, 1.0,
                600, 0.6
              ],
              "circle-blur": [
                "interpolate",
                ["linear"],
                ["get", "age_seconds"],
                0, 0.2,
                600, 0.5
              ]
            }
          });
        }
      },
      "LightningLayer"
    );

    this.applyVisibility();

    // Fetch initial data if empty
    if (this.lastData.features.length === 0) {
      this.fetchLightning();
    }
  }

  remove(map: MaptilerMap): void {
    this.stopRefresh();
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
    if (on) {
      this.startRefresh();
    } else {
      this.stopRefresh();
    }
  }

  private async fetchLightning(): Promise<void> {
    try {
      // Optional: pass bbox if needed, but for lightning global/regional is often fine.
      // If map is available, use map bounds?
      let url = "/api/layers/lightning";
      /*
      if (this.map) {
          const bounds = this.map.getBounds();
          const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
          url += `?bbox=${bbox}`;
      }
      */

      const response = await fetch(url);
      if (!response.ok) return; // Silent fail
      const data = await response.json() as FeatureCollection;
      this.updateData(data);
    } catch (e) {
      console.warn("[LightningLayer] fetch failed", e);
    }
  }

  private startRefresh(): void {
    this.stopRefresh();
    this.fetchLightning();
    this.refreshTimer = window.setInterval(() => this.fetchLightning(), this.refreshSeconds * 1000);
  }

  private stopRefresh(): void {
    if (this.refreshTimer !== undefined) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  updateData(data: FeatureCollection): void {
    this.lastData = data ?? EMPTY;

    // Aplicar decay temporal: reducir opacidad según la edad del strike
    const now = Date.now() / 1000; // timestamp en segundos
    const maxAgeSeconds = 1800; // 30 minutos máximo
    const decayStartSeconds = 600; // Empezar decay después de 10 minutos

    const processedFeatures = this.lastData.features.map((feature) => {
      if (!feature.properties || typeof feature.properties.timestamp !== "number") {
        return feature;
      }

      const ageSeconds = now - feature.properties.timestamp;

      // Si es muy antiguo, excluirlo completamente (backend prune_seconds might handle this too)
      if (ageSeconds > maxAgeSeconds) {
        return null;
      }

      // Calcular opacidad basada en edad
      let opacity = 0.65; // Opacidad base
      if (ageSeconds > decayStartSeconds) {
        // Decay lineal desde decayStartSeconds hasta maxAgeSeconds
        const decayProgress = (ageSeconds - decayStartSeconds) / (maxAgeSeconds - decayStartSeconds);
        opacity = 0.65 * (1 - decayProgress);
        opacity = Math.max(0.1, opacity); // Mínimo 10% de opacidad
      }

      return {
        ...feature,
        properties: {
          ...feature.properties,
          opacity,
          age_seconds: ageSeconds
        }
      };
    }).filter((f): f is typeof this.lastData.features[0] => f !== null);

    const processedData: FeatureCollection = {
      type: "FeatureCollection",
      features: processedFeatures
    };

    // Update local state is not enough if we filtered results, we should keep original data for next refresh?
    // Actually fetch gets fresh data. So filtering here only affects display.

    if (!this.map) return;
    const source = this.map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      source.setData(processedData);
    }
  }

  getData(): FeatureCollection {
    return this.lastData;
  }

  destroy(): void {
    this.stopRefresh();
    this.map = undefined;
  }

  private applyVisibility() {
    if (!this.map) return;
    const style = getSafeMapStyle(this.map);
    if (!style) {
      console.warn("[LightningLayer] Style not ready, skipping");
      return;
    }
    const visibility = this.enabled ? "visible" : "none";
    if (this.map.getLayer(this.id)) {
      try {
        this.map.setLayoutProperty(this.id, "visibility", visibility);
      } catch (e) {
        console.warn("[LightningLayer] layout skipped:", e);
      }
    }
  }
}
