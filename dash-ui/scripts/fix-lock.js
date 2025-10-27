#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const lockPath = join(process.cwd(), "package-lock.json");

if (!existsSync(lockPath)) {
  console.warn("[fix-lock] package-lock.json no encontrado. Ejecuta `npm install` para generarlo.");
  process.exit(0);
}

let lockRaw;
try {
  lockRaw = readFileSync(lockPath, "utf8");
} catch (error) {
  console.warn(`[fix-lock] No se pudo leer ${lockPath}:`, error);
  process.exit(0);
}

let parsed;
try {
  parsed = JSON.parse(lockRaw);
} catch (error) {
  console.warn("[fix-lock] package-lock.json inválido. Ejecuta `rm -f package-lock.json && npm install`.");
  process.exit(0);
}

const packages = parsed?.packages ?? {};
const maplibreEntry = Object.entries(packages).find(([key, value]) => {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (key === "node_modules/maplibre-gl") {
    return true;
  }
  return value.name === "maplibre-gl";
});

const maplibreVersion = maplibreEntry && typeof maplibreEntry[1] === "object" ? maplibreEntry[1].version : undefined;

if (!maplibreVersion || !String(maplibreVersion).startsWith("3.6.")) {
  console.warn("[fix-lock] Dependencia clave maplibre-gl@3.6.x ausente o desincronizada en package-lock.json.");
  console.warn("[fix-lock] Sugerencia: rm -f package-lock.json && npm install");
}
