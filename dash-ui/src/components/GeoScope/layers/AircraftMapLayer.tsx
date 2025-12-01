import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Marker, type Map as MaptilerMap } from "@maptiler/sdk";
import type { FeatureCollection, Point, Feature, Geometry, GeoJsonProperties } from "geojson";

import { apiGet } from "../../../lib/api";
import { withConfigDefaults } from "../../../config/defaults";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";
import type { LayerRegistry } from "./LayerRegistry";
import type { AppConfig } from "../../../types/config";

type FlightFeatureProperties = {
    icao24?: string;
    callsign?: string;
    alt_baro?: number;
    track?: number;
    speed?: number;
    timestamp?: number;
    origin_country?: string;
    on_ground?: boolean;
    category?: string | number | null;
    vertical_rate?: number | null;
    squawk?: string | null;
    last_contact?: number | null;
    in_focus?: boolean;
    stale?: boolean;
};

type FlightsApiItem = {
    id: string;
    icao24?: string | null;
    callsign?: string | null;
    origin_country?: string | null;
    lon: number;
    lat: number;
    alt?: number | null;
    velocity?: number | null;
    vertical_rate?: number | null;
    track?: number | null;
    on_ground?: boolean;
    category?: string | number | null;
    squawk?: string | null;
    last_contact?: number | null;
    stale?: boolean | null;
};

type FlightsApiResponse = {
    count: number;
    ts?: number;
    stale?: boolean;
    disabled?: boolean;
    items: FlightsApiItem[];
};

