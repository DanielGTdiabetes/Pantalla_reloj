import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import GeoScopeLayerOrder from "./layerOrder";
import type { Layer } from "./LayerRegistry";
import { getExistingPopup, isGeoJSONSource } from "./layerUtils";

interface ShipsLayerOptions {
  enabled?: boolean;
  opacity?: number;
  maxAgeSeconds?: number;
  cineFocus?: {
    enabled: boolean;
    outsideDimOpacity: number;
    hardHideOutside: boolean;
  };
  styleScale?: number;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class ShipsLayer implements Layer {
  public readonly id = "geoscope-ships";
  public readonly zIndex = GeoScopeLayerOrder.Ships;

  private enabled: boolean;
  private opacity: number;
  private maxAgeSeconds: number;
  private cineFocus?: ShipsLayerOptions["cineFocus"];
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-ships-source";
  private lastData: FeatureCollection = EMPTY;
  private styleScale: number;

  constructor(options: ShipsLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 1.0;
    this.maxAgeSeconds = options.maxAgeSeconds ?? 180;
    this.cineFocus = options.cineFocus;
    this.styleScale = options.styleScale ?? 1.0;
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
          "circle-radius": this.getCircleRadiusExpression(),
          "circle-color": "#38bdf8",
          "circle-stroke-color": "#0f172a",
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
            const name = feature.properties.name || feature.properties.mmsi || "N/A";
            const mmsi = feature.properties.mmsi || "N/A";
            const speed = feature.properties.speed ? `${Math.round(feature.properties.speed)} knots` : "N/A";
            const course = feature.properties.course ? `${Math.round(feature.properties.course)}°` : "N/A";
            const timestamp = feature.properties.timestamp 
              ? new Date(feature.properties.timestamp * 1000).toLocaleTimeString()
              : "N/A";
            const content = `<strong>${name}</strong><br/>MMSI: ${mmsi}<br/>Velocidad: ${speed}<br/>Curso: ${course}<br/>Última actualización: ${timestamp}`;
            
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
    this.applyStyleScale();
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

  private getCircleRadiusExpression(): maplibregl.ExpressionSpecification {
    const baseRadius = 5;
    const scale = Math.max(0.1, Math.min(this.styleScale, 4));
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      baseRadius,
      3,
      baseRadius * scale,
      4,
      baseRadius,
      22,
      baseRadius,
    ];
  }

  private applyStyleScale(): void {
    if (!this.map) {
      return;
    }
    if (this.map.getLayer(this.id)) {
      this.map.setPaintProperty(this.id, "circle-radius", this.getCircleRadiusExpression());
    }
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

  setStyleScale(scale: number): void {
    const clamped = Math.max(0.1, Math.min(scale, 4));
    if (this.styleScale === clamped) {
      return;
    }
    this.styleScale = clamped;
    this.applyStyleScale();
  }

  updateData(data: FeatureCollection): void {
    // Calcular edad para cada feature y aplicar dimming según in_focus
    const now = Math.floor(Date.now() / 1000);
    const featuresWithAge = {
      ...data,
      features: data.features
        .map((feature) => {
          const props = feature.properties || {};
          const timestamp = props.timestamp || now;
          const ageSeconds = Math.max(0, now - timestamp);
          const inFocus = Boolean(props.in_focus);
          const isStale = props.stale === true;

          // Si hard_hide_outside está activado y no está en foco, ocultar
          if (this.cineFocus?.enabled && this.cineFocus.hardHideOutside && !inFocus) {
            return null; // Filtrar después
          }

          return {
            ...feature,
            properties: {
              ...props,
              age_seconds: ageSeconds,
              in_focus: inFocus,
              stale: isStale ? true : undefined
            }
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
    };

    this.lastData = featuresWithAge;

    if (!this.map) return;

    const source = this.map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      source.setData(this.lastData);
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

  private applyOpacity() {
    if (!this.map || !this.map.getLayer(this.id)) return;
    // La opacidad se aplica en la expresión paint
  }
}
