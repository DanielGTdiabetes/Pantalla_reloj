export type UiMapLike = {
  ui_map?: {
    provider?: string | null;
    maptiler?: {
      api_key?: string | null;
      styleUrl?: string | null;
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

export function hasMaptilerKey(config: UiMapLike | null | undefined, health?: HealthLike | null): boolean {
  const fromSecrets = Boolean(config?.secrets?.maptiler?.api_key);
  const fromUiMap = Boolean(config?.ui_map?.maptiler?.api_key);
  const fromHealth = Boolean(health?.maptiler?.has_api_key);
  return fromSecrets || fromUiMap || fromHealth;
}

export function buildMaptilerStyleUrl(baseUrl: string | null | undefined, apiKey?: string | null | undefined): string | null {
  if (!baseUrl || typeof baseUrl !== "string") {
    return null;
  }
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (apiKey && !url.searchParams.get("key")) {
      url.searchParams.set("key", apiKey);
    }
    return url.toString();
  } catch {
    // Si no es una URL válida, devolver tal cual si hay contenido
    return trimmed || null;
  }
}

export function containsApiKey(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  return /[?&]key=/.test(url);
}
*** End Patch```️} -->

