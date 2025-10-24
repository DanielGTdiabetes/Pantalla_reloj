import { API_BASE_URL } from './config';

export interface WifiNetwork {
  ssid: string;
  signal?: number;
  security?: string;
}

export interface WifiScanResult {
  networks: WifiNetwork[];
  raw?: string;
}

export interface WifiStatus {
  connected: boolean;
  ssid?: string | null;
  ip?: string | null;
  interface?: string | null;
}

export class WifiNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WifiNotSupportedError';
  }
}

async function parseWifiError(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (typeof data?.message === 'string') return data.message;
  } catch (error) {
    // ignore JSON parse errors
  }
  return response.statusText || null;
}

async function wifiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 501) {
    const message = (await parseWifiError(response)) ?? 'Wi-Fi no soportado en este dispositivo';
    throw new WifiNotSupportedError(message);
  }

  if (!response.ok) {
    const message = (await parseWifiError(response)) ?? `Error ${response.status}`;
    throw new Error(message);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

export async function scanNetworks(): Promise<WifiScanResult> {
  return await wifiRequest<WifiScanResult>('/wifi/scan');
}

export async function connectNetwork(ssid: string, password?: string): Promise<void> {
  await wifiRequest('/wifi/connect', {
    method: 'POST',
    body: JSON.stringify({ ssid, psk: password ?? undefined }),
  });
}

export async function fetchWifiStatus(): Promise<WifiStatus> {
  return await wifiRequest<WifiStatus>('/wifi/status');
}
