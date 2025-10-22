import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDayBrief, type DayInfoPayload } from '../services/dayinfo';

interface DayBriefCacheRecord {
  data: DayInfoPayload | null;
  timestamp: number | null;
  date: string | null;
}

interface UseDayBriefResult {
  data: DayInfoPayload | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
}

const CACHE_KEY = 'dayBriefCache_v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
const ERROR_RETRY_MS = 60 * 60 * 1000; // 1 hora

let memoryCache: DayBriefCacheRecord = { data: null, timestamp: null, date: null };
let cacheHydrated = false;
let inflightRequest: Promise<DayInfoPayload> | null = null;

function todayKey(): string {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return local.toISOString().slice(0, 10);
}

function readCacheFromStorage(): DayBriefCacheRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DayBriefCacheRecord>;
    if (!parsed) return null;
    const record: DayBriefCacheRecord = {
      data: (parsed.data as DayInfoPayload) ?? null,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : null,
      date: typeof parsed.date === 'string' ? parsed.date : null,
    };
    return record;
  } catch (error) {
    console.warn('No se pudo leer caché de day brief', error);
    return null;
  }
}

function persistCache(record: DayBriefCacheRecord): void {
  if (typeof window === 'undefined') return;
  try {
    if (!record.timestamp) {
      window.localStorage.removeItem(CACHE_KEY);
      return;
    }
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(record));
  } catch (error) {
    console.warn('No se pudo persistir caché de day brief', error);
  }
}

function hydrateCache(): DayBriefCacheRecord {
  if (!cacheHydrated) {
    const stored = readCacheFromStorage();
    if (stored) {
      memoryCache = stored;
    }
    cacheHydrated = true;
  }
  return memoryCache;
}

function updateCache(data: DayInfoPayload | null, timestamp: number | null): void {
  const dateValue = data?.date && typeof data.date === 'string' ? data.date : todayKey();
  memoryCache = { data, timestamp, date: timestamp ? dateValue : null };
  persistCache(memoryCache);
}

async function requestDayBrief(): Promise<DayInfoPayload> {
  if (!inflightRequest) {
    inflightRequest = fetchDayBrief()
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

function isCacheExpired(record: DayBriefCacheRecord, now: number): boolean {
  if (!record.timestamp) return true;
  if (!record.date) return true;
  if (now - record.timestamp >= CACHE_TTL_MS) return true;
  const today = todayKey();
  if (record.date !== today) return true;
  return false;
}

export const useDayBrief = (): UseDayBriefResult => {
  const initialCache = hydrateCache();
  const [data, setData] = useState<DayInfoPayload | null>(initialCache.data);
  const [timestamp, setTimestamp] = useState<number | null>(initialCache.timestamp);
  const [loading, setLoading] = useState<boolean>(() => {
    if (!initialCache.timestamp || !initialCache.date) return true;
    const now = Date.now();
    return isCacheExpired(initialCache, now);
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
      const result = await requestDayBrief();
      const now = Date.now();
      updateCache(result, now);
      if (!isMountedRef.current) return;
      setData(result);
      setTimestamp(now);
    } catch (err) {
      console.warn('No se pudo cargar información diaria', err);
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
    const cacheDate = data?.date ?? memoryCache.date;
    const expired = isCacheExpired({ data, timestamp, date: cacheDate }, now);

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
  }, [data, performFetch, timestamp]);

  const refresh = useCallback(async () => {
    await performFetch();
  }, [performFetch]);

  return { data, loading, error, refresh };
};

export type { DayInfoPayload } from '../services/dayinfo';
