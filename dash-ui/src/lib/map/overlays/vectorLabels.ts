import maplibregl, { type Map } from "maplibre-gl";
import type {
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";

import { DEFAULT_LABELS_STYLE_URL, clampLabelsOpacity } from "../labelsOverlay";
import { signMapTilerUrl } from "../utils/maptilerHelpers";

export type LabelsOverlayCfg = {
  enabled: boolean;
  style_url: string;
  layer_filter?: string | null;
  opacity?: number;
};

const LABELS_SRC_ID = "labels-src";
const LABELS_LAYER_PREFIX = "labels-ov-";

type ParsedLayerFilter =
  | { kind: "expression"; value: FilterSpecification }
  | { kind: "includes"; tokens: string[] };

const clampOpacity = (value?: number | null): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, value));
};

const ensureStyleUrl = (value?: string | null): string => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || DEFAULT_LABELS_STYLE_URL;
};

const tokenize = (raw: string): string[] => {
  return raw
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
};

const parseLayerFilter = (raw: string | null | undefined): ParsedLayerFilter | null => {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { kind: "expression", value: parsed as FilterSpecification };
    }
    if (typeof parsed === "string") {
      const tokens = tokenize(parsed);
      return tokens.length > 0 ? { kind: "includes", tokens } : null;
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { includes?: unknown }).includes)) {
      const tokens = (parsed as { includes: unknown[] }).includes
        .map((token) => (typeof token === "string" ? token : String(token)))
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length > 0);
      return tokens.length > 0 ? { kind: "includes", tokens } : null;
    }
  } catch (error) {
    console.warn("[vectorLabels] layer_filter inválido. Ignorando filtro.", error);
  }
  return null;
};

const isSymbolLayer = (layer: LayerSpecification): layer is SymbolLayerSpecification => {
  return layer.type === "symbol";
};

const looksLikeLabel = (layer: SymbolLayerSpecification): boolean => {
  const id = typeof layer.id === "string" ? layer.id.toLowerCase() : "";
  const sourceLayer =
    typeof (layer as { "source-layer"?: unknown })["source-layer"] === "string"
      ? ((layer as { "source-layer": string })["source-layer"] ?? "").toLowerCase()
      : "";
  const layout = layer.layout ?? {};
  const hasTextField = typeof (layout as Record<string, unknown>)["text-field"] !== "undefined";

  if (hasTextField) {
    return true;
  }

  const tokens = ["label", "name", "text", "poi", "place", "city", "town"];
  return tokens.some((token) => id.includes(token) || sourceLayer.includes(token));
};

const shouldIncludeLayerByName = (
  layer: SymbolLayerSpecification,
  parsedFilter: ParsedLayerFilter | null,
): boolean => {
  if (!parsedFilter || parsedFilter.kind !== "includes") {
    return true;
  }
  const id = typeof layer.id === "string" ? layer.id.toLowerCase() : "";
  const sourceLayer =
    typeof (layer as { "source-layer"?: unknown })["source-layer"] === "string"
      ? ((layer as { "source-layer": string })["source-layer"] ?? "").toLowerCase()
      : "";
  return parsedFilter.tokens.some((token) => id.includes(token) || sourceLayer.includes(token));
};

const buildLayerFilter = (
  layer: SymbolLayerSpecification,
  parsedFilter: ParsedLayerFilter | null,
): FilterSpecification | undefined => {
  if (!parsedFilter || parsedFilter.kind !== "expression") {
    return layer.filter as FilterSpecification | undefined;
  }

  const existing = layer.filter as FilterSpecification | undefined;
  if (!existing) {
    return parsedFilter.value;
  }

  return ["all", parsedFilter.value, existing] as FilterSpecification;
};

const cloneVectorSource = (
  source: SourceSpecification,
  apiKey?: string | null,
): maplibregl.VectorSourceSpecification | null => {
  if (!source || (source as { type?: unknown }).type !== "vector") {
    return null;
  }

  const vectorSource = { ...(source as maplibregl.VectorSourceSpecification) };

  if (typeof vectorSource.url === "string") {
    vectorSource.url = signMapTilerUrl(vectorSource.url, apiKey) ?? vectorSource.url;
  }

  if (Array.isArray(vectorSource.tiles)) {
    vectorSource.tiles = vectorSource.tiles.map((tileUrl) => signMapTilerUrl(tileUrl, apiKey) ?? tileUrl);
  }

  return vectorSource;
};

const findVectorSource = (sources: StyleSpecification["sources"]): SourceSpecification | null => {
  for (const source of Object.values(sources ?? {})) {
    if (source && (source as { type?: unknown }).type === "vector") {
      return source as SourceSpecification;
    }
  }
  return null;
};

