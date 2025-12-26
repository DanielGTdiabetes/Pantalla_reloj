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

        map.current.on('load', () => {
            addSourcesAndLayers();
            startDataRefresh();
        });

    }, []);

    const addSourcesAndLayers = async () => {
        if (!map.current) return;
        const m = map.current;

        // Load Icons with Promises to ensure they are available before adding layers
        const loadImgPromise = (id: string, url: string) => {
            return new Promise<void>((resolve) => {
                (m as any).loadImage(url, (error: any, image: any) => {
                    if (error) {
                        console.error(`Error loading icon ${id}:`, error);
                        resolve(); // Resolve anyway to continue adding other things
                        return;
                    }
                    if (image && !m.hasImage(id)) {
                        m.addImage(id, image);
                        console.log(`Icon ${id} loaded successfully`);
                    }
                    resolve();
                });
            });
        };

        // Wait for essential icons
        await Promise.all([
            loadImgPromise('plane-icon', '/assets/img/map_plane.png'),
            loadImgPromise('ship-icon', '/assets/img/map_ship.png')
        ]);

        // Helper to safely add source
        const safeAddSource = (id: string, options: any) => {
            if (!m.getSource(id)) {
                m.addSource(id, options);
            }
        };

        // Helper to safely add layer
        const safeAddLayer = (layer: any, beforeId?: string) => {
            if (!m.getLayer(layer.id)) {
                if (layer.type === 'symbol' && layer.layout && layer.layout['icon-image']) {
                    const iconName = layer.layout['icon-image'];
                    if (!m.hasImage(iconName)) {
                        console.warn(`Layer ${layer.id} requires ${iconName} but it's not loaded.`);
                    }
                }
                m.addLayer(layer, beforeId);
            }
        };

        // --- Flights ---
        safeAddSource('flights', { type: 'geojson', data: '/api/layers/flights' });

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
                'icon-rotate': ['-', ['get', 'true_track'], 45],
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
        safeAddSource('ships', { type: 'geojson', data: '/api/layers/ships' });

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
        safeAddSource('lightning', { type: 'geojson', data: '/api/layers/lightning' });

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
            const data = await res.json();
            if (data.ok && data.url_template && map.current) {
                // url_template is available but we construct tileUrl manually from frames for precision
                // 2 = Universal Blue
                if (data.frames && data.frames.length > 0) {
                    const latestFrame = data.frames[data.frames.length - 1]; // Latest
                    const tileUrl = `${data.host}${latestFrame.path}/256/{z}/{x}/{y}/2/1_1.png`;

                    if (map.current.getSource('radar')) {
                        // Update logic if possible, or remove/add
                        // Raster source update is tricky, easier to remove source and add back
                        if (map.current.getLayer('radar-layer')) map.current.removeLayer('radar-layer');
                        map.current.removeSource('radar');
                    }

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
        } catch (e) {
            console.error("Radar update failed", e);
        }
    };

    const startDataRefresh = () => {
        const refreshInterval = setInterval(async () => {
            if (!map.current) return;

            try {
                // Refresh Flights
                const fRes = await fetch('/api/layers/flights');
                const fData = await fRes.json();
                console.log("Map: Flights data received", fData);
                (map.current.getSource('flights') as any)?.setData(fData);

                // Refresh Ships
                const sRes = await fetch('/api/layers/ships');
                const sData = await sRes.json();
                console.log("Map: Ships data received", sData);
                (map.current.getSource('ships') as any)?.setData(sData);

                // Refresh Lightning
                const lRes = await fetch('/api/layers/lightning');
                const lData = await lRes.json();
                (map.current.getSource('lightning') as any)?.setData(lData);

                // Refresh Radar
                updateRadarLayer();
            } catch (err) {
                console.error("Map: Refresh failed", err);
            }
        }, 30000); // 30s refresh

        return () => clearInterval(refreshInterval);
    };

    return (
        <div className="fs-map-wrapper">
            <div ref={mapContainer} className="fs-map-container" />

        </div>
    );
};
