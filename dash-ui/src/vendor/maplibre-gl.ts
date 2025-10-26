const SCRIPT_URL = "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js";
const STYLESHEET_URL = "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css";

export type LngLatLike = [number, number];

export interface MapOptions {
  container: string | HTMLElement;
  style: StyleSpecification;
  center?: LngLatLike;
  zoom?: number;
  bearing?: number;
  pitch?: number;
  interactive?: boolean;
  attributionControl?: boolean;
}

export interface MapInstance {
  resize(): void;
  remove(): void;
  once?(event: string, handler: (...args: unknown[]) => void): void;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface MapLibreGL {
  Map: new (options: MapOptions) => MapInstance;
}

export type StyleSpecification = Record<string, unknown>;

let loaderPromise: Promise<MapLibreGL> | null = null;

const ensureStylesheet = () => {
  if (typeof document === "undefined") {
    return;
  }

  const existingLink = document.querySelector<HTMLLinkElement>('link[data-maplibre-stylesheet="true"]');
  if (existingLink) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET_URL;
  link.setAttribute("data-maplibre-stylesheet", "true");
  document.head.appendChild(link);
};

const loadMapLibre = (): Promise<MapLibreGL> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MapLibre solo está disponible en navegadores"));
  }

  if (window.maplibregl) {
    ensureStylesheet();
    return Promise.resolve(window.maplibregl);
  }

  if (!loaderPromise) {
    loaderPromise = new Promise<MapLibreGL>((resolve, reject) => {
      ensureStylesheet();

      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;

      script.addEventListener("load", () => {
        if (window.maplibregl) {
          resolve(window.maplibregl);
          return;
        }

        reject(new Error("MapLibre se cargó pero no está disponible en ventana"));
      });

      script.addEventListener("error", () => {
        reject(new Error("No se pudo cargar la librería de MapLibre"));
      });

      document.head.appendChild(script);
    });
  }

  return loaderPromise;
};

export default loadMapLibre;

declare global {
  interface Window {
    maplibregl?: MapLibreGL;
  }
}

export {};
