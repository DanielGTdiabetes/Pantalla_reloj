import type { ThemeKey } from '../styles/theme';
import bg1 from '../assets/backgrounds/1.webp';
import bg2 from '../assets/backgrounds/2.webp';
import bg3 from '../assets/backgrounds/3.webp';
import bg4 from '../assets/backgrounds/4.webp';
import bg5 from '../assets/backgrounds/5.webp';
import bg6 from '../assets/backgrounds/6.webp';

export const API_BASE_URL = 'http://127.0.0.1:8787/api';
export const WEATHER_CACHE_KEY = 'weatherCache';
export const THEME_STORAGE_KEY = 'dashTheme';
export const CONFIG_CACHE_KEY = 'dashConfig';
export const DEFAULT_THEME: ThemeKey = 'cyberpunkNeon';
export const DEFAULT_BACKGROUND_INTERVAL = 5;
export const powerSave = false;

export const BACKGROUND_SOURCES = [bg1, bg2, bg3, bg4, bg5, bg6] as const;

export interface WeatherConfig {
  lat?: number;
  lon?: number;
  city?: string;
  units?: 'metric' | 'imperial';
  apiKey?: string;
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

export interface DashboardConfig {
  weather?: WeatherConfig;
  theme?: ThemeConfig;
  background?: BackgroundConfig;
  tts?: TTSConfig;
  wifi?: WifiConfig;
  calendar?: CalendarConfig;
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
