import { apiRequest } from './config';

export interface WifiNetwork {
  ssid: string;
  signal?: number;
  security?: string;
}

export interface WifiStatus {
  connected: boolean;
  ssid?: string | null;
  ip?: string | null;
}

export async function scanNetworks(): Promise<WifiNetwork[]> {
  return await apiRequest<WifiNetwork[]>('/wifi/scan');
}

export async function connectNetwork(ssid: string, password?: string): Promise<void> {
  await apiRequest('/wifi/connect', {
    method: 'POST',
    body: JSON.stringify({ ssid, psk: password ?? undefined }),
  });
}

export async function forgetNetwork(ssid: string): Promise<void> {
  await apiRequest('/wifi/forget', {
    method: 'POST',
    body: JSON.stringify({ ssid }),
  });
}

export async function fetchWifiStatus(): Promise<WifiStatus> {
  return await apiRequest<WifiStatus>('/wifi/status');
}
