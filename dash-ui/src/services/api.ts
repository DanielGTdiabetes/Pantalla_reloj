import type { AppConfig } from "../types/config";

const API_BASE = "/api";

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type HttpMethod = "GET" | "PUT" | "POST" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
};

const toJson = async (response: Response) => {
  if (response.status === 204) {
    return {};
  }

  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ApiError("La respuesta del servidor no es JSON válido", response.status);
  }
};

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { method = "GET", body } = options;

  let response: Response;
  try {
    const headers: HeadersInit | undefined =
      body === undefined ? undefined : { "Content-Type": "application/json" };
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new ApiError("No se pudo conectar con el servicio", undefined);
  }

  if (response.status === 404 || response.status === 501) {
    throw new ApiError("No disponible / no configurado", response.status);
  }

  if (!response.ok) {
    let detail: string | null = null;
    try {
      const payload = (await toJson(response)) as { detail?: string };
      detail = typeof payload?.detail === "string" ? payload.detail : null;
    } catch (parseError) {
      detail = null;
    }

    const message = detail || `Error ${response.status} en la solicitud`;
    throw new ApiError(message, response.status);
  }

  return toJson(response) as Promise<T>;
};

export const api = {
  fetchHealth: () => request<{ status: string; uptime_seconds: number; timestamp: string }>("/health"),
  fetchConfig: () => request<AppConfig>("/config"),
  updateConfig: (payload: AppConfig) => request<AppConfig>("/config", { method: "PUT", body: payload }),
  fetchWeather: () => request<Record<string, unknown>>("/weather"),
  fetchNews: () => request<Record<string, unknown>>("/news"),
  fetchAstronomy: () => request<Record<string, unknown>>("/astronomy"),
  fetchCalendar: () => request<Record<string, unknown>>("/calendar"),
  fetchStormMode: () => request<Record<string, unknown>>("/storm_mode"),
  updateStormMode: (payload: { enabled: boolean }) => request<Record<string, unknown>>("/storm_mode", { method: "POST", body: payload })
};

export type ApiClient = typeof api;
