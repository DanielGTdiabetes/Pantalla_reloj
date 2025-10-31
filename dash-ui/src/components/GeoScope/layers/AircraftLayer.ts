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
  cluster?: boolean;
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
  private lastData: FeatureCollection = EMPTY;
  private clusterEnabled: boolean;
  private readonly clusterLayerId: string;
  private readonly clusterCountLayerId: string;

  constructor(options: AircraftLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 1.0;
    this.maxAgeSeconds = options.maxAgeSeconds ?? 120;
    this.cineFocus = options.cineFocus;
    this.clusterEnabled = options.cluster ?? false;
    this.clusterLayerId = `${this.id}-clusters`;
    this.clusterCountLayerId = `${this.id}-cluster-count`;
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    this.ensureSource();
    this.ensureLayers();
    this.applyVisibility();
    this.applyOpacity();

    let hoveredId: string | null = null;
    map.on("mouseenter", this.id, (event) => {
      if (event.features && event.features.length > 0) {
        map.getCanvas().style.cursor = "pointer";
        const feature = event.features[0];
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        hoveredId = feature.id as string;
        const callsign = (properties.callsign as string | undefined)?.trim();
        const icao24 = (properties.icao24 as string | undefined)?.trim();
        const altitude = typeof properties.alt_baro === "number" ? Math.round(properties.alt_baro as number) : null;
        const speed = typeof properties.speed === "number" ? (properties.speed as number) : null;
        const origin = (properties.origin_country as string | undefined) ?? "N/A";
        const timestamp = (properties.timestamp as number | undefined) ?? (properties.last_contact as number | undefined);
        const nowSeconds = Math.floor(Date.now() / 1000);
        const age = typeof timestamp === "number" ? Math.max(0, nowSeconds - timestamp) : null;
        const content = `
          <strong>${callsign || icao24 || "Sin identificador"}</strong><br/>
          ICAO24: ${icao24 || "N/A"}<br/>
          Altitud: ${altitude !== null ? `${altitude} m` : "N/A"}<br/>
          Velocidad: ${speed !== null ? `${Math.round(speed)} m/s (${Math.round(speed * 3.6)} km/h)` : "N/A"}<br/>
          País: ${origin}<br/>
          Último contacto: ${age !== null ? `hace ${age}s` : "sin datos"}
        `;

        if (!getExistingPopup(map)) {
          new maplibregl.Popup({ closeOnClick: false, closeButton: true })
            .setLngLat(event.lngLat)
            .setHTML(content)
            .addTo(map);
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

    map.on("mousemove", this.id, (event) => {
      if (event.features && event.features.length > 0 && hoveredId) {
        const popup = getExistingPopup(map);
        if (popup) {
          popup.setLngLat(event.lngLat);
        }
      }
    });
  }

  private ensureSource(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;
    const existing = map.getSource(this.sourceId);
    const expectedCluster = this.clusterEnabled;
    if (existing) {
      const anySource = existing as maplibregl.GeoJSONSource & { cluster?: boolean };
      const isCluster = Boolean(anySource.cluster);
      if (isCluster !== expectedCluster) {
        this.removeLayers(map);
        map.removeSource(this.sourceId);
      }
    }

    if (!map.getSource(this.sourceId)) {
      const sourceInit: maplibregl.GeoJSONSourceRaw = {
        type: "geojson",
        data: this.lastData,
      };
      if (expectedCluster) {
        sourceInit.cluster = true;
        sourceInit.clusterRadius = 40;
        sourceInit.clusterMaxZoom = 10;
      }
      map.addSource(this.sourceId, sourceInit);
    } else {
      const source = map.getSource(this.sourceId);
      if (isGeoJSONSource(source)) {
        source.setData(this.lastData);
      }
    }
  }

  private ensureLayers(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;
    this.removeLayers(map);

    if (this.clusterEnabled) {
      if (!map.getLayer(this.clusterLayerId)) {
        map.addLayer({
          id: this.clusterLayerId,
          type: "circle",
          source: this.sourceId,
          filter: ["has", "point_count"],
          paint: {
            "circle-radius": 18,
            "circle-color": "rgba(249,115,22,0.7)",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#111827",
          },
        });
      }

      if (!map.getLayer(this.clusterCountLayerId)) {
        map.addLayer({
          id: this.clusterCountLayerId,
          type: "symbol",
          source: this.sourceId,
          filter: ["has", "point_count"],
          layout: {
            "text-field": "{point_count_abbreviated}",
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 12,
          },
          paint: {
            "text-color": "#ffffff",
          },
        });
      }
    }

    if (!map.getLayer(this.id)) {
      map.addLayer({
        id: this.id,
        type: "symbol",
        source: this.sourceId,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": "airport-15",
          "icon-size": 1.2,
          "icon-allow-overlap": true,
          "icon-rotate": ["coalesce", ["get", "track"], 0],
          "icon-rotation-alignment": "map",
        },
        paint: {
          "icon-color": "#f97316",
          "icon-halo-color": "#111827",
          "icon-halo-width": 0.25,
        },
      });
    }
  }

  private removeLayers(map: maplibregl.Map): void {
    if (map.getLayer(this.clusterCountLayerId)) {
      map.removeLayer(this.clusterCountLayerId);
    }
    if (map.getLayer(this.clusterLayerId)) {
      map.removeLayer(this.clusterLayerId);
    }
    if (map.getLayer(this.id)) {
      map.removeLayer(this.id);
    }
  }

  private getOpacityExpression(): maplibregl.Expression {
    return [
      "interpolate",
      ["linear"],
      ["get", "age_seconds"],
      0,
      [
        "case",
        ["get", "in_focus"],
        this.opacity,
        this.cineFocus?.enabled ? this.opacity * this.cineFocus.outsideDimOpacity : this.opacity,
      ],
      this.maxAgeSeconds / 2,
      [
        "case",
        ["get", "in_focus"],
        this.opacity * 0.5,
        this.cineFocus?.enabled
          ? this.opacity * this.cineFocus.outsideDimOpacity * 0.5
          : this.opacity * 0.5,
      ],
      this.maxAgeSeconds,
      0.0,
    ];
  }

  setCluster(enabled: boolean): void {
    if (this.clusterEnabled === enabled) {
      return;
    }
    this.clusterEnabled = enabled;
    if (this.map) {
      const map = this.map;
      this.removeLayers(map);
      if (map.getSource(this.sourceId)) {
        map.removeSource(this.sourceId);
      }
      this.ensureSource();
      this.ensureLayers();
      this.applyVisibility();
      this.applyOpacity();
    }
  }

  remove(map: maplibregl.Map): void {
    this.removeLayers(map);
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
    this.applyOpacity();
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
    if (this.map.getLayer(this.clusterLayerId)) {
      this.map.setLayoutProperty(this.clusterLayerId, "visibility", visibility);
    }
    if (this.map.getLayer(this.clusterCountLayerId)) {
      this.map.setLayoutProperty(this.clusterCountLayerId, "visibility", visibility);
    }
  }

  private applyOpacity() {
    if (!this.map || !this.map.getLayer(this.id)) return;
    const expression = this.getOpacityExpression();
    this.map.setPaintProperty(this.id, "icon-opacity", expression);
    if (this.map.getLayer(this.clusterLayerId)) {
      this.map.setPaintProperty(this.clusterLayerId, "circle-opacity", this.opacity);
    }
    if (this.map.getLayer(this.clusterCountLayerId)) {
      this.map.setPaintProperty(this.clusterCountLayerId, "text-opacity", this.opacity);
    }
  }
}
