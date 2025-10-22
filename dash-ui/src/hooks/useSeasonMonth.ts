import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface SeasonMonthPayload {
  month: number;
  hortalizas: string[];
  frutas: string[];
  nota?: string;
  tip?: string;
}

interface SeasonCacheRecord {
  data: SeasonMonthPayload | null;
  timestamp: number | null;
}

interface UseSeasonMonthResult {
  data: SeasonMonthPayload | null;
  formatted: string | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
}

const CACHE_KEY = 'seasonMonthCache_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FORMAT_LENGTH = 160;
const ERROR_RETRY_MS = 60 * 60 * 1000;

let memoryCache: SeasonCacheRecord = { data: null, timestamp: null };
let cacheHydrated = false;
let inflightRequest: Promise<SeasonMonthPayload> | null = null;

function readCacheFromStorage(): SeasonCacheRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: SeasonMonthPayload; timestamp?: number };
    if (parsed && typeof parsed.timestamp === 'number') {
      return {
        data: parsed.data ?? null,
        timestamp: parsed.timestamp,
      };
    }
  } catch (error) {
    console.warn('No se pudo leer caché de temporada', error);
  }
  return null;
}

function persistCache(record: SeasonCacheRecord): void {
  if (typeof window === 'undefined') return;
  try {
    if (!record.timestamp) {
      window.localStorage.removeItem(CACHE_KEY);
      return;
    }
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(record));
  } catch (error) {
    console.warn('No se pudo persistir caché de temporada', error);
  }
}

function hydrateMemoryCache(): SeasonCacheRecord {
  if (!cacheHydrated && typeof window !== 'undefined') {
    const stored = readCacheFromStorage();
    if (stored) {
      memoryCache = stored;
    }
    cacheHydrated = true;
  }
  return memoryCache;
}

function updateCache(data: SeasonMonthPayload | null, timestamp: number | null): void {
  memoryCache = { data, timestamp };
  persistCache(memoryCache);
}

async function requestSeasonMonth(): Promise<SeasonMonthPayload> {
  const response = await fetch('/api/season/month');
  if (!response.ok) {
    throw new Error(`Error ${response.status}`);
  }
  return (await response.json()) as SeasonMonthPayload;
}

async function loadSeasonMonth(): Promise<SeasonMonthPayload> {
  if (!inflightRequest) {
    inflightRequest = requestSeasonMonth()
      .then((result) => {
        inflightRequest = null;
        return result;
      })
      .catch((error) => {
        inflightRequest = null;
        throw error;
      });
  }
  return inflightRequest;
}

function sanitizeItems(items: string[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return '…';
  const slice = text.slice(0, maxLength - 1);
  const lastSeparator = Math.max(slice.lastIndexOf(' · '), slice.lastIndexOf(', '), slice.lastIndexOf(' '));
  const safeSlice = lastSeparator > 40 ? slice.slice(0, lastSeparator) : slice;
  return `${safeSlice.replace(/[·,\s]+$/u, '')}…`;
}

function formatSeasonLine(payload: SeasonMonthPayload | null): string | null {
  if (!payload) return null;
  const safeMonth = Number.isFinite(payload.month) ? Math.min(Math.max(Math.trunc(payload.month), 1), 12) : 1;
  const monthDate = new Date(Date.UTC(2020, safeMonth - 1, 1));
  const monthName = capitalize(new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(monthDate));
  const hortalizas = sanitizeItems(payload.hortalizas).join(', ');
  const frutas = sanitizeItems(payload.frutas).join(', ');
  const segments: string[] = [monthName];
  if (hortalizas) {
    segments.push(`Hortalizas: ${hortalizas}`);
  }
  if (frutas) {
    segments.push(`Frutas: ${frutas}`);
  }
  const fullLine = segments.join(' · ');
  return truncate(fullLine, MAX_FORMAT_LENGTH);
}

export const useSeasonMonth = (): UseSeasonMonthResult => {
  const initialCache = hydrateMemoryCache();
  const [data, setData] = useState<SeasonMonthPayload | null>(initialCache.data);
  const [timestamp, setTimestamp] = useState<number | null>(initialCache.timestamp);
  const [loading, setLoading] = useState<boolean>(() => {
    if (!initialCache.timestamp) return true;
    return Date.now() - initialCache.timestamp >= CACHE_TTL_MS;
  });
  const [error, setError] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const performFetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const result = await loadSeasonMonth();
      const now = Date.now();
      updateCache(result, now);
      if (!isMountedRef.current) return;
      setData(result);
      setTimestamp(now);
    } catch (err) {
      console.warn('No se pudo cargar temporada del mes', err);
      const now = Date.now();
      const retryTimestamp = Math.max(0, now - CACHE_TTL_MS + ERROR_RETRY_MS);
      updateCache(null, retryTimestamp);
      if (!isMountedRef.current) return;
      setData(null);
      setTimestamp(retryTimestamp);
      setError(true);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const expired = !timestamp || now - timestamp >= CACHE_TTL_MS;

    const triggerFetch = () => {
      if (cancelled) return;
      void performFetch();
    };

    let timer: number | undefined;
    if (expired) {
      triggerFetch();
    } else {
      const delay = Math.max(1, CACHE_TTL_MS - (now - (timestamp ?? 0)));
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
  }, [performFetch, timestamp]);

  const formatted = useMemo(() => formatSeasonLine(data), [data]);

  const refresh = useCallback(async () => {
    await performFetch();
  }, [performFetch]);

  return { data, formatted, loading, error, refresh };
};

export { formatSeasonLine };
