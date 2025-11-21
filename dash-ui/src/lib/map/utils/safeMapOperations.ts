import type maplibregl from "maplibre-gl";
import { getSafeMapStyle } from "./safeMapStyle";

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
  map: maplibregl.Map | undefined | null,
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
 * Añade un source al mapa de forma segura.
 * 
 * @param map - Instancia del mapa de MapLibre
 * @param sourceId - ID del source
 * @param sourceSpec - Especificación del source
 * @param layerName - Nombre de la capa para logs
 * @returns true si se añadió correctamente
 */
export const safeAddSource = (
  map: maplibregl.Map | undefined | null,
  sourceId: string,
  sourceSpec: maplibregl.SourceSpecification,
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
  map: maplibregl.Map | undefined | null,
  layerSpec: maplibregl.LayerSpecification,
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

