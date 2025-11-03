import type { AppConfig } from "../types/config";
import type { AppConfigV2 } from "../types/config_v2";

export type SaveConfigResponse = {
  ok: boolean;
  path?: string;
  provider: string;
  calendar?: {
    enabled?: boolean;
    provider?: string;
    ics_path?: string;
    status?: string;
    last_error?: string | null;
  };
  layers?: {
    flights?: boolean;
    ships?: boolean;
  };
  radar?: {
    enabled?: boolean;
    provider?: string | null;
  };
  config_version?: number;
  reloaded?: boolean;
};

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
  return apiPost<SaveConfigResponse>("/api/config", data);
}

// V2 API functions
export async function getConfigV2(): Promise<AppConfigV2> {
  const config = await apiGet<AppConfigV2>("/api/config");
  
  // Verificar que no contiene claves v1
  if (config && typeof config === 'object') {
    const v1Keys = ['ui', 'map', 'cinema', 'maptiler'];
    const hasV1Keys = v1Keys.some(key => {
      if (key === 'ui' && 'ui' in config && config.ui && typeof config.ui === 'object' && 'map' in config.ui) {
        return true;
      }
      return key in config;
    });
    
    if (hasV1Keys) {
      throw new ApiError(400, { error: "v1 keys not allowed", message: "Config contains v1 keys" });
    }
  }
  
  return config;
}

export async function saveConfigV2(config: AppConfigV2): Promise<SaveConfigResponse> {
  // Verificar que es v2
  if (config.version !== 2) {
    throw new ApiError(400, { error: "Only v2 config allowed", version: config.version });
  }
  
  // Verificar que no contiene claves v1
  const v1Keys = ['ui', 'map', 'cinema', 'maptiler'];
  const hasV1Keys = v1Keys.some(key => {
    if (key === 'ui' && 'ui' in config && config.ui && typeof config.ui === 'object') {
      return 'map' in config.ui || 'cinema' in config.ui || 'maptiler' in config.ui;
    }
    return key in config;
  });
  
  if (hasV1Keys) {
    throw new ApiError(400, { error: "v1 keys not allowed", v1_keys: v1Keys.filter(k => k in config) });
  }
  
  return apiPost<SaveConfigResponse>("/api/config", config);
}

export async function reloadConfig(): Promise<{ success: boolean; message: string; config_path?: string; config_loaded_at?: string }> {
  return apiPost<{ success: boolean; message: string; config_path?: string; config_loaded_at?: string }>("/api/config/reload", {});
}

export type AemetSecretRequest = {
  api_key: string | null;
};

export type AemetTestResponse = {
  ok: boolean;
  reason?: string;
};

export type MaskedSecretMeta = {
  has_api_key: boolean;
  api_key_last4: string | null;
};

export async function updateAemetApiKey(apiKey: string | null) {
  return apiPost<undefined>("/api/config/secret/aemet_api_key", {
    api_key: apiKey,
  } satisfies AemetSecretRequest);
}

export async function updateAISStreamApiKey(apiKey: string | null) {
  return apiPost<undefined>("/api/config/secret/aisstream_api_key", {
    api_key: apiKey,
  });
}

export async function testAemetApiKey(apiKey?: string) {
  const body = apiKey && apiKey.trim().length > 0 ? { api_key: apiKey } : {};
  return apiPost<AemetTestResponse | undefined>("/api/aemet/test_key", body);
}

export type CalendarTestResponse = {
  ok: boolean;
  message?: string;
  reason?: string;
  event_count?: number;
};

export async function testCalendarConnection(apiKey?: string, calendarId?: string) {
  const body: Record<string, unknown> = {};
  if (apiKey && apiKey.trim().length > 0) {
    body.api_key = apiKey.trim();
  }
  if (calendarId && calendarId.trim().length > 0) {
    body.calendar_id = calendarId.trim();
  }
  return apiPost<CalendarTestResponse | undefined>("/api/calendar/test", body);
}

export async function updateOpenWeatherMapApiKey(apiKey: string | null) {
  return apiPost<undefined>("/api/config/secret/openweathermap_api_key", { api_key: apiKey });
}

export async function getOpenWeatherMapApiKeyMeta() {
  return apiGet<MaskedSecretMeta>("/api/config/secret/openweathermap_api_key");
}

export async function getSchema() {
  return apiGet<Record<string, unknown> | undefined>("/api/config/schema");
}

export type OpenSkyStatus = {
  enabled: boolean;
  mode: "bbox" | "global";
  configured_poll?: number;
  effective_poll?: number;
  status?: "ok" | "error" | "stale" | string;
  auth?: {
    has_credentials: boolean;
    token_cached: boolean;
    expires_in_sec: number | null;
  };
  has_credentials?: boolean;
  token_cached?: boolean;
  expires_in?: number | null;
  expires_in_sec?: number | null;
  backoff_active?: boolean;
  backoff_seconds?: number;
  last_fetch_ok?: boolean | null;
  last_fetch_ts?: number | null;
  last_fetch_iso?: string | null;
  last_fetch_age?: number | null;
  last_error?: string | null;
  items?: number | null;
  items_count?: number | null;
  rate_limit_hint?: string | null;
  bbox: { lamin: number; lamax: number; lomin: number; lomax: number };
  max_aircraft: number;
  extended: number;
  cluster: boolean;
  poll_warning?: string;
};

