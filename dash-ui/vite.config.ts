import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const maplibreEntry = new URL("./src/vendor/maplibre-gl.ts", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "maplibre-gl": maplibreEntry
    }
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
