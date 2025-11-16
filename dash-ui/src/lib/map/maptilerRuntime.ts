export type UiMapLike = {
  ui_map?: {
    provider?: string | null;
    maptiler?: {
      api_key?: string | null;
      apiKey?: string | null;
      key?: string | null;
      style?: string | null;
      style_url?: string | null;
      styleUrl?: string | null;
      urls?: {
        styleUrlDark?: string | null;
        styleUrlLight?: string | null;
        styleUrlBright?: string | null;
      } | null;
    } | null;
  } | null;
  secrets?: {
    maptiler?: {
      api_key?: string | null;
    } | null;
  } | null;
};

export type HealthLike = {
  maptiler?: {
    has_api_key?: boolean;
    styleUrl?: string | null;
  } | null;
};

/**
 * Detecta si hay una API key de MapTiler disponible en config o health.
 */
export function hasMaptilerKey(config: UiMapLike | null | undefined, health?: HealthLike | null): boolean {
  const fromSecrets = Boolean(config?.secrets?.maptiler?.api_key);
  const fromUiMap = Boolean(
    config?.ui_map?.maptiler?.api_key ||
    config?.ui_map?.maptiler?.apiKey ||
    config?.ui_map?.maptiler?.key
  );
  const fromHealth = Boolean(health?.maptiler?.has_api_key);
  return fromSecrets || fromUiMap || fromHealth;
}

/**
 * Extrae la API key de MapTiler desde config o health.
 * Prioridad: secrets > ui_map > health (si has_api_key es true, intenta extraer de styleUrl)
 */
export function extractMaptilerApiKey(
  config: UiMapLike | null | undefined,
  health?: HealthLike | null
): string | null {
  // 1. Desde secrets
  const fromSecrets = config?.secrets?.maptiler?.api_key;
  if (fromSecrets && typeof fromSecrets === "string" && fromSecrets.trim()) {
    return fromSecrets.trim();
  }

  // 2. Desde ui_map.maptiler
  const maptiler = config?.ui_map?.maptiler;
  const fromUiMap = maptiler?.api_key || maptiler?.apiKey || maptiler?.key;
  if (fromUiMap && typeof fromUiMap === "string" && fromUiMap.trim()) {
    return fromUiMap.trim();
  }

  // 3. Desde health.maptiler.styleUrl si tiene key
  if (health?.maptiler?.styleUrl && typeof health.maptiler.styleUrl === "string") {
    const keyMatch = health.maptiler.styleUrl.match(/[?&]key=([^&]+)/);
    if (keyMatch && keyMatch[1]) {
      try {
        const decoded = decodeURIComponent(keyMatch[1]);
        if (decoded.trim()) {
          return decoded.trim();
        }
      } catch {
        // Si falla decode, usar tal cual
        if (keyMatch[1].trim()) {
          return keyMatch[1].trim();
        }
      }
    }
  }

  return null;
}

/**
 * Construye una URL de estilo de MapTiler firmada con la API key.
 * Si la URL ya tiene key, la respeta. Si no tiene key y hay apiKey disponible, la añade.
 */
export function buildMaptilerStyleUrl(
  baseUrl: string | null | undefined,
  apiKey?: string | null | undefined
): string | null {
  if (!baseUrl || typeof baseUrl !== "string") {
    return null;
  }
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;

  // Si ya tiene key, devolver tal cual
  if (containsApiKey(trimmed)) {
    return trimmed;
  }

  // Si no tiene key pero tenemos apiKey, añadirla
  if (apiKey && typeof apiKey === "string" && apiKey.trim()) {
    try {
      const url = new URL(trimmed);
      url.searchParams.set("key", apiKey.trim());
      return url.toString();
    } catch {
      // Si no es una URL válida, añadir key manualmente
      const sep = trimmed.includes("?") ? "&" : "?";
      return `${trimmed}${sep}key=${encodeURIComponent(apiKey.trim())}`;
    }
  }

  // Sin key disponible, devolver URL sin firmar
  return trimmed;
}

/**
 * Construye la URL final de estilo de MapTiler usando config y health.
 * Prioridad:
 * 1. health.maptiler.styleUrl (si viene firmado, usarlo tal cual)
 * 2. baseStyleUrl desde config + apiKey extraída
 * 3. fallback a baseStyleUrl sin key si no hay apiKey
 */
export function buildFinalMaptilerStyleUrl(
  config: UiMapLike | null | undefined,
  health: HealthLike | null | undefined,
  baseStyleUrl: string | null | undefined,
  runtimeBaseStyleUrl?: string | null
): string | null {
  // Prioridad 1: health.maptiler.styleUrl (ya viene firmado del backend)
  if (health?.maptiler?.styleUrl && typeof health.maptiler.styleUrl === "string") {
    const healthUrl = health.maptiler.styleUrl.trim();
    if (healthUrl) {
      return healthUrl; // Ya viene con ?key=, usarlo tal cual
    }
  }

  // Prioridad 2: baseStyleUrl desde config (runtimeBaseStyleUrl o baseStyleUrl)
  const candidateUrl = runtimeBaseStyleUrl || baseStyleUrl;
  if (candidateUrl && typeof candidateUrl === "string") {
    const trimmed = candidateUrl.trim();
    if (trimmed) {
      // Si ya tiene key, devolver tal cual
      if (containsApiKey(trimmed)) {
        return trimmed;
      }

      // Extraer apiKey y construir URL firmada
      const apiKey = extractMaptilerApiKey(config, health);
      const signed = buildMaptilerStyleUrl(trimmed, apiKey);
      if (signed) {
        return signed;
      }
    }
  }

  // Prioridad 3: construir desde nombre de estilo + apiKey cuando no hay styleUrl
  const styleSlug = resolveMaptilerStyleSlug(
    (config?.ui_map?.maptiler as { style?: string | null })?.style ?? null
  );
  if (!styleSlug) {
    return null;
  }

  const apiKey = extractMaptilerApiKey(config, health);
  const canonicalUrl = `https://api.maptiler.com/maps/${styleSlug}/style.json`;
  return buildMaptilerStyleUrl(canonicalUrl, apiKey);
}

/**
 * Detecta si una URL contiene un parámetro key (ya sea ?key= o &key=).
 */
export function containsApiKey(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  return /[?&]key=/.test(url);
}

const STYLE_SLUG_MAP: Record<string, string> = {
  "vector-dark": "dataviz-dark",
  "vector-light": "streets-v2",
  "vector-bright": "bright-v2",
  "dataviz-dark": "dataviz-dark",
  "streets": "streets",
  "streets-v2": "streets-v2",
  "streets-v4": "streets-v4",
  "bright": "bright",
  "bright-v2": "bright-v2",
  "light": "streets-v2",
  "dark": "dataviz-dark",
  "outdoor": "outdoor",
  "topo": "topo",
  "winter": "winter",
  "osm-bright": "osm-bright",
};

/**
 * Normaliza el nombre de estilo configurado para MapTiler y devuelve el slug final.
 */
export function resolveMaptilerStyleSlug(styleName?: string | null): string | null {
  if (typeof styleName !== "string") {
    return null;
  }
  const normalized = styleName.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (STYLE_SLUG_MAP[normalized]) {
    return STYLE_SLUG_MAP[normalized];
  }

  // Si parece un slug válido (solo caracteres permitidos), usarlo tal cual
  if (/^[a-z0-9-]+$/i.test(normalized)) {
    return normalized;
  }

  return null;
}

