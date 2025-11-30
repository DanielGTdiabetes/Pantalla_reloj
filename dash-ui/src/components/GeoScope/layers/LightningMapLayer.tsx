import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Marker, type Map as MaptilerMap } from "@maptiler/sdk";
import type { FeatureCollection, Point, Feature, Geometry, GeoJsonProperties } from "geojson";

import { apiGet } from "../../../lib/api";
import { withConfigDefaults } from "../../../config/defaults";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";
import type { LayerRegistry } from "./LayerRegistry";
import type { AppConfig } from "../../../types/config";

type LightningFeatureProperties = {
    timestamp?: number;
    intensity?: number;
    opacity?: number;
    age_seconds?: number;
};

type LightningMapLayerProps = {
    mapRef: MutableRefObject<MaptilerMap | null>;
    layerRegistry: LayerRegistry | null;
    config: AppConfig | null;
    mapReady: boolean;
};

const isFeatureCollection = <G extends Geometry, P extends GeoJsonProperties = GeoJsonProperties>(
    value: unknown
): value is FeatureCollection<G, P> => {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as FeatureCollection<G, P>;
    return candidate.type === "FeatureCollection" && Array.isArray(candidate.features);
};

/**
 * Retry helper con backoff exponencial
 */
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    baseDelayMs: number,
    layerId: LayerId,
    operation: string
): Promise<T | null> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt < maxRetries - 1) {
                const delayMs = baseDelayMs * Math.pow(2, attempt);
                console.warn(
                    `[${layerId}] ${operation} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms...`,
                    lastError
                );
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    if (lastError) {
        layerDiagnostics.recordError(layerId, lastError, {
            phase: operation,
            retriesExhausted: true,
        });
    }

    return null;
}

/**
 * Componente funcional que maneja el polling de rayos y actualiza LightningLayer (HTML Markers)
 */
