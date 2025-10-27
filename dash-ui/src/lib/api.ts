import type { AppConfig } from "../types/config";

const BASE = window.location.origin;

const withBase = (path: string) => {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${suffix}`;
};

const readJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.warn("Failed to parse API response as JSON", error);
    return undefined as T;
  }
};

export const API_ORIGIN = BASE;

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const response = await fetch(withBase(path), {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`API:${response.status}`);
  return await readJson<T>(response);
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(withBase(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body ?? {})
  });
  if (!response.ok) throw new Error(`API:${response.status}`);
  return await readJson<T>(response);
}

export async function getHealth() {
  return apiGet<Record<string, unknown> | undefined>("/api/health");
}

export async function getConfig() {
  return apiGet<AppConfig | undefined>("/api/config");
}

export async function saveConfig(data: AppConfig) {
  return apiPost<unknown>("/api/config", data);
}
