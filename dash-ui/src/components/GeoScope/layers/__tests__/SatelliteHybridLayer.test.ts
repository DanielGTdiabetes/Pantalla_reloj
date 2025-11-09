import { beforeEach, describe, expect, it, vi } from "vitest";
import type maplibregl from "maplibre-gl";

import SatelliteHybridLayer from "../SatelliteHybridLayer";

type AnyLayer = maplibregl.AnyLayer;

class FakeMap {
  sources = new Map<string, maplibregl.AnySourceData>();
  layers: AnyLayer[] = [];
  baseStyleLayers: AnyLayer[];
  addLayerCalls: AnyLayer[] = [];

  constructor() {
    this.baseStyleLayers = [
      { id: "background", type: "background" } as AnyLayer,
      {
        id: "road-label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        layout: { "text-field": "{name}" },
      } as AnyLayer,
    ];
  }

  asMap(): maplibregl.Map {
    return this as unknown as maplibregl.Map;
  }

  addSource(id: string, source: maplibregl.AnySourceData) {
    this.sources.set(id, source);
  }

  getSource(id: string) {
    return this.sources.get(id);
  }

  removeSource(id: string) {
    this.sources.delete(id);
  }

  addLayer(layer: AnyLayer, beforeId?: string) {
    this.addLayerCalls.push(layer);

    if (beforeId) {
      const index = this.layers.findIndex((item) => item.id === beforeId);
      if (index >= 0) {
        this.layers.splice(index, 0, layer);
      } else {
        this.layers.push(layer);
      }
    } else {
      this.layers.push(layer);
    }
  }

  getLayer(id: string) {
    return (
      this.layers.find((layer) => layer.id === id) ??
      this.baseStyleLayers.find((layer) => layer.id === id)
    );
  }

  removeLayer(id: string) {
    this.layers = this.layers.filter((layer) => layer.id !== id);
  }

  setPaintProperty() {
    // noop para tests
  }

  setLayoutProperty() {
    // noop para tests
  }

  moveLayer() {
    // noop para tests
  }

  getStyle() {
    return {
      layers: [...this.baseStyleLayers, ...this.layers],
    };
  }
}

describe("SatelliteHybridLayer", () => {
  let map: FakeMap;

  beforeEach(() => {
    map = new FakeMap();
  });

  it("no añade capas cuando está deshabilitada", () => {
    const layer = new SatelliteHybridLayer({ enabled: false, apiKey: "TEST" });
    layer.add(map.asMap());

    expect(map.getSource("geoscope-satellite-hybrid-raster-source")).toBeUndefined();
    expect(map.getLayer("geoscope-satellite-hybrid-raster-layer")).toBeUndefined();
  });

  it("añade source y layer raster cuando está habilitada con apiKey", () => {
    const layer = new SatelliteHybridLayer({ enabled: true, apiKey: "TEST" });
    layer.add(map.asMap());

    expect(map.getSource("geoscope-satellite-hybrid-raster-source")).toBeDefined();
    expect(map.getLayer("geoscope-satellite-hybrid-raster-layer")).toBeDefined();
  });

  it("avisa y no monta la capa si falta la apiKey", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const layer = new SatelliteHybridLayer({ enabled: true, apiKey: null });
    layer.add(map.asMap());

    expect(warnSpy).toHaveBeenCalledWith("[SatelliteHybrid] disabled (missing MapTiler key)");
    expect(map.getSource("geoscope-satellite-hybrid-raster-source")).toBeUndefined();
    warnSpy.mockRestore();
  });
});


