import { useEffect, useRef, type MutableRefObject } from "react";
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

    useEffect(() => {
        console.log("[AircraftMapLayer] Mounted");

        if (!config || !mapRef.current || !mapReady || !layerRegistry) {
            console.log("[AircraftMapLayer] Preconditions not met:", {
                hasConfig: !!config,
                hasMap: !!mapRef.current,
                mapReady,
                hasRegistry: !!layerRegistry,
            });
            return;
        }

        const merged = withConfigDefaults(config);
        const flightsConfig = merged.layers?.flights;
        const openskyConfig = merged.opensky ?? { enabled: true };
        const layerId: LayerId = "flights";
        const MAX_RETRIES = 3;

        console.log("[AircraftMapLayer] Config loaded:", {
            enabled: flightsConfig?.enabled,
            refresh_seconds: flightsConfig?.refresh_seconds,
            provider: flightsConfig?.provider,
        });

        if (!flightsConfig) {
            layerDiagnostics.setEnabled(layerId, false);
            console.warn("[AircraftMapLayer] flightsConfig is undefined, skipping polling");
            return;
        }

        const flightsEnabled = flightsConfig.enabled ?? false;
        const openskyEnabled = (openskyConfig.enabled ?? true) && (openskyConfig.oauth2?.has_credentials ?? true);

        if (!flightsEnabled || !openskyEnabled) {
            layerDiagnostics.setEnabled(layerId, false);
            console.log("[AircraftMapLayer] Flights disabled:", { flightsEnabled, openskyEnabled });
            return;
        }

        const aircraftLayer = layerRegistry.get("geoscope-aircraft") as AircraftLayer | undefined;
        if (!aircraftLayer) {
            console.warn("[AircraftMapLayer] AircraftLayer not found in registry");
            return;
        }

        aircraftLayerRef.current = aircraftLayer;

        // Habilitar la capa según la configuración
        aircraftLayer.setEnabled(true);

        console.log("[AircraftMapLayer] Starting polling");
        layerDiagnostics.setEnabled(layerId, true);

        const loadFlightsData = async (): Promise<void> => {
            try {
                if (!flightsEnabled || !openskyEnabled) {
                    layerDiagnostics.setEnabled(layerId, false);
                    return;
                }

                const map = mapRef.current;
                let bbox: string | undefined;

                if (map && map.isStyleLoaded()) {
                    const expandedBbox = getExpandedBbox(map, 1.5);
                    bbox = `${expandedBbox.lamin},${expandedBbox.lamax},${expandedBbox.lomin},${expandedBbox.lomax}`;

                    console.log(
                        "[AircraftMapLayer] BBOX:",
                        expandedBbox.lamin.toFixed(4),
                        expandedBbox.lamax.toFixed(4),
                        expandedBbox.lomin.toFixed(4),
                        expandedBbox.lomax.toFixed(4)
                    );

                    // Fallback for Mini PC (small screen) to ensure data availability
                    // The map is fixed to Spain on these devices, so we can safely force the bbox
                    // This prevents issues where map.getBounds() might return invalid values during init
                    if (typeof window !== "undefined") {
                        console.log("[AircraftMapLayer] Window width:", window.innerWidth);
                        if (window.innerWidth < 1280) {
                            const spainBbox = "34.0,46.0,-12.0,6.0"; // Generous Spain BBox
                            console.log("[AircraftMapLayer] Mini PC detected, forcing BBOX:", spainBbox);
                            bbox = spainBbox;
                        }
                    }
                }

                let url = "/api/layers/flights";
                const params = new URLSearchParams();
                if (bbox) {
                    params.append("bbox", bbox);
                }
                if (params.toString()) {
                    url += `?${params.toString()}`;
                }

                console.log("[AircraftMapLayer] Fetching:", url);

                const response = await retryWithBackoff(
                    async () => {
                        const resp = await apiGet<FlightsApiResponse | FeatureCollection<Point, FlightFeatureProperties> | undefined>(url);

                        if (!resp) {
                            throw new Error("Empty response from backend");
                        }

                        if (!isFeatureCollection<Point, FlightFeatureProperties>(resp) && resp.disabled) {
                            layerDiagnostics.setState(layerId, "disabled", {
                                reason: "backend_disabled",
                            });
                            return resp;
                        }

                        if (typeof resp !== "object") {
                            throw new Error(`Invalid response type: ${typeof resp}`);
                        }

                        return resp;
                    },
                    MAX_RETRIES,
                    1000,
                    layerId,
                    "loadFlightsData"
                );

                if (!response) {
                    layerDiagnostics.updatePreconditions(layerId, {
                        backendAvailable: false,
                    });
                    return;
                }

                layerDiagnostics.updatePreconditions(layerId, {
                    backendAvailable: true,
                });

                const responseDisabled = !isFeatureCollection<Point, FlightFeatureProperties>(response) && response.disabled;

                if (!responseDisabled) {
                    try {
                        const featureCollection = flightsResponseToGeoJSON(response);
                        console.log("[AircraftMapLayer] Features received:", featureCollection.features?.length ?? 0);

                        const currentLayer = aircraftLayerRef.current;
                        if (!currentLayer) {
                            console.warn("[AircraftMapLayer] AircraftLayer ref is null");
                            return;
                        }

                        currentLayer.updateData(featureCollection);
                        console.log("[AircraftMapLayer] Data updated successfully");
                    } catch (conversionError) {
                        const error = conversionError instanceof Error ? conversionError : new Error(String(conversionError));
                        layerDiagnostics.recordError(layerId, error, {
                            phase: "flightsResponseToGeoJSON",
                        });
                        console.error("[AircraftMapLayer] Conversion error:", conversionError);
                    }
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                layerDiagnostics.recordError(layerId, err, {
                    phase: "loadFlightsData",
                });
                console.error("[AircraftMapLayer] Load error:", error);
            }
        };

        // Cargar inmediatamente
        void loadFlightsData();

        // Polling periódico
        const intervalSeconds = Math.max(5, flightsConfig.refresh_seconds ?? 10);
        const intervalMs = intervalSeconds * 1000;
        const intervalId = setInterval(() => {
            void loadFlightsData();
        }, intervalMs);

        return () => {
            console.log("[AircraftMapLayer] Unmounting, clearing interval");
            clearInterval(intervalId);
        };
    }, [config, layerRegistry, mapReady]);

    // Este componente no renderiza nada visible
    return null;
}
