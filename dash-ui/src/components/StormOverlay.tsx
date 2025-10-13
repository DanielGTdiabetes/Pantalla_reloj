import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BACKEND_BASE_URL } from '../services/config';
import { fetchStormStatus, type StormStatus } from '../services/storms';

const POLL_INTERVAL = 5 * 60 * 1000;

const StormOverlay = () => {
  const [status, setStatus] = useState<StormStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendBase = useMemo(() => BACKEND_BASE_URL.replace(/\/$/, ''), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const data = await fetchStormStatus();
        if (!cancelled) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sin datos');
        }
      }
    };

    void load();
    timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, []);

  if (!status?.nearActivity) {
    return null;
  }

  const radarUrl = status.radarUrl
    ? status.radarUrl.startsWith('http')
      ? status.radarUrl
      : `${backendBase}${status.radarUrl}`
    : null;
  const updatedAt = status.updatedAt
    ? new Date(status.updatedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <aside className="pointer-events-auto absolute right-8 top-24 z-30 w-[360px] rounded-3xl border border-amber-300/40 bg-amber-500/10 p-5 text-amber-100 shadow-lg backdrop-blur">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6" />
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-amber-200">Actividad eléctrica cercana</p>
          {updatedAt && <p className="text-xs text-amber-100/70">Actualizado {updatedAt}</p>}
        </div>
      </div>
      {radarUrl ? (
        <img
          src={radarUrl}
          alt="Radar de precipitaciones"
          className="mt-4 h-40 w-full rounded-2xl object-cover"
        />
      ) : (
        <p className="mt-3 text-xs text-amber-100/70">{error ?? 'Sin radar disponible en este momento.'}</p>
      )}
      <p className="mt-3 text-xs text-amber-100/80">
        Probabilidad estimada: {(status.stormProb * 100).toFixed(0)}%
      </p>
    </aside>
  );
};

export default StormOverlay;
