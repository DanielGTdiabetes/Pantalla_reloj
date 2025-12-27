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
        // User requested no layers (ships, planes, etc.)
        // Just the base map is sufficient.
    };

    const startDataRefresh = () => {
        // No data to refresh
    };

    return (
        <div className="fs-map-wrapper">
            <div ref={mapContainer} className="fs-map-container" />

        </div>
    );
};
