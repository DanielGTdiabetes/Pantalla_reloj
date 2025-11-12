import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { signMapTilerUrl, getSatelliteTileUrl } from "../../../lib/map/utils/maptilerHelpers";
import { ensureLabelsOverlay, removeLabelsOverlay } from "../../../lib/map/overlays/vectorLabels";

export interface MapHybridProps {
  map: MapLibreMap;
  enabled: boolean;
  opacity: number;
  labelsOverlay: boolean;
  labelsStyleUrl: string | null;
  labelsOpacity?: number;
  apiKey: string | null | undefined;
}

/**
 * Componente MapHybrid: Renderiza modo híbrido MapTiler
 * - Fondo satélite raster: satellite/{z}/{x}/{y}.jpg
 * - Overlay de etiquetas vectoriales: streets-v4/style.json
 */
export default function MapHybrid({
  map,
  enabled,
  opacity,
  labelsOverlay,
  labelsStyleUrl,
  labelsOpacity = 1.0,
  apiKey,
}: MapHybridProps) {
  const rasterSourceId = "maptiler-satellite-raster";
  const rasterLayerId = "maptiler-satellite-raster-layer";
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!map || !enabled || !apiKey) {
      // Limpiar si está deshabilitado o falta API key
      if (map) {
        if (map.getLayer(rasterLayerId)) {
          try {
            map.removeLayer(rasterLayerId);
          } catch (e) {
            console.warn("[MapHybrid] Error removiendo capa raster:", e);
          }
        }
        if (map.getSource(rasterSourceId)) {
          try {
            map.removeSource(rasterSourceId);
          } catch (e) {
            console.warn("[MapHybrid] Error removiendo source raster:", e);
          }
        }
        removeLabelsOverlay(map);
      }
      initializedRef.current = false;
      return;
    }

    // Asegurar que el estilo esté cargado
    if (!map.isStyleLoaded()) {
      const onStyleLoad = () => {
        initializeLayers();
      };
      map.once("style.load", onStyleLoad);
      return () => {
        map.off("style.load", onStyleLoad);
      };
    }

    initializeLayers();
  }, [map, enabled, opacity, labelsOverlay, labelsStyleUrl, apiKey, labelsOpacity]);

  const initializeLayers = async () => {
    if (!map || !enabled || !apiKey || initializedRef.current) {
      return;
    }

    try {
      // 1. Obtener URL de tiles raster de satélite
      // Asumimos que la configuración tiene styleUrl que apunta a /maps/satellite/style.json
      // Necesitamos convertirlo a la URL de tiles
      const satelliteTileUrl = getSatelliteTileUrl(
        "https://api.maptiler.com/maps/satellite/style.json",
        apiKey
      );

      if (!satelliteTileUrl) {
        console.error("[MapHybrid] No se pudo obtener URL de tiles de satélite");
        return;
      }

      // 2. Añadir fuente raster de satélite
      if (!map.getSource(rasterSourceId)) {
        map.addSource(rasterSourceId, {
          type: "raster",
          tiles: [satelliteTileUrl],
          tileSize: 256,
          attribution: "© MapTiler © OpenStreetMap contributors",
        });
      }

      // 3. Añadir capa raster de satélite (antes de cualquier overlay)
      if (!map.getLayer(rasterLayerId)) {
        // Buscar antes de qué capa insertar (antes de overlays como radar, vuelos, etc.)
        const beforeId = findOverlayBeforeId();
        map.addLayer(
          {
            id: rasterLayerId,
            type: "raster",
            source: rasterSourceId,
            paint: {
              "raster-opacity": opacity,
            },
            minzoom: 0,
            maxzoom: 22,
          },
          beforeId
        );
      } else {
        // Actualizar opacidad si la capa ya existe
        map.setPaintProperty(rasterLayerId, "raster-opacity", opacity);
      }

      // 4. Añadir overlay de etiquetas vectoriales si está habilitado
      if (labelsOverlay && labelsStyleUrl) {
        await ensureLabelsOverlay(
          map,
          {
            enabled: true,
            style_url: labelsStyleUrl,
            opacity: labelsOpacity,
            layer_filter: null,
          },
          apiKey
        );
      } else {
        removeLabelsOverlay(map);
      }

      initializedRef.current = true;
    } catch (error) {
      console.error("[MapHybrid] Error inicializando capas:", error);
    }
  };

  const findOverlayBeforeId = (): string | undefined => {
    // Buscar capas de overlay comunes para insertar antes de ellas
    const overlayIds = [
      "geoscope-global-radar",
      "geoscope-global-satellite",
      "geoscope-weather",
      "geoscope-aemet-warnings",
      "geoscope-lightning",
      "geoscope-aircraft",
      "geoscope-ships",
    ];

    for (const id of overlayIds) {
      if (map.getLayer(id)) {
        return id;
      }
    }
    return undefined;
  };

  // Actualizar opacidad cuando cambie
  useEffect(() => {
    if (!map || !enabled || !map.getLayer(rasterLayerId)) {
      return;
    }

    try {
      map.setPaintProperty(rasterLayerId, "raster-opacity", opacity);
    } catch (error) {
      console.warn("[MapHybrid] Error actualizando opacidad:", error);
    }
  }, [opacity, map, enabled]);

  // Actualizar opacidad de etiquetas cuando cambie
  useEffect(() => {
    if (!map || !enabled) {
      return;
    }

    try {
      const layers = map.getStyle()?.layers ?? [];
      for (const layer of layers) {
        if (layer.id && layer.id.startsWith("labels-ov-")) {
          try {
            map.setPaintProperty(layer.id, "text-opacity", labelsOpacity);
            map.setPaintProperty(layer.id, "icon-opacity", labelsOpacity);
          } catch (e) {
            // Ignorar si la propiedad no existe
          }
        }
      }
    } catch (error) {
      console.warn("[MapHybrid] Error actualizando opacidad de etiquetas:", error);
    }
  }, [labelsOpacity, map, enabled]);

  return null; // Componente sin UI visual
}

