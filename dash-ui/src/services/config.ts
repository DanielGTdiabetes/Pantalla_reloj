import type { ThemeKey } from '../styles/theme';

export const API_BASE_URL = 'http://127.0.0.1:8787/api';
export const BACKEND_BASE_URL = API_BASE_URL.replace(/\/?api$/, '');
export const CONFIG_CACHE_KEY = 'dashConfig';

export interface WeatherConfig {
  city?: string;
  units?: 'metric' | 'imperial';
}

export interface ThemeConfig {
  current?: ThemeKey;
}

export interface BackgroundConfig {
  intervalMinutes?: number;
}

export interface TTSConfig {
  voice?: string;
  volume?: number;
}

export interface WifiConfig {
  preferredInterface?: string;
}

export interface CalendarConfig {
  enabled?: boolean;
  icsUrl?: string;
  maxEvents?: number;
  notifyMinutesBefore?: number;
  icsConfigured?: boolean;
}

export interface StormConfig {
  threshold?: number;
  enableExperimentalLightning?: boolean;
}

export interface DashboardConfig {
  weather?: WeatherConfig;
  theme?: ThemeConfig;
  background?: BackgroundConfig;
  tts?: TTSConfig;
  wifi?: WifiConfig;
  calendar?: CalendarConfig;
  storm?: StormConfig;
}

export type ConfigUpdate = Partial<DashboardConfig>;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await safeParseError(response);
    throw new Error(detail || `Error ${response.status}`);
  }
  return (await response.json()) as T;
}

async function safeParseError(response: Response): Promise<string | undefined> {
  try {
    const data = await response.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (typeof data?.message === 'string') return data.message;
  } catch (error) {
    // ignore
  }
  return response.statusText;
}

export async function fetchDashboardConfig(): Promise<DashboardConfig> {
  return await apiRequest<DashboardConfig>('/config');
}

export async function updateDashboardConfig(payload: ConfigUpdate): Promise<DashboardConfig> {
  return await apiRequest<DashboardConfig>('/config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function loadCachedConfig(): DashboardConfig | null {
  try {
    const raw = window.localStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DashboardConfig;
  } catch (error) {
    console.warn('No se pudo leer config cache', error);
    return null;
  }
}

export function persistConfig(config: DashboardConfig): void {
  try {
    window.localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn('No se pudo persistir config cache', error);
  }
}
