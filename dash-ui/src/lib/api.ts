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
  const response = await fetch(withBase(path), {
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    ...init,
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

export async function getSchema() {
  return apiGet<Record<string, unknown> | undefined>("/api/config/schema");
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