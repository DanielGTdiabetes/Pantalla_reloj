import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BACKGROUND_SOURCES, DEFAULT_BACKGROUND_INTERVAL } from '../services/config';

interface BackgroundRotatorProps {
  powerSave: boolean;
  intervalMinutes?: number;
}

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let isMounted = true;
    let timer: number | undefined;

    const rotationMs = (intervalMinutes ?? DEFAULT_BACKGROUND_INTERVAL) * 60_000;

    const cycle = async (index: number) => {
      const src = BACKGROUND_SOURCES[index];
      await preload(src);
      if (!isMounted) return;
      setCurrentUrl(src);

      const nextIndex = (index + 1) % BACKGROUND_SOURCES.length;
      const nextSrc = BACKGROUND_SOURCES[nextIndex];
      const preloadNext = preload(nextSrc);

      timer = window.setTimeout(async () => {
        await preloadNext;
        if (!isMounted) return;
        cycle(nextIndex);
      }, rotationMs);
    };

    cycle(0);

    return () => {
      isMounted = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [intervalMinutes]);

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
