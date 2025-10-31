import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";
import { getExistingPopup, isGeoJSONSource } from "./layerUtils";

interface AircraftLayerOptions {
  enabled?: boolean;
  opacity?: number;
  maxAgeSeconds?: number;
  cineFocus?: {
    enabled: boolean;
    outsideDimOpacity: number;
    hardHideOutside: boolean;
  };
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class AircraftLayer implements Layer {
  public readonly id = "geoscope-aircraft";
  public readonly zIndex = 40;

  private enabled: boolean;
  private opacity: number;
  private maxAgeSeconds: number;
  private cineFocus?: AircraftLayerOptions["cineFocus"];
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-aircraft-source";

  constructor(options: AircraftLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 1.0;
    this.maxAgeSeconds = options.maxAgeSeconds ?? 120;
    this.cineFocus = options.cineFocus;
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
          "circle-radius": 5,
          "circle-color": "#f97316",
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 1,
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["get", "age_seconds"],
            0,
            [
              "case",
              ["get", "in_focus"],
              this.opacity,
              this.cineFocus?.enabled
                ? this.opacity * this.cineFocus.outsideDimOpacity
                : this.opacity
            ],
            this.maxAgeSeconds / 2,
            [
              "case",
              ["get", "in_focus"],
              this.opacity * 0.5,
              this.cineFocus?.enabled
                ? this.opacity * this.cineFocus.outsideDimOpacity * 0.5
                : this.opacity * 0.5
            ],
            this.maxAgeSeconds,
            0.0
          ]
        }
      });

      // Tooltip en hover
      let hoveredId: string | null = null;
      map.on("mouseenter", this.id, (e) => {
        if (e.features && e.features.length > 0) {
          map.getCanvas().style.cursor = "pointer";
          const feature = e.features[0];
          if (feature.properties) {
            hoveredId = feature.id as string;
            const callsign = feature.properties.callsign || "N/A";
            const alt = feature.properties.alt_baro || "N/A";
            const speed = feature.properties.speed ? `${Math.round(feature.properties.speed * 3.6)} km/h` : "N/A";
            const content = `<strong>${callsign}</strong><br/>Altitud: ${alt}m<br/>Velocidad: ${speed}`;
            
            // Crear popup si no existe
            if (!getExistingPopup(map)) {
              new maplibregl.Popup({ closeOnClick: false, closeButton: true })
                .setLngLat(e.lngLat)
                .setHTML(content)
                .addTo(map);
            }
          }
        }
      });

      map.on("mouseleave", this.id, () => {
        map.getCanvas().style.cursor = "";
        const popup = getExistingPopup(map);
        if (popup) {
          popup.remove();
        }
        hoveredId = null;
      });

      map.on("mousemove", this.id, (e) => {
        if (e.features && e.features.length > 0 && hoveredId) {
          const popup = getExistingPopup(map);
          if (popup) {
            popup.setLngLat(e.lngLat);
          }
        }
      });
    }

    this.applyVisibility();
    this.applyOpacity();
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

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
    this.applyOpacity();
  }

  setMaxAgeSeconds(seconds: number): void {
    this.maxAgeSeconds = seconds;
    // Necesitaría recargar el layer para actualizar la expresión de opacity
    if (this.map) {
      const data = this.getData();
      this.updateData(data);
    }
  }

  updateData(data: FeatureCollection): void {
    if (!this.map) return;
    
    // Calcular edad para cada feature y aplicar dimming según in_focus
    const now = Math.floor(Date.now() / 1000);
    const featuresWithAge = {
      ...data,
      features: data.features.map((feature) => {
        const props = feature.properties || {};
        const timestamp = props.timestamp || now;
        const ageSeconds = Math.max(0, now - timestamp);
        const inFocus = Boolean(props.in_focus);
        
        // Si hard_hide_outside está activado y no está en foco, ocultar
        if (this.cineFocus?.enabled && this.cineFocus.hardHideOutside && !inFocus) {
          return null; // Filtrar después
        }
        
        return {
          ...feature,
          properties: {
            ...props,
            age_seconds: ageSeconds,
            in_focus: inFocus
          }
        };
      }).filter((f): f is NonNullable<typeof f> => f !== null)
    };

    const source = this.map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      source.setData(featuresWithAge);
    }
  }

  getData(): FeatureCollection {
    if (!this.map) return EMPTY;
    const source = this.map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      return (source.getData() as FeatureCollection) ?? EMPTY;
    }
    return EMPTY;
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

  private applyOpacity() {
    if (!this.map || !this.map.getLayer(this.id)) return;
    // La opacidad se aplica en la expresión paint, pero podemos actualizar el maxAgeSeconds en la expresión
    // Por ahora, solo actualizamos la opacidad base si la expresión lo permite
    // En un futuro, podríamos hacer que la expresión use this.opacity directamente
  }
}
