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
