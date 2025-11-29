import type { Map as MaptilerMap, StyleSpecification } from "@maptiler/sdk";

// @ts-expect-error - These types exist but have export issues
type SourceSpecification = import("maplibre-gl").SourceSpecification;
// @ts-expect-error - These types exist but have export issues
type LayerSpecification = import("maplibre-gl").LayerSpecification;
import { getSafeMapStyle } from "./safeMapStyle";

/**
 * Espera a que el estilo del mapa esté completamente cargado.
 * Si ya está cargado, resuelve inmediatamente.
 * Si no, espera al evento 'styledata' o 'load', con polling de respaldo.
 * 
 * @param map - Instancia del mapa de MapLibre
 * @param timeoutMs - Tiempo máximo de espera en milisegundos (default: 10000)
 * @returns Promise que resuelve true si el estilo se cargó, false si hubo timeout
 */
export const waitForStyleLoaded = (
  map: MaptilerMap | undefined | null,
  timeoutMs: number = 10000
): Promise<boolean> => {
  return new Promise((resolve) => {
    if (!map) {
      resolve(false);
      return;
    }

    // Función helper para verificar si el estilo está realmente listo
    const isStyleReady = (): boolean => {
      try {
        return map.isStyleLoaded() && getSafeMapStyle(map) !== null;
      } catch {
        return false;
      }
    };

    // Si el estilo ya está cargado, resolver inmediatamente
    if (isStyleReady()) {
      resolve(true);
      return;
    }

    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pollingId: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pollingId) {
        clearInterval(pollingId);
        pollingId = null;
      }
      try {
        map.off("styledata", onStyleData);
        map.off("load", onLoad);
        map.off("style.load", onStyleLoad);
      } catch {
        // Ignorar errores al remover listeners
      }
    };

    const doResolve = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    const checkAndResolve = () => {
      if (resolved) return;
      if (isStyleReady()) {
        doResolve(true);
      }
    };

    const onStyleData = () => checkAndResolve();
    const onLoad = () => checkAndResolve();
    const onStyleLoad = () => checkAndResolve();

    // Configurar timeout
    timeoutId = setTimeout(() => {
      if (resolved) return;
      // Último intento antes de reportar timeout
      if (isStyleReady()) {
        doResolve(true);
        return;
      }
      console.warn("[waitForStyleLoaded] Timeout waiting for style to load");
      doResolve(false);
    }, timeoutMs);

    // Escuchar todos los eventos relevantes
    map.on("styledata", onStyleData);
    map.on("load", onLoad);
    map.on("style.load", onStyleLoad);

    // Polling de respaldo cada 200ms en caso de que los eventos no se disparen
    // Esto es un fallback para casos donde los eventos ya se dispararon
    pollingId = setInterval(() => {
      checkAndResolve();
    }, 200);

    // Verificación inmediata después de registrar listeners (por si el evento ya pasó)
    setTimeout(() => checkAndResolve(), 0);
  });
};

/**
 * Ejecuta una operación en el mapa solo si el estilo está completamente listo.
 * Protege contra errores internos de MapLibre relacionados con style.version.
 * 
 * @param map - Instancia del mapa de MapLibre
 * @param operation - Función que contiene las operaciones a ejecutar (addSource, addLayer, etc.)
 * @param layerName - Nombre de la capa/operación para logs
 * @returns true si la operación se ejecutó correctamente, false si se saltó o falló
 */
