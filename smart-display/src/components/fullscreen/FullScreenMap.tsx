import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './FullScreenMap.css';

export const FullScreenMap: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);

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

        map.current.on('load', async () => {
            await addSourcesAndLayers();
            startDataRefresh();
        });

    }, []);

    const addSourcesAndLayers = async () => {
        if (!map.current) return;
        const m = map.current;

        // Load Icons - Non-blocking where possible, but we need them for layers
        const loadImgPromise = (id: string, url: string) => {
            return new Promise<void>((resolve) => {
                if (m.hasImage(id)) {
                    resolve();
                    return;
                }
                (m as any).loadImage(url, (error: any, image: any) => {
                    if (error) {
                        console.error(`Error loading icon ${id} at ${url}:`, error);
                        // Resolve anyway to avoid blocking
                        resolve();
                        return;
                    }
                    if (image && !m.hasImage(id)) {
                        m.addImage(id, image);
                        console.log(`Icon loaded: ${id}`);
                    }
                    resolve();
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

    const startDataRefresh = () => {
        const fetchData = async () => {
            if (!map.current) return;

            try {
                // Refresh Flights
                const fRes = await fetch('/api/layers/flights');
                if (fRes.ok) {
                    const fData = await fRes.json();
                    const fSource: any = map.current.getSource('flights');
                    if (fSource) {
                        fSource.setData(fData);
                        console.log("Updated Flights:", fData.features?.length);
                    } else {
                        console.warn("Flights source not found during refresh");
                    }
                }

                // Refresh Ships
                const sRes = await fetch('/api/layers/ships');
                if (sRes.ok) {
                    const sData = await sRes.json();
                    const sSource: any = map.current.getSource('ships');
                    if (sSource) {
                        sSource.setData(sData);
                        console.log("Updated Ships:", sData.features?.length);
                    }
                }

                // Refresh Lightning
                const lRes = await fetch('/api/layers/lightning');
                if (lRes.ok) {
                    const lData = await lRes.json();
                    const lSource: any = map.current.getSource('lightning');
                    if (lSource) lSource.setData(lData);
                }

                // Refresh Radar (every cycle)
                updateRadarLayer();
            } catch (err) {
                console.error("Map: Refresh failed", err);
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

        </div>
    );
};
