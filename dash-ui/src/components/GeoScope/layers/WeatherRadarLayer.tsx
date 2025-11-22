import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { RadarLayer } from "@maptiler/weather";
import { config as maptilerConfig } from "@maptiler/sdk";
import "@maptiler/sdk/dist/maptiler-sdk.css";
import { getSafeMapStyle } from "../../../lib/map/utils/safeMapStyle";
import { waitForMapReady } from "../../../lib/map/utils/waitForMapReady";
import { extractMaptilerApiKey } from "../../../lib/map/maptilerRuntime";
import type { AppConfigV2, GlobalRadarLayerConfigV2 } from "../../../types/config_v2";

interface WeatherRadarLayerOptions {
  enabled?: boolean;
  opacity?: number;
  animationSpeed?: number;
  map?: maplibregl.Map | null;
  config?: AppConfigV2 | null;
  health?: { maptiler?: { has_api_key?: boolean } } | null;
}

/**
 * Weather radar layer using MapTiler Weather JS (replaces RainViewer legacy tiles).
 * 
 * Esta capa usa @maptiler/weather RadarLayer para mostrar datos de radar/precipitación globales.
 * Reemplaza la capa legacy GlobalRadarLayer que usaba RainViewer.
 * 
 * Features:
 * - Uses @maptiler/weather RadarLayer for precipitation/radar data
 * - Requires MapTiler API key configured globally
 * - Automatically animates radar frames
 * - Positioned below water layer for proper rendering
 * 
 * Solo se inicializa cuando config.layers.global.radar.provider === "maptiler_weather" (default).
 * Para usar RainViewer legacy, configurar provider === "rainviewer" (usa GlobalRadarLayer).
 */
