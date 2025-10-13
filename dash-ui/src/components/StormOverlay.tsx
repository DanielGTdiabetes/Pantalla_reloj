import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BACKEND_BASE_URL } from '../services/config';
import { useStormStatus } from '../context/StormStatusContext';
import { fetchRadarAnimation, type RadarFrame } from '../services/storms';

const FRAME_INTERVAL_MS = 650;
const RADAR_REFRESH_MS = 5 * 60 * 1000;

const StormOverlay = () => {
  const { status, error } = useStormStatus();
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [radarError, setRadarError] = useState<string | null>(null);
  const backendBase = useMemo(() => BACKEND_BASE_URL.replace(/\/$/, ''), []);

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
        <img
          key={radarUrl}
          src={radarUrl}
          alt="Radar de precipitaciones"
          className="mt-4 h-40 w-full rounded-2xl object-cover"
        />
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

export default StormOverlay;
