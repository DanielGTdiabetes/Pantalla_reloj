/**
 * Helper para firmar URLs de MapTiler añadiendo la API key si falta.
 * @param url URL a firmar
 * @param apiKey API key de MapTiler (opcional, puede venir en la URL ya o desde env)
 */
export function signMapTilerUrl(url: string, apiKey?: string | null): string {
  if (!url || typeof url !== "string") {
    return url;
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return url;
  }

  // Verificar si ya tiene key
  const hasKey = /\?key=/.test(trimmedUrl) || /&key=/.test(trimmedUrl);
  
  // Obtener API key: primero del parámetro, luego de variables de entorno
  const effectiveApiKey = apiKey || import.meta.env.VITE_MAPTILER_KEY || '';
  
  if (!hasKey && effectiveApiKey) {
    const sep = trimmedUrl.includes('?') ? '&' : '?';
    return `${trimmedUrl}${sep}key=${effectiveApiKey}`;
  }
  
  return trimmedUrl;
}

