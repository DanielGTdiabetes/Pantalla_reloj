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

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as Record<string, unknown> | string | undefined;
      if (typeof data === "string") return data;
      const detail = data?.detail ?? data?.message;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) return detail.join(", ");
      if (detail != null) return String(detail);
    } else {
      const text = await res.text();
      if (text) return text;
    }
  } catch {
    // Fall through to the fallback message below.
  }
  return fallback;
}

export async function apiPut<T = JSON>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
    ...init
  });
  if (!res.ok) {
    const fallback = `PUT ${path} ${res.status}`;
    const detail = await parseError(res, fallback);
    throw new Error(detail === fallback ? detail : `${fallback}: ${detail}`);
  }
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
