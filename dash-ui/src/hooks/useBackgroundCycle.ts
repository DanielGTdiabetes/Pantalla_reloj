import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import fallbackImage from '../assets/backgrounds/3.webp';
import { BACKEND_BASE_URL } from '../services/config';
import { useStormStatus } from '../context/StormStatusContext';

interface BackgroundResponse {
  url: string;
  generatedAt: number;
  isFallback?: boolean;
  etag?: string;
  lastModified?: number;
}

export interface BackgroundSlot {
  url: string;
  generatedAt: number;
  isFallback: boolean;
  etag?: string;
  lastModified?: number;
}

export interface BackgroundCycleState {
  previous: BackgroundSlot | null;
  current: BackgroundSlot;
  next: BackgroundSlot | null;
  cycleKey: number;
  isCrossfading: boolean;
}

const DEFAULT_REFRESH_MINUTES = 60;
const CROSSFADE_DURATION_MS = 1200;

export function useBackgroundCycle(refreshMinutes = DEFAULT_REFRESH_MINUTES): BackgroundCycleState {
  const { status: stormStatus } = useStormStatus();
  const backendBase = useMemo(() => BACKEND_BASE_URL.replace(/\/$/, ''), []);
  const [current, setCurrent] = useState<BackgroundSlot>({
    url: fallbackImage,
    generatedAt: 0,
    isFallback: true,
  });
  const [previous, setPrevious] = useState<BackgroundSlot | null>(null);
  const [next, setNext] = useState<BackgroundSlot | null>(null);
  const [isCrossfading, setIsCrossfading] = useState(false);
  const [cycleKey, setCycleKey] = useState(0);
  const etagRef = useRef<string | undefined>();
  const lastSwitchRef = useRef<number>(Date.now());
  const isCommittingRef = useRef<boolean>(false);
  const refreshMs = refreshMinutes * 60_000;

  const normalizePayload = useCallback(
    (payload: BackgroundResponse): BackgroundSlot => ({
      url: payload.url.startsWith('http') ? payload.url : `${backendBase}${payload.url}`,
      generatedAt: payload.generatedAt ?? Date.now(),
      isFallback: Boolean(payload.isFallback),
      etag: payload.etag,
      lastModified: payload.lastModified,
    }),
    [backendBase],
  );

  const fetchBackground = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (etagRef.current) {
      headers['If-None-Match'] = etagRef.current;
    }
    const response = await fetch(`${backendBase}/api/backgrounds/current`, { headers });
    if (response.status === 304) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }
    const data = (await response.json()) as BackgroundResponse;
    const etag = response.headers.get('etag') ?? data.etag ?? undefined;
    etagRef.current = etag ?? undefined;
    return normalizePayload({ ...data, etag });
  }, [backendBase, normalizePayload]);

  const prepareNext = useCallback(async () => {
    try {
      const slot = await fetchBackground();
      if (!slot) {
        return;
      }
      await preloadImage(slot);
      setNext(slot);
    } catch (error) {
      console.warn('No se pudo precargar fondo siguiente', error);
    }
  }, [fetchBackground]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const slot = await fetchBackground();
        if (slot && !cancelled) {
          await preloadImage(slot);
          setCurrent(slot);
          lastSwitchRef.current = Date.now();
        }
      } catch (error) {
        console.warn('No se pudo cargar fondo inicial', error);
      }
      if (!cancelled) {
        void prepareNext();
      }
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [fetchBackground, prepareNext]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void prepareNext();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [prepareNext, refreshMs]);

  const commitNext = useCallback(() => {
    if (isCommittingRef.current || !next) {
      return;
    }
    isCommittingRef.current = true;
    setPrevious(current);
    setCurrent(next);
    setNext(null);
    setIsCrossfading(true);
    lastSwitchRef.current = Date.now();
    setCycleKey((value) => value + 1);
    isCommittingRef.current = false;
  }, [current, next]);

  useEffect(() => {
    if (!next) return;
    const now = Date.now();
    const due = lastSwitchRef.current + refreshMs;
    if (now >= due) {
      commitNext();
      return;
    }
    const timeout = window.setTimeout(() => {
      commitNext();
    }, Math.max(0, due - now));
    return () => window.clearTimeout(timeout);
  }, [commitNext, next, refreshMs]);

  const prevStorm = useRef<boolean | null>(null);
  useEffect(() => {
    const hasStorm = Boolean(stormStatus?.nearActivity);
    if (prevStorm.current === null) {
      prevStorm.current = hasStorm;
      return;
    }
    if (hasStorm && !prevStorm.current && next) {
      commitNext();
    }
    prevStorm.current = hasStorm;
  }, [stormStatus?.nearActivity, next, commitNext]);

  useEffect(() => {
    if (!isCrossfading) return;
    const timeout = window.setTimeout(() => {
      setPrevious(null);
      setIsCrossfading(false);
    }, CROSSFADE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [isCrossfading]);

  return { previous, current, next, isCrossfading, cycleKey };
}

export function buildVersionedSrc(slot: BackgroundSlot): string {
  const version = slot.etag ?? slot.generatedAt;
  if (!version) {
    return slot.url;
  }
  const hashIndex = slot.url.indexOf('#');
  const hash = hashIndex >= 0 ? slot.url.slice(hashIndex) : '';
  const base = hashIndex >= 0 ? slot.url.slice(0, hashIndex) : slot.url;
  const separator = base.includes('?') ? '&' : '?';
  const versioned = `${base}${separator}v=${encodeURIComponent(String(version))}`;
  return `${versioned}${hash}`;
}

async function preloadImage(slot: BackgroundSlot): Promise<void> {
  const src = buildVersionedSrc(slot);
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`No se pudo precargar ${src}`));
    image.src = src;
  });
}