export default function LightningMapLayer({
    mapRef,
    layerRegistry,
    config,
    mapReady,
}: LightningMapLayerProps) {
    const [debugStatus, setDebugStatus] = useState<string>("Initializing...");

    useEffect(() => {
        console.log("[LightningMapLayer] Mounted");

        if (!config || !mapRef.current || !mapReady || !layerRegistry) {
            setDebugStatus(`Preconditions failed: Cfg=${!!config} Map=${!!mapRef.current} Ready=${mapReady} Reg=${!!layerRegistry}`);
            return;
        }

        const merged = withConfigDefaults(config);
        // Lightning config might be nested in global or separate, checking defaults
        // Assuming it's enabled by default or part of global layers if not explicitly in config types
        // For now, we'll assume it's enabled if not explicitly disabled in a hypothetical config
        const lightningEnabled = true; // TODO: Check actual config if available

        const layerId: LayerId = "lightning" as LayerId; // Casting as it might not be in LayerId type yet
        const MAX_RETRIES = 3;

        if (!lightningEnabled) {
            setDebugStatus(`Disabled`);
            // layerDiagnostics.setEnabled(layerId, false);
            return;
        }

        // layerDiagnostics.setEnabled(layerId, true);

        const loadLightningData = async (): Promise<void> => {
            const map = mapRef.current;
            if (!map) return;

            try {
                // Fetch global lightning or bbox? API seems to support bbox but we can fetch all for now
                // The API definition says: getLightning(bbox?: string)

                let url = "/api/lightning";
                // Optional: add bbox if needed, but lightning is usually sparse enough to fetch globally or large area

                const response = await retryWithBackoff(
                    async () => {
                        // The API returns { features: [...] } which is compatible with FeatureCollection structure
                        const resp = await apiGet<FeatureCollection<Point, LightningFeatureProperties> | undefined>(url);
                        if (!resp) throw new Error("Empty response");
                        return resp;
                    },
                    MAX_RETRIES,
                    1000,
                    layerId,
                    "loadLightningData"
                );

                if (!response) {
                    return;
                }

                if (response.features) { // Check if features exist
                    try {
                        const features = response.features;

                        // HTML MARKER RENDERING
                        if (map) {
                            const MAX_MARKERS = 200; // Limit lightning markers
                            // Sort by timestamp descending (newest first)
                            const sortedFeatures = features.sort((a, b) => {
                                const ta = a.properties?.timestamp ?? 0;
                                const tb = b.properties?.timestamp ?? 0;
                                return tb - ta;
                            }).slice(0, MAX_MARKERS);

                            const currentIds = new Set<string>();

                            // Initialize marker cache if needed
                            if (!(window as any)._lightningMarkers) {
                                (window as any)._lightningMarkers = new Map<string, Marker>();
                            }
                            const markerMap = (window as any)._lightningMarkers as Map<string, Marker>;

                            const now = Date.now() / 1000;
                            const maxAgeSeconds = 1800; // 30 mins
                            const decayStartSeconds = 600; // 10 mins

                            sortedFeatures.forEach((feature, index) => {
                                const id = String(index); // Simple index based ID for now as features might not have stable IDs
                                // Better to use coordinates as ID key if possible to avoid flickering
                                const coords = feature.geometry.coordinates as [number, number];
                                const uniqueId = `${coords[0].toFixed(4)}_${coords[1].toFixed(4)}`;
                                currentIds.add(uniqueId);

                                const timestamp = feature.properties?.timestamp ?? now;
                                const ageSeconds = now - timestamp;

                                if (ageSeconds > maxAgeSeconds) return; // Skip old

                                // Calculate opacity
                                let opacity = 1.0;
                                if (ageSeconds > decayStartSeconds) {
                                    const decayProgress = (ageSeconds - decayStartSeconds) / (maxAgeSeconds - decayStartSeconds);
                                    opacity = 1.0 * (1 - decayProgress);
                                    opacity = Math.max(0.1, opacity);
                                }

                                let marker = markerMap.get(uniqueId);

                                if (!marker) {
                                    // Create new marker
                                    const el = document.createElement('div');
                                    el.className = 'lightning-marker';
                                    el.style.width = '24px';
                                    el.style.height = '24px';
                                    // Lightning bolt icon (yellow with orange stroke)
                                    el.style.backgroundImage = 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23fcd34d\' stroke=\'%23f59e0b\' stroke-width=\'1.5\'%3E%3Cpath d=\'M13 2L3 14h9l-1 8 10-12h-9l1-8z\'/%3E%3C/svg%3E")';
                                    el.style.backgroundSize = 'contain';
                                    el.style.backgroundRepeat = 'no-repeat';
                                    el.style.filter = 'drop-shadow(0 0 4px rgba(252, 211, 77, 0.6))'; // Glow effect
                                    el.style.opacity = String(opacity);
                                    el.style.zIndex = '80'; // Below ships

                                    // @ts-ignore
                                    const newMarker = new Marker({ element: el })
                                        .setLngLat(coords)
                                        .addTo(map);

                                    markerMap.set(uniqueId, newMarker);
                                } else {
                                    // Update existing opacity
                                    const el = marker.getElement();
                                    el.style.opacity = String(opacity);
                                }
                            });

                            // Remove stale markers
                            for (const [id, marker] of markerMap.entries()) {
                                if (!currentIds.has(id)) {
                                    marker.remove();
                                    markerMap.delete(id);
                                }
                            }
                            setDebugStatus(`Updated (HTML): ${sortedFeatures.length} lightning`);
                        }

                    } catch (e) {
                        console.error("Error updating lightning data", e);
                    }
                }
            } catch (error) {
                console.error("Error loading lightning:", error);
                setDebugStatus("Error loading lightning");
            }
        };

        void loadLightningData();

        const intervalSeconds = 15; // Fast refresh for lightning
        const intervalMs = intervalSeconds * 1000;
        const intervalId = setInterval(() => {
            void loadLightningData();
        }, intervalMs);

        return () => {
            clearInterval(intervalId);
        };
    }, [config, layerRegistry, mapReady]);

    return null;
}
