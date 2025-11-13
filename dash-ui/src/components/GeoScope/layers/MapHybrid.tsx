import React, { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { getSatelliteTileUrl } from "../../../lib/map/utils/maptilerHelpers";
import { ensureLabelsOverlay, removeLabelsOverlay } from "../../../lib/map/overlays/vectorLabels";
import type { NormalizedLabelsOverlay } from "../../../lib/map/labelsOverlay";

export interface MapHybridProps {
  map: MapLibreMap;
  enabled: boolean;
  opacity: number;
  baseStyleUrl: string | null;
  labelsOverlay: NormalizedLabelsOverlay;
  apiKey: string | null | undefined;
}

const maskUrl = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return value ?? null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.searchParams.has("key")) {
      url.searchParams.set("key", "***");
      return url.toString();
    }
  } catch {
    // Ignorar errores de parseo
  }
  return trimmed;
};

/**
 * Componente MapHybrid: Renderiza modo híbrido MapTiler
 * - Fondo satélite raster: satellite/{z}/{x}/{y}.jpg
 * - Overlay de etiquetas vectoriales: streets-v4/style.json
 */
export default function MapHybrid({
  map,
  enabled,
  opacity,
  baseStyleUrl,
  labelsOverlay,
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
  }, [
    map,
    enabled,
    opacity,
    baseStyleUrl,
    labelsOverlay.enabled,
    labelsOverlay.style_url,
    labelsOverlay.layer_filter,
    labelsOverlay.opacity,
    apiKey,
  ]);

  const initializeLayers = async () => {
    if (!map || !enabled || !apiKey) {
      return;
    }

    try {
      const styleUrlCandidate =
        baseStyleUrl && baseStyleUrl.trim().length > 0
          ? baseStyleUrl
          : "https://api.maptiler.com/maps/satellite/style.json";

      const satelliteTileUrl = getSatelliteTileUrl(styleUrlCandidate, apiKey);

      if (!satelliteTileUrl) {
        console.error("[MapHybrid] No se pudo obtener URL de tiles de satélite");
        return;
      }

      if (!map.getSource(rasterSourceId)) {
        map.addSource(rasterSourceId, {
          type: "raster",
          tiles: [satelliteTileUrl],
          tileSize: 256,
          attribution: "© MapTiler © OpenStreetMap contributors",
        });
      }

      if (!map.getLayer(rasterLayerId)) {
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
        map.setPaintProperty(rasterLayerId, "raster-opacity", opacity);
      }

      if (labelsOverlay.enabled && labelsOverlay.style_url) {
        await ensureLabelsOverlay(
          map,
          {
            enabled: true,
            style_url: labelsOverlay.style_url,
            opacity: labelsOverlay.opacity,
            layer_filter: labelsOverlay.layer_filter ?? null,
          },
          apiKey
        );
      } else {
        removeLabelsOverlay(map);
      }

      if (!initializedRef.current) {
        const maskedBase = maskUrl(styleUrlCandidate);
        const maskedLabels = labelsOverlay.enabled ? maskUrl(labelsOverlay.style_url) : null;
        console.info(
          `[MapHybrid] Hybrid mode enabled: base=${maskedBase ?? "n/a"} labels=${maskedLabels ?? "none"} opacity=${opacity.toFixed(2)}`,
          {
            labels_opacity: labelsOverlay.opacity,
            layer_filter: labelsOverlay.layer_filter ?? null,
          }
        );
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
            map.setPaintProperty(layer.id, "text-opacity", labelsOverlay.opacity);
            map.setPaintProperty(layer.id, "icon-opacity", labelsOverlay.opacity);
          } catch (e) {
            // Ignorar si la propiedad no existe
          }
        }
      }
    } catch (error) {
      console.warn("[MapHybrid] Error actualizando opacidad de etiquetas:", error);
    }
  }, [labelsOverlay.opacity, map, enabled]);

  return null; // Componente sin UI visual
}

