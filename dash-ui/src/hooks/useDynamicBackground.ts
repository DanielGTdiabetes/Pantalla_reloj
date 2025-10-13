import { useEffect, useMemo, useState } from 'react';
import fallbackImage from '../assets/backgrounds/3.webp';
import { BACKEND_BASE_URL } from '../services/config';

interface BackgroundResponse {
  url: string;
  generatedAt: number;
}

interface BackgroundState {
  url: string;
  generatedAt: number;
  isFallback: boolean;
}

const DEFAULT_REFRESH_MINUTES = 60;

export function useDynamicBackground(refreshMinutes = DEFAULT_REFRESH_MINUTES): BackgroundState {
  const [state, setState] = useState<BackgroundState>({
    url: fallbackImage,
    generatedAt: 0,
    isFallback: true,
  });

  const backendBase = useMemo(() => BACKEND_BASE_URL.replace(/\/$/, ''), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const response = await fetch(`${backendBase}/api/backgrounds/current`);
        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }
        const data = (await response.json()) as BackgroundResponse;
        if (!cancelled && data?.url) {
          const fullUrl = data.url.startsWith('http') ? data.url : `${backendBase}${data.url}`;
          setState({ url: fullUrl, generatedAt: data.generatedAt, isFallback: false });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ url: fallbackImage, generatedAt: 0, isFallback: true });
        }
      }
    };

    void load();

    timer = window.setInterval(() => {
      void load();
    }, refreshMinutes * 60_000);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [backendBase, refreshMinutes]);

  return state;
}
