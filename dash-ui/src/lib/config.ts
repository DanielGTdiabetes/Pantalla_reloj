import type { AppConfig } from "../types/config";
type ConfigLike = Partial<AppConfig> | null | undefined;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Extrae la API key de MapTiler desde la configuración actual.
 * Prioriza el layout v2 (`providers.map.maptiler_api_key`) y aplica fallbacks
 * para configuraciones legacy.
 */
export function getMaptilerApiKey(config: ConfigLike): string | null {
  if (!config || typeof config !== "object") {
    return null;
  }

  const candidates: Array<unknown> = [
    // v2 oficial
    (config as { providers?: { map?: { maptiler_api_key?: unknown } } })?.providers?.map?.maptiler_api_key,
    // Preferencias legacy (v1)
    (config as { map?: { maptiler_api_key?: unknown } })?.map?.maptiler_api_key,
    // Bloque ui_map v2 (por compatibilidad con defaults)
    (config as { ui_map?: { maptiler?: { api_key?: unknown; apiKey?: unknown } } })?.ui_map?.maptiler?.api_key,
    (config as { ui_map?: { maptiler?: { api_key?: unknown; apiKey?: unknown } } })?.ui_map?.maptiler?.apiKey,
    // UI legacy v1
    (config as { ui?: { map?: { maptiler?: { apiKey?: unknown; key?: unknown } } } })?.ui?.map?.maptiler?.apiKey,
    (config as { ui?: { map?: { maptiler?: { key?: unknown } } } })?.ui?.map?.maptiler?.key,
  ];

  for (const candidate of candidates) {
    if (isNonEmptyString(candidate)) {
      return candidate.trim();
    }
  }

  return null;
}


