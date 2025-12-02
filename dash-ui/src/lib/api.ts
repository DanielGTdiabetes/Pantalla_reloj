
import type {
  AppConfig,
  CalendarConfig,
} from "../types/config";

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
  let text: string;
  try {
    text = await response.text();
  } catch (textError) {
    // Si ni siquiera podemos leer el texto, lanzar error
    const error = new Error(`Failed to read response text: ${textError instanceof Error ? textError.message : String(textError)}`);
    console.warn("Failed to read response text", {
      status: response.status,
      statusText: response.statusText,
      error: textError,
    });
    throw error;
  }

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    // Si falla el parseo, lanzar error con información útil
    const parseError = error as Error;
    const errorMessage = `JSON parse failed: ${parseError.message}. Response preview: ${text.substring(0, 200)}`;
    console.warn("Failed to parse API response as JSON", {
      status: response.status,
      statusText: response.statusText,
      textPreview: text.substring(0, 200),
      error: parseError.message,
    });
    throw new Error(errorMessage);
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

  // Intentar leer JSON siempre, incluso si response.ok es false
  let body: unknown;
  try {
    body = await readJson(response);
  } catch (parseError) {
    // Si falla el parseo, construir un objeto de error razonable
    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    body = {
      error: "Failed to parse response as JSON",
      status: response.status,
      statusText: response.statusText,
      parseError: errorMessage,
    };
  }

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  // Si el body es undefined o null, intentar construir un fallback según el endpoint
  if (body === undefined || body === null) {
    // Para endpoints específicos, devolver un objeto de error estructurado
    if (path.includes("/opensky/status")) {
      body = {
        enabled: false,
        reachable: false,
        error: "Failed to parse OpenSky status response",
        details: {},
      };
    }
  }

  return body as T;
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

export async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
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

export async function getConfigV2(): Promise<AppConfig> {
  const config = await apiGet<AppConfig>("/api/config");

  return config;
}

export async function saveConfigV2(config: AppConfig): Promise<SaveConfigResponse> {
  // Verificar que es v2
  if (config.version !== 2) {
    throw new ApiError(400, { error: "Only v2 config allowed", version: config.version });
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

export async function saveCalendarConfig(config: Partial<CalendarConfig>): Promise<void> {
  return apiPatch("/api/config/group/calendar", config);
}

export async function updateOpenWeatherMapApiKey(apiKey: string | null) {
  return apiPost<undefined>("/api/config/secret/openweathermap_api_key", { api_key: apiKey });
}

export async function getOpenWeatherMapApiKeyMeta() {
  return apiGet<MaskedSecretMeta>("/api/config/secret/openweathermap_api_key");
}

export async function updateMeteoblueApiKey(apiKey: string | null) {
  return apiPost<undefined>("/api/config/secret/meteoblue_api_key", { api_key: apiKey });
}

export async function getMeteoblueApiKeyMeta() {
  return apiGet<MaskedSecretMeta>("/api/config/secret/meteoblue_api_key");
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

// Test functions for APIs
export type OpenSkyTestResponse = {
  ok: boolean;
  reason?: string;
  token_valid?: boolean;
  expires_in?: number;
};

export async function testOpenSky(): Promise<OpenSkyTestResponse> {
  return apiGet<OpenSkyTestResponse>("/api/opensky/test");
}

export type AISStreamTestResponse = {
  ok: boolean;
  reason?: string;
  features_count?: number;
};

export async function testAISStream(): Promise<AISStreamTestResponse> {
  try {
    const response = await apiGet<{ type: string; features: unknown[]; meta?: { ok?: boolean; reason?: string } }>("/api/layers/ships?max_items_view=1");
    const meta = response.meta || {};
    return {
      ok: meta.ok !== false,
      reason: meta.reason || undefined,
      features_count: Array.isArray(response.features) ? response.features.length : 0,
    };
  } catch (error) {
    return { ok: false, reason: "connection_error" };
  }
}

export type AISHubTestResponse = {
  ok: boolean;
  reason?: string;
};

export async function testAISHub(): Promise<AISHubTestResponse> {
  // AISHub no tiene endpoint específico, usar el endpoint de ships y verificar meta
  try {
    const response = await apiGet<{ meta?: { ok?: boolean; reason?: string; provider?: string } }>("/api/layers/ships?max_items_view=1");
    const meta = response.meta || {};
    if (meta.provider === "aishub") {
      return {
        ok: meta.ok !== false,
        reason: meta.reason || undefined,
      };
    }
    return { ok: false, reason: "provider_not_aishub" };
  } catch (error) {
    return { ok: false, reason: "connection_error" };
  }
}

export type WikimediaTestResponse = {
  ok: boolean;
  reason?: string;
  count?: number;
};


export async function testWikimedia(): Promise<WikimediaTestResponse> {
  try {
    // Usar el endpoint de efemérides con fecha de hoy para test
    const today = new Date().toISOString().split("T")[0];
    const response = await apiGet<{ count: number; items: unknown[]; source?: string }>(`/api/efemerides?target_date=${today}`);
    if (response.source === "wikimedia") {
      return {
        ok: true,
        count: response.count,
      };
    }
    return { ok: false, reason: "provider_not_wikimedia" };
  } catch (error) {
    return { ok: false, reason: "connection_error" };
  }
}

export type LightningTestResponse = {
  ok: boolean;
  reason?: string;
  features_count?: number;
};

export async function testLightning(): Promise<LightningTestResponse> {
  try {
    const response = await apiGet<{ type: string; features: unknown[] }>("/api/lightning");
    return {
      ok: true,
      features_count: Array.isArray(response.features) ? response.features.length : 0,
    };
  } catch (error) {
    return { ok: false, reason: "connection_error" };
  }
}

export type RainViewerTestResponse = {
  ok: boolean;
  status?: number;
  provider?: string;
  timestamp?: number;
  test_tile?: string;
  error?: string;
  message?: string;
  frames_count?: number;
  reason?: string;
};

export async function testRainViewer(
  provider: string = "rainviewer",
  layer_type: string = "precipitation_new",
  opacity: number = 0.7
): Promise<RainViewerTestResponse> {
  try {
    const response = await apiPost<RainViewerTestResponse>("/api/maps/test_rainviewer", {
      provider,
      layer_type,
      opacity,
    });
    return response;
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: "connection_error",
      message: error instanceof Error ? error.message : "Error de conexión"
    };
  }
}

export type OpenWeatherMapTestResponse = {
  ok: boolean;
  status?: number;
  message?: string;
  error?: string;
  data?: {
    temp?: number;
    condition?: string;
    location?: string;
  };
};

export async function testOpenWeatherMap(apiKey?: string | null): Promise<OpenWeatherMapTestResponse> {
  try {
    return apiPost<OpenWeatherMapTestResponse>("/api/weather/test_openweathermap", { api_key: apiKey });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: "connection_error",
      message: error instanceof Error ? error.message : "Error de conexión"
    };
  }
}

export type MeteoblueTestResponse = {
  ok: boolean;
  status?: number;
  message?: string;
  error?: string;
  data?: {
    temp?: number;
    condition?: string;
    location?: string;
  };
};

export async function testMeteoblue(apiKey?: string | null): Promise<MeteoblueTestResponse> {
  try {
    return apiPost<MeteoblueTestResponse>("/api/weather/test_meteoblue", { api_key: apiKey });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: "connection_error",
      message: error instanceof Error ? error.message : "Error de conexión"
    };
  }
}

