import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Plane, Ship, Zap, CloudRain } from 'lucide-react';
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

    const addSourcesAndLayers = () => {
        if (!map.current) return;
        const m = map.current;

        // --- Flights ---
        m.addSource('flights', { type: 'geojson', data: '/api/layers/flights' });
        m.addLayer({
            id: 'flights-layer',
            type: 'circle',
            source: 'flights',
            paint: {
                'circle-radius': 6,
                'circle-color': '#fbbf24', // Amber-400
                'circle-stroke-width': 2,
                'circle-stroke-color': '#000'
            }
        });
        // Flight Labels (Callsign)
        m.addLayer({
            id: 'flights-labels',
            type: 'symbol',
            source: 'flights',
            layout: {
                'text-field': ['get', 'callsign'],
                'text-font': ['Open Sans Regular'], // Might fall back if not available
                'text-offset': [0, 1.2],
                'text-size': 12,
                'text-anchor': 'top'
            },
            paint: {
                'text-color': '#fbbf24',
                'text-halo-color': '#000',
                'text-halo-width': 2
            }
        });

        // --- Ships ---
        m.addSource('ships', { type: 'geojson', data: '/api/layers/ships' });
        m.addLayer({
            id: 'ships-layer',
            type: 'circle',
            source: 'ships',
            paint: {
                'circle-radius': 5,
                'circle-color': '#60a5fa', // Blue-400
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000'
            }
        });

        // --- Lightning (Rays) ---
        m.addSource('lightning', { type: 'geojson', data: '/api/layers/lightning' });
        m.addLayer({
            id: 'lightning-heat',
            type: 'heatmap',
            source: 'lightning',
            paint: {
                'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
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
        m.addLayer({
            id: 'lightning-points',
            type: 'circle',
            source: 'lightning',
            minzoom: 5,
            paint: {
                'circle-radius': 4,
                'circle-color': '#f43f5e', // Rose-500
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff'
            }
        });

        // --- Radar Tile Layer (RainViewer) ---
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
        setInterval(() => {
            if (!map.current) return;
            // Refresh GeoJSONs
            (map.current.getSource('flights') as any)?.setData('/api/layers/flights');
            (map.current.getSource('ships') as any)?.setData('/api/layers/ships');
            (map.current.getSource('lightning') as any)?.setData('/api/layers/lightning');

            // Refresh Radar periodically
            updateRadarLayer();
        }, 30000); // 30s refresh
    };

    return (
        <div className="fs-map-wrapper">
            <div ref={mapContainer} className="fs-map-container" />
            <div className="fs-map-legend">
                <div className="legend-item"><Plane size={16} className="text-amber-400" /> Aviones</div>
                <div className="legend-item"><Ship size={16} className="text-blue-400" /> Barcos</div>
                <div className="legend-item"><Zap size={16} className="text-rose-500" /> Rayos</div>
                <div className="legend-item"><CloudRain size={16} className="text-blue-300" /> Lluvia</div>
            </div>
        </div>
    );
};
