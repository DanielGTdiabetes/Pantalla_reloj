import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSeasonMonth, type MonthSeason } from '../services/season';
import { subscribeTime } from '../services/time';

const STORAGE_KEY = 'monthTips.lastShown';
const HIGHLIGHT_TIMEOUT = 12_000;

function toMonthLabel(month: number): string {
  const date = new Date(Date.UTC(2020, month - 1, 1));
  const label = date.toLocaleDateString('es-ES', { month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const MonthTips = () => {
  const [season, setSeason] = useState<MonthSeason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [highlight, setHighlight] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const monthRef = useRef<number>(new Date().getMonth() + 1);
  const highlightTimerRef = useRef<number | null>(null);

  const triggerHighlight = useCallback((month: number) => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(month).padStart(2, '0')}`;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      console.warn('No se pudo leer monthTips.lastShown', err);
    }
    if (stored === key) {
      setHighlight(false);
      return;
    }
    setHighlight(true);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlight(false);
    }, HIGHLIGHT_TIMEOUT);
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch (err) {
      console.warn('No se pudo persistir monthTips.lastShown', err);
    }
  }, []);

  const loadSeason = useCallback(
    async (targetMonth?: number) => {
      setLoading(true);
      try {
        const data = await fetchSeasonMonth(targetMonth);
        setSeason(data);
        setError(null);
        monthRef.current = data.month;
        triggerHighlight(data.month);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sin datos';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [triggerHighlight],
  );

  useEffect(() => {
    void loadSeason();
  }, [loadSeason]);

  useEffect(() => {
    const unsubscribe = subscribeTime((now) => {
      const month = now.getMonth() + 1;
      if (month !== monthRef.current) {
        monthRef.current = month;
        void loadSeason(month);
      }
    });
    return unsubscribe;
  }, [loadSeason]);

  useEffect(() => {
    if (!popoverOpen) return;

    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [popoverOpen]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const monthLabel = season ? toMonthLabel(season.month) : null;
  const summary = season?.tip ?? (loading ? 'Actualizando recomendaciones…' : 'Sin datos de temporada.');

  return (
    <section
      ref={containerRef}
      className="relative rounded-3xl bg-slate-900/40 p-4 text-sm text-slate-100/80 shadow-lg backdrop-blur"
      data-depth-blur="true"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-1 flex-col gap-1 text-left">
          <span className="text-[0.65rem] uppercase tracking-[0.4em] text-emerald-200/80">
            Temporadas {monthLabel ? `· ${monthLabel}` : ''}
          </span>
          <p className="text-sm font-medium leading-snug text-slate-100/90">{summary}</p>
        </div>
        <div className="flex items-start gap-2">
          {highlight && (
            <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-[0.65rem] uppercase tracking-[0.35em] text-emerald-200 animate-pulse">
              Nuevo mes
            </span>
          )}
          <button
            type="button"
            aria-label="Detalles de temporada"
            aria-expanded={popoverOpen}
            aria-controls="month-tips-popover"
            onClick={() => setPopoverOpen((value) => !value)}
            className="rounded-full border border-slate-500/40 bg-slate-900/60 px-2 py-1 text-xs text-slate-200/90 transition hover:bg-slate-800/80"
          >
            ℹ︎
          </button>
        </div>
      </header>
      {error && <p className="mt-3 text-xs text-amber-300">{error}</p>}
      {popoverOpen && season && (
        <div
          id="month-tips-popover"
          role="dialog"
          aria-modal="false"
          className="absolute right-4 top-full z-20 mt-3 w-72 rounded-2xl border border-slate-500/30 bg-slate-900/95 p-4 text-xs text-slate-100 shadow-2xl backdrop-blur"
        >
          <div className="space-y-4">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.35em] text-emerald-200/80">Siembra</p>
              {season.hortalizas.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm leading-tight text-slate-100/90">
                  {season.hortalizas.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span aria-hidden className="pt-[2px] text-emerald-300">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-300/70">Sin recomendaciones de siembra.</p>
              )}
            </div>
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.35em] text-amber-200/80">Temporada</p>
              {season.frutas.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm leading-tight text-slate-100/90">
                  {season.frutas.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span aria-hidden className="pt-[2px] text-amber-300">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-300/70">Sin frutas destacadas.</p>
              )}
            </div>
            {season.nota && (
              <p className="rounded-2xl border border-slate-500/20 bg-slate-800/60 p-3 text-[0.75rem] leading-relaxed text-slate-100/80">
                {season.nota}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default MonthTips;
