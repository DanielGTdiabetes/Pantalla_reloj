import { memo, useEffect, useRef } from 'react';
import { loadAnimation, type AnimationItem } from 'lottie-web';
import { ENABLE_LOTTIE } from '../utils/runtimeFlags';

export type LottieIconName =
  | 'weather-sun'
  | 'weather-rain'
  | 'weather-cloud'
  | 'weather-storm';

const animationLoaders: Record<LottieIconName, () => Promise<unknown>> = {
  'weather-sun': () => import('../assets/lottie/weather-sun.json'),
  'weather-rain': () => import('../assets/lottie/weather-rain.json'),
  'weather-cloud': () => import('../assets/lottie/weather-cloud.json'),
  'weather-storm': () => import('../assets/lottie/weather-storm.json'),
};

interface LottieIconProps {
  name: LottieIconName;
  loop?: boolean;
  className?: string;
}

const LottieIconComponent = ({ name, loop = true, className }: LottieIconProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<AnimationItem | null>(null);

  useEffect(() => {
    if (!ENABLE_LOTTIE) {
      return undefined;
    }
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const loader = animationLoaders[name];
        const module = (await loader()) as { default: { nm?: string } };
        if (cancelled) return;
        animationRef.current = loadAnimation({
          container,
          renderer: 'svg',
          loop,
          autoplay: true,
          animationData: module.default,
        });
      } catch (error) {
        console.warn('No se pudo inicializar animación Lottie', error);
      }
    };

    void load();

    return () => {
      cancelled = true;
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, [name, loop]);

  return <div ref={containerRef} className={className} aria-hidden />;
};

const LottieIcon = memo(LottieIconComponent);

export default LottieIcon;
