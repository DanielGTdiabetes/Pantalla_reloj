#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const lockPath = path.resolve(process.cwd(), "package-lock.json");

if (!fs.existsSync(lockPath)) {
  console.log("[fix-lock] package-lock.json no encontrado; omitiendo comprobaciones.");
  process.exit(0);
}

let lockRaw = "";
try {
  lockRaw = fs.readFileSync(lockPath, "utf8");
} catch (error) {
  console.warn(`[fix-lock] No se pudo leer ${lockPath}:`, error);
  process.exit(0);
}

let lockData;
try {
  lockData = JSON.parse(lockRaw);
} catch (error) {
  console.warn(`[fix-lock] No se pudo parsear ${lockPath}:`, error);
  process.exit(0);
}

const getDependencyVersion = (name) => {
  const packages = lockData?.packages ?? {};
  const direct = lockData?.dependencies ?? {};
  const pkgEntry = packages[`node_modules/${name}`];
  if (pkgEntry?.version) {
    return pkgEntry.version;
  }
  const rootEntry = direct[name];
  if (typeof rootEntry === "string") {
    return rootEntry;
  }
  if (rootEntry?.version) {
    return rootEntry.version;
  }
  return null;
};

const issues = [];

const maplibreVersion = getDependencyVersion("maplibre-gl");
if (!maplibreVersion) {
  issues.push("maplibre-gl no está presente en package-lock.json");
} else if (!/^3\.6\./.test(maplibreVersion)) {
  issues.push(`maplibre-gl tiene versión inesperada (${maplibreVersion}); se espera 3.6.x`);
}

if (issues.length > 0) {
  console.warn("[fix-lock] Se detectaron posibles inconsistencias:");
  for (const issue of issues) {
    console.warn(`  • ${issue}`);
  }
  console.warn("[fix-lock] Sugerencia: rm -f package-lock.json && npm install");
} else {
  console.log("[fix-lock] package-lock.json verificado correctamente.");
}
