import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { buildVersionedSrc, useBackgroundCycle } from '../hooks/useBackgroundCycle';
import { ENABLE_WEBGL } from '../utils/runtimeFlags';

interface DynamicBackgroundProps {
  refreshMinutes?: number;
}

const WALLPAPER_CLASSNAMES = ['wallpaper-dark', 'wallpaper-light'] as const;
type WallpaperTone = (typeof WALLPAPER_CLASSNAMES)[number] | null;

const DynamicBackground = ({ refreshMinutes }: DynamicBackgroundProps) => {
  const { current, previous, cycleKey, isCrossfading } = useBackgroundCycle(refreshMinutes);

  const [wallpaperTone, setWallpaperTone] = useState<WallpaperTone>(null);

  const currentSrc = current ? buildVersionedSrc(current) : '';
  const previousSrc = previous ? buildVersionedSrc(previous) : '';

  useEffect(() => {
    if (!currentSrc) {
      setWallpaperTone(null);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = currentSrc;

    const handleLoad = () => {
      if (cancelled) {
        return;
      }
      try {
        const tone = estimateWallpaperTone(image);
        setWallpaperTone(tone);
      } catch (error) {
        console.warn('No se pudo analizar el fondo actual', error);
        setWallpaperTone(null);
      }
    };

    const handleError = () => {
      if (cancelled) {
        return;
      }
      setWallpaperTone(null);
    };

    image.addEventListener('load', handleLoad);
    image.addEventListener('error', handleError);

    return () => {
      cancelled = true;
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    };
  }, [currentSrc, cycleKey]);

  useEffect(() => {
    const root = document.documentElement;
    WALLPAPER_CLASSNAMES.forEach((className) => {
      root.classList.remove(className);
      document.body.classList.remove(className);
    });

    if (wallpaperTone) {
      root.classList.add(wallpaperTone);
      document.body.classList.add(wallpaperTone);
    }

    return () => {
      WALLPAPER_CLASSNAMES.forEach((className) => {
        root.classList.remove(className);
        document.body.classList.remove(className);
      });
    };
  }, [wallpaperTone]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <AnimatePresence mode="sync">
        {previous && previousSrc && (
          <motion.img
            key={`prev-${previous.generatedAt}-${previous.etag ?? 'none'}`}
            className="fixed inset-0 h-full w-full object-cover fade-layer"
            src={previousSrc}
            alt=""
            aria-hidden
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
            style={{ filter: 'saturate(110%) contrast(105%)' }}
          />
        )}
        {currentSrc && (
          <motion.img
            key={`current-${cycleKey}-${current.etag ?? current.generatedAt}`}
            className="fixed inset-0 h-full w-full object-cover fade-layer"
            src={currentSrc}
            alt=""
            aria-hidden
            initial={{ opacity: isCrossfading ? 0 : 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
            style={{
              filter: ENABLE_WEBGL ? 'saturate(118%) contrast(110%)' : 'saturate(110%) contrast(105%)',
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default DynamicBackground;

function estimateWallpaperTone(image: HTMLImageElement): WallpaperTone {
  const SAMPLE_SIZE = 32;
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  let sum = 0;
  const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const pixelCount = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    // Relative luminance (Rec. 709)
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += luminance;
  }

  const average = sum / pixelCount;
  const normalized = average / 255;
  return normalized < 0.5 ? 'wallpaper-dark' : 'wallpaper-light';
}
