import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "maplibre-gl/dist/maplibre-gl.css", replacement: "/src/vendor/maplibre-gl.css" },
      { find: "maplibre-gl", replacement: "/src/vendor/maplibre-gl.ts" }
    ]
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  build: {
    outDir: "dist",
    sourcemap: false
  }
});
