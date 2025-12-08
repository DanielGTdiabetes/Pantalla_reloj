import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { FeatureCollection } from "geojson";

import WeatherLayer from "../WeatherLayer";
import { layerDiagnostics } from "../LayerDiagnostics";

type MapSource = { type?: string; setData?: (data: FeatureCollection) => void };

class FakeMap {
  private source: MapSource | undefined;

  asMap(): any {
    return this as any;
  }

  getSource(): MapSource | undefined {
    return this.source;
  }

  setSource(source: MapSource) {
    this.source = source;
  }

  getLayer() {
    return undefined;
  }

  addSource() {
    // noop for tests
  }

  addLayer() {
    // noop for tests
  }
}

const SAMPLE_DATA: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {},
    },
  ],
};

describe("WeatherLayer defensive behaviour", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it("no registra errores cuando la source no existe", () => {
    const recordErrorSpy = vi.spyOn(layerDiagnostics, "recordError");
    const map = new FakeMap();
    const layer = new WeatherLayer({ enabled: true, refreshSeconds: 0, provider: "cap_aemet" });

    (layer as any).map = map.asMap();
    layer.updateData(SAMPLE_DATA);

    expect(recordErrorSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    recordErrorSpy.mockRestore();
  });

  it("salta updateData si la source no es GeoJSON sin disparar errores", () => {
    const recordErrorSpy = vi.spyOn(layerDiagnostics, "recordError");
    const map = new FakeMap();
    map.setSource({ type: "raster" });

    const layer = new WeatherLayer({ enabled: true, refreshSeconds: 0, provider: "cap_aemet" });
    (layer as any).map = map.asMap();

    layer.updateData(SAMPLE_DATA);

    expect(recordErrorSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    recordErrorSpy.mockRestore();
  });

  it("desactiva comportamiento GeoJSON para provider maptiler_weather", () => {
    const recordErrorSpy = vi.spyOn(layerDiagnostics, "recordError");
    const layer = new WeatherLayer({ enabled: true, refreshSeconds: 0, provider: "maptiler_weather" });

    layer.updateData(SAMPLE_DATA);

    expect(recordErrorSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    recordErrorSpy.mockRestore();
  });
});
