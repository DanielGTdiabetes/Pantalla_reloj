export const API_BASE = `${window.location.origin}/api`;

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`GET ${path} ${response.status}`);
  return (await response.json()) as T;
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body ?? {})
  });
  if (!response.ok) throw new Error(`PUT ${path} ${response.status}`);
  return (await response.json()) as T;
}

export async function apiPing(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
