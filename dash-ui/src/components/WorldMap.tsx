import { useEffect, useRef } from "react";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type WorldMapProps = {
  token?: string | null;
  className?: string;
};

const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";
const ROTATION_SECONDS = 120;

export const WorldMap = ({ token, className }: WorldMapProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const spinRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || !token) {
      return undefined;
    }

    mapboxgl.accessToken = token;

    const mapInstance = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 1.2,
      pitch: 0,
      projection: { name: "globe" },
      interactive: false,
      attributionControl: false,
      scrollZoom: false,
      dragRotate: false,
      touchZoomRotate: false,
      doubleClickZoom: false,
      keyboard: false
    });

    mapRef.current = mapInstance;

    const applyFog = () => {
      if (!mapRef.current) {
        return;
      }
      mapRef.current.setFog({
        color: "hsl(225, 30%, 8%)",
        "high-color": "hsl(225, 40%, 15%)",
        "horizon-blend": 0.1,
        "space-color": "hsl(225, 30%, 5%)",
        "star-intensity": 0.3
      });
    };

    mapInstance.on("style.load", applyFog);

    const spinGlobe = () => {
      if (!mapRef.current) {
        return;
      }
      const map = mapRef.current;
      const zoom = map.getZoom();
      if (zoom >= 3) {
        return;
      }
      const distancePerSecond = 360 / ROTATION_SECONDS;
      const center = map.getCenter();
      center.lng -= distancePerSecond / 60;
      map.easeTo({
        center,
        duration: 1000,
        easing: (n) => n,
        essential: true
      });
    };

    spinRef.current = window.setInterval(spinGlobe, 1000);

    return () => {
      if (spinRef.current) {
        window.clearInterval(spinRef.current);
        spinRef.current = null;
      }
      mapInstance.off("style.load", applyFog);
      mapInstance.remove();
      mapRef.current = null;
    };
  }, [token]);

  return (
    <div className={["world-map", className].filter(Boolean).join(" ")}> 
      <div ref={containerRef} className="world-map__canvas" />
      {!token && (
        <div className="world-map__overlay">
          <div className="world-map__overlay-card">
            <p>Para mostrar el globo necesitas definir un token de Mapbox.</p>
            <p className="world-map__overlay-hint">Ve a <strong>/config</strong> y añade tu token en la sección de interfaz.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldMap;
