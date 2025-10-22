import type { ThemeKey } from '../styles/theme';

export const API_BASE_URL = '/api';
export const BACKEND_BASE_URL = '';
export const CONFIG_CACHE_KEY = 'dashConfig';

export interface AemetConfig {
  apiKey?: string;
  municipioId?: string;
  municipioName?: string;
  postalCode?: string;
  province?: string;
}

export interface WeatherConfig {
  city?: string;
  units?: 'metric' | 'imperial';
}

export interface ThemeConfig {
  current?: ThemeKey;
}

export interface BackgroundConfig {
  intervalMinutes?: number;
  mode?: 'daily' | 'weather';
  retainDays?: number;
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
  mode?: 'url' | 'ics';
  provider?: 'none' | 'ics' | 'url' | 'google';
  url?: string | null;
  icsPath?: string | null;
  maxEvents?: number;
  notifyMinutesBefore?: number;
  icsConfigured?: boolean;
  google?: {
    calendarId?: string | null;
  };
}

export interface LocaleConfig {
  language?: string;
  country?: string;
  autonomousCommunity?: string;
  province?: string;
  city?: string;
}

export interface PatronConfig {
  city?: string;
  name?: string;
  month?: number;
  day?: number;
}

export interface StormConfig {
  threshold?: number;
  enableExperimentalLightning?: boolean;
}

export type RotatingPanelSectionKey = 'calendar' | 'season' | 'weekly' | 'lunar';

export interface RotatingPanelConfig {
  enabled?: boolean;
  sections?: RotatingPanelSectionKey[];
  intervalSeconds?: number;
}

export interface UIConfig {
  rotatingPanel?: RotatingPanelConfig;
}

export interface DashboardConfig {
  aemet?: AemetConfig;
  weather?: WeatherConfig;
  theme?: ThemeConfig;
  background?: BackgroundConfig;
  tts?: TTSConfig;
  wifi?: WifiConfig;
  calendar?: CalendarConfig;
  storm?: StormConfig;
  locale?: LocaleConfig;
  patron?: PatronConfig;
  ui?: UIConfig;
}

export type ConfigUpdate = Partial<DashboardConfig>;

export interface ConfigEnvelope {
  config: Record<string, unknown>;
  paths: { config: string; secrets: string };
  secrets: Record<string, unknown>;
}

export interface SecretsPatch {
  openai?: { apiKey?: string | null };
}

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
    if (data?.detail && typeof data.detail.message === 'string') return data.detail.message;
    if (typeof data?.detail?.error === 'string') return data.detail.error;
    if (typeof data?.message === 'string') return data.message;
  } catch (error) {
    // ignore
  }
  return response.statusText;
}

export async function fetchConfigEnvelope(): Promise<ConfigEnvelope> {
  return await apiRequest<ConfigEnvelope>('/config');
}

export async function fetchDashboardConfig(): Promise<DashboardConfig> {
  const envelope = await fetchConfigEnvelope();
  return (envelope?.config as DashboardConfig) ?? {};
}

export async function updateDashboardConfig(payload: ConfigUpdate): Promise<DashboardConfig> {
  const envelope = await saveConfigPatch(payload);
  return (envelope?.config as DashboardConfig) ?? {};
}

export async function saveConfigPatch(payload: ConfigUpdate): Promise<ConfigEnvelope> {
  return await apiRequest<ConfigEnvelope>('/config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function saveSecretsPatch(payload: SecretsPatch): Promise<ConfigEnvelope> {
  return await apiRequest<ConfigEnvelope>('/secrets', {
    method: 'PUT',
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
