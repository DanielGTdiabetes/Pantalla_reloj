import { useEffect, useMemo, useState } from 'react';
import { Calendar, Bell } from 'lucide-react';
import { fetchTodayEvents, type CalendarEvent } from '../services/calendar';
import { useDashboardConfig } from '../context/DashboardConfigContext';

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

const CalendarPeek = () => {
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
          setError('Sin respuesta del calendario');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    const interval = window.setInterval(() => {
      void load();
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
    [],
  );

  if (!enabled) {
    return (
      <aside
        className="flex h-full w-full flex-col justify-center rounded-3xl bg-emerald-500/5 p-6 text-sm text-emerald-100/70 backdrop-blur"
        data-depth-blur="true"
      >
        <p className="text-xs uppercase tracking-[0.35em] text-emerald-200/80">Agenda</p>
        <p className="mt-3 text-emerald-100/80">Configura tu calendario desde la mini-web de ajustes.</p>
      </aside>
    );
  }

  const displayEvents = events.slice(0, 4);

  return (
    <aside
      className="flex h-full w-full flex-col rounded-3xl bg-emerald-500/10 p-6 text-emerald-50 backdrop-blur"
      data-depth-blur="true"
    >
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.35em] text-emerald-200/80">
        <span className="flex items-center gap-2">
          <Calendar className="h-4 w-4" aria-hidden />
          Agenda
        </span>
        <span>{todayLabel}</span>
      </div>
      <div className="mt-4 flex-1 space-y-3 text-sm text-emerald-50/90">
        {loading && <p className="text-emerald-100/60">Sincronizando…</p>}
        {!loading && error && <p className="text-rose-200">{error}</p>}
        {!loading && !error && displayEvents.length === 0 && <p className="text-emerald-100/60">Nada programado para hoy.</p>}
        {!loading && !error &&
          displayEvents.map((event) => (
            <article
              key={`${event.title}-${event.start}`}
              className={`flex items-start justify-between rounded-2xl border px-3 py-2 ${
                event.notify
                  ? 'border-emerald-300/70 bg-emerald-300/15'
                  : 'border-emerald-300/30 bg-emerald-300/10'
              }`}
            >
              <div>
                <h3 className="text-sm font-semibold leading-tight text-emerald-50">{event.title}</h3>
                <p className="text-xs text-emerald-100/70">{formatEventTime(event)}</p>
              </div>
              {event.notify && <Bell className="mt-1 h-4 w-4 flex-shrink-0 text-emerald-100" aria-hidden />}
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
