import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchWeatherBrief, type WeatherBriefData } from '../services/ai';

const REFRESH_INTERVAL = 30 * 60 * 1000;

const WeatherBrief = () => {
  const [brief, setBrief] = useState<WeatherBriefData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchWeatherBrief();
        if (!cancelled) {
          setBrief(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Sin resumen meteorológico disponible');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    timer = window.setInterval(() => {
      void load();
    }, REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, []);

  const handleToggle = () => {
    if (!brief) return;
    setOpen((prev) => !prev);
  };

  const updatedLabel = brief
    ? new Date(brief.updatedAt).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  if (!brief && !error && !loading) {
    return null;
  }

  return (
    <aside
      className="rounded-3xl border border-cyan-400/20 bg-slate-900/30 px-5 py-4 text-cyan-100/80 shadow-lg backdrop-blur"
      data-depth-blur="true"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left focus:outline-none"
        onClick={handleToggle}
        disabled={!brief}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-cyan-50">
          <Sparkles className="h-5 w-5 text-cyan-200" aria-hidden />
          {brief ? brief.title : 'Resumen meteorológico'}
          {brief?.cached && <span className="text-[11px] font-normal uppercase tracking-[0.3em] text-cyan-200/60">cache</span>}
        </span>
        <span className="text-[11px] uppercase tracking-[0.35em] text-cyan-200/70">{open ? 'Ocultar' : 'Ver'}</span>
      </button>
      {updatedLabel && (
        <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-cyan-200/60">Actualizado {updatedLabel}</p>
      )}
      {loading && <p className="mt-2 text-xs text-cyan-100/60">Calculando resumen…</p>}
      {error && !loading && <p className="mt-2 text-xs text-amber-300">{error}</p>}
      {open && brief && (
        <ul className="mt-3 space-y-2 text-sm text-cyan-50/90">
          {brief.tips.map((tip, index) => (
            <li key={index} className="rounded-2xl bg-cyan-500/10 px-3 py-2 text-left">
              {tip}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};

export default WeatherBrief;
