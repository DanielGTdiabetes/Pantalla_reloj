import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchWeatherWeekly,
  fetchWeatherToday,
  type WeatherDay,
  type WeatherToday,
} from '../services/weather';

interface WeeklyCacheRecord {
  data: WeatherDay[] | null;
  timestamp: number | null;
  fallback: boolean;
}

interface WeeklyForecastResult {
  days: WeatherDay[] | null;
  text: string | null;
  loading: boolean;
}

const CACHE_KEY = 'weeklyForecastCache';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const FALLBACK_TTL_MS = 5 * 60 * 1000; // caché más corta para datos parciales
const ERROR_RETRY_MS = 5 * 60 * 1000;

const ICON_MAP: Record<string, string> = {
  sun: '☀️',
  cloud: '☁️',
  rain: '🌧️',
  storm: '⛈️',
  snow: '❄️',
  fog: '🌫️',
};

const DOW_LABELS: Record<string, string> = {
  Lun: 'Lu',
  Mar: 'Ma',
  Mié: 'Mi',
  Mie: 'Mi',
  Jue: 'Ju',
  Vie: 'Vi',
  Sáb: 'Sá',
  Sab: 'Sá',
  Dom: 'Do',
  Mon: 'Lu',
  Tue: 'Ma',
  Wed: 'Mi',
  Thu: 'Ju',
  Fri: 'Vi',
  Sat: 'Sá',
  Sun: 'Do',
};

let memoryCache: WeeklyCacheRecord = { data: null, timestamp: null, fallback: false };
let cacheHydrated = false;
let inflightRequest: Promise<{ data: WeatherDay[]; fallback: boolean }> | null = null;

function readCacheFromStorage(): WeeklyCacheRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WeeklyCacheRecord>;
    if (!parsed) return null;
    return {
      data: Array.isArray(parsed.data) ? (parsed.data as WeatherDay[]) : null,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : null,
      fallback: Boolean(parsed.fallback),
    };
  } catch (error) {
    console.warn('No se pudo leer caché de previsión semanal', error);
    return null;
  }
}

function persistCache(record: WeeklyCacheRecord): void {
  if (typeof window === 'undefined') return;
  try {
    if (!record.timestamp) {
      window.sessionStorage.removeItem(CACHE_KEY);
      return;
    }
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(record));
  } catch (error) {
    console.warn('No se pudo persistir caché de previsión semanal', error);
  }
}

function hydrateCache(): WeeklyCacheRecord {
  if (!cacheHydrated) {
    const stored = readCacheFromStorage();
    if (stored) {
      memoryCache = stored;
    }
    cacheHydrated = true;
  }
  return memoryCache;
}

function updateCache(data: WeatherDay[] | null, timestamp: number | null, fallback: boolean): void {
  memoryCache = { data, timestamp, fallback: Boolean(fallback) };
  persistCache(memoryCache);
}

async function requestWeeklyForecast(): Promise<{ data: WeatherDay[]; fallback: boolean }> {
  if (!inflightRequest) {
    inflightRequest = fetchWeatherWeekly()
      .then((days) => {
        inflightRequest = null;
        if (!Array.isArray(days) || days.length === 0) {
          throw new Error('Sin datos semanales');
        }
        return { data: days, fallback: false };
      })
      .catch(async (error) => {
        inflightRequest = null;
        console.warn('Fallo en previsión semanal, aplicando fallback', error);
        try {
          const today = await fetchWeatherToday();
          const fallbackDay = buildFallbackDay(today);
          return { data: fallbackDay ? [fallbackDay] : [], fallback: true };
        } catch (fallbackError) {
          console.warn('No se pudo generar fallback diario', fallbackError);
          throw error instanceof Error ? error : new Error('No se pudo cargar previsión semanal');
        }
      });
  }
  return inflightRequest;
}

function buildFallbackDay(today: WeatherToday | null): WeatherDay | null {
  if (!today) return null;
  const now = new Date();
  const iso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  return {
    day: 'Hoy',
    date: iso,
    min: today.min,
    max: today.max,
    rainProb: today.rainProb,
    stormProb: 0,
    condition: today.condition,
    icon: today.icon,
  };
}

function isExpired(record: WeeklyCacheRecord, now: number): boolean {
  if (!record.timestamp) return true;
  const ttl = record.fallback ? FALLBACK_TTL_MS : CACHE_TTL_MS;
  if (now - record.timestamp >= ttl) return true;
  return false;
}

function formatWeeklyLine(days: WeatherDay[] | null): string | null {
  if (!days || days.length === 0) return null;
  const segments = days.slice(0, 7).map((day) => {
    const icon = ICON_MAP[day.icon] ?? '•';
    const label = DOW_LABELS[day.day] ?? day.day.slice(0, 2);
    const rain = Number.isFinite(day.rainProb) ? `${Math.round(day.rainProb)}%` : '—';
    const max = Number.isFinite(day.max) ? `${Math.round(day.max)}°` : '—';
    const min = Number.isFinite(day.min) ? `${Math.round(day.min)}°` : '—';
    return `${icon} ${label} ${rain} ${max}/${min}`;
  });
  return segments.join(' · ');
}

export const useWeeklyForecast = (): WeeklyForecastResult => {
  const initialCache = hydrateCache();
  const [days, setDays] = useState<WeatherDay[] | null>(initialCache.data);
  const [timestamp, setTimestamp] = useState<number | null>(initialCache.timestamp);
  const [fallback, setFallback] = useState<boolean>(initialCache.fallback);
  const [loading, setLoading] = useState<boolean>(() => !initialCache.timestamp);
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const performFetch = useCallback(async () => {
    try {
      setLoading(true);
      const result = await requestWeeklyForecast();
      const now = Date.now();
      updateCache(result.data, now, result.fallback);
      if (!isMountedRef.current) return;
      setDays(result.data);
      setTimestamp(now);
      setFallback(result.fallback);
    } catch (err) {
      console.warn('No se pudo actualizar la previsión semanal', err);
      const now = Date.now();
      const retryAt = Math.max(0, now - CACHE_TTL_MS + ERROR_RETRY_MS);
      updateCache(null, retryAt, false);
      if (!isMountedRef.current) return;
      setDays(null);
      setTimestamp(retryAt);
      setFallback(false);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const expired = isExpired({ data: days, timestamp, fallback }, now);

    const triggerFetch = () => {
      if (cancelled) return;
      void performFetch();
    };

    let timer: number | undefined;
    if (expired) {
      triggerFetch();
    } else {
      const ttl = fallback ? FALLBACK_TTL_MS : CACHE_TTL_MS;
      const delay = Math.max(1, ttl - (now - (timestamp ?? 0)));
      timer = window.setTimeout(() => {
        triggerFetch();
      }, delay);
    }

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [days, fallback, performFetch, timestamp]);

  const text = useMemo(() => formatWeeklyLine(days), [days]);

  return { days, text, loading };
};