export default function WeatherRadarLayer({
  enabled = false,
  opacity = 0.7,
  animationSpeed = 1,
  map,
  config,
  health,
}: WeatherRadarLayerOptions): null {
  const radarLayerRef = useRef<RadarLayer | null>(null);
  const initializedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Early exit if disabled or missing dependencies
    if (!enabled || !map || !config) {
      if (radarLayerRef.current && map) {
        // Cleanup existing layer if disabling
        try {
          radarLayerRef.current.animate(0); // Stop animation
          if (map.getLayer("geoscope-weather-radar")) {
            map.removeLayer("geoscope-weather-radar");
          }
          const source = map.getSource("geoscope-weather-radar");
          if (source) {
            map.removeSource("geoscope-weather-radar");
          }
        } catch (e) {
          console.warn("[WeatherRadarLayer] Error during cleanup:", e);
        }
        radarLayerRef.current = null;
        initializedRef.current = false;
      }
      return;
    }

    // Check provider - only initialize if provider is maptiler_weather
    // Leer configuración desde layers.global.radar (prioridad) o ui_global.radar
    const radarConfigFromLayers = config.layers?.global_?.radar ?? config.layers?.global?.radar;
    const radarConfigFromUI = config.ui_global?.radar;
    
    // Merge configs: layers.global.radar takes precedence, fallback to ui_global.radar with defaults
    // Si viene de ui_global.radar, solo aceptar si provider es "maptiler_weather"
    // RadarConfig no tiene opacity, así que usamos un cast seguro o valor por defecto
    const radarConfig: GlobalRadarLayerConfigV2 | undefined = radarConfigFromLayers ?? 
      (radarConfigFromUI && radarConfigFromUI.provider === "maptiler_weather" ? {
        enabled: radarConfigFromUI.enabled ?? false,
        provider: "maptiler_weather" as const,
        opacity: (radarConfigFromUI as any).opacity ?? 0.7,
        animation_speed: 1.0, // Default animation speed
      } : undefined);
    
    // Default a maptiler_weather si no hay configuración
    const provider = radarConfig?.provider ?? "maptiler_weather";
    if (provider !== "maptiler_weather") {
      console.log(`[WeatherRadarLayer] Provider is "${provider}", skipping (only maptiler_weather is supported)`);
      return;
    }

    // Extract and configure MapTiler API key
    const apiKey = extractMaptilerApiKey(config as any, health);
    if (!apiKey) {
      console.warn("[WeatherRadarLayer] MapTiler API key not available, skipping radar layer");
      return;
    }

    // Configure MapTiler SDK globally
    maptilerConfig.apiKey = apiKey;

    // Initialize radar layer
    const initializeRadar = async () => {
      if (initializedRef.current || !map) {
        return;
      }

      try {
        // Wait for map to be ready
        await waitForMapReady(map);

        const style = getSafeMapStyle(map);
        if (!style) {
          console.warn("[WeatherRadarLayer] Style not ready, skipping initialization");
          return;
        }

        // Find water layer to insert radar below it
        const styleLayers = Array.isArray(style.layers) ? style.layers : [];
        let waterLayerId: string | undefined;
        
        // Look for water layer by common IDs
        for (const layer of styleLayers) {
          const id = layer.id?.toLowerCase() || "";
          if (id.includes("water") || id.includes("ocean") || id.includes("sea")) {
            waterLayerId = layer.id;
            break;
          }
        }

        // If no water layer found, use first fill layer as fallback
        if (!waterLayerId) {
          for (const layer of styleLayers) {
            if (layer.type === "fill") {
              waterLayerId = layer.id;
              break;
            }
          }
        }

        // Create radar layer
        const radar = new RadarLayer({
          id: "geoscope-weather-radar",
          opacity: opacity,
        });

        // Add layer to map (RadarLayer implements MapLibre layer interface)
        // Type assertion needed because RadarLayer from @maptiler/weather is compatible but types don't match exactly
        if (waterLayerId) {
          map.addLayer(radar as any, waterLayerId);
          // Make water slightly transparent for better radar visibility
          try {
            const waterLayer = map.getLayer(waterLayerId);
            if (waterLayer && waterLayer.type === "fill") {
              map.setPaintProperty(waterLayerId, "fill-color", "rgba(0, 0, 0, 0.5)");
            }
          } catch (e) {
            // Ignore if property doesn't exist or can't be set
            console.debug("[WeatherRadarLayer] Could not set water fill-color:", e);
          }
        } else {
          // Fallback: add at the end (before labels if possible)
          const labelLayer = styleLayers.find((l: any) => l.type === "symbol");
          if (labelLayer && labelLayer.id) {
            map.addLayer(radar as any, labelLayer.id);
          } else {
            map.addLayer(radar as any);
          }
        }

        // Start animation when source is ready
        radar.on("sourceReady", () => {
          console.log("[WeatherRadarLayer] Source ready, starting animation");
          radar.animate(animationSpeed);
        });

        radarLayerRef.current = radar;
        initializedRef.current = true;

        console.log("[WeatherRadarLayer] Initialized with MapTiler Weather");

        // Setup cleanup function
        cleanupRef.current = () => {
          try {
            if (radarLayerRef.current) {
              radarLayerRef.current.animate(0); // Stop animation
            }
            if (map.getLayer("geoscope-weather-radar")) {
              map.removeLayer("geoscope-weather-radar");
            }
            const source = map.getSource("geoscope-weather-radar");
            if (source) {
              map.removeSource("geoscope-weather-radar");
            }
          } catch (e) {
            console.warn("[WeatherRadarLayer] Error during cleanup:", e);
          }
          radarLayerRef.current = null;
          initializedRef.current = false;
        };
      } catch (error) {
        console.error("[WeatherRadarLayer] Error initializing radar:", error);
      }
    };

    // Handle style changes
    const handleStyleData = () => {
      if (initializedRef.current) {
        // Reinitialize if style changes
        initializedRef.current = false;
        if (radarLayerRef.current) {
          try {
            radarLayerRef.current.animate(0);
            if (map.getLayer("geoscope-weather-radar")) {
              map.removeLayer("geoscope-weather-radar");
            }
            const source = map.getSource("geoscope-weather-radar");
            if (source) {
              map.removeSource("geoscope-weather-radar");
            }
          } catch (e) {
            // Ignore errors during cleanup
          }
          radarLayerRef.current = null;
        }
        void initializeRadar();
      }
    };

    map.on("styledata", handleStyleData);
    void initializeRadar();

    // Cleanup on unmount or when dependencies change
    return () => {
      map.off("styledata", handleStyleData);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [enabled, map, config, health, opacity, animationSpeed]);

  // Update opacity if layer exists and opacity changes
  useEffect(() => {
    if (radarLayerRef.current && initializedRef.current) {
      try {
        radarLayerRef.current.setOpacity(opacity);
      } catch (e) {
        console.warn("[WeatherRadarLayer] Error updating opacity:", e);
      }
    }
  }, [opacity]);

  return null;
}