export async function getRainViewerFrames(
  history_minutes?: number,
  frame_step?: number
): Promise<number[]> {
  try {
    const params = new URLSearchParams();
    if (history_minutes !== undefined) {
      params.append("history_minutes", history_minutes.toString());
    }
    if (frame_step !== undefined) {
      params.append("frame_step", frame_step.toString());
    }
    const query = params.toString();
    const path = `/api/rainviewer/frames${query ? `?${query}` : ""}`;
    return apiGet<number[]>(path);
  } catch (error) {
    return [];
  }
}

export async function getRainViewerTileUrl(
  timestamp: number,
  z: number,
  x: number,
  y: number
): Promise<string> {
  return `${BASE}/api/rainviewer/tiles/${timestamp}/${z}/${x}/${y}.png`;
}

export type GIBSTestResponse = {
  ok: boolean;
  reason?: string;
};

export async function testGIBS(): Promise<GIBSTestResponse> {
  try {
    // Primero obtener frames disponibles
    const framesResponse = await apiGet<{
      frames: Array<{ timestamp: number; iso: string }>;
      count: number;
      provider: string;
      error: string | null;
    }>("/api/global/satellite/frames");

    if (!framesResponse || framesResponse.error !== null) {
      return { ok: false, reason: "backend_error" };
    }

    if (!framesResponse.frames || framesResponse.frames.length === 0) {
      return { ok: false, reason: "tile_not_available" };
    }

    // Usar el último frame disponible
    const lastFrame = framesResponse.frames[framesResponse.frames.length - 1];
    const timestamp = lastFrame.timestamp;

    // Probar un tile con el timestamp del frame
    const tileUrl = `${BASE}/api/global/satellite/tiles/${timestamp}/0/0/0.png`;
    const tileResponse = await fetch(tileUrl);

    if (tileResponse.ok && tileResponse.headers.get("content-type")?.includes("image")) {
      return { ok: true };
    }

    return { ok: false, reason: "tile_not_available" };
  } catch (error) {
    return { ok: false, reason: "connection_error" };
  }
}

