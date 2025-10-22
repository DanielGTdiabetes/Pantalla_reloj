import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNewsHeadlines, type NewsHeadline } from '../services/news';

interface UseNewsHeadlinesResult {
  items: NewsHeadline[];
  loading: boolean;
  error: boolean;
  note: string | null;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

const REFRESH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutos

export const useNewsHeadlines = (enabled: boolean): UseNewsHeadlinesResult => {
  const [items, setItems] = useState<NewsHeadline[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const performFetch = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await fetchNewsHeadlines();
      if (!mountedRef.current) return;
      setItems(Array.isArray(response.items) ? response.items : []);
      setNote(typeof response.note === 'string' ? response.note : null);
      setUpdatedAt(typeof response.updated_at === 'number' ? response.updated_at : null);
    } catch (err) {
      console.warn('No se pudieron obtener noticias', err);
      if (!mountedRef.current) return;
      setItems([]);
      setNote('Error al obtener noticias');
      setUpdatedAt(null);
      setError(true);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      setError(false);
      setNote(null);
      setUpdatedAt(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (cancelled) return;
      await performFetch();
    };

    void load();
    const interval = window.setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, performFetch]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    await performFetch();
  }, [enabled, performFetch]);

  return { items, loading, error, note, updatedAt, refresh };
};

export type { NewsHeadline } from '../services/news';
