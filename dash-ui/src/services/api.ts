import type { AppConfig } from "../types/config";

const API_BASE = import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8081";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed for ${path}`);
  }
  return response.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed for ${path}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  fetchHealth: () => get<{ status: string; uptime_seconds: number; timestamp: string }>("/api/health"),
  fetchConfig: () => get<AppConfig>("/api/config"),
  updateConfig: (payload: Partial<AppConfig>) => post<AppConfig>("/api/config", payload),
  fetchWeather: () => get<Record<string, unknown>>("/api/weather"),
  fetchNews: () => get<Record<string, unknown>>("/api/news"),
  fetchAstronomy: () => get<Record<string, unknown>>("/api/astronomy"),
  fetchCalendar: () => get<Record<string, unknown>>("/api/calendar"),
  fetchStormMode: () => get<Record<string, unknown>>("/api/storm_mode"),
  updateStormMode: (payload: { enabled: boolean }) => post<Record<string, unknown>>("/api/storm_mode", payload)
};
