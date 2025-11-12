import maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";
import type {
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";

import { signMapTilerUrl } from "../../map/utils/maptilerHelpers";
import {
  DEFAULT_LABELS_STYLE_URL,
  clampLabelsOpacity,
  normalizeLabelsOverlay,
  type NormalizedLabelsOverlay,
} from "../labelsOverlay";

type VectorLabelsState = {
  styleUrl: string;
  layerIds: Array<{ id: string; type: LayerSpecification["type"] }>;
  sourceId: string;
  layerFilter: string | null;
  opacity: number;
};

const VECTOR_LABELS_SOURCE_ID = "pantalla-vector-labels-source";
const VECTOR_LABELS_LAYER_PREFIX = "pantalla-vector-labels-layer-";
const VECTOR_LABELS_STATE_KEY = "__pantallaVectorLabelsState";
const OVERLAY_LAYER_PREFERENCE = [
  "geoscope-global-radar",
  "geoscope-global-satellite",
  "geoscope-weather",
  "geoscope-aemet-warnings",
  "geoscope-lightning",
  "geoscope-aircraft",
  "geoscope-ships",
];

type MapWithVectorLabelsState = Map & {
  [VECTOR_LABELS_STATE_KEY]?: VectorLabelsState;
};

const getOverlayState = (map: Map): VectorLabelsState | undefined => {
  return (map as MapWithVectorLabelsState)[VECTOR_LABELS_STATE_KEY];
};

const setOverlayState = (map: Map, state: VectorLabelsState | undefined) => {
  if (state) {
    (map as MapWithVectorLabelsState)[VECTOR_LABELS_STATE_KEY] = state;
  } else {
    delete (map as MapWithVectorLabelsState)[VECTOR_LABELS_STATE_KEY];
  }
};

const waitForStyleLoad = async (map: Map): Promise<void> => {
  if (map.isStyleLoaded()) {
    return;
  }

  await new Promise<void>((resolve) => {
    map.once("style.load", () => resolve());
  });
};

const findVectorSource = (
  sources: StyleSpecification["sources"],
): { key: string; source: SourceSpecification } | null => {
  for (const [key, source] of Object.entries(sources ?? {})) {
    if (source && (source as SourceSpecification).type === "vector") {
      return { key, source };
    }
  }
  return null;
};

const isSymbolLikeLayer = (layer: LayerSpecification): layer is SymbolLayerSpecification => {
  if (layer.type !== "symbol") {
    return false;
  }
  return true;
};

const isLabelCandidate = (layer: LayerSpecification): boolean => {
  if (!isSymbolLikeLayer(layer)) {
    return false;
  }

  const layout = layer.layout ?? {};
  const id = (layer.id ?? "").toLowerCase();
  const hasTextField = typeof (layout as Record<string, unknown>)["text-field"] !== "undefined";
  const looksLikeLabel =
    id.includes("label") || id.includes("name") || id.includes("text") || id.includes("poi");

  return hasTextField || looksLikeLabel;
};

const findOverlayBeforeId = (map: Map): string | undefined => {
  for (const layerId of OVERLAY_LAYER_PREFERENCE) {
    if (map.getLayer(layerId)) {
      return layerId;
    }
  }
  return undefined;
};

const clampOpacity = (value: number): number => {
  return Math.min(1, Math.max(0, value));
};

const isFilterSpecification = (candidate: unknown): candidate is FilterSpecification => {
  return Array.isArray(candidate) && candidate.length > 0;
};

const parseLayerFilter = (rawFilter: string | null | undefined): FilterSpecification | undefined => {
  if (!rawFilter) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(rawFilter);
    return isFilterSpecification(parsed) ? parsed : undefined;
  } catch (error) {
    console.warn("[vectorLabels] Invalid layer_filter JSON. Ignoring filter.", error);
    return undefined;
  }
};

const addVectorSource = (
  map: Map,
  sourceId: string,
  vectorSource: SourceSpecification,
  apiKey?: string | null,
) => {
  const existing = map.getSource(sourceId);
  if (existing) {
    return;
  }

  const sourceConfig: maplibregl.VectorSourceSpecification = {
    type: "vector",
  };

  const rawUrl = (vectorSource as maplibregl.VectorSourceSpecification).url;
  const rawTiles = (vectorSource as maplibregl.VectorSourceSpecification).tiles;

  if (rawUrl) {
    const signed = signMapTilerUrl(rawUrl, apiKey) ?? rawUrl;
    sourceConfig.url = signed;
  } else if (Array.isArray(rawTiles) && rawTiles.length > 0) {
    sourceConfig.tiles = rawTiles.map((tileUrl) => signMapTilerUrl(tileUrl, apiKey) ?? tileUrl);
  } else {
    console.warn("[vectorLabels] Vector source missing url/tiles. Using default MapTiler tiles.");
    sourceConfig.url = signMapTilerUrl(DEFAULT_LABELS_STYLE_URL, apiKey) ?? DEFAULT_LABELS_STYLE_URL;
  }

  const minzoom = (vectorSource as { minzoom?: number }).minzoom;
  const maxzoom = (vectorSource as { maxzoom?: number }).maxzoom;
  const attribution = (vectorSource as { attribution?: string }).attribution;

  if (typeof minzoom === "number") {
    sourceConfig.minzoom = minzoom;
  }
  if (typeof maxzoom === "number") {
    sourceConfig.maxzoom = maxzoom;
  }
  if (typeof attribution === "string") {
    sourceConfig.attribution = attribution;
  }

  map.addSource(sourceId, sourceConfig);
};