type AircraftMapLayerProps = {
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

const flightsResponseToGeoJSON = (
    payload: FlightsApiResponse | FeatureCollection<Point, FlightFeatureProperties>
): FeatureCollection<Point, FlightFeatureProperties> => {
    if (!payload || typeof payload !== "object") {
        throw new Error("Invalid flights payload: expected object");
    }

    if (isFeatureCollection<Point, FlightFeatureProperties>(payload)) {
        return payload;
    }

    const timestampFallback = typeof payload.ts === "number" ? payload.ts : Math.floor(Date.now() / 1000);
    const features: Array<Feature<Point, FlightFeatureProperties>> = [];

    for (const item of payload.items) {
        if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) {
            continue;
        }
        const timestamp = typeof item.last_contact === "number" ? item.last_contact : timestampFallback;
        const isStale = item.stale === true;
        features.push({
            type: "Feature",
            id: item.id,
            geometry: {
                type: "Point",
                coordinates: [item.lon, item.lat],
            },
            properties: {
                icao24: item.icao24 ?? undefined,
                callsign: item.callsign ?? undefined,
                alt_baro: typeof item.alt === "number" ? item.alt : undefined,
                track: typeof item.track === "number" ? item.track : undefined,
                speed: typeof item.velocity === "number" ? item.velocity : undefined,
                origin_country: item.origin_country ?? undefined,
                on_ground: Boolean(item.on_ground),
                category: item.category ?? null,
                vertical_rate: typeof item.vertical_rate === "number" ? item.vertical_rate : undefined,
                squawk: item.squawk ?? null,
                timestamp,
                last_contact: typeof item.last_contact === "number" ? item.last_contact : undefined,
                stale: isStale ? true : undefined,
            },
        });
    }

    return {
        type: "FeatureCollection",
        features,
    };
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
 * Componente funcional que maneja el polling de vuelos y actualiza AircraftLayer
 */
export default function AircraftMapLayer({
    mapRef,
    layerRegistry,
    config,
    mapReady,
}: AircraftMapLayerProps) {
    const [debugStatus, setDebugStatus] = useState<string>("Initializing...");

    useEffect(() => {
        console.log("[AircraftMapLayer] Mounted (HTML Mode)");

        if (!config || !mapRef.current || !mapReady) {
            setDebugStatus(`Preconditions failed: Cfg=${!!config} Map=${!!mapRef.current} Ready=${mapReady}`);
            return;
        }

        const merged = withConfigDefaults(config);
        const flightsConfig = merged.layers?.flights;
        const openskyConfig = merged.opensky ?? { enabled: true };
        const layerId: LayerId = "flights";
        const MAX_RETRIES = 3;

        if (!flightsConfig) {
            setDebugStatus("No flights config");
            layerDiagnostics.setEnabled(layerId, false);
            return;
        }

        const flightsEnabled = flightsConfig.enabled ?? false;
        // Relaxed check: if openskyConfig is missing, assume enabled if flights are enabled
        const openskyEnabled = (openskyConfig.enabled ?? true);

        if (!flightsEnabled) {
            setDebugStatus(`Disabled: Flights=${flightsEnabled}`);
            layerDiagnostics.setEnabled(layerId, false);
            return;
        }

        layerDiagnostics.setEnabled(layerId, true);

        // FORCE ZOOM/CENTER for Mini PC
        if (mapRef.current) {
            // Only jump if we are very far away or at 0,0
            const center = mapRef.current.getCenter();
            if (center.lng === 0 && center.lat === 0) {
                mapRef.current.jumpTo({
                    center: [-3.7038, 40.4168], // Madrid
                    zoom: 5.0
                });
            }
        }

        const loadFlightsData = async (): Promise<void> => {
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

                let url = "/api/layers/flights";
                const params = new URLSearchParams();
                if (bbox) {
                    params.append("bbox", bbox);
                }
                if (params.toString()) {
                    url += `?${params.toString()}`;
                }

                const response = await retryWithBackoff(
                    async () => {
                        const resp = await apiGet<FlightsApiResponse | FeatureCollection<Point, FlightFeatureProperties> | undefined>(url);
                        if (!resp) throw new Error("Empty response");
                        return resp;
                    },
                    MAX_RETRIES,
                    1000,
                    layerId,
                    "loadFlightsData"
                );

                if (!response) {
                    return;
                }

                const responseDisabled = !isFeatureCollection<Point, FlightFeatureProperties>(response) && response.disabled;

                if (!responseDisabled) {
                    try {
                        const featureCollection = flightsResponseToGeoJSON(response);

                        // HTML MARKER RENDERING
                        if (map) {
                            const MAX_MARKERS = 500; // Increased limit for user request
                            const features = featureCollection.features.slice(0, MAX_MARKERS);
                            const currentIds = new Set<string>();

                            // Initialize marker cache if needed
                            if (!(window as any)._aircraftMarkers) {
                                (window as any)._aircraftMarkers = new Map<string, Marker>();
                            }
                            const markerMap = (window as any)._aircraftMarkers as Map<string, Marker>;

                            features.forEach(feature => {
                                const id = String(feature.id || feature.properties.icao24 || Math.random());
                                currentIds.add(id);
                                const coords = feature.geometry.coordinates as [number, number];
                                const track = feature.properties.track ?? 0;

                                let marker = markerMap.get(id);

                                if (!marker) {
                                    // Create new marker
                                    const el = document.createElement('div');
                                    el.className = 'aircraft-marker';
                                    el.style.width = '24px';
                                    el.style.height = '24px';
                                    el.style.backgroundImage = 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23f97316\' stroke=\'%23ffffff\' stroke-width=\'2\'%3E%3Cpath d=\'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z\'/%3E%3C/svg%3E")';
                                    el.style.backgroundSize = 'contain';
                                    el.style.backgroundRepeat = 'no-repeat';
                                    el.style.cursor = 'pointer';
                                    el.style.zIndex = '100'; // Ensure on top

                                    // Remove rotationAlignment: 'map' which might be causing issues
                                    // @ts-ignore
                                    const newMarker = new Marker({ element: el })
                                        .setLngLat(coords)
                                        .setRotation(track)
                                        .addTo(map);

                                    markerMap.set(id, newMarker);
                                } else {
                                    // Update existing
                                    marker.setLngLat(coords);
                                    marker.setRotation(track);
                                }
                            });

                            // Remove stale markers
                            for (const [id, marker] of markerMap.entries()) {
                                if (!currentIds.has(id)) {
                                    marker.remove();
                                    markerMap.delete(id);
                                }
                            }
                            setDebugStatus(`Updated (HTML): ${features.length} aircraft`);
                        }

                    } catch (e) {
                        console.error("Error updating aircraft data", e);
                    }
                }
            } catch (error) {
                console.error("Error loading flights:", error);
                setDebugStatus("Error loading flights");
            }
        };

        void loadFlightsData();

        const intervalSeconds = Math.max(5, flightsConfig.refresh_seconds ?? 10);
        const intervalMs = intervalSeconds * 1000;
        const intervalId = setInterval(() => {
            void loadFlightsData();
        }, intervalMs);

        return () => {
            clearInterval(intervalId);
        };
    }, [config, mapReady]);

    return null;
}
