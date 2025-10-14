import { apiRequest } from './config';

export type TimeListener = (now: Date) => void;

const listeners = new Set<TimeListener>();
let timerId: number | undefined;

function tick() {
  const now = new Date();
  listeners.forEach((listener) => listener(now));
}

function ensureTimer() {
  if (timerId !== undefined) return;
  tick();
  timerId = window.setInterval(() => {
    tick();
  }, 1000);
}

export function subscribeTime(listener: TimeListener) {
  listeners.add(listener);
  ensureTimer();
  listener(new Date());
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timerId !== undefined) {
      window.clearInterval(timerId);
      timerId = undefined;
    }
  };
}

export function formatTime(date: Date) {
  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: undefined,
    hour12: false
  });
}

export function formatDate(date: Date) {
  return date.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  });
}

interface RawDstTransition {
  has_upcoming: boolean;
  date: string | null;
  kind: 'back' | 'forward' | null;
  delta_hours: number;
  days_left: number | null;
}

export interface DstTransitionInfo {
  hasUpcoming: boolean;
  date: string | null;
  kind: 'back' | 'forward' | null;
  deltaHours: number;
  daysLeft: number | null;
}

interface RawTimeNow {
  datetime: string;
  timestamp: number;
  timezone: string;
  utc_offset_seconds: number;
  is_dst: boolean;
}

export interface BackendTimeNow {
  datetime: string;
  timestamp: number;
  timezone: string;
  utcOffsetSeconds: number;
  isDst: boolean;
}

function normaliseDst(payload: RawDstTransition): DstTransitionInfo {
  return {
    hasUpcoming: payload.has_upcoming,
    date: payload.date ?? null,
    kind: payload.kind ?? null,
    deltaHours: payload.delta_hours,
    daysLeft: payload.days_left ?? null,
  };
}

function normaliseTimeNow(payload: RawTimeNow): BackendTimeNow {
  return {
    datetime: payload.datetime,
    timestamp: payload.timestamp,
    timezone: payload.timezone,
    utcOffsetSeconds: payload.utc_offset_seconds,
    isDst: payload.is_dst,
  };
}

export async function fetchNextDstTransition(): Promise<DstTransitionInfo> {
  const data = await apiRequest<RawDstTransition>('/time/dst/next');
  return normaliseDst(data);
}

export async function fetchBackendNow(): Promise<BackendTimeNow> {
  const data = await apiRequest<RawTimeNow>('/time/now');
  return normaliseTimeNow(data);
}
