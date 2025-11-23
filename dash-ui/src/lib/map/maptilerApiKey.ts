/**
 * Extrae la API key de MapTiler desde una URL de estilo.
 * @param url URL del estilo que puede contener el parámetro ?key=...
 * @returns La API key extraída o null si no se encuentra
 */
export function extractMaptilerApiKeyFromUrl(url?: string | null): string | null {
  if (!url) return null;
  
  try {
    const u = new URL(url);
    const key = u.searchParams.get("key");
    if (key && key.trim().length > 0) {
      return key.trim();
    }
  } catch (err) {
    console.warn("[MapTilerKey] Invalid URL while extracting key:", url, err);
  }
  
  return null;
}

