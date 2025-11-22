import type maplibregl from "maplibre-gl";
import { getSafeMapStyle } from "./safeMapStyle";

/**
 * Espera a que el mapa esté completamente listo antes de inicializar capas.
 * Garantiza que:
 * 1. El evento "load" se ha disparado
 * 2. El mapa está en estado "idle"
 * 3. El estilo está cargado y es válido (getSafeMapStyle devuelve un objeto válido)
 * 
 * @param map - Instancia del mapa de MapLibre
 * @param timeoutMs - Timeout máximo en milisegundos (default: 10000)
 * @throws Error si el mapa no está listo después del timeout
 */
export async function waitForMapReady(
  map: maplibregl.Map,
  timeoutMs: number = 10000
): Promise<void> {
  const startTime = Date.now();

  // Helper para verificar timeout
  const checkTimeout = (): void => {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`waitForMapReady timeout after ${timeoutMs}ms`);
    }
  };

  // Paso 1: Verificar si ya está cargado (puede que ya estemos dentro del evento "load")
  if (!map.isStyleLoaded()) {
    // Si no está cargado, esperar al evento "load"
    await new Promise<void>((resolve, reject) => {
      checkTimeout();

      const timeout = setTimeout(() => {
        map.off("load", onLoad);
        reject(new Error("waitForMapReady: load event timeout"));
      }, timeoutMs);

      const onLoad = () => {
        clearTimeout(timeout);
        map.off("load", onLoad);
        resolve();
      };

      map.once("load", onLoad);
    });
  }

  // Paso 2: Esperar estado "idle" (tiles cargados)
  await new Promise<void>((resolve, reject) => {
    checkTimeout();

    // Verificar si ya está idle
    if (map.loaded() && map.areTilesLoaded && map.areTilesLoaded()) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      map.off("idle", onIdle);
      reject(new Error("waitForMapReady: idle event timeout"));
    }, timeoutMs);

    const onIdle = () => {
      // Verificar que realmente está idle
      if (map.loaded() && map.areTilesLoaded && map.areTilesLoaded()) {
        clearTimeout(timeout);
        map.off("idle", onIdle);
        resolve();
      }
    };

    map.once("idle", onIdle);
  });

  // Paso 3: Verificar que el estilo es válido
  checkTimeout();
  const style = getSafeMapStyle(map);
  if (!style) {
    throw new Error("waitForMapReady: style not ready after load and idle");
  }

  // Verificación final: asegurar que el estilo tiene version
  if (typeof (style as { version?: unknown }).version !== "number") {
    throw new Error("waitForMapReady: style version is not a number");
  }
}