// Lightning/Blitzortung API
export type LightningMqttTestRequest = {
  mqtt_host: string;
  mqtt_port: number;
  mqtt_topic: string;
  timeout_sec: number;
};

export type LightningMqttTestResponse = {
  ok: boolean;
  connected: boolean;
  received?: number;
  topic?: string;
  latency_ms?: number;
  error?: string;
};

export async function testLightningMqtt(request: LightningMqttTestRequest): Promise<LightningMqttTestResponse> {
  try {
    return apiPost<LightningMqttTestResponse>("/api/lightning/test_mqtt", request);
  } catch (error) {
    return { ok: false, connected: false, error: "connection_error" };
  }
}

export type LightningWsTestRequest = {
  ws_url: string;
  timeout_sec: number;
};

export type LightningWsTestResponse = {
  ok: boolean;
  connected: boolean;
  error?: string;
};

export async function testLightningWs(request: LightningWsTestRequest): Promise<LightningWsTestResponse> {
  try {
    return apiPost<LightningWsTestResponse>("/api/lightning/test_ws", request);
  } catch (error) {
    return { ok: false, connected: false, error: "connection_error" };
  }
}

export type LightningStatusResponse = {
  enabled: boolean;
  source: "mqtt" | "ws" | "none";
  connected: boolean;
  buffer_size: number;
  last_event_age_sec: number | null;
  rate_per_min: number;
  center: {
    lat: number;
    lng: number;
    zoom: number;
  } | null;
  auto_enable: {
    active: boolean;
    radius_km: number;
    will_disable_in_min: number | null;
  } | null;
};

export async function getLightningStatus(): Promise<LightningStatusResponse> {
  try {
    return apiGet<LightningStatusResponse>("/api/lightning/status");
  } catch (error) {
    return {
      enabled: false,
      source: "none",
      connected: false,
      buffer_size: 0,
      last_event_age_sec: null,
      rate_per_min: 0,
      center: null,
      auto_enable: null,
    };
  }
}

export type LightningSampleResponse = {
  count: number;
  items: Array<{
    ts: number;
    lat: number;
    lng: number;
    amplitude: number | null;
    type: string;
  }>;
};

export async function getLightningSample(limit: number = 50): Promise<LightningSampleResponse> {
  try {
    return apiGet<LightningSampleResponse>(`/api/lightning/sample?limit=${limit}`);
  } catch (error) {
    return { count: 0, items: [] };
  }
}

// Flights and Ships test endpoints
export type FlightsTestResponse = {
  ok: boolean;
  provider?: string;
  auth?: string;
  token_last4?: string;
  expires_in?: number;
  reason?: string;
  tip?: string;
  detail?: string;
};

export async function testFlights(): Promise<FlightsTestResponse> {
  try {
    return apiPost<FlightsTestResponse>("/api/flights/test", {});
  } catch (error) {
    return { ok: false, reason: "connection_error", tip: String(error) };
  }
}

export type ShipsTestResponse = {
  ok: boolean;
  provider?: string;
  reason?: string;
  tip?: string;
  detail?: string;
};

export async function testShips(): Promise<ShipsTestResponse> {
  try {
    return apiPost<ShipsTestResponse>("/api/ships/test", {});
  } catch (error) {
    return { ok: false, reason: "connection_error", tip: String(error) };
  }
}

// Flights and Ships preview endpoints
export type FlightsPreviewResponse = {
  ok: boolean;
  count: number;
  total?: number;
  items: unknown[];
  reason?: string;
};

export async function getFlightsPreview(limit: number = 20): Promise<FlightsPreviewResponse> {
  try {
    return apiGet<FlightsPreviewResponse>(`/api/flights/preview?limit=${limit}`);
  } catch (error) {
    return { ok: false, count: 0, items: [], reason: "connection_error" };
  }
}

export type ShipsPreviewResponse = {
  ok: boolean;
  count: number;
  total?: number;
  items: unknown[];
  reason?: string;
};

export async function getShipsPreview(limit: number = 20): Promise<ShipsPreviewResponse> {
  try {
    return apiGet<ShipsPreviewResponse>(`/api/ships/preview?limit=${limit}`);
  } catch (error) {
    return { ok: false, count: 0, items: [], reason: "connection_error" };
  }
}

// Config group save functions
export async function saveConfigGroup(groupName: string, config: unknown): Promise<AppConfig> {
  return apiPatch<AppConfig>(`/api/config/group/${groupName}`, config);
}

