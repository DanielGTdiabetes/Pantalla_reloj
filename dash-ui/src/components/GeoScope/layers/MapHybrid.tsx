import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, LayerSpecification } from "maplibre-gl";

export interface MapHybridProps {
  map: MapLibreMap;
  enabled: boolean;
  opacity: number;
  labelsOverlay: boolean;
  labelsStyleUrl: string;
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
  apiKey,
}: MapHybridProps) {
  const rasterSourceId = "maptiler-satellite-raster";
  const rasterLayerId = "maptiler-satellite-raster-layer";
  const labelsSourceId = "maptiler-satellite-labels";
  const labelsLayerId = "maptiler-satellite-labels-layer";
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!map || !enabled || !apiKey) {
      // Limpiar si está deshabilitado o falta API key
      if (map) {
        if (map.getLayer(rasterLayerId)) {
          map.removeLayer(rasterLayerId);
        }
        if (map.getSource(rasterSourceId)) {
          map.removeSource(rasterSourceId);
        }
        if (map.getLayer(labelsLayerId)) {
          map.removeLayer(labelsLayerId);
        }
        if (map.getSource(labelsSourceId)) {
          map.removeSource(labelsSourceId);
        }
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
  }, [map, enabled, opacity, labelsOverlay, labelsStyleUrl, apiKey]);

  const initializeLayers = () => {
    if (!map || !enabled || !apiKey || initializedRef.current) {
      return;
    }

    try {
      // 1. Añadir fuente raster de satélite
      if (!map.getSource(rasterSourceId)) {
        map.addSource(rasterSourceId, {
          type: "raster",
          tiles: [`https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${apiKey}`],
          tileSize: 256,
          attribution: "© MapTiler © OpenStreetMap contributors",
        });
      }

      // 2. Añadir capa raster de satélite
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

      // 3. Añadir overlay de etiquetas vectoriales si está habilitado
      if (labelsOverlay && labelsStyleUrl) {
        if (!map.getSource(labelsSourceId)) {
          // Cargar el estilo de etiquetas y extraer las capas de labels
          loadLabelsStyle(labelsStyleUrl, apiKey);
        } else {
          // Actualizar visibilidad de las capas de labels
          updateLabelsVisibility(true);
        }
      } else {
        // Remover capas de labels si están deshabilitadas
        updateLabelsVisibility(false);
      }

      initializedRef.current = true;
    } catch (error) {
      console.error("[MapHybrid] Error inicializando capas:", error);
    }
  };

  const loadLabelsStyle = async (styleUrl: string, key: string) => {
    try {
      // Añadir API key a la URL si no está presente
      let url = styleUrl;
      if (key && !url.includes("?key=") && !url.includes("&key=")) {
        const separator = url.includes("?") ? "&" : "?";
        url = `${url}${separator}key=${key}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load labels style: ${response.status}`);
      }

      const style = await response.json();

      // Añadir fuente vectorial para las etiquetas
      if (style.sources && Object.keys(style.sources).length > 0) {
        const firstSourceKey = Object.keys(style.sources)[0];
        const firstSource = style.sources[firstSourceKey];

        if (!map.getSource(labelsSourceId)) {
          map.addSource(labelsSourceId, {
            type: "vector",
            url: firstSource.url || firstSource.tiles?.[0] || "",
            ...(firstSource.tiles ? { tiles: firstSource.tiles } : {}),
          });
        }

        // Añadir capas de labels del estilo
        if (style.layers && Array.isArray(style.layers)) {
          const labelLayers = style.layers.filter((layer: any) => {
            const id = (layer.id || "").toLowerCase();
            const hasTextField = layer.layout?.["text-field"] !== undefined;
            return (
              hasTextField ||
              id.includes("label") ||
              id.includes("name") ||
              id.includes("text") ||
              id.includes("poi")
            );
          });

          const beforeId = findOverlayBeforeId();
          labelLayers.forEach((layer: any, index: number) => {
            const layerId = `${labelsLayerId}-${index}`;
            if (!map.getLayer(layerId)) {
              try {
                map.addLayer(
                  {
                    id: layerId,
                    type: "symbol",
                    source: labelsSourceId,
                    "source-layer": layer["source-layer"] || layer.source,
                    layout: layer.layout || {},
                    paint: layer.paint || {},
                    filter: layer.filter,
                    minzoom: layer.minzoom,
                    maxzoom: layer.maxzoom,
                  },
                  beforeId
                );
              } catch (err) {
                console.warn(`[MapHybrid] No se pudo añadir capa de label ${layerId}:`, err);
              }
            }
          });
        }
      }
    } catch (error) {
      console.error("[MapHybrid] Error cargando estilo de labels:", error);
    }
  };

  const updateLabelsVisibility = (visible: boolean) => {
    if (!map) return;

    const visibility = visible ? "visible" : "none";
    const layers = map.getStyle().layers || [];
    layers.forEach((layer: LayerSpecification) => {
      const id = layer.id;
      if (id && id.startsWith(labelsLayerId)) {
        try {
          map.setLayoutProperty(id, "visibility", visibility);
        } catch (err) {
          // Ignorar errores si la capa no existe
        }
      }
    });
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

  return null; // Componente sin UI visual
}

