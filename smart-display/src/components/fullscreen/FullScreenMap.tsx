import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './FullScreenMap.css';

export const FullScreenMap: React.FC = React.memo(() => {

    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const mapLoaded = useRef(false); // To track if the 'load' event has fired

    useEffect(() => {
        if (map.current) return;
        if (!mapContainer.current) return;


        // Use standard OSM raster tiles for guaranteed availability without API keys
        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: {
                version: 8,
                sources: {
                    'osm': {
                        type: 'raster',
                        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                        tileSize: 256,
                        attribution: '&copy; OpenStreetMap Contributors'
                    }
                },
                layers: [
                    {
                        id: 'osm-tiles',
                        type: 'raster',
                        source: 'osm',
                        minzoom: 0,
                        maxzoom: 19
                    }
                ]
            },
            center: [-0.1014, 39.9378], // Vila-real
            zoom: 6
        });

        // Add controls
        map.current.addControl(new maplibregl.NavigationControl(), 'bottom-right');

        const handleMapLoad = async () => {
            if (mapLoaded.current) return; // Prevent double execution if timeout also triggers
            mapLoaded.current = true;
            try {
                await addSourcesAndLayers();
                startDataRefresh();
            } catch (error) {
                console.error("FullScreenMap: Error during map load and initialization:", error);
            }
        };

        map.current.on('load', handleMapLoad);

        // Fallback: If 'load' event doesn't fire within 3 seconds, try to initialize anyway
        const loadTimeout = setTimeout(() => {
            if (!mapLoaded.current) {
                console.warn("FullScreenMap: Map 'load' event did not fire within 3 seconds. Attempting to initialize layers and data refresh as fallback.");
                handleMapLoad(); // Call the same handler
            }
        }, 3000); // 3 seconds

        return () => {
            clearTimeout(loadTimeout);
            if (map.current) {
                map.current.off('load', handleMapLoad);
                map.current.remove();
                map.current = null;
            }
        };

    }, []);

    const addSourcesAndLayers = async () => {
        if (!map.current) return;
        const m = map.current;

        // Load Icons - Non-blocking where possible, but we need them for layers
        const loadImgPromise = (id: string, url: string) => {
            return new Promise<void>((resolve) => {
                let responded = false;
                const done = () => {
                    if (!responded) {
                        responded = true;
                        resolve();
                    }
                };

                // Timeout after 2 seconds
                setTimeout(() => {
                    if (!responded) {
                        console.warn(`Icon load timeout for ${id}`);
                        done();
                    }
                }, 2000);

                if (m.hasImage(id)) {
                    done();
                    return;
                }
                (m as any).loadImage(url, (error: any, image: any) => {
                    if (error) {
                        console.error(`Error loading icon ${id} at ${url}:`, error);
                        done();
                        return;
                    }
                    if (image && !m.hasImage(id)) {
                        m.addImage(id, image);
                        console.log(`Icon loaded: ${id}`);
                    }
                    done();
                });
            });
        };

        try {
            // Load icons concurrently
            await Promise.all([
                loadImgPromise('plane-icon', '/assets/img/map_plane.png'),
                loadImgPromise('ship-icon', '/assets/img/map_ship.png')
            ]);
        } catch (e) {
            console.error("Error loading icons:", e);
        }

        // Helper to safely add source
        const safeAddSource = (id: string, options: any) => {
            if (!m.getSource(id)) {
                try {
                    m.addSource(id, options);
                } catch (e) {
                    console.error(`Error adding source ${id}:`, e);
                }
            }
        };

        // Helper to safely add layer
        const safeAddLayer = (layer: any, beforeId?: string) => {
            if (!m.getLayer(layer.id)) {
                try {
                    m.addLayer(layer, beforeId);
                } catch (e) {
                    console.error(`Error adding layer ${layer.id}:`, e);
                }
            }
        };

        const emptyGeoJson = { type: 'FeatureCollection', features: [] };

        // --- Flights ---
        safeAddSource('flights', { type: 'geojson', data: emptyGeoJson });

        safeAddLayer({
            id: 'flights-circles',
            type: 'circle',
            source: 'flights',
            paint: {
                'circle-radius': 6,
                'circle-color': '#fbbf24',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000'
            }
        });

        safeAddLayer({
            id: 'flights-layer',
            type: 'symbol',
            source: 'flights',
            layout: {
                'icon-image': 'plane-icon',
                'icon-size': 0.15,
                'icon-rotate': ['-', ['coalesce', ['get', 'track'], ['get', 'true_track'], 0], 45],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });

        safeAddLayer({
            id: 'flights-labels',
            type: 'symbol',
            source: 'flights',
            layout: {
                'text-field': ['get', 'callsign'],
                'text-offset': [0, 2.5],
                'text-size': 14,
                'text-anchor': 'top',
                'text-allow-overlap': false
            },
            paint: {
                'text-color': '#fbbf24',
                'text-halo-color': '#000',
                'text-halo-width': 2
            }
        });

        // --- Ships ---
        safeAddSource('ships', { type: 'geojson', data: emptyGeoJson });

        safeAddLayer({
            id: 'ships-circles',
            type: 'circle',
            source: 'ships',
            paint: {
                'circle-radius': 5,
                'circle-color': '#0ea5e9',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000'
            }
        });

        safeAddLayer({
            id: 'ships-layer',
            type: 'symbol',
            source: 'ships',
            layout: {
                'icon-image': 'ship-icon',
                'icon-size': 0.12,
                'icon-rotate': ['-', ['get', 'course'], 45],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true
            }
        });

        // --- Lightning ---
        safeAddSource('lightning', { type: 'geojson', data: emptyGeoJson });

        safeAddLayer({
            id: 'lightning-heat',
            type: 'heatmap',
            source: 'lightning',
            paint: {
                'heatmap-color': [
                    'interpolate', ['linear'], ['heatmap-density'],
                    0, 'rgba(33,102,172,0)',
                    0.2, 'rgb(103,169,207)',
                    0.4, 'rgb(209,229,240)',
                    0.6, 'rgb(253,219,199)',
                    0.8, 'rgb(239,138,98)',
                    1, 'rgb(178,24,43)'
                ],
                'heatmap-opacity': 0.8
            }
        });

        safeAddLayer({
            id: 'lightning-points',
            type: 'circle',
            source: 'lightning',
            minzoom: 5,
            paint: {
                'circle-radius': 4,
                'circle-color': '#f43f5e',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff'
            }
        });

        // --- Radar ---
        updateRadarLayer();
    };

    const updateRadarLayer = async () => {
        try {
            const res = await fetch('/api/weather/radar');
            if (!res.ok) return;
            const data = await res.json();

            if (data.ok && data.url_template && map.current) {
                // url_template is available but we construct tileUrl manually from frames for precision
                // 2 = Universal Blue
                if (data.frames && data.frames.length > 0) {
                    const latestFrame = data.frames[data.frames.length - 1]; // Latest
                    const tileUrl = `${data.host}${latestFrame.path}/256/{z}/{x}/{y}/2/1_1.png`;

                    if (map.current.getSource('radar')) {
                        // Update is tricky for raster, usually cleaner to remove and add
                        // But we can check if url changed
                    } else {
                        map.current.addSource('radar', {
                            type: 'raster',
                            tiles: [tileUrl],
                            tileSize: 256
                        });

                        // Insert radar below labels but above tiles
                        const firstSymbolId = map.current.getStyle().layers.find(l => l.type === 'symbol')?.id;
                        map.current.addLayer({
                            id: 'radar-layer',
                            type: 'raster',
                            source: 'radar',
                            paint: { 'raster-opacity': 0.6 }
                        }, firstSymbolId);
                    }
                }
            }
        } catch (e) {
            console.error("Radar update failed", e);
        }
    };

    const [debugInfo, setDebugInfo] = React.useState<{ flightCount: number, shipCount: number, lastUpdate: string }>({
        flightCount: 0,
        shipCount: 0,
        lastUpdate: '-'
    });

    const startDataRefresh = () => {
        const fetchData = async () => {
            if (!map.current) return;
            const m = map.current; // Stable reference

            try {
                let flights = 0;
                let ships = 0;
                let statusMsg = 'OK';

                // Helper to ensure source exists
                const ensureSource = (id: string) => {
                    if (!m.getSource(id)) {
                        console.warn(`Source ${id} missing during refresh, re-adding...`);
                        try {
                            m.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                        } catch (e) {
                            console.error(`Failed to re-add source ${id}:`, e);
                            return false;
                        }
                    }
                    return true;
                };

                // Refresh Flights
                try {
                    const fRes = await fetch(`/api/layers/flights?_t=${Date.now()}`);
                    statusMsg = `F:${fRes.status}`;
                    if (fRes.ok) {
                        try {
                            const fData = await fRes.json();
                            if (ensureSource('flights')) {
                                const fSource: any = m.getSource('flights');
                                fSource.setData(fData);
                                flights = fData.features?.length || 0;
                                statusMsg += ` C:${flights}`;
                            }
                        } catch (parseErr) {
                            console.error("JSON Parse Error:", parseErr);
                            statusMsg += " ParseErr";
                        }
                    } else {
                        console.warn(`Flights: Fetch failed with status ${fRes.status}`);
                    }
                } catch (e) {
                    console.error("Flights fetch error:", e);
                    statusMsg = "FetchErr";
                }


                // Refresh Ships
                try {
                    const sRes = await fetch(`/api/layers/ships?_t=${Date.now()}`);
                    if (sRes.ok) {
                        const sData = await sRes.json();
                        if (ensureSource('ships')) {
                            const sSource: any = m.getSource('ships');
                            sSource.setData(sData);
                            ships = sData.features?.length || 0;
                        }
                    } else {
                        console.warn(`Ships: Fetch failed with status ${sRes.status}`);
                    }
                } catch (e) {
                    console.error("Ships fetch error:", e);
                }

                // Refresh Lightning
                try {
                    const lRes = await fetch(`/api/layers/lightning?_t=${Date.now()}`);
                    if (lRes.ok) {
                        const lData = await lRes.json();
                        if (ensureSource('lightning')) {
                            const lSource: any = m.getSource('lightning');
                            lSource.setData(lData);
                        }
                    } else {
                        console.warn(`Lightning: Fetch failed with status ${lRes.status}`);
                    }
                } catch (e) {
                    console.error("Lightning fetch error:", e);
                }

                // Update debug info
                setDebugInfo({
                    flightCount: flights,
                    shipCount: ships,
                    lastUpdate: new Date().toLocaleTimeString() + ` (${statusMsg})`
                });

                // Refresh Radar (every cycle)
                updateRadarLayer();
            } catch (err) {
                console.error("Map: Refresh failed", err);
                setDebugInfo(prev => ({ ...prev, lastUpdate: "Global Error" }));
            }
        };

        // Initial fetch immediately
        fetchData();

        // Schedule periodic refresh
        const refreshInterval = setInterval(fetchData, 30000);

        return () => clearInterval(refreshInterval);
    };

    return (
        <div className="fs-map-wrapper">
            <div ref={mapContainer} className="fs-map-container" />
            <div className="fs-map-debug" style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                background: 'red',
                color: 'white',
                padding: '10px',
                borderRadius: '5px',
                fontSize: '12px',
                fontFamily: 'monospace',
                pointerEvents: 'none'
            }}>
                <div>Flights: {debugInfo.flightCount}</div>
                <div>Ships: {debugInfo.shipCount}</div>
                <div>Updated: {debugInfo.lastUpdate}</div>
            </div>
        </div>
    );
});
