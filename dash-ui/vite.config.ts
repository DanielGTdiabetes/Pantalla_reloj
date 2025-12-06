import react from "@vitejs/plugin-react";

// Declaración mínima para evitar dependencia de @types/node
declare const process: { env: { npm_package_version?: string } };

const appVersion = process.env.npm_package_version ?? "dev";

export default {
  base: "/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8081",
        changeOrigin: true
      }
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: "dist",
    sourcemap: false
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
};
