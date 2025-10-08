import { apiRequest, WEATHER_CACHE_KEY } from './config';

export type WeatherIcon = 'cloud' | 'rain' | 'sun' | 'snow' | 'storm' | 'fog';

export interface WeatherSnapshot {
  temp: number;
  condition: string;
  icon: WeatherIcon;
  precipProb: number;
  humidity: number;
  updatedAt: number;
  stale?: boolean;
  message?: string;
}

interface ListenerState {
  timer?: number;
  backoffMs: number;
  destroyed: boolean;
}

const listeners = new Map<(data: WeatherSnapshot | null) => void, ListenerState>();
const DEFAULT_INTERVAL = 12 * 60_000;
const MIN_BACKOFF = 60_000;
const MAX_BACKOFF = 15 * 60_000;

function persist(snapshot: WeatherSnapshot) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('No se pudo persistir el clima', error);
  }
}

export function loadCachedWeather(): WeatherSnapshot | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WeatherSnapshot;
  } catch (error) {
    console.warn('No se pudo leer cache de clima', error);
    return null;
  }
}

async function fetchWeather(): Promise<WeatherSnapshot> {
  return await apiRequest<WeatherSnapshot>('/weather/current');
}

function schedule(listener: (data: WeatherSnapshot | null) => void, delay: number) {
  const state = listeners.get(listener);
  if (!state) return;
  if (state.timer) {
    window.clearTimeout(state.timer);
  }
  state.timer = window.setTimeout(() => {
    tick(listener);
  }, delay);
}

async function tick(listener: (data: WeatherSnapshot | null) => void) {
  const state = listeners.get(listener);
  if (!state || state.destroyed) return;
  try {
    const snapshot = await fetchWeather();
    persist(snapshot);
    state.backoffMs = MIN_BACKOFF;
    listener({ ...snapshot, stale: false, message: undefined });
    schedule(listener, DEFAULT_INTERVAL);
  } catch (error) {
    const cached = loadCachedWeather();
    const message = error instanceof Error ? error.message : 'Error desconocido';
    if (cached) {
      listener({ ...cached, stale: true, message });
    } else {
      listener({
        temp: 0,
        condition: 'Sin datos',
        icon: 'cloud',
        precipProb: 0,
        humidity: 0,
        updatedAt: Date.now(),
        stale: true,
        message,
      });
    }
    schedule(listener, state.backoffMs);
    state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF);
  }
}

export function subscribeWeather(listener: (data: WeatherSnapshot | null) => void): () => void {
  const cached = loadCachedWeather();
  if (cached) {
    listener({ ...cached, stale: true });
  } else {
    listener(null);
  }
  listeners.set(listener, { backoffMs: MIN_BACKOFF, destroyed: false });
  tick(listener);
  return () => {
    const state = listeners.get(listener);
    if (state?.timer) {
      window.clearTimeout(state.timer);
    }
    if (state) {
      state.destroyed = true;
    }
    listeners.delete(listener);
  };
}

export function getWeatherSnapshot(): WeatherSnapshot | null {
  return loadCachedWeather();
}
