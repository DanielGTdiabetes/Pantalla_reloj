import { useEffect, useState } from 'react';
import { CalendarDays, Landmark } from 'lucide-react';
import { fetchDayBrief, type DayInfoPayload } from '../services/dayinfo';

const REFRESH_INTERVAL = 12 * 60 * 60 * 1000; // 12 horas

const DayStrip = () => {
  const [info, setInfo] = useState<DayInfoPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchDayBrief();
        if (!cancelled) {
          setInfo(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Sin información del día');
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

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const headline = getHeadline(info, loading, error);
  const holidayBadge = getHolidayBadge(info);
  const patronBadge = getPatronBadge(info);

  const handleToggle = () => {
    if (!info) return;
    setOpen((prev) => !prev);
  };

  return (
    <aside
      className="relative rounded-3xl border border-sky-400/20 bg-slate-900/60 px-5 py-4 text-sky-100/80 shadow-lg backdrop-blur"
      data-depth-blur="true"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 text-left focus:outline-none"
        onClick={handleToggle}
        disabled={!info}
      >
        <div className="flex flex-1 items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-500/20 text-sky-100">
            <CalendarDays className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-semibold text-sky-50/90">{headline}</span>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] text-sky-200/70">
              {holidayBadge}
              {patronBadge}
              {error && !info && <span className="text-rose-300">{error}</span>}
              {loading && <span className="text-sky-200/60">Actualizando…</span>}
            </div>
          </div>
        </div>
        <span className="text-[11px] uppercase tracking-[0.35em] text-sky-200/70">{open ? 'Ocultar' : 'Ver'}</span>
      </button>

      {open && info && (
        <div className="absolute left-0 right-0 top-full z-20 mt-3 rounded-2xl border border-sky-400/30 bg-slate-950/90 p-5 text-sky-50 shadow-xl backdrop-blur">
          <h3 className="text-xs uppercase tracking-[0.4em] text-sky-300/70">{formatDate(info.date)}</h3>
          <div className="mt-3 space-y-4 text-sm text-sky-100/90">
            {info.efemerides.length > 0 && (
              <section>
                <h4 className="text-[13px] font-semibold uppercase tracking-[0.3em] text-sky-200/80">Efemérides</h4>
                <ul className="mt-2 space-y-2">
                  {info.efemerides.slice(0, 5).map((item, index) => (
                    <li key={`${item.text}-${index}`} className="rounded-2xl bg-sky-500/10 px-3 py-2">
                      <span className="font-semibold text-sky-100/90">{item.year ? `${item.year}: ` : ''}</span>
                      <span>{item.text}</span>
                      {item.source && <span className="ml-2 text-[10px] uppercase tracking-[0.3em] text-sky-300/70">{item.source}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {info.santoral.length > 0 && (
              <section>
                <h4 className="text-[13px] font-semibold uppercase tracking-[0.3em] text-sky-200/80">Santoral</h4>
                <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                  {info.santoral.slice(0, 5).map((entry) => (
                    <li key={entry.name} className="rounded-2xl bg-sky-500/15 px-3 py-2">
                      {entry.name}
                      {entry.source && <span className="ml-2 text-[10px] uppercase tracking-[0.3em] text-sky-300/70">{entry.source}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4 className="text-[13px] font-semibold uppercase tracking-[0.3em] text-sky-200/80">Festivos</h4>
              {info.holiday?.is_holiday ? (
                <p>
                  {info.holiday.name ?? 'Festivo'}
                  {info.holiday.scope && <span className="ml-2 text-[11px] uppercase tracking-[0.3em] text-sky-300/70">{scopeLabel(info.holiday.scope, info.holiday.region)}</span>}
                </p>
              ) : (
                <p className="text-sky-200/70">Hoy no es festivo en tu región.</p>
              )}
            </section>
            {info.patron && (
              <section>
                <h4 className="text-[13px] font-semibold uppercase tracking-[0.3em] text-sky-200/80">Patrón local</h4>
                <p className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-sky-200" aria-hidden />
                  <span>
                    {info.patron.name}
                    {info.patron.place && <span className="ml-2 text-sky-200/70">({info.patron.place})</span>}
                  </span>
                </p>
              </section>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

function getHeadline(info: DayInfoPayload | null, loading: boolean, error: string | null): string {
  if (loading && !info) {
    return 'Actualizando efemérides…';
  }
  if (!info) {
    return error ?? 'Sin datos del día';
  }
  if (info.efemerides.length > 0) {
    const first = info.efemerides[0];
    const yearLabel = typeof first.year === 'number' ? `${first.year}: ` : '';
    return `${yearLabel}${first.text}`;
  }
  if (info.santoral.length > 0) {
    const names = info.santoral
      .slice(0, 3)
      .map((entry) => entry.name)
      .filter(Boolean)
      .join(', ');
    if (names) {
      return `Santoral: ${names}`;
    }
  }
  return error ?? 'Sin datos relevantes para hoy';
}

function getHolidayBadge(info: DayInfoPayload | null) {
  if (!info?.holiday?.is_holiday) return null;
  const label = scopeLabel(info.holiday.scope ?? null, info.holiday.region ?? null);
  return <span className="rounded-full bg-sky-500/20 px-3 py-1 text-[10px] uppercase tracking-[0.4em] text-sky-200/90">{label}</span>;
}

function getPatronBadge(info: DayInfoPayload | null) {
  if (!info?.patron) return null;
  const place = info.patron.place ? ` (${info.patron.place})` : '';
  return (
    <span className="rounded-full bg-amber-500/20 px-3 py-1 text-[10px] uppercase tracking-[0.4em] text-amber-200/90">
      Patrón: {info.patron.name}
      {place}
    </span>
  );
}

function scopeLabel(scope: DayInfoPayload['holiday']['scope'], region: string | null | undefined): string {
  switch (scope) {
    case 'national':
      return 'Festivo nacional';
    case 'regional':
      return region ? `Festivo (${region})` : 'Festivo regional';
    case 'local':
      return region ? `Festivo local (${region})` : 'Festivo local';
    default:
      return 'Festivo';
  }
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default DayStrip;
