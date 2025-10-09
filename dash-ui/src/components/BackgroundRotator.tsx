import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BACKGROUND_SOURCES, BACKEND_BASE_URL, DEFAULT_BACKGROUND_INTERVAL } from '../services/config';
import { fetchAutoBackgrounds, type BackgroundAsset } from '../services/backgrounds';

interface BackgroundRotatorProps {
  powerSave: boolean;
  intervalMinutes?: number;
}

const POLLING_INTERVAL_MS = 60_000;

function preload(src: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.src = src;
    if (image.complete) {
      resolve(src);
      return;
    }
    image.onload = () => resolve(src);
    image.onerror = () => resolve(src);
  });
}

const BackgroundRotator = ({ powerSave, intervalMinutes }: BackgroundRotatorProps) => {
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>(() => [...BACKGROUND_SOURCES]);

  const backendBase = useMemo(() => BACKEND_BASE_URL.replace(/\/$/, ''), []);

  const composeUrl = useCallback(
    (asset: BackgroundAsset) => `${backendBase}${asset.url}?v=${asset.generatedAt}`,
    [backendBase],
  );

  const refreshBackgrounds = useCallback(async () => {
    try {
      const assets = await fetchAutoBackgrounds(8);
      if (!assets.length) {
        setSources((prev) => (prev.length ? prev : [...BACKGROUND_SOURCES]));
        return;
      }
      const urls = assets.map(composeUrl);
      setSources((prev) => {
        const currentKey = prev.join('|');
        const nextKey = urls.join('|');
        if (currentKey === nextKey) {
          return prev;
        }
        return urls;
      });
    } catch (error) {
      console.warn('No se pudieron cargar fondos automáticos', error);
      setSources((prev) => (prev.length ? prev : [...BACKGROUND_SOURCES]));
    }
  }, [composeUrl]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: number | undefined;
    void refreshBackgrounds();
    timer = window.setInterval(() => {
      void refreshBackgrounds();
    }, POLLING_INTERVAL_MS);
    return () => {
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [refreshBackgrounds]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!sources.length) {
      setCurrentUrl(null);
      return undefined;
    }
    let isMounted = true;
    let timer: number | undefined;

    const rotationMs = (intervalMinutes ?? DEFAULT_BACKGROUND_INTERVAL) * 60_000;

    let index = 0;

    const cycle = async () => {
      const src = sources[index % sources.length];
      await preload(src);
      if (!isMounted) return;
      setCurrentUrl(src);
      index = (index + 1) % sources.length;
      timer = window.setTimeout(() => {
        void cycle();
      }, rotationMs);
    };

    void cycle();

    return () => {
      isMounted = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [intervalMinutes, sources]);

  const transitionDuration = powerSave ? 0.8 : 1.4;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <AnimatePresence mode="wait">
        {currentUrl && (
          <motion.div
            key={currentUrl}
            className="fade-layer absolute inset-0 reduced-motion"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: transitionDuration, ease: 'easeInOut' }}
            style={{
              backgroundImage: `url(${currentUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: powerSave ? 'none' : 'saturate(110%) contrast(105%)',
            }}
            aria-hidden
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-black/70" aria-hidden />
      <div className="absolute inset-0 mix-blend-screen opacity-20" style={{ background: 'radial-gradient(circle at 20% 20%, rgba(56, 249, 255, 0.25), transparent 55%)' }} />
    </div>
  );
};

export default BackgroundRotator;
