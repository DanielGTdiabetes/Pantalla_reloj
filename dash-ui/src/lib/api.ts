const BASE = "/api";

type JSON = Record<string, unknown>;

export async function apiGet<T = JSON>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...init
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPut<T = JSON>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
    ...init
  });
  if (!res.ok) throw new Error(`PUT ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

// Ping simple para /config
export async function apiPing(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}
