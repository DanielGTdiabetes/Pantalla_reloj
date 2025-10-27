import L from "leaflet";
import type { FeatureCollection } from "geojson";

import type { Layer } from "./LayerRegistry";

interface CyclonesLayerOptions {
  enabled?: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export default class CyclonesLayer implements Layer {
  public readonly id = "geoscope-cyclones";
  public readonly zIndex = 20;

  private enabled: boolean;
  private map?: L.Map;
  private layer?: L.GeoJSON;
  private paneName?: string;

  constructor(options: CyclonesLayerOptions = {}) {
    this.enabled = options.enabled ?? false;
  }

  add(map: L.Map): void {
    this.map = map;
    const paneName = this.ensurePane(map);

    if (!this.layer) {
      this.layer = L.geoJSON(EMPTY, {
        pane: paneName,
        style: {
          color: "#34d399",
          weight: 2,
          dashArray: "4 4"
        }
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
    this.layer?.remove();
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