// Secrets update functions
export async function updateSecrets(secrets: {
  opensky?: {
    oauth2?: {
      client_id?: string | null;
      client_secret?: string | null;
      token_url?: string | null;
      scope?: string | null;
    };
    basic?: {
      username?: string | null;
      password?: string | null;
    };
  };
  aviationstack?: {
    api_key?: string | null;
  };
  aisstream?: {
    api_key?: string | null;
  };
  aishub?: {
    api_key?: string | null;
  };
  maptiler?: {
    api_key?: string | null;
  };
  openweathermap?: {
    api_key?: string | null;
  };
  meteoblue?: {
    api_key?: string | null;
  };
}): Promise<void> {
  return apiPatch("/api/config/group/secrets", secrets);
}

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
  source?: string;
  count?: number;
  sample?: Array<{
    title: string;
    start: string;
    end: string;
    location: string;
    allDay: boolean;
  }>;
  range_days?: number;
  message?: string;
  reason?: string;
  tip?: string;
};

export async function testCalendarConnection(apiKey?: string, calendarId?: string) {
  // Si no se proporcionan credenciales, llamar sin body para usar el origen activo
  if (!apiKey && !calendarId) {
    try {
      return apiPost<CalendarTestResponse | undefined>("/api/calendar/test", {});
    } catch (error) {
      return { ok: false, reason: "connection_error", message: String(error) };
    }
  }

  const body: Record<string, unknown> = {};
  if (apiKey && apiKey.trim().length > 0) {
    body.api_key = apiKey.trim();
  }
  if (calendarId && calendarId.trim().length > 0) {
    body.calendar_id = calendarId.trim();
  }
  return apiPost<CalendarTestResponse | undefined>("/api/calendar/test", body);
}

// Maps test endpoints
export type MapTilerTestRequest = {
  styleUrl: string;
};

export type MapTilerTestResponse = {
  ok: boolean;
  bytes?: number;
  status?: number;
  error?: string;
};

export async function testMapTiler(request: MapTilerTestRequest): Promise<MapTilerTestResponse> {
  try {
    return apiPost<MapTilerTestResponse>("/api/maps/test_maptiler", request);
  } catch (error) {
    return { ok: false, error: "connection_error" };
  }
}

export type XyzTestRequest = {
  tileUrl: string;
};

export type XyzTestResponse = {
  ok: boolean;
  bytes?: number;
  contentType?: string;
  error?: string;
};

export async function testXyz(request: XyzTestRequest): Promise<XyzTestResponse> {
  try {
    return apiPost<XyzTestResponse>("/api/maps/test_xyz", request);
  } catch (error) {
    return { ok: false, error: "connection_error" };
  }
}

// News feeds test endpoint
export type NewsTestFeedsRequest = {
  feeds: string[];
};

export type NewsFeedTestResult = {
  url: string;
  reachable: boolean;
  items: number;
  title: string | null;
  error: string | null;
};

export type NewsTestFeedsResponse = {
  ok: boolean;
  results: NewsFeedTestResult[];
};

export async function testNewsFeeds(request: NewsTestFeedsRequest): Promise<NewsTestFeedsResponse> {
  try {
    return apiPost<NewsTestFeedsResponse>("/api/news/test_feeds", request);
  } catch (error) {
    return { ok: false, results: [] };
  }
}

// Calendar ICS endpoints
export type CalendarICSUploadResponse = {
  ok: boolean;
  events_parsed?: number;
  range_days?: number;
  error?: string;
  detail?: string;
};

export async function uploadCalendarICS(file: File): Promise<CalendarICSUploadResponse> {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${window.location.origin}/api/calendar/ics/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "unknown_error" }));
      return { ok: false, error: error.error || "upload_error", detail: error.detail };
    }

    return await response.json();
  } catch (error) {
    return { ok: false, error: "connection_error", detail: String(error) };
  }
}

export type CalendarICSUrlRequest = {
  url: string;
};

export type CalendarICSUrlResponse = {
  ok: boolean;
  events?: number;
  error?: string;
  detail?: string;
};

export async function setCalendarICSUrl(request: CalendarICSUrlRequest): Promise<CalendarICSUrlResponse> {
  try {
    return apiPost<CalendarICSUrlResponse>("/api/calendar/ics/url", request);
  } catch (error) {
    return { ok: false, error: "connection_error", detail: String(error) };
  }
}

export type CalendarPreviewItem = {
  title: string;
  start: string;
  end: string;
  location: string;
  all_day: boolean;
};

export type CalendarPreviewResponse = {
  ok: boolean;
  source?: string;
  count?: number;
  items?: CalendarPreviewItem[];
  error?: string;
  message?: string;
};

export async function getCalendarPreview(limit: number = 10): Promise<CalendarPreviewResponse> {
  try {
    return apiGet<CalendarPreviewResponse>(`/api/calendar/preview?limit=${limit}`);
  } catch (error) {
    return { ok: false, error: "connection_error", message: String(error) };
  }
}