const addVectorLabelLayers = (
  map: Map,
  sourceId: string,
  style: StyleSpecification,
  overlay: NormalizedLabelsOverlay,
): Array<{ id: string; type: LayerSpecification["type"] }> => {
  const layerEntries: Array<{ id: string; type: LayerSpecification["type"] }> = [];

  const layers = Array.isArray(style.layers) ? style.layers : [];
  const parsedFilter = parseLayerFilter(overlay.layer_filter);
  const beforeId = findOverlayBeforeId(map);
  const targetOpacity = clampOpacity(clampLabelsOpacity(overlay.opacity));

  let index = 0;
  for (const layer of layers) {
    if (!isLabelCandidate(layer)) {
      continue;
    }

    const layerId = `${VECTOR_LABELS_LAYER_PREFIX}${index++}`;
    if (map.getLayer(layerId)) {
      continue;
    }

    const symbolLayer = layer as SymbolLayerSpecification;
    const filterValue: any = parsedFilter ?? symbolLayer.filter;
    const layerFilter: FilterSpecification | undefined = isFilterSpecification(filterValue)
      ? filterValue
      : (symbolLayer.filter as FilterSpecification | undefined);

    const newLayer: SymbolLayerSpecification = {
      id: layerId,
      type: "symbol",
      source: sourceId,
      "source-layer": symbolLayer["source-layer"],
      layout: {
        ...(symbolLayer.layout ?? {}),
        visibility: "visible",
      },
      paint: {
        ...(symbolLayer.paint ?? {}),
      },
      filter: layerFilter,
      minzoom: symbolLayer.minzoom,
      maxzoom: symbolLayer.maxzoom,
    };

    if (!newLayer.paint) {
      newLayer.paint = {};
    }

    try {
      map.addLayer(newLayer, beforeId);
      layerEntries.push({ id: layerId, type: newLayer.type });
    } catch (error) {
      console.warn(`[vectorLabels] Failed to add label layer ${layerId}`, error);
      continue;
    }

    try {
      map.setPaintProperty(layerId, "text-opacity", targetOpacity);
    } catch {
      // ignore
    }

    try {
      map.setPaintProperty(layerId, "icon-opacity", targetOpacity);
    } catch {
      // ignore
    }
  }

  return layerEntries;
};

export const removeLabelsOverlay = (map: Map): void => {
  const state = getOverlayState(map);
  if (!state) {
    return;
  }

  for (const entry of state.layerIds) {
    if (!map.getLayer(entry.id)) {
      continue;
    }
    try {
      map.removeLayer(entry.id);
    } catch (error) {
      console.warn(`[vectorLabels] Failed to remove layer ${entry.id}`, error);
    }
  }

  if (map.getSource(state.sourceId)) {
    try {
      map.removeSource(state.sourceId);
    } catch (error) {
      console.warn("[vectorLabels] Failed to remove vector labels source", error);
    }
  }

  setOverlayState(map, undefined);
};

export const ensureLabelsOverlay = async (
  map: Map,
  overlayInput: NormalizedLabelsOverlay | boolean | null | undefined,
  apiKey?: string | null,
): Promise<void> => {
  const normalizedOverlay = normalizeLabelsOverlay(overlayInput, DEFAULT_LABELS_STYLE_URL);

  if (!normalizedOverlay.enabled) {
    removeLabelsOverlay(map);
    return;
  }

  await waitForStyleLoad(map);

  const state = getOverlayState(map);
  const signedStyleUrl = signMapTilerUrl(normalizedOverlay.style_url, apiKey) ?? normalizedOverlay.style_url;

  if (
    state &&
    state.styleUrl === signedStyleUrl &&
    state.layerFilter === (normalizedOverlay.layer_filter ?? null) &&
    map.getSource(state.sourceId)
  ) {
    updateLabelsOpacity(map, normalizedOverlay.opacity);
    return;
  }

  removeLabelsOverlay(map);

  try {
    const response = await fetch(signedStyleUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load labels style: HTTP ${response.status}`);
    }

    const style = (await response.json()) as StyleSpecification;
    if (!style.sources || !style.layers) {
      throw new Error("Invalid labels style format");
    }

    const vectorSourceEntry = findVectorSource(style.sources);
    if (!vectorSourceEntry) {
      throw new Error("Vector source not found in labels style");
    }

    addVectorSource(map, VECTOR_LABELS_SOURCE_ID, vectorSourceEntry.source, apiKey);
    const layerEntries = addVectorLabelLayers(map, VECTOR_LABELS_SOURCE_ID, style, normalizedOverlay);

    setOverlayState(map, {
      styleUrl: signedStyleUrl,
      layerIds: layerEntries,
      sourceId: VECTOR_LABELS_SOURCE_ID,
      layerFilter: normalizedOverlay.layer_filter ?? null,
      opacity: clampLabelsOpacity(normalizedOverlay.opacity),
    });
  } catch (error) {
    console.error("[vectorLabels] Failed to ensure labels overlay:", error);
  }
};

export const updateLabelsOpacity = (map: Map, opacity: number | null | undefined): void => {
  const state = getOverlayState(map);
  if (!state) {
    return;
  }

  const clamped = clampLabelsOpacity(opacity ?? state.opacity ?? 1);
  for (const entry of state.layerIds) {
    if (entry.type === "symbol") {
      try {
        map.setPaintProperty(entry.id, "text-opacity", clamped);
      } catch {
        // ignore
      }
      try {
        map.setPaintProperty(entry.id, "icon-opacity", clamped);
      } catch {
        // ignore
      }
    } else if (entry.type === "raster") {
      try {
        map.setPaintProperty(entry.id, "raster-opacity", clamped);
      } catch {
        // ignore
      }
    }
  }

  state.opacity = clamped;
  setOverlayState(map, state);
};