const addSymbolLayers = (
  map: Map,
  layers: StyleSpecification["layers"],
  parsedFilter: ParsedLayerFilter | null,
): void => {
  const entries = Array.isArray(layers) ? layers : [];
  let incrementalId = 0;

  for (const layer of entries) {
    if (!isSymbolLayer(layer)) {
      continue;
    }

    if (!looksLikeLabel(layer)) {
      continue;
    }

    if (!shouldIncludeLayerByName(layer, parsedFilter)) {
      continue;
    }

    const baseId =
      typeof layer.id === "string" && layer.id.trim().length > 0 ? layer.id.trim() : `auto-${incrementalId++}`;
    const newId = `${LABELS_LAYER_PREFIX}${baseId}`;

    if (map.getLayer(newId)) {
      continue;
    }

    const baseLayout = (layer.layout ?? {}) as SymbolLayerSpecification["layout"];
    const layout: SymbolLayerSpecification["layout"] = {
      ...baseLayout,
      visibility: "visible",
    };
    const paint = layer.paint ? { ...layer.paint } : {};
    const filter = buildLayerFilter(layer, parsedFilter);

    const newLayer: SymbolLayerSpecification = {
      ...layer,
      id: newId,
      source: LABELS_SRC_ID,
      layout,
      paint,
      filter,
    };

    try {
      map.addLayer(newLayer);
    } catch (error) {
      console.warn(`[vectorLabels] No se pudo añadir la capa ${newId}`, error);
    }
  }
};

export const removeLabelsOverlay = (map: Map): void => {
  const style = map.getStyle() as StyleSpecification | undefined;
  if (!style) {
    console.warn("[GeoScope] getStyle() returned null, aborting removeLabelsOverlay");
    return;
  }
  const layers = style.layers ?? [];

  for (const layer of layers) {
    if (!layer.id || !layer.id.startsWith(LABELS_LAYER_PREFIX)) {
      continue;
    }
    if (!map.getLayer(layer.id)) {
      continue;
    }
    try {
      map.removeLayer(layer.id);
    } catch (error) {
      console.warn(`[vectorLabels] No se pudo eliminar la capa ${layer.id}`, error);
    }
  }

  if (map.getSource(LABELS_SRC_ID)) {
    try {
      map.removeSource(LABELS_SRC_ID);
    } catch (error) {
      console.warn("[vectorLabels] No se pudo eliminar la source de labels", error);
    }
  }
};

export const ensureLabelsOverlay = async (
  map: Map,
  cfgInput: LabelsOverlayCfg | null | undefined,
  apiKey?: string | null,
): Promise<void> => {
  removeLabelsOverlay(map);

  const enabled = Boolean(cfgInput?.enabled);
  if (!enabled) {
    return;
  }

  const styleUrl = ensureStyleUrl(cfgInput?.style_url);
  const signedStyleUrl = signMapTilerUrl(styleUrl, apiKey) ?? styleUrl;

  try {
    const response = await fetch(signedStyleUrl, { cache: "no-cache" });
    if (!response.ok) {
      console.error(`[vectorLabels] labels style fetch ${response.status}`);
      return;
    }

    const style = (await response.json()) as StyleSpecification;
    if (!style?.sources || !style?.layers) {
      console.warn("[vectorLabels] Formato de estilo inválido, no se añadieron labels.");
      return;
    }

    const vectorSource = findVectorSource(style.sources);
    if (!vectorSource) {
      console.warn("[vectorLabels] Estilo sin fuente vectorial, no se añadieron labels.");
      return;
    }

    const sourceConfig = cloneVectorSource(vectorSource, apiKey);
    if (!sourceConfig) {
      console.warn("[vectorLabels] No se pudo clonar la fuente vectorial, abortando overlay.");
      return;
    }

    map.addSource(LABELS_SRC_ID, sourceConfig);

    const parsedFilter = parseLayerFilter(cfgInput?.layer_filter ?? null);
    addSymbolLayers(map, style.layers, parsedFilter);

    const targetOpacity = clampOpacity(cfgInput?.opacity);
    if (typeof targetOpacity === "number") {
      updateLabelsOpacity(map, targetOpacity);
    }
  } catch (error) {
    console.error("[vectorLabels] Error al asegurar el overlay de labels:", error);
  }
};

export const updateLabelsOpacity = (map: Map, opacity: number | null | undefined): void => {
  const target = clampLabelsOpacity(typeof opacity === "number" ? opacity : 1);
  const style = map.getStyle() as StyleSpecification | undefined;
  if (!style) {
    console.warn("[GeoScope] getStyle() returned null, aborting updateLabelsOpacity");
    return;
  }
  const layers = style.layers ?? [];

  for (const layer of layers) {
    if (!layer.id || !layer.id.startsWith(LABELS_LAYER_PREFIX)) {
      continue;
    }
    if (!map.getLayer(layer.id)) {
      continue;
    }
    try {
      map.setPaintProperty(layer.id, "text-opacity", target);
    } catch {
      // ignorado
    }
    try {
      map.setPaintProperty(layer.id, "icon-opacity", target);
    } catch {
      // ignorado
    }
  }
};

