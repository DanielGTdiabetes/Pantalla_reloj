import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapInstance, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type GeoScopeMapProps = {
  className?: string;
  center?: [number, number];
  zoom?: number;
};

const style: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" }
  ]
};

export const GeoScopeMap = ({ className, center, zoom = 1.6 }: GeoScopeMapProps): JSX.Element => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [lng, lat] = center ?? [0, 20];

  useEffect(() => {
    if (!mapContainer.current) {
      return undefined;
    }

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style,
      center: [lng, lat],
      zoom,
      bearing: 0,
      pitch: 0,
      interactive: false,
      attributionControl: false
    });

    mapRef.current = map;

    const onResize = () => {
      map.resize();
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom]);

  return (
    <div className={["world-map", className].filter(Boolean).join(" ")}>
      <div ref={mapContainer} className="world-map__canvas" aria-hidden="true" />
      <div className="absolute bottom-1 right-2 text-[10px] text-white/50">
        © OpenStreetMap contributors
      </div>
    </div>
  );
};

export default GeoScopeMap;
