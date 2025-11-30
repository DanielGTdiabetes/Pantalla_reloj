import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Map as MaptilerMap } from "@maptiler/sdk";
import type { FeatureCollection, Point, Feature, Geometry, GeoJsonProperties } from "geojson";

import { apiGet } from "../../../lib/api";
import { withConfigDefaults } from "../../../config/defaults";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";
import type { LayerRegistry } from "./LayerRegistry";
import AircraftLayer from "./AircraftLayer";
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
    import { useEffect, useRef, useState, type MutableRefObject } from "react";
    import type { Map as MaptilerMap } from "@maptiler/sdk";
import type { FeatureCollection, Point, Feature, Geometry, GeoJsonProperties } from "geojson";

import { apiGet } from "../../../lib/api";
import { withConfigDefaults } from "../../../config/defaults";
import { layerDiagnostics, type LayerId } from "./LayerDiagnostics";
import type { LayerRegistry } from "./LayerRegistry";
import AircraftLayer from "./AircraftLayer";
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
    const aircraftLayerRef = useRef<AircraftLayer | null>(null);
    const [debugStatus, setDebugStatus] = useState<string>("Initializing...");

    useEffect(() => {
        console.log("[AircraftMapLayer] Mounted");

        // DEBUG: Add HTML Marker to verify map projection
        if (mapRef.current) {
            try {
                // @ts-ignore - Ignore TS error for Marker options for now to ensure runtime works
                new Marker({ color: "#FF0000" })
                    .setLngLat([-3.7038, 40.4168]) // Madrid
                    .addTo(mapRef.current);
                console.log("[AircraftMapLayer] Test Marker added to Madrid");
            } catch (e) {
                console.error("[AircraftMapLayer] Failed to add test marker:", e);
            }
        }

        if (!config || !mapRef.current || !mapReady || !layerRegistry) {
            setDebugStatus(`Preconditions failed: Cfg=${!!config} Map=${!!mapRef.current} Ready=${mapReady} Reg=${!!layerRegistry}`);
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
        const openskyEnabled = (openskyConfig.enabled ?? true) && (openskyConfig.oauth2?.has_credentials ?? true);

        if (!flightsEnabled || !openskyEnabled) {
            setDebugStatus(`Disabled: Flights=${flightsEnabled} OpenSky=${openskyEnabled}`);
            layerDiagnostics.setEnabled(layerId, false);
            return;
        }

        const aircraftLayer = layerRegistry.get("geoscope-aircraft") as AircraftLayer | undefined;
        if (!aircraftLayer) {
            setDebugStatus("Layer not found in registry");
            return;
        }

        aircraftLayerRef.current = aircraftLayer;
        aircraftLayer.setEnabled(true);
        layerDiagnostics.setEnabled(layerId, true);

        const loadFlightsData = async (): Promise<void> => {
            setDebugStatus(`Polling... ${new Date().toLocaleTimeString()}`);
            try {
                let bbox: string | undefined;
                const map = mapRef.current;

                if (map && map.isStyleLoaded()) {
                    const expandedBbox = getExpandedBbox(map, 1.5);
                    bbox = `${expandedBbox.lamin},${expandedBbox.lamax},${expandedBbox.lomin},${expandedBbox.lomax}`;
                }

                // FORCE Spain BBox for Mini PC debugging
                const spainBbox = "34.0,46.0,-12.0,6.0";
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
                    setDebugStatus(`Empty response ${new Date().toLocaleTimeString()}`);
                    // DEBUG: Force updateData even if response is empty
                    aircraftLayer.updateData({ type: "FeatureCollection", features: [] });
                    return;
                }

                const responseDisabled = !isFeatureCollection<Point, FlightFeatureProperties>(response) && response.disabled;

                if (!responseDisabled) {
                    try {
                        const featureCollection = flightsResponseToGeoJSON(response);
                        aircraftLayer.updateData(featureCollection);
                        setDebugStatus(`Updated: ${featureCollection.features?.length ?? 0} planes`);
                    } catch (conversionError) {
                        setDebugStatus("Conversion error");
                    }
                }
            } catch (error) {
                setDebugStatus(`Error: ${String(error)}`);
                // DEBUG: Force updateData even on error
                if (aircraftLayerRef.current) {
                    aircraftLayerRef.current.updateData({ type: "FeatureCollection", features: [] });
                }
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
    }, [config, layerRegistry, mapReady]);

    return (
        <div style={{
            position: 'absolute',
            bottom: 10,
            left: 10,
            backgroundColor: 'rgba(0,0,0,0.8)',
            color: '#00ff00',
            padding: '8px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '12px',
            zIndex: 9999,
            pointerEvents: 'none',
            maxWidth: '300px',
            whiteSpace: 'pre-wrap'
        }}>
            [Aircraft Debug]<br />
            {debugStatus}
        </div>
    );
}
