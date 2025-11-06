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
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "age_seconds"],
            0, 6,
            600, 6,
            1800, 4
          ],
          "circle-color": "#fcd34d",
          "circle-opacity": [
            "coalesce",
            ["get", "opacity"],
            0.65
          ],
          "circle-blur": [
            "interpolate",
            ["linear"],
            ["get", "age_seconds"],
            0, 0.35,
            600, 0.5,
            1800, 0.8
          ]
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
    
    // Aplicar decay temporal: reducir opacidad según la edad del strike
    const now = Date.now() / 1000; // timestamp en segundos
    const maxAgeSeconds = 1800; // 30 minutos máximo
    const decayStartSeconds = 600; // Empezar decay después de 10 minutos
    
    const processedFeatures = this.lastData.features.map((feature) => {
      if (!feature.properties || typeof feature.properties.timestamp !== "number") {
        return feature;
      }
      
      const ageSeconds = now - feature.properties.timestamp;
      
      // Si es muy antiguo, excluirlo completamente
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
