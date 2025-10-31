import type { AppConfig } from "../types/config";

const BASE = window.location.origin;

const withBase = (path: string) => {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${suffix}`;
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    console.warn("Failed to parse API response as JSON", error);
    return undefined;
  }
};

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API:${status}`);
    this.status = status;
    this.body = body;
  }
}

const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  // Para /api/config, agregar headers anti-cache para asegurar que siempre obtengamos la versión más reciente
  const isConfigEndpoint = path.includes("/api/config");
  const cacheHeaders = isConfigEndpoint
    ? {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      }
    : {};

  const { headers: initHeaders, cache: initCache, ...restInit } = init ?? {};
  const headers = new Headers(initHeaders ?? {});
  headers.set("Accept", "application/json");
  for (const [key, value] of Object.entries(cacheHeaders)) {
    headers.set(key, value);
  }

  const response = await fetch(withBase(path), {
    ...restInit,
    headers,
    cache: isConfigEndpoint ? "no-store" : initCache ?? "default",
  });
  if (!response.ok) {
    const body = await readJson(response);
    throw new ApiError(response.status, body);
  }
  return (await readJson(response)) as T;
};

export const API_ORIGIN = BASE;

export async function apiGet<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

export async function getHealth() {
  return apiGet<Record<string, unknown> | undefined>("/api/health");
}

export async function getConfig() {
  return apiGet<AppConfig | undefined>("/api/config");
}

export async function saveConfig(data: AppConfig) {
  return apiPost<AppConfig>("/api/config", data);
}

export type AemetSecretRequest = {
  api_key: string | null;
};

export type AemetTestResponse = {
  ok: boolean;
  reason?: string;
};

export async function updateAemetApiKey(apiKey: string | null) {
  return apiPost<undefined>("/api/config/secret/aemet_api_key", {
    api_key: apiKey,
  } satisfies AemetSecretRequest);
}

export async function testAemetApiKey(apiKey?: string) {
  const body = apiKey && apiKey.trim().length > 0 ? { api_key: apiKey } : {};
  return apiPost<AemetTestResponse | undefined>("/api/aemet/test_key", body);
}

export async function getSchema() {
  return apiGet<Record<string, unknown> | undefined>("/api/config/schema");
}

// Storm Mode API
export type StormModeStatus = {
  enabled: boolean;
  last_triggered: string | null;
  center?: { lat: number; lng: number };
  zoom?: number;
};

export async function getStormMode() {
  return apiGet<StormModeStatus>("/api/storm_mode");
}

export async function updateStormMode(data: { enabled: boolean; last_triggered?: string | null }) {
  return apiPost<StormModeStatus>("/api/storm_mode", data);
}

// Lightning API
export type LightningData = {
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number]; // [lng, lat]
    };
    properties: {
      timestamp?: number;
      intensity?: number;
    };
  }>;
};

export async function getLightning() {
  return apiGet<LightningData>("/api/lightning");
}

// WiFi API
export type WiFiNetwork = {
  ssid: string;
  signal: number;
  security: string;
  mode: string;
};

export type WiFiScanResponse = {
  interface: string;
  networks: WiFiNetwork[];
  count: number;
};

export type WiFiStatusResponse = {
  interface: string;
  connected: boolean;
  ssid: string | null;
  ip_address: string | null;
  signal: number | null;
  error?: string;
};

export type WiFiConnectRequest = {
  ssid: string;
  password?: string;
};

export type WiFiConnectResponse = {
  success: boolean;
  message: string;
  ssid: string;
};

export type WiFiNetworksResponse = {
  networks: Array<{ uuid: string; name: string }>;
  count: number;
};

export async function wifiScan() {
  return apiGet<WiFiScanResponse>("/api/wifi/scan");
}

export async function wifiStatus() {
  return apiGet<WiFiStatusResponse>("/api/wifi/status");
}

export async function wifiNetworks() {
  return apiGet<WiFiNetworksResponse>("/api/wifi/networks");
}

export async function wifiConnect(request: WiFiConnectRequest) {
  return apiPost<WiFiConnectResponse>("/api/wifi/connect", request);
}

export async function wifiDisconnect() {
  return apiPost<{ success: boolean; message: string }>("/api/wifi/disconnect", {});
}