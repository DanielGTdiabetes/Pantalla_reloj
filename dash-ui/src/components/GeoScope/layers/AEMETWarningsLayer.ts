import maplibregl from "maplibre-gl";
import type { MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";
import { getExistingPopup, isGeoJSONSource } from "./layerUtils";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { withSafeMapStyle } from "../../../lib/map/utils/safeMapOperations";

interface AEMETWarningsLayerOptions {
  enabled?: boolean;
  opacity?: number;
  minSeverity?: "minor" | "moderate" | "severe" | "extreme";
  refreshSeconds?: number;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

// Colores según severidad CAP
const SEVERITY_COLORS: Record<string, { fill: string; stroke: string }> = {
  extreme: { fill: "#8B0000", stroke: "#FFFFFF" },
  severe: { fill: "#FF4500", stroke: "#FFFFFF" },
  moderate: { fill: "#FFA500", stroke: "#000000" },
  minor: { fill: "#FFD700", stroke: "#000000" },
  unknown: { fill: "#808080", stroke: "#FFFFFF" },
};

const SEVERITY_ORDER: Record<string, number> = {
  minor: 1,
  moderate: 2,
  severe: 3,
  extreme: 4,
  unknown: 0,
};

const MIN_SEVERITY_ORDER: Record<string, number> = {
  minor: 1,
  moderate: 2,
  severe: 3,
  extreme: 4,
};

export default class AEMETWarningsLayer implements Layer {
  public readonly id = "geoscope-aemet-warnings";
  public readonly zIndex = 15; // Por encima de radar/satélite (10), debajo de vuelos (40)

  private enabled: boolean;
  private opacity: number;
  private minSeverity: AEMETWarningsLayerOptions["minSeverity"];
  private refreshSeconds: number;
  private map?: maplibregl.Map;
  private readonly sourceId = "geoscope-aemet-warnings-source";
  private lastData: FeatureCollection = EMPTY;
  private refreshTimer?: number;
  private eventsRegistered = false;
  private onMouseEnter?: (event: MapLayerMouseEvent) => void;
  private onMouseLeave?: (event: MapLayerMouseEvent) => void;
  private onMouseMove?: (event: MapLayerMouseEvent) => void;
  private hoveredFeatureId: string | null = null;

  constructor(options: AEMETWarningsLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.opacity = options.opacity ?? 0.6;
    this.minSeverity = options.minSeverity ?? "moderate";
    this.refreshSeconds = options.refreshSeconds ?? 900; // 15 minutos por defecto
  }

  add(map: maplibregl.Map): void {
    this.map = map;
    
    // Asegurar source
    this.ensureSource();
    
    // Asegurar layer
    this.ensureLayer();
    
    // Iniciar refresco periódico
    this.startRefresh();
    
    // Registrar eventos
    this.registerEvents(map);
    
    // Aplicar visibilidad
    this.applyVisibility();
  }

  remove(map: maplibregl.Map): void {
    this.stopRefresh();
    this.unregisterEvents(map);
    
    if (map.getLayer(`${this.id}-outline`)) {
      map.removeLayer(`${this.id}-outline`);
    }
    
    if (map.getLayer(this.id)) {
      map.removeLayer(this.id);
    }
    
    if (map.getSource(this.sourceId)) {
      map.removeSource(this.sourceId);
    }
    
    this.map = undefined;
  }

  destroy(): void {
    this.stopRefresh();
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

  setMinSeverity(severity: AEMETWarningsLayerOptions["minSeverity"]): void {
    this.minSeverity = severity ?? "moderate";
    this.updateData(this.lastData);
  }

  setRefreshSeconds(seconds: number): void {
    this.refreshSeconds = Math.max(60, Math.min(3600, seconds));
    this.stopRefresh();
    this.startRefresh();
  }

  /**
   * Asegura que la capa esté inicializada después de cambios de estilo.
   */
  async ensureWarningsLayer(): Promise<void> {
    if (!this.map || !this.enabled) {
      return;
    }

    this.ensureSource();
    this.ensureLayer();
    this.ensureLayerOrder();
    this.applyVisibility();
    
    // Recargar datos si es necesario
    if (this.lastData.features.length === 0) {
      await this.fetchWarnings();
    }
  }

  updateData(data: FeatureCollection): void {
    // Filtrar por severidad mínima
    const minOrder = MIN_SEVERITY_ORDER[this.minSeverity ?? "moderate"] ?? 2;
    const filteredFeatures = data.features.filter((feature) => {
      const props = feature.properties || {};
      const severity = String(props.severity || "unknown").toLowerCase();
      const severityOrder = SEVERITY_ORDER[severity] ?? 0;
      return severityOrder >= minOrder;
    });

    this.lastData = {
      ...data,
      features: filteredFeatures,
    };

    if (!this.map) {
      return;
    }

    const source = this.map.getSource(this.sourceId);
    if (isGeoJSONSource(source)) {
      source.setData(this.lastData);
    }
  }

  getData(): FeatureCollection {
    return this.lastData;
  }

  private ensureSource(): void {
    if (!this.map) {
      return;
    }

    if (!this.map.getSource(this.sourceId)) {
      const sourceAdded = withSafeMapStyle(
        this.map,
        () => {
          this.map!.addSource(this.sourceId, {
            type: "geojson",
            data: this.lastData,
            generateId: true,
          });
        },
        "AEMETWarningsLayer"
      );

      if (!sourceAdded) {
        console.warn("[AEMETWarningsLayer] Could not add source, style not ready");
      }
    }
  }

  private ensureLayer(): void {
    if (!this.map) {
      return;
    }

    if (!this.map.getLayer(this.id)) {
      const beforeId = this.findBeforeId();
      
      const layerAdded = withSafeMapStyle(
        this.map,
        () => {
          // Capa de relleno (fill)
          this.map!.addLayer({
            id: this.id,
            type: "fill",
            source: this.sourceId,
            paint: {
              "fill-color": [
                "case",
                ["==", ["get", "severity"], "extreme"],
                SEVERITY_COLORS.extreme.fill,
                ["==", ["get", "severity"], "severe"],
                SEVERITY_COLORS.severe.fill,
                ["==", ["get", "severity"], "moderate"],
                SEVERITY_COLORS.moderate.fill,
                ["==", ["get", "severity"], "minor"],
                SEVERITY_COLORS.minor.fill,
                SEVERITY_COLORS.unknown.fill,
              ],
              "fill-opacity": this.opacity * 0.4,
              "fill-outline-color": [
                "case",
                ["==", ["get", "severity"], "extreme"],
                SEVERITY_COLORS.extreme.stroke,
                ["==", ["get", "severity"], "severe"],
                SEVERITY_COLORS.severe.stroke,
                ["==", ["get", "severity"], "moderate"],
                SEVERITY_COLORS.moderate.stroke,
                ["==", ["get", "severity"], "minor"],
                SEVERITY_COLORS.minor.stroke,
                SEVERITY_COLORS.unknown.stroke,
              ],
            },
          }, beforeId);

          // Capa de contorno (line) para mejor visibilidad
          this.map!.addLayer({
            id: `${this.id}-outline`,
            type: "line",
            source: this.sourceId,
            paint: {
              "line-color": [
                "case",
                ["==", ["get", "severity"], "extreme"],
                SEVERITY_COLORS.extreme.stroke,
                ["==", ["get", "severity"], "severe"],
                SEVERITY_COLORS.severe.stroke,
                ["==", ["get", "severity"], "moderate"],
                SEVERITY_COLORS.moderate.stroke,
                ["==", ["get", "severity"], "minor"],
                SEVERITY_COLORS.minor.stroke,
                SEVERITY_COLORS.unknown.stroke,
              ],
              "line-width": 2,
              "line-opacity": this.opacity,
            },
          }, beforeId);
        },
        "AEMETWarningsLayer"
      );

      if (!layerAdded) {
        console.warn("[AEMETWarningsLayer] Could not add layers, style not ready");
      }
    }
  }

  private findBeforeId(): string | undefined {
    if (!this.map) {
      return undefined;
    }

    const style = getSafeMapStyle(this.map);
    if (!style || !Array.isArray(style.layers)) {
      return undefined;
    }

    // Buscar capas de vuelos o barcos para colocar warnings antes
    for (const layer of style.layers) {
      const layerId = (layer.id || "").toLowerCase();
      if (
        layerId.includes("aircraft") ||
        layerId.includes("ships") ||
        layerId.includes("flight") ||
        layerId.includes("ship")
      ) {
        return layer.id;
      }
    }

    return undefined;
  }

  private ensureLayerOrder(): void {
    if (!this.map) {
      return;
    }

    const beforeId = this.findBeforeId();
    if (!beforeId) {
      // Mover al tope si no se encuentra referencia
      try {
        const style = getSafeMapStyle(this.map);
        const layers = Array.isArray(style?.layers) ? (style!.layers as Array<{ id?: string }>) : [];
        if (Array.isArray(layers) && layers.length > 0) {
          const lastLayer = layers[layers.length - 1] as { id?: string } | undefined;
          if (lastLayer && lastLayer.id !== this.id) {
            this.map.moveLayer(this.id, lastLayer.id);
            this.map.moveLayer(`${this.id}-outline`, lastLayer.id);
          }
        }
      } catch (error) {
        // Ignorar errores de orden
      }
    }
  }

  private applyVisibility(): void {
    if (!this.map) {
      return;
    }

    const visibility = this.enabled ? "visible" : "none";
    
    if (this.map.getLayer(this.id)) {
      this.map.setLayoutProperty(this.id, "visibility", visibility);
    }
    
    if (this.map.getLayer(`${this.id}-outline`)) {
      this.map.setLayoutProperty(`${this.id}-outline`, "visibility", visibility);
    }
  }

  private applyOpacity(): void {
    if (!this.map) {
      return;
    }

    if (this.map.getLayer(this.id)) {
      this.map.setPaintProperty(this.id, "fill-opacity", this.opacity * 0.4);
    }

    if (this.map.getLayer(`${this.id}-outline`)) {
      this.map.setPaintProperty(`${this.id}-outline`, "line-opacity", this.opacity);
    }
  }

  private async fetchWarnings(): Promise<void> {
    try {
      const response = await fetch("/api/aemet/warnings");
      if (!response.ok) {
        console.warn("[AEMETWarningsLayer] Failed to fetch warnings:", response.status);
        return;
      }

      const data = await response.json() as FeatureCollection;
      this.updateData(data);
    } catch (error) {
      console.error("[AEMETWarningsLayer] Error fetching warnings:", error);
    }
  }

  private startRefresh(): void {
    this.stopRefresh();
    
    if (this.refreshSeconds <= 0) {
      return;
    }

    // Cargar datos iniciales
    void this.fetchWarnings();

    // Refrescar periódicamente
    this.refreshTimer = window.setInterval(() => {
      void this.fetchWarnings();
    }, this.refreshSeconds * 1000) as unknown as number;
  }

  private stopRefresh(): void {
    if (this.refreshTimer !== undefined) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private registerEvents(map: maplibregl.Map): void {
    if (this.eventsRegistered) {
      return;
    }

    this.onMouseEnter = (event) => {
      const features = Array.isArray(event.features) ? event.features : [];
      if (features.length === 0) {
        return;
      }

      map.getCanvas().style.cursor = "pointer";
      const feature = features[0];
      if (!feature.properties) {
        return;
      }

      this.hoveredFeatureId = feature.id as string;
      const severity = String(feature.properties.severity || "unknown").toUpperCase();
      const status = String(feature.properties.status || "unknown").toUpperCase();
      const event_name = String(feature.properties.event || "Unknown");
      
      const content = `<strong>Aviso AEMET</strong><br/>
        <strong>Severidad:</strong> ${severity}<br/>
        <strong>Estado:</strong> ${status}<br/>
        <strong>Evento:</strong> ${event_name}`;

      if (!getExistingPopup(map)) {
        if (event.lngLat && typeof event.lngLat === "object" && "lng" in event.lngLat && "lat" in event.lngLat) {
          new maplibregl.Popup({ closeOnClick: false, closeButton: true })
            .setLngLat(event.lngLat as { lng: number; lat: number })
            .setHTML(content)
            .addTo(map);
        }
      }
    };

    this.onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      const popup = getExistingPopup(map);
      if (popup) {
        popup.remove();
      }
      this.hoveredFeatureId = null;
    };

    this.onMouseMove = (event) => {
      const features = Array.isArray(event.features) ? event.features : [];
      if (features.length === 0 || !this.hoveredFeatureId) {
        return;
      }

      const popup = getExistingPopup(map);
      if (popup && event.lngLat && typeof event.lngLat === "object" && "lng" in event.lngLat && "lat" in event.lngLat) {
        popup.setLngLat(event.lngLat as { lng: number; lat: number });
      }
    };

    map.on("mouseenter", this.id, this.onMouseEnter as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mouseleave", this.id, this.onMouseLeave as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mousemove", this.id, this.onMouseMove as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    
    map.on("mouseenter", `${this.id}-outline`, this.onMouseEnter as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mouseleave", `${this.id}-outline`, this.onMouseLeave as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    map.on("mousemove", `${this.id}-outline`, this.onMouseMove as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    
    this.eventsRegistered = true;
  }

  private unregisterEvents(map: maplibregl.Map): void {
    if (!this.eventsRegistered) {
      return;
    }

    if (this.onMouseEnter) {
      map.off("mouseenter", this.id, this.onMouseEnter as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
      map.off("mouseenter", `${this.id}-outline`, this.onMouseEnter as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }

    if (this.onMouseLeave) {
      map.off("mouseleave", this.id, this.onMouseLeave as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
      map.off("mouseleave", `${this.id}-outline`, this.onMouseLeave as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }

    if (this.onMouseMove) {
      map.off("mousemove", this.id, this.onMouseMove as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
      map.off("mousemove", `${this.id}-outline`, this.onMouseMove as unknown as (ev: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void);
    }

    const popup = getExistingPopup(map);
    if (popup) {
      popup.remove();
    }

    map.getCanvas().style.cursor = "";
    this.hoveredFeatureId = null;
    this.onMouseEnter = undefined;
    this.onMouseLeave = undefined;
    this.onMouseMove = undefined;
    this.eventsRegistered = false;
  }
}

