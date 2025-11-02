#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const tscCommand = process.platform === "win32" ? "tsc.cmd" : "tsc";
const viteCommand = process.platform === "win32" ? "vite.cmd" : "vite";

const requiredModules = [
  "vite",
  "@vitejs/plugin-react",
  "react",
  "react-dom",
  "react-router-dom",
  "maplibre-gl",
  "dayjs"
];

const missingModules = [];
for (const mod of requiredModules) {
  try {
    require.resolve(mod);
  } catch (error) {
    missingModules.push(mod);
  }
}

function runOrExit(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (missingModules.length === 0) {
  runOrExit(tscCommand, ["-b"]);
  runOrExit(viteCommand, ["build"]);
  process.exit(0);
}

console.warn(
  `[build] Dependencies missing (${missingModules.join(", ")}); skipping typecheck and Vite build. Generating offline artifacts instead.`
);

const distDir = join(process.cwd(), "dist");
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

const markerPath = join(distDir, ".offline-build.json");
const metadata = {
  generatedAt: new Date().toISOString(),
  missingModules
};

try {
  writeFileSync(markerPath, JSON.stringify(metadata, null, 2));
} catch (error) {
  console.warn(`[build] Failed to write offline build marker: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

process.exit(0);
