import L from "leaflet";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";

interface ShipsLayerOptions {
  enabled?: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class ShipsLayer implements Layer {
  public readonly id = "geoscope-ships";
  public readonly zIndex = 30;

  private enabled: boolean;
  private map?: L.Map;
  private layer?: L.GeoJSON;
  private paneName?: string;

  constructor(options: ShipsLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
  }

  add(map: L.Map): void {
    this.map = map;
    const paneName = this.ensurePane(map);

    if (!this.layer) {
      this.layer = L.geoJSON(EMPTY, {
        pane: paneName,
        pointToLayer: (_, latlng) =>
          L.circleMarker(latlng, {
            radius: 4,
            color: "#38bdf8",
            weight: 1,
            fillColor: "#38bdf8",
            fillOpacity: 0.85
          })
      });
    }

    this.applyVisibility();
  }

  remove(map: L.Map): void {
    if (this.layer && map.hasLayer(this.layer)) {
      map.removeLayer(this.layer);
    }
    this.removePane(map);
    this.map = undefined;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVisibility();
  }

  destroy(): void {
    this.layer = undefined;
    this.map = undefined;
    this.paneName = undefined;
  }

  private applyVisibility() {
    if (!this.map || !this.layer) return;
    const shouldShow = this.enabled;
    if (shouldShow && !this.map.hasLayer(this.layer)) {
      this.layer.addTo(this.map);
    } else if (!shouldShow && this.map.hasLayer(this.layer)) {
      this.map.removeLayer(this.layer);
    }
  }

  private ensurePane(map: L.Map) {
    if (!this.paneName) {
      const paneName = `${this.id}-pane`;
      const pane = map.getPane(paneName) ?? map.createPane(paneName);
      pane.style.zIndex = String(300 + this.zIndex);
      this.paneName = paneName;
    }
    return this.paneName;
  }

  private removePane(map: L.Map) {
    if (!this.paneName) return;
    const pane = map.getPane(this.paneName);
    if (pane?.parentElement) {
      pane.parentElement.removeChild(pane);
    }
    this.paneName = undefined;
  }
}
