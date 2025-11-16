import maplibregl from "maplibre-gl";
import {
  buildFinalMaptilerStyleUrl,
  buildMaptilerStyleUrl,
  resolveMaptilerStyleSlug,
} from "../lib/map/maptilerRuntime";

let styleChangeInFlight = false;

/**
 * Aplica un nuevo estilo al mapa con validación, preflight y fallback.
 */
export async function applyMapStyle(
  map: maplibregl.Map,
  styleUrl: string,
  checksum: string | null
): Promise<void> {
  if (styleChangeInFlight) {
    console.warn("[map] Style change already in flight, ignoring");
    return;
  }

  styleChangeInFlight = true;

  const url = withBuster(styleUrl, checksum);

  // Preflight: evitar colgar el kiosk si la URL está mal
  const ok = await preflight(url);
  if (!ok) {
    console.warn("[map] preflight failed, fallback OSM");
    await hardSwitchToOSM(map, checksum);
    styleChangeInFlight = false;
    return;
  }

  teardownCustomLayers(map); // quita radar/sat/cap/ships/flights/storm si existen

  const FAILSAFE_MS = 8000;
  const timer = setTimeout(() => {
    console.warn("[map] style change timeout → hard reload");
    hardReload();
  }, FAILSAFE_MS);

  const onErr = (e: any) => {
    clientLog("map.setStyle", e?.error?.message || String(e));
  };
  map.on("error", onErr);

  try {
    map.setStyle(url, { diff: false });
    map.once("load", () => {
      clearTimeout(timer);
      map.off("error", onErr);
      reinjectCustomLayers(map);
      styleChangeInFlight = false;
      console.log("[map] style applied", url);
    });
  } catch (e) {
    clearTimeout(timer);
    map.off("error", onErr);
    styleChangeInFlight = false;
    clientLog("map.setStyle.exception", String(e));
    hardReload();
  }
}

/**
 * Preflight: verifica que el styleUrl es válido antes de usarlo.
 */
async function preflight(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return false;
    const text = await res.text();
    return text.length > 1024; // style.json razonable
  } catch {
    return false;
  }
}

/**
 * Añade cache-buster al URL.
 */
function withBuster(url: string, checksum: string | null): string {
  if (!checksum) return url;
  return url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(checksum);
}

/**
 * Hard reload: limpia caché y recarga la página.
 */
function hardReload(): void {
  try {
    if ("caches" in window) {
      caches.keys().then((k) => k.forEach((c) => caches.delete(c)));
    }
  } catch {}
  window.location.reload();
}

/**
 * Fallback a OSM si el styleUrl falla.
 */
async function hardSwitchToOSM(map: maplibregl.Map, checksum: string | null): Promise<void> {
  teardownCustomLayers(map);
  const osmUrl = withBuster("https://demotiles.maplibre.org/style.json", checksum);
  map.setStyle(osmUrl, { diff: false });
  map.once("load", () => reinjectCustomLayers(map));
}

/**
 * Teardown de capas personalizadas antes de cambiar estilo.
 */
function teardownCustomLayers(map: maplibregl.Map): void {
  // Lista de IDs de capas personalizadas a remover
  const customLayerIds = [
    "geoscope-weather",
    "geoscope-aemet-warnings",
    "geoscope-flights",
    "geoscope-ships",
    "geoscope-lightning",
    "geoscope-global-radar",
    "geoscope-global-satellite",
  ];

  for (const layerId of customLayerIds) {
    try {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
    } catch {
      // Ignorar si la capa no existe
    }
  }

  // Lista de IDs de fuentes personalizadas a remover
  const customSourceIds = [
    "geoscope-weather-source",
    "geoscope-aemet-warnings-source",
    "geoscope-flights-source",
    "geoscope-ships-source",
    "geoscope-lightning-source",
    "geoscope-global-radar-source",
    "geoscope-global-satellite-source",
  ];

  for (const sourceId of customSourceIds) {
    try {
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    } catch {
      // Ignorar si la fuente no existe
    }
  }
}

/**
 * Reinjecta capas personalizadas después de cambiar estilo.
 * Esta función debe ser llamada después de style.load y reinyecta
 * las capas usando el LayerRegistry si está disponible, o directamente.
 */
function reinjectCustomLayers(map: maplibregl.Map): void {
  // Disparar evento para que el componente reinyecte las capas
  // usando su LayerRegistry
  window.dispatchEvent(new CustomEvent("map:style:loaded"));
}

/**
 * Log de errores del cliente al backend.
 */
function clientLog(where: string, msg: string): void {
  fetch("/api/logs/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ts: Date.now(), where, msg, level: "error" }),
  }).catch(() => {
    // Ignorar errores de logging
  });
}

/**
 * Computa el styleUrl desde la configuración del mapa.
 * Usa buildFinalMaptilerStyleUrl para asegurar que siempre se firma con la API key cuando está disponible.
 */
export function computeStyleUrlFromConfig(mapConfig: any, health?: any): string | null {
  if (!mapConfig) return null;

  const maptiler = mapConfig.maptiler;
  if (!maptiler) return null;

  // Si hay styleUrl personalizado (styleUrlDark, styleUrlLight, styleUrlBright o styleUrl), usarlo
  const baseStyleUrl = maptiler.styleUrl || maptiler.styleUrlDark || maptiler.styleUrlLight || maptiler.styleUrlBright;
  
  // Si hay baseStyleUrl, usar buildFinalMaptilerStyleUrl para firmarlo
  if (baseStyleUrl) {
    return buildFinalMaptilerStyleUrl(mapConfig, health, baseStyleUrl, null);
  }

  // Si hay apiKey, construir URL según el estilo
  const apiKey = maptiler.api_key || maptiler.apiKey || maptiler.key;
  if (!apiKey) return null;

  // Usar el estilo de la configuración, pero no forzar "vector-dark" como fallback
  // Si no hay estilo definido, devolver null para que se use el styleUrl si está disponible
  const styleSlug = resolveMaptilerStyleSlug(mapConfig.style);
  if (!styleSlug) return null;
  
  const baseUrl = `https://api.maptiler.com/maps/${styleSlug}/style.json`;
  return buildMaptilerStyleUrl(baseUrl, apiKey);
}

