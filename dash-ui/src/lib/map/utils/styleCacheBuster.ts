const readGlobalBuildId = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  const candidate = (window as { __PANTALLA_BUILD_ID__?: string }).__PANTALLA_BUILD_ID__;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
};

const readEnvBuildId = (): string | undefined => {
  const env = (import.meta.env as Record<string, string | undefined>) || {};
  const fromBuild = env.VITE_APP_BUILD_ID?.trim();
  if (fromBuild) {
    return fromBuild;
  }
  const fromVersion = env.VITE_APP_VERSION?.trim();
  if (fromVersion) {
    return fromVersion;
  }
  return undefined;
};

const readFallbackVersion = (): string | undefined => {
  try {
    if (typeof __APP_VERSION__ === "string" && __APP_VERSION__.trim().length > 0) {
      return __APP_VERSION__.trim();
    }
  } catch {
    // Ignorar si no está definido
  }
  return undefined;
};

const CACHE_BUSTER_VALUE =
  readGlobalBuildId() ||
  readEnvBuildId() ||
  readFallbackVersion() ||
  "";

export const getStyleCacheBuster = (): string | null => {
  return CACHE_BUSTER_VALUE || null;
};

export const withStyleCacheBuster = (url: string | null | undefined): string | null => {
  if (!url || typeof url !== "string") {
    return url ?? null;
  }
  const trimmed = url.trim();
  if (!trimmed || !CACHE_BUSTER_VALUE) {
    return trimmed || null;
  }
  try {
    const parsed = new URL(trimmed);
    parsed.searchParams.set("cache", CACHE_BUSTER_VALUE);
    return parsed.toString();
  } catch {
    const separator = trimmed.includes("?") ? "&" : "?";
    return `${trimmed}${separator}cache=${encodeURIComponent(CACHE_BUSTER_VALUE)}`;
  }
};
