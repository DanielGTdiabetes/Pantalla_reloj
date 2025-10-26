import { useEffect, useRef, useState } from "react";

type MapboxFogOptions = {
  color?: string;
  "high-color"?: string;
  "horizon-blend"?: number;
  "space-color"?: string;
  "star-intensity"?: number;
};

type MapboxEaseOptions = {
  center: { lng: number; lat: number };
  duration: number;
  easing: (value: number) => number;
  essential: boolean;
};

type MapboxMap = {
  on(event: "style.load", handler: () => void): void;
  off(event: "style.load", handler: () => void): void;
  remove(): void;
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  easeTo(options: MapboxEaseOptions): void;
  setFog(options: MapboxFogOptions): void;
};

type MapboxGl = {
  accessToken: string;
  Map: new (options: {
    container: HTMLElement;
    style: string;
    center: [number, number];
    zoom: number;
    pitch: number;
    projection: { name: string };
    interactive: boolean;
    attributionControl: boolean;
    scrollZoom: boolean;
    dragRotate: boolean;
    touchZoomRotate: boolean;
    doubleClickZoom: boolean;
    keyboard: boolean;
  }) => MapboxMap;
};

declare global {
  interface Window {
    mapboxgl?: MapboxGl;
  }
}

const MAPBOX_SCRIPT_URL = "https://api.mapbox.com/mapbox-gl-js/v3.2.1/mapbox-gl.js";
const MAPBOX_STYLESHEET_URL = "https://api.mapbox.com/mapbox-gl-js/v3.2.1/mapbox-gl.css";

const ensureStylesheet = (href: string): Promise<void> => {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Las hojas de estilo sólo pueden cargarse en el navegador"));
  }

  const existing = document.querySelector<HTMLLinkElement>(`link[data-mapbox-stylesheet='${href}']`);
  if (existing) {
    if (existing.sheet) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`No se pudo cargar la hoja de estilo: ${href}`)), {
        once: true
      });
    });
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.mapboxStylesheet = href;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error(`No se pudo cargar la hoja de estilo: ${href}`)), {
      once: true
    });
    document.head.appendChild(link);
  });
};

const ensureScript = (src: string): Promise<void> => {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Los scripts externos sólo pueden cargarse en el navegador"));
  }

  const existing = document.querySelector<HTMLScriptElement>(`script[data-mapbox-script='${src}']`);
  if (existing) {
    if (existing.dataset.loaded === "true") {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`No se pudo cargar el script: ${src}`)), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.mapboxScript = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error(`No se pudo cargar el script: ${src}`)), { once: true });
    document.head.appendChild(script);
  });
};

let mapboxLoader: Promise<MapboxGl> | null = null;

const ensureMapbox = (): Promise<MapboxGl> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Mapbox GL sólo puede inicializarse en el navegador"));
  }

  if (window.mapboxgl) {
    return Promise.resolve(window.mapboxgl);
  }

  if (!mapboxLoader) {
    mapboxLoader = Promise.all([ensureStylesheet(MAPBOX_STYLESHEET_URL), ensureScript(MAPBOX_SCRIPT_URL)])
      .then(() => {
        if (!window.mapboxgl) {
          throw new Error("Mapbox GL no se inicializó correctamente");
        }
        return window.mapboxgl;
      })
      .catch((error) => {
        mapboxLoader = null;
        throw error;
      });
  }

  return mapboxLoader;
};

type WorldMapProps = {
  token?: string | null;
  className?: string;
};

const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";
const ROTATION_SECONDS = 120;

export const WorldMap = ({ token, className }: WorldMapProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const spinRef = useRef<number | null>(null);
  const [mapbox, setMapbox] = useState<MapboxGl | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    ensureMapbox()
      .then((instance) => {
        if (!cancelled) {
          setMapbox(instance);
          setMapError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error(error);
          setMapError("No se pudo cargar Mapbox GL.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token || !containerRef.current || !mapbox) {
      setIsMapReady(false);
      return undefined;
    }

    setIsMapReady(false);
    mapbox.accessToken = token;

    const mapInstance = new mapbox.Map({
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
      setIsMapReady(true);
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
      setIsMapReady(false);
    };
  }, [token, mapbox]);

  const overlayContent = (() => {
    if (!token) {
      return (
        <>
          <p>Para mostrar el globo necesitas definir un token de Mapbox.</p>
          <p className="world-map__overlay-hint">Ve a <strong>/config</strong> y añade tu token en la sección de interfaz.</p>
        </>
      );
    }

    if (mapError) {
      return (
        <>
          <p>{mapError}</p>
          <p className="world-map__overlay-hint">Verifica tu conexión a Internet e inténtalo de nuevo.</p>
        </>
      );
    }

    if (!isMapReady) {
      return (
        <>
          <p>Cargando globo terráqueo…</p>
          <p className="world-map__overlay-hint">Esto puede tardar unos segundos.</p>
        </>
      );
    }

    return null;
  })();

  return (
    <div className={["world-map", className].filter(Boolean).join(" ")}> 
      <div ref={containerRef} className="world-map__canvas" />
      {overlayContent && (
        <div className="world-map__overlay">
          <div className="world-map__overlay-card">
            {overlayContent}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldMap;
