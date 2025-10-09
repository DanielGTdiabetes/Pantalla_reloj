import { useEffect, useMemo, useState } from 'react';
import { Calendar, Bell } from 'lucide-react';
import { fetchTodayEvents, type CalendarEvent } from '../services/calendar';
import { useDashboardConfig } from '../context/DashboardConfigContext';

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface CalendarPeekProps {
  tone?: 'light' | 'dark';
  className?: string;
}

const CalendarPeek = ({ tone = 'dark', className = '' }: CalendarPeekProps) => {
  const { config } = useDashboardConfig();
  const calendarPrefs = config?.calendar;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(calendarPrefs?.enabled && calendarPrefs?.icsConfigured);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTodayEvents();
        if (!cancelled) {
          setEvents(data);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('No se pudo sincronizar calendario', err);
          setError('Sin respuesta del calendario');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load().catch(() => {
      // handled via error state
    });

    const interval = window.setInterval(() => {
      load().catch(() => {
        // handled via error state
      });
    }, REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, calendarPrefs?.maxEvents, calendarPrefs?.notifyMinutesBefore]);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString('es-ES', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    []
  );

  if (!enabled) {
    return null;
  }

  const accentText = tone === 'light' ? 'text-slate-600/80' : 'text-slate-300/70';
  const bodyText = tone === 'light' ? 'text-slate-700/85' : 'text-slate-200/80';
  const mutedText = tone === 'light' ? 'text-slate-500/80' : 'text-slate-300/60';

  return (
    <aside
      className={`glass-surface ${tone === 'light' ? 'glass-light' : 'glass'} w-full max-w-md p-5 text-slate-100 shadow-lg shadow-emerald-500/10 transition ${className}`}
    >
      <div className={`flex items-center justify-between text-[11px] uppercase tracking-[0.3em] ${accentText}`}>
        <span className="flex items-center gap-2">
          <Calendar className="h-4 w-4" aria-hidden />
          Agenda
        </span>
        <span>{todayLabel}</span>
      </div>
      <div className={`mt-3 space-y-3 text-sm ${bodyText}`}>
        {loading && <p className={mutedText}>Sincronizando…</p>}
        {!loading && error && <p className="text-rose-300">{error}</p>}
        {!loading && !error && events.length === 0 && (
          <p className={mutedText}>Nada programado para hoy.</p>
        )}
        {!loading && !error &&
          events.map((event) => (
            <article
              key={`${event.title}-${event.start}`}
              className={`flex items-start justify-between rounded-2xl border px-3 py-2 transition ${
                event.notify
                  ? 'border-emerald-400/70 bg-emerald-400/10'
                  : tone === 'light'
                  ? 'border-slate-200/40 bg-white/40'
                  : 'border-white/5 bg-white/5'
              }`}
            >
              <div>
                <h3 className={`text-sm font-semibold leading-tight ${tone === 'light' ? 'text-slate-800' : 'text-slate-100'}`}>
                  {event.title}
                </h3>
                <p className={`text-xs ${tone === 'light' ? 'text-slate-600/80' : 'text-slate-300/70'}`}>
                  {formatEventTime(event)}
                </p>
              </div>
              {event.notify && <Bell className="mt-1 h-4 w-4 flex-shrink-0 text-emerald-300" aria-hidden />}
            </article>
          ))}
      </div>
    </aside>
  );
};

function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) {
    return 'Todo el día';
  }
  const start = new Date(event.start);
  const startLabel = start.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (!event.end) {
    return startLabel;
  }
  const end = new Date(event.end);
  const endLabel = end.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${startLabel} – ${endLabel}`;
}

export default CalendarPeek;
