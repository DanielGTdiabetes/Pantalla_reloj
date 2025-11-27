import type { SatelliteLabelsOverlay } from "../../types/config";

export type NormalizedLabelsOverlay = {
  enabled: boolean;
  style_url: string;
  layer_filter: string | null;
  opacity: number;
};

export const DEFAULT_LABELS_STYLE_URL = "https://api.maptiler.com/maps/streets-v4/style.json";

export const DEFAULT_NORMALIZED_LABELS_OVERLAY: NormalizedLabelsOverlay = {
  enabled: false,
  style_url: DEFAULT_LABELS_STYLE_URL,
  layer_filter: null,
  opacity: 1,
};

export const clampLabelsOpacity = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(1, Math.max(0, numeric));
};

const isSatelliteLabelsOverlay = (
  value: unknown,
): value is SatelliteLabelsOverlay & { opacity?: number | null } => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "enabled" in value
  );
};

export const normalizeLabelsOverlay = (
  rawOverlay: boolean | SatelliteLabelsOverlay | null | undefined,
  legacyStyleUrl?: string | null,
): NormalizedLabelsOverlay => {
  if (rawOverlay === false) {
    return {
      ...DEFAULT_NORMALIZED_LABELS_OVERLAY,
      enabled: false,
    };
  }

  const base = { ...DEFAULT_NORMALIZED_LABELS_OVERLAY };

  if (rawOverlay === true) {
    return base;
  }

  const sourceOverlay = isSatelliteLabelsOverlay(rawOverlay)
    ? rawOverlay
    : typeof rawOverlay === "boolean"
      ? { enabled: rawOverlay }
      : {};

  const enabled =
    typeof (sourceOverlay as { enabled?: unknown })?.enabled === "boolean"
      ? (sourceOverlay as { enabled?: boolean }).enabled ?? base.enabled
      : base.enabled;

  const styleCandidate =
    typeof (sourceOverlay as { style_url?: unknown })?.style_url === "string"
      ? ((sourceOverlay as { style_url?: string }).style_url ?? "").trim()
      : "";

  const fallbackLegacy =
    typeof legacyStyleUrl === "string" && legacyStyleUrl.trim().length > 0
      ? legacyStyleUrl.trim()
      : "";

  const style_url = styleCandidate || fallbackLegacy || DEFAULT_LABELS_STYLE_URL;

  const layer_filter =
    typeof (sourceOverlay as { layer_filter?: unknown })?.layer_filter === "string"
      ? ((sourceOverlay as { layer_filter?: string }).layer_filter ?? "").trim() || null
      : null;

  const opacity = clampLabelsOpacity(
    (sourceOverlay as { opacity?: number | null })?.opacity ?? base.opacity,
  );

  return {
    enabled,
    style_url,
    layer_filter,
    opacity,
  };
};


