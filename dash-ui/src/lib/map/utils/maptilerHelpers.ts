/**
 * Helper para firmar URLs de MapTiler añadiendo la API key si falta.
 * @param url URL a firmar (puede ser string, null o undefined)
 * @param apiKey API key de MapTiler (opcional, puede venir en la URL ya o desde env)
 * @returns URL firmada o null si la URL es inválida
 */
export function signMapTilerUrl(url: string | null | undefined, apiKey?: string | null): string | null {
  if (!url || typeof url !== "string") {
    return url ?? null;
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return null;
  }

  // Verificar si ya tiene key
  const hasKey = /\?key=/.test(trimmedUrl) || /&key=/.test(trimmedUrl);
  
  // Obtener API key: primero del parámetro, luego de variables de entorno
  // Usar type assertion para evitar error de TypeScript con VITE_MAPTILER_KEY
  const envKey = (import.meta.env as Record<string, string | undefined>).VITE_MAPTILER_KEY;
  const effectiveApiKey = apiKey || envKey || '';
  
  if (!hasKey && effectiveApiKey) {
    const sep = trimmedUrl.includes('?') ? '&' : '?';
    return `${trimmedUrl}${sep}key=${effectiveApiKey}`;
  }
  
  return trimmedUrl;
}

/**
 * Detecta si una URL es un estilo de satélite de MapTiler.
 * @param url URL del estilo
 * @returns true si es un estilo de satélite
 */
export function isSatelliteStyle(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }
  return url.includes("/maps/satellite/");
}

/**
 * Detecta si una URL es un estilo híbrido de MapTiler.
 * @param url URL del estilo
 * @returns true si es un estilo híbrido
 */
export function isHybridStyle(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }
  return url.includes("/maps/hybrid/");
}

/**
 * Obtiene la URL de tiles raster de satélite desde una URL de estilo.
 * @param styleUrl URL del estilo (ej: https://api.maptiler.com/maps/satellite/style.json?key=...)
 * @returns URL de tiles raster (ej: https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=...)
 */
export function getSatelliteTileUrl(styleUrl: string | null | undefined, apiKey?: string | null): string | null {
  if (!styleUrl || typeof styleUrl !== "string") {
    return null;
  }

  // Extraer la clave de estilo (ej: "satellite" de "/maps/satellite/style.json")
  const match = styleUrl.match(/\/maps\/([^\/]+)\/style\.json/);
  if (!match || !match[1]) {
    return null;
  }

  const styleKey = match[1];
  const baseUrl = `https://api.maptiler.com/tiles/${styleKey}/{z}/{x}/{y}.jpg`;
  
  // Extraer la API key de la URL si existe
  const keyMatch = styleUrl.match(/[?&]key=([^&]+)/);
  const effectiveKey = keyMatch ? keyMatch[1] : apiKey;
  
  if (effectiveKey) {
    return `${baseUrl}?key=${effectiveKey}`;
  }
  
  return baseUrl;
}
