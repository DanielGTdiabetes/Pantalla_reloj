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

