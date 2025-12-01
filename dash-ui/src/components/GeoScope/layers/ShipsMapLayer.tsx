import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Marker, type Map as MaptilerMap } from "@maptiler/sdk";
import type { FeatureCollection, Point, Feature, Geometry, GeoJsonProperties } from "geojson";

import { apiGet } from "../../../lib/api";
import { withConfigDefaults } from "../../../config/defaults";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";
import type { LayerRegistry } from "./LayerRegistry";
import type { AppConfig } from "../../../types/config";

type ShipFeatureProperties = {
    mmsi?: string;
    name?: string;
    course?: number;
    speed?: number;
    timestamp?: number;
    type?: string;
    in_focus?: boolean;
    stale?: boolean;
};

type ShipsMapLayerProps = {
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
 * Obtiene un bbox expandido del mapa actual con un factor de expansión.
 */
function getExpandedBbox(map: MaptilerMap, expandFactor: number = 1.5): {
    lamin: number;
    lamax: number;
    lomin: number;
    lomax: number;
} {
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const latSpan = ne.lat - sw.lat;
    const lonSpan = ne.lng - sw.lng;

    const latExpansion = latSpan * (expandFactor - 1);
    const lonExpansion = lonSpan * (expandFactor - 1);

    return {
        lamin: sw.lat - latExpansion,
        lamax: ne.lat + latExpansion,
        lomin: sw.lng - lonExpansion,
        lomax: ne.lng + lonExpansion,
    };
}

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
 * Componente funcional que maneja el polling de barcos y actualiza ShipsLayer
 */
export default function ShipsMapLayer({
    mapRef,
    layerRegistry,
    config,
    mapReady,
}: ShipsMapLayerProps) {
    const [debugStatus, setDebugStatus] = useState<string>("Initializing...");

    useEffect(() => {
        console.log("[ShipsMapLayer] Mounted (HTML Mode)");

        if (!config || !mapRef.current || !mapReady) {
            setDebugStatus(`Preconditions failed: Cfg=${!!config} Map=${!!mapRef.current} Ready=${mapReady}`);
            return;
        }

        const merged = withConfigDefaults(config);
        const shipsConfig = merged.layers?.ships;
        const layerId: LayerId = "ships";
        const MAX_RETRIES = 3;

        if (!shipsConfig) {
            setDebugStatus("No ships config");
            layerDiagnostics.setEnabled(layerId, false);
            return;
        }

        const shipsEnabled = shipsConfig.enabled ?? false;

        if (!shipsEnabled) {
            setDebugStatus(`Disabled: Ships=${shipsEnabled}`);
            layerDiagnostics.setEnabled(layerId, false);
            return;
        }

        layerDiagnostics.setEnabled(layerId, true);

        const loadShipsData = async (): Promise<void> => {
            const map = mapRef.current;

            try {
                let bbox: string | undefined;

                if (map && map.isStyleLoaded()) {
                    const expandedBbox = getExpandedBbox(map, 1.5);
                    bbox = `${expandedBbox.lamin},${expandedBbox.lamax},${expandedBbox.lomin},${expandedBbox.lomax}`;
                }

                // FORCE Spain BBox for Mini PC debugging
                const spainBbox = "35.0,44.0,-10.0,4.5";
                if (typeof window !== "undefined") {
                    if (window.innerWidth < 2500 || !bbox) {
                        bbox = spainBbox;
                    }
                } else if (!bbox) {
                    bbox = spainBbox;
                }

                let url = "/api/layers/ships";
                const params = new URLSearchParams();
                if (bbox) {
                    params.append("bbox", bbox);
                }
                if (params.toString()) {
                    url += `?${params.toString()}`;
                }

                const response = await retryWithBackoff(
                    async () => {
                        const resp = await apiGet<FeatureCollection<Point, ShipFeatureProperties> | undefined>(url);
                        if (!resp) throw new Error("Empty response");
                        return resp;
                    },
                    MAX_RETRIES,
                    1000,
                    layerId,
                    "loadShipsData"
                );

                if (!response) {
                    return;
                }

                if (isFeatureCollection<Point, ShipFeatureProperties>(response)) {
                    try {
                        const featureCollection = response;

                        // HTML MARKER RENDERING
                        if (map) {
                            const MAX_MARKERS = 500;
                            const features = featureCollection.features.slice(0, MAX_MARKERS);
                            const currentIds = new Set<string>();

                            // Initialize marker cache if needed
                            if (!(window as any)._shipsMarkers) {
                                (window as any)._shipsMarkers = new Map<string, Marker>();
                            }
                            const markerMap = (window as any)._shipsMarkers as Map<string, Marker>;

                            features.forEach(feature => {
                                const id = String(feature.id || feature.properties.mmsi || Math.random());
                                currentIds.add(id);
                                const coords = feature.geometry.coordinates as [number, number];
                                const course = feature.properties.course ?? 0;

                                let marker = markerMap.get(id);

                                if (!marker) {
                                    // Create new marker
                                    const el = document.createElement('div');
                                    el.className = 'ship-marker';
                                    el.style.width = '20px';
                                    el.style.height = '20px';
                                    // Blue ship icon
                                    el.style.backgroundImage = 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%2338bdf8\' stroke=\'%23ffffff\' stroke-width=\'2\'%3E%3Cpath d=\'M3 14l1.5 5h15L21 14zM12 2L3 14h18z\'/%3E%3C/svg%3E")';
                                    el.style.backgroundSize = 'contain';
                                    el.style.backgroundRepeat = 'no-repeat';
                                    el.style.cursor = 'pointer';
                                    el.style.zIndex = '90'; // Below aircraft (100)

                                    // Remove rotationAlignment: 'map'
                                    // @ts-ignore
                                    const newMarker = new Marker({ element: el })
                                        .setLngLat(coords)
                                        .setRotation(course)
                                        .addTo(map);

                                    markerMap.set(id, newMarker);
                                } else {
                                    // Update existing
                                    marker.setLngLat(coords);
                                    marker.setRotation(course);
                                }
                            });

                            // Remove stale markers
                            for (const [id, marker] of markerMap.entries()) {
                                if (!currentIds.has(id)) {
                                    marker.remove();
                                    markerMap.delete(id);
                                }
                            }
                            setDebugStatus(`Updated (HTML): ${features.length} ships`);
                        }

                    } catch (e) {
                        console.error("Error updating ships data", e);
                    }
                }
            } catch (error) {
                console.error("Error loading ships:", error);
                setDebugStatus("Error loading ships");
            }
        };

        void loadShipsData();

        const intervalSeconds = Math.max(30, shipsConfig.refresh_seconds ?? 60); // Ships update slower
        const intervalMs = intervalSeconds * 1000;
        const intervalId = setInterval(() => {
            void loadShipsData();
        }, intervalMs);

        return () => {
            clearInterval(intervalId);
        };
    }, [config, mapReady]);

    return null;
}
