import { apiRequest } from './config';

export interface HealthStatus {
  status: string;
  uptime?: number;
  version?: string;
}

export interface OfflineState {
  offline: boolean;
  since?: number;
  sources?: Record<string, boolean>;
  errors?: Record<string, string>;
}

export async function fetchHealth(): Promise<HealthStatus> {
  return await apiRequest<HealthStatus>('/health');
}

export async function fetchOfflineState(): Promise<OfflineState> {
  return await apiRequest<OfflineState>('/system/offline-state');
}