export const withSafeMapStyle = (
  map: MaptilerMap | undefined | null,
  operation: () => void,
  layerName: string
): boolean => {
  if (!map) {
    console.warn(`[${layerName}] Map not available, skipping operation`);
    return false;
  }

  // Verificar que el estilo esté completamente cargado
  if (!map.isStyleLoaded()) {
    console.warn(`[${layerName}] Style not loaded yet, skipping operation`);
    return false;
  }

  // Verificar que el estilo sea válido y tenga version
  const style = getSafeMapStyle(map);
  if (!style) {
    console.warn(`[${layerName}] Style not ready (null or invalid), skipping operation`);
    return false;
  }

  // Ejecutar la operación con try-catch defensivo
  // Esto captura errores internos de MapLibre que pueden ocurrir
  // cuando el estilo está en transición o en estado inconsistente
  try {
    operation();
    return true;
  } catch (error) {
    // Si el error está relacionado con style.version, es probable que
    // MapLibre esté en un estado transitorio. Loguear pero no fallar.
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("version") || errorMsg.includes("style")) {
      console.warn(
        `[${layerName}] MapLibre internal error (likely style transition), operation skipped:`,
        errorMsg
      );
    } else {
      // Otros errores pueden ser más serios, pero no queremos romper el mapa
      console.error(`[${layerName}] Error during map operation:`, error);
    }
    return false;
  }
};

/**
 * Versión async de withSafeMapStyle que espera a que el estilo esté listo antes de ejecutar.
 * 
 * @param map - Instancia del mapa de MapLibre
 * @param operation - Función que contiene las operaciones a ejecutar
 * @param layerName - Nombre de la capa/operación para logs
 * @param timeoutMs - Tiempo máximo de espera (default: 10000)
 * @returns Promise que resuelve true si la operación se ejecutó correctamente
 */
export const withSafeMapStyleAsync = async (
  map: MaptilerMap | undefined | null,
  operation: () => void,
  layerName: string,
  timeoutMs: number = 10000
): Promise<boolean> => {
  if (!map) {
    console.warn(`[${layerName}] Map not available, skipping operation`);
    return false;
  }

  // Si el estilo no está cargado, esperar
  if (!map.isStyleLoaded() || !getSafeMapStyle(map)) {
    console.log(`[${layerName}] Style not ready, waiting...`);
    const styleLoaded = await waitForStyleLoaded(map, timeoutMs);
    if (!styleLoaded) {
      console.warn(`[${layerName}] Timeout waiting for style, skipping operation`);
      return false;
    }
    console.log(`[${layerName}] Style now ready, proceeding with operation`);
  }

  // Ejecutar la operación de forma síncrona ahora que el estilo está listo
  return withSafeMapStyle(map, operation, layerName);
};

/**
 * Añade un source al mapa de forma segura.
 * 
 * @param map - Instancia del mapa de MapLibre
 * @param sourceId - ID del source
 * @param sourceSpec - Especificación del source
 * @param layerName - Nombre de la capa para logs
 * @returns true si se añadió correctamente
 */
export const safeAddSource = (
  map: MaptilerMap | undefined | null,
  sourceId: string,
  sourceSpec: SourceSpecification,
  layerName: string
): boolean => {
  return withSafeMapStyle(
    map,
    () => {
      if (!map!.getSource(sourceId)) {
        map!.addSource(sourceId, sourceSpec);
      }
    },
    layerName
  );
};

/**
 * Añade una capa al mapa de forma segura.
 * 
 * @param map - Instancia del mapa de MapLibre
 * @param layerSpec - Especificación de la capa
 * @param beforeId - ID de la capa antes de la cual insertar (opcional)
 * @param layerName - Nombre de la capa para logs
 * @returns true si se añadió correctamente
 */
export const safeAddLayer = (
  map: MaptilerMap | undefined | null,
  layerSpec: LayerSpecification,
  beforeId: string | undefined,
  layerName: string
): boolean => {
  return withSafeMapStyle(
    map,
    () => {
      if (!map!.getLayer(layerSpec.id)) {
        map!.addLayer(layerSpec, beforeId);
      }
    },
    layerName
  );
};

/**
 * Checks if an image exists in the map style safely.
 * 
 * @param map - MapLibre map instance
 * @param imageId - ID of the image to check
 * @returns true if the image exists, false otherwise (including if style is not ready)
 */
export const safeHasImage = (
  map: MaptilerMap | undefined | null,
  imageId: string
): boolean => {
  if (!map) {
    return false;
  }
  const style = getSafeMapStyle(map);
  if (!style) {
    return false;
  }
  try {
    return map.hasImage(imageId);
  } catch {
    return false;
  }
};
