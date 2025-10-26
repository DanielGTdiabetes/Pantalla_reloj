import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface WorldMapProps {
  mapboxToken?: string;
}

const WorldMap = ({ mapboxToken }: WorldMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      projection: { name: 'globe' },
      zoom: 1.2,
      center: [0, 20],
      pitch: 0,
      interactive: false,
    });

    map.current.on('style.load', () => {
      map.current?.setFog({
        color: 'hsl(225, 30%, 8%)',
        'high-color': 'hsl(225, 40%, 15%)',
        'horizon-blend': 0.1,
        'space-color': 'hsl(225, 30%, 5%)',
        'star-intensity': 0.3,
      });
    });

    const secondsPerRevolution = 120;
    let userInteracting = false;

    function spinGlobe() {
      if (!map.current || userInteracting) return;
      
      const zoom = map.current.getZoom();
      if (zoom < 3) {
        const distancePerSecond = 360 / secondsPerRevolution;
        const center = map.current.getCenter();
        center.lng -= distancePerSecond / 60;
        map.current.easeTo({ 
          center, 
          duration: 1000, 
          easing: (n) => n 
        });
      }
    }

    const spinInterval = setInterval(spinGlobe, 1000);

    return () => {
      clearInterval(spinInterval);
      map.current?.remove();
    };
  }, [mapboxToken]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="absolute inset-0" />
      {!mapboxToken && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center p-6 rounded-lg bg-card border border-border">
            <p className="text-muted-foreground mb-4">
              Para mostrar el mapa, necesitas agregar tu token de Mapbox
            </p>
            <a 
              href="https://account.mapbox.com/access-tokens/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Obtén tu token aquí
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldMap;
