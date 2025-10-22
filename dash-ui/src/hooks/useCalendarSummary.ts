import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCalendarStatus,
  fetchTodayEvents,
  fetchCalendarEvents,
  type CalendarStatus,
  type CalendarEvent,
  type CalendarEventsResponse,
  type CalendarProvider,
  type CalendarUpcomingEvent,
} from '../services/calendar';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import type { CalendarConfig } from '../services/config';

interface CalendarSummaryResult {
  text: string | null;
  loading: boolean;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export const useCalendarSummary = (): CalendarSummaryResult => {
  const { config } = useDashboardConfig();
  const calendarPrefs = config?.calendar;
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);
  const textRef = useRef<string | null>(null);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const load = useCallback(async () => {
    if (!isMountedRef.current) return;
    setLoading((previous) => (textRef.current ? previous : true));

    const handleGoogleEvents = (response: CalendarEventsResponse | undefined) => {
      if (!isMountedRef.current) return;
      if (!response) {
        setText('Sin datos');
        setLoading(false);
        return;
      }
      const items = Array.isArray(response.items) ? response.items : [];
      const todayItems = filterEventsForToday(items);
      if (todayItems.length === 0) {
        setText(response.note ?? 'Sin eventos');
      } else {
        setText(formatCalendarLine(todayItems));
      }
      setLoading(false);
    };

    try {
      const status = await fetchCalendarStatus();
      const provider = determineCalendarProvider(calendarPrefs, status);

      if (provider === 'none') {
        if (!isMountedRef.current) return;
        setText('Sin datos');
        setLoading(false);
        return;
      }

      if (provider === 'google') {
        try {
          const response = await fetchCalendarEvents(1);
          handleGoogleEvents(response);
        } catch (googleError) {
          console.warn('No se pudo cargar eventos de Google Calendar', googleError);
          if (!isMountedRef.current) return;
          setText('Sin datos');
          setLoading(false);
        }
        return;
      }

      const readiness = resolveCalendarReadiness(calendarPrefs, status, provider);

      if (readiness !== 'ready') {
        if (!isMountedRef.current) return;
        setText('Sin datos');
        setLoading(false);
        return;
      }

      try {
        const events = await fetchTodayEvents();
        if (!isMountedRef.current) return;
        if (!events || events.length === 0) {
          setText('Sin eventos');
        } else {
          setText(formatCalendarLine(events));
        }
      } catch (eventsError) {
        console.warn('No se pudo cargar eventos del calendario', eventsError);
        if (!isMountedRef.current) return;
        setText('Sin datos');
      }
    } catch (statusError) {
      console.warn('No se pudo cargar estado del calendario', statusError);
      if (!isMountedRef.current) return;
      setText('Sin datos');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [calendarPrefs]);

  useEffect(() => {
    let cancelled = false;

    const trigger = () => {
      if (cancelled) return;
      void load();
    };

    trigger();
    const timer = window.setInterval(trigger, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  const memoizedText = useMemo(() => text, [text]);

  return {
    text: memoizedText,
    loading,
  };
};

type Readiness = 'no-source' | 'ready';

function determineCalendarProvider(
  calendarPrefs: CalendarConfig | undefined,
  status: CalendarStatus,
): CalendarProvider {
  const fromConfig = calendarPrefs?.provider?.toLowerCase() as CalendarProvider | undefined;
  if (fromConfig && fromConfig !== 'none') {
    return fromConfig;
  }
  const statusProvider = status?.provider?.toLowerCase() as CalendarProvider | undefined;
  if (statusProvider) {
    return statusProvider;
  }
  const enabled = Boolean(calendarPrefs?.enabled);
  if (!enabled) return 'none';
  const mode = (calendarPrefs?.mode || status?.mode || 'url').toLowerCase();
  if (mode === 'ics') return 'ics';
  if (mode === 'url') return 'url';
  return enabled ? 'url' : 'none';
}

function resolveCalendarReadiness(
  calendarPrefs: CalendarConfig | undefined,
  status: CalendarStatus,
  provider: CalendarProvider,
): Readiness {
  if (provider === 'google') {
    return 'ready';
  }

  const enabled = Boolean(calendarPrefs?.enabled);
  if (!enabled) {
    return 'no-source';
  }

  if (provider === 'url') {
    const hasUrl = Boolean(calendarPrefs?.url || status?.url);
    return hasUrl ? 'ready' : 'no-source';
  }
  if (provider === 'ics') {
    const hasFile = Boolean(status?.exists || calendarPrefs?.icsConfigured || calendarPrefs?.icsPath);
    return hasFile ? 'ready' : 'no-source';
  }

  return 'no-source';
}

type CalendarSummaryEvent = Pick<CalendarUpcomingEvent, 'title' | 'start' | 'end' | 'allDay'>;

function filterEventsForToday(events: CalendarUpcomingEvent[]): CalendarSummaryEvent[] {
  const today = new Date();
  return events.filter((event) => {
    const start = safeDate(event.start);
    if (!start) return false;
    return isSameDay(start, today);
  });
}

function formatCalendarLine(events: CalendarSummaryEvent[]): string {
  const safeEvents = events.filter((event) => event && typeof event.title === 'string');
  if (safeEvents.length === 0) {
    return 'Sin eventos';
  }

  const segments = safeEvents.slice(0, 3).map(formatCalendarEvent);
  if (safeEvents.length > 3) {
    segments.push(`+${safeEvents.length - 3}`);
  }
  return `Hoy · ${segments.join(' · ')}`;
}

function formatCalendarEvent(event: CalendarSummaryEvent): string {
  const title = event.title?.trim() || 'Evento';
  if (event.allDay) {
    return `${title} (todo el día)`;
  }

  const start = safeDate(event.start);
  const end = safeDate(event.end);
  const startLabel = start ? formatTime(start) : null;
  const endLabel = end ? formatTime(end) : null;

  if (startLabel && endLabel) {
    return `${startLabel}-${endLabel} ${title}`;
  }
  if (startLabel) {
    return `${startLabel} ${title}`;
  }
  return title;
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

