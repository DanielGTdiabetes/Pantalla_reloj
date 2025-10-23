import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BACKEND_BASE_URL } from '../services/config';
import { useStormStatus } from '../context/StormStatusContext';
import { fetchRadarAnimation, type RadarFrame } from '../services/storms';

const FRAME_INTERVAL_MS = 650;
const RADAR_REFRESH_MS = 5 * 60 * 1000;

const GEO_BOUNDS = {
  minLat: 27.0,
  maxLat: 44.5,
  minLon: -9.5,
  maxLon: 4.5,
};

const StormOverlay = () => {
  const { status, error } = useStormStatus();
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [radarError, setRadarError] = useState<string | null>(null);
  const backendBase = useMemo(() => BACKEND_BASE_URL.replace(/\/$/, ''), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const strikeCoords = useMemo(() => {
    if (!status || status.provider !== 'blitzortung') {
      return [];
    }
    return status.strikeCoords;
  }, [status]);

  useEffect(() => {
    if (!status?.nearActivity) {
      setFrames([]);
      setRadarError(null);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const loadFrames = async () => {
      try {
        const data = await fetchRadarAnimation(8);
        if (cancelled) return;
        setFrames(data);
        setFrameIndex(0);
        setRadarError(null);
      } catch (err) {
        if (!cancelled) {
          setRadarError(err instanceof Error ? err.message : 'Sin datos de radar');
        }
      }
    };

    void loadFrames();
    timer = window.setInterval(() => {
      void loadFrames();
    }, RADAR_REFRESH_MS);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [status?.nearActivity, status?.updatedAt]);

  useEffect(() => {
    if (!frames.length) return undefined;
    const preloaders = frames.map((frame) => {
      const url = resolveUrl(frame.url, backendBase);
      return preloadImage(url).catch(() => undefined);
    });
    void Promise.all(preloaders);
    return undefined;
  }, [frames, backendBase]);

  useEffect(() => {
    if (!frames.length) return undefined;
    const timer = window.setInterval(() => {
      setFrameIndex((index) => (index + 1) % frames.length);
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [frames]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    if (typeof ResizeObserver === 'undefined') {
      const update = () => {
        setCanvasSize({ width: container.offsetWidth, height: container.offsetHeight });
      };
      update();
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', update);
        return () => {
          window.removeEventListener('resize', update);
        };
      }
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = canvasSize;
    if (width <= 0 || height <= 0) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!strikeCoords.length) {
      return;
    }
    context.scale(dpr, dpr);
    drawLightningOverlay(context, width, height, strikeCoords);
  }, [canvasSize, strikeCoords]);

  if (!status?.nearActivity) {
    return null;
  }

  const activeFrame = frames[frameIndex];
  const fallbackRadar = status.radarUrl ? resolveUrl(status.radarUrl, backendBase) : null;
  const radarUrl = activeFrame ? resolveUrl(activeFrame.url, backendBase) : fallbackRadar;
  const updatedAt = status.updatedAt
    ? new Date(status.updatedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <aside
      className="pointer-events-auto absolute right-8 top-24 z-30 w-[360px] rounded-3xl border border-amber-300/40 bg-amber-500/10 p-5 text-amber-100 shadow-lg backdrop-blur"
      data-depth-blur="true"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6" />
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-amber-200">Actividad eléctrica cercana</p>
          {updatedAt && <p className="text-xs text-amber-100/70">Actualizado {updatedAt}</p>}
        </div>
      </div>
      {radarUrl ? (
        <div ref={containerRef} className="relative mt-4 h-40 w-full overflow-hidden rounded-2xl">
          <img
            key={radarUrl}
            src={radarUrl}
            alt="Radar de precipitaciones"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />
        </div>
      ) : (
        <p className="mt-3 text-xs text-amber-100/70">{radarError ?? error ?? 'Sin radar disponible en este momento.'}</p>
      )}
      <p className="mt-3 text-xs text-amber-100/80">
        Probabilidad estimada: {(status.stormProb * 100).toFixed(0)}%
      </p>
      {frames.length > 1 && (
        <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-amber-100/60">
          Frame {frameIndex + 1} / {frames.length}
        </p>
      )}
    </aside>
  );
};

function resolveUrl(url: string, backendBase: string): string {
  return url.startsWith('http') ? url : `${backendBase}${url}`;
}

async function preloadImage(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`No se pudo precargar ${url}`));
    image.src = url;
  });
}

function drawLightningOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  strikes: Array<[number, number]>,
) {
  context.save();
  const radius = Math.max(4, Math.min(12, Math.min(width, height) * 0.02));
  const cross = radius * 0.6;
  context.lineWidth = Math.max(1, Math.min(2.5, width * 0.003));
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.fillStyle = 'rgba(255, 82, 82, 0.65)';
  context.shadowColor = 'rgba(255, 51, 51, 0.5)';
  context.shadowBlur = radius * 0.8;

  for (const [lat, lon] of strikes) {
    const point = projectToRadar(lat, lon, width, height);
    if (!point) {
      continue;
    }
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(point.x - cross, point.y);
    context.lineTo(point.x + cross, point.y);
    context.moveTo(point.x, point.y - cross);
    context.lineTo(point.x, point.y + cross);
    context.stroke();
  }

  context.restore();
}

function projectToRadar(lat: number, lon: number, width: number, height: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  const { minLat, maxLat, minLon, maxLon } = GEO_BOUNDS;
  const latitude = clamp(lat, minLat, maxLat);
  const longitude = clamp(lon, minLon, maxLon);
  const x = ((longitude - minLon) / (maxLon - minLon)) * width;
  const y = (1 - (latitude - minLat) / (maxLat - minLat)) * height;
  // TODO(proj): ajustar los bounds al radar oficial utilizado por el panel.
  return { x, y };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default StormOverlay;
