import type { MapLibreGL } from "../types/maplibre-gl";

const SCRIPT_URL = "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js";
const STYLESHEET_URL = "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css";

let loaderPromise: Promise<MapLibreGL> | null = null;

const ensureStylesheet = () => {
  if (typeof document === "undefined") {
    return;
  }

  const existingLink = document.querySelector<HTMLLinkElement>(
    'link[data-maplibre-stylesheet="true"]'
  );

  if (existingLink) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET_URL;
  link.setAttribute("data-maplibre-stylesheet", "true");
  document.head.appendChild(link);
};

export const loadMapLibre = (): Promise<MapLibreGL> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MapLibre can only be loaded in a browser environment"));
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

        reject(new Error("MapLibre script loaded but window.maplibregl is undefined"));
      });

      script.addEventListener("error", () => {
        reject(new Error("No se pudo cargar la librería de mapas (MapLibre)"));
      });

      document.head.appendChild(script);
    });
  }

  return loaderPromise;
};

export const resetMapLibreLoaderForTests = () => {
  loaderPromise = null;
};
