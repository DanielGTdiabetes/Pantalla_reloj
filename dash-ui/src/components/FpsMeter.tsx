import { useEffect, useState } from 'react';
import { ENABLE_FPS_METER } from '../utils/runtimeFlags';

const SAMPLE_SIZE = 40;

const FpsMeter = () => {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!ENABLE_FPS_METER) {
      return undefined;
    }

    let frame = 0;
    const times: number[] = [];
    let last = performance.now();
    let rafId = 0;

    const loop = (now: number) => {
      const delta = now - last;
      last = now;
      if (delta > 0) {
        const currentFps = 1000 / delta;
        times.push(currentFps);
        if (times.length > SAMPLE_SIZE) {
          times.shift();
        }
        const avg = times.reduce((sum, value) => sum + value, 0) / times.length;
        if (frame % 10 === 0) {
          setFps(Number(avg.toFixed(1)));
        }
      }
      frame += 1;
      rafId = window.requestAnimationFrame(loop);
    };

    rafId = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  if (!ENABLE_FPS_METER || fps === null) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-6 z-40 select-none rounded-xl border border-cyan-400/30 bg-black/30 px-4 py-2 text-xs font-mono text-cyan-200/80 shadow-lg">
      <span>FPS {fps.toFixed(1)}</span>
    </div>
  );
};

export default FpsMeter;