export async function getOpenSkyStatus() {
  return apiGet<OpenSkyStatus | null>("/api/opensky/status");
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

export async function getConfigMeta() {
  return apiGet<{
    config_version: number;
    config_loaded_at: string | null;
    config_path: string;
    config_source: string;
  }>("/api/config/meta");
}

export async function getSantoralToday() {
  return apiGet<{ date: string; names: string[] }>("/api/santoral/today");
}

export async function getSantoralDate(iso: string) {
  return apiGet<{ date: string; names: string[] }>(`/api/santoral/date?iso=${encodeURIComponent(iso)}`);
}

export async function getShipsLayer() {
  return apiGet<Record<string, unknown>>("/api/layers/ships");
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
  security?: string;
  mode?: string;
  bars?: string;
};

export type WiFiScanResponse = {
  ok: boolean;
  count: number;
  networks: WiFiNetwork[];
  meta?: {
    stdout?: string;
    stderr?: string;
    reason?: string;
    attempt?: string;
  };
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
  interface?: string;
  networks: WiFiNetwork[];
  count: number;
  meta?: {
    stderr?: string;
    reason?: string;
    attempt?: string;
  };
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

// Geocode API
export type GeocodePostalResponse = {
  ok: boolean;
  postal_code: string;
  lat: number;
  lon: number;
  source?: string;
};

export async function geocodePostalES(code: string) {
  return apiGet<GeocodePostalResponse>(`/api/geocode/es/postal?code=${encodeURIComponent(code)}`);
}

// Config Migration
export type MigrateConfigResponse = {
  ok: boolean;
  version: number;
  migrated: boolean;
  message: string;
  config?: unknown;
};

export async function migrateConfig(to: number = 2, backup: boolean = true) {
  return apiPost<MigrateConfigResponse>(`/api/config/migrate?to=${to}&backup=${backup ? "true" : "false"}`, {});
}

// Weather API
export type WeatherWeeklyResponse = {
  ok: boolean;
  reason?: string;
  daily: Array<{
    date: string;
    temp_max: number;
    temp_min: number;
    condition: string;
    icon: string;
    humidity?: number;
    wind_speed?: number;
  }>;
  location?: { lat: number; lon: number };
};

export async function getWeatherWeekly(lat: number, lon: number): Promise<WeatherWeeklyResponse> {
  return apiGet<WeatherWeeklyResponse>(`/api/weather/weekly?lat=${lat}&lon=${lon}`);
}

// News RSS API
export type NewsRSSRequest = {
  feeds: string[];
};

export type NewsRSSItem = {
  title: string;
  link: string;
  source: string;
  published: string;
};

export type NewsRSSResponse = {
  items: NewsRSSItem[];
};

export async function getNewsRSS(feeds: string[]): Promise<NewsRSSResponse> {
  return apiPost<NewsRSSResponse>("/api/news/rss", { feeds });
}

// Calendar API
export type CalendarEvent = {
  title: string;
  start: string;
  end: string;
  location: string;
};

export async function getCalendarEvents(from: string, to: string): Promise<CalendarEvent[]> {
  return apiGet<CalendarEvent[]>(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

// Calendar Status API
export type CalendarStatusResponse = {
  provider: string;
  enabled: boolean;
  credentials_present: boolean;
  status: "ok" | "error" | "stale" | "empty";
  last_fetch_iso?: string | null;
  note?: string | null;
};

export async function getCalendarStatus(): Promise<CalendarStatusResponse> {
  return apiGet<CalendarStatusResponse>("/api/calendar/status");
}

// Historical Events (Efemérides) API
export type HistoricalEventsResponse = {
  date: string;
  count: number;
  items: string[];
};

export type HistoricalEventsStatusResponse = {
  enabled: boolean;
  provider: string;
  status: "ok" | "error" | "missing" | "empty";
  last_load_iso?: string | null;
  data_path: string;
};

export type HistoricalEventsUploadResponse = {
  ok: boolean;
  saved_path: string;
  items_total: number;
};

export async function getHistoricalEvents(date?: string): Promise<HistoricalEventsResponse> {
  const url = date ? `/api/efemerides?date=${encodeURIComponent(date)}` : "/api/efemerides";
  return apiGet<HistoricalEventsResponse>(url);
}

export async function getHistoricalEventsStatus(): Promise<HistoricalEventsStatusResponse> {
  return apiGet<HistoricalEventsStatusResponse>("/api/efemerides/status");
}

export async function uploadHistoricalEventsFile(file: File): Promise<HistoricalEventsUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(withBase("/api/efemerides/upload"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = await readJson(response);
    throw new ApiError(response.status, body);
  }

  return (await readJson(response)) as HistoricalEventsUploadResponse;
}

// ICS Upload API
export type IcsUploadResponse = {
  ok: boolean;
  ics_path: string;
  provider: string;
  events_detected?: number;
  reloaded?: boolean;
  config_version?: number;
  calendar?: {
    status?: string;
    last_error?: string | null;
  };
};

export async function uploadIcsFile(file: File, filename?: string): Promise<IcsUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (filename) {
    formData.append("filename", filename);
  }
  
  const response = await fetch(withBase("/api/config/upload/ics"), {
    method: "POST",
    body: formData,
  });
  
  if (!response.ok) {
    const body = await readJson(response);
    throw new ApiError(response.status, body);
  }
  
  return (await readJson(response)) as IcsUploadResponse;
}

// AEMET Warnings API
export type AemetWarningFeature = {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    id?: string;
    severity: string;
    status?: string;
    event: string;
    source: string;
    onset?: string;
    expires?: string;
  };
};

export type AemetWarningsResponse = {
  type: "FeatureCollection";
  features: AemetWarningFeature[];
  metadata?: {
    source: string;
    enabled?: boolean;
    error?: string;
    timestamp: string;
  };
};

export async function getAemetWarnings(): Promise<AemetWarningsResponse> {
  return apiGet<AemetWarningsResponse>("/api/aemet/warnings");
}