import { useEffect, useMemo, useRef, useState } from 'react';
import type { OverlaySectionKey } from '../services/config';

interface RotatorProps {
  order?: OverlaySectionKey[];
  dwellSeconds?: number;
  transitionMs?: number;
  className?: string;
}

interface PlaceholderItem {
  key: OverlaySectionKey;
  title: string;
  subtitle: string;
}

const PLACEHOLDERS: PlaceholderItem[] = [
  { key: 'weather_now', title: 'Clima ahora', subtitle: 'Datos locales pendientes de integrar.' },
  { key: 'weather_week', title: 'Predicción semanal', subtitle: 'Pronósticos se mostrarán aquí.' },
  { key: 'moon', title: 'Fase lunar', subtitle: 'Información de la luna próximamente.' },
  { key: 'season', title: 'Temporada', subtitle: 'Consejos estacionales aparecerán aquí.' },
  { key: 'ephemeris', title: 'Efemérides', subtitle: 'Eventos históricos destacados.' },
  { key: 'news', title: 'Noticias', subtitle: 'Titulares se rotarán en este espacio.' },
  { key: 'saints', title: 'Santoral', subtitle: 'Onomásticas diarias en preparación.' },
  { key: 'calendar', title: 'Agenda', subtitle: 'Próximos eventos del calendario.' },
];

const ALLOWED_KEYS = new Set<OverlaySectionKey>(PLACEHOLDERS.map((item) => item.key));

function sanitizeOrder(order?: OverlaySectionKey[]): OverlaySectionKey[] {
  if (!Array.isArray(order) || order.length === 0) {
    return PLACEHOLDERS.map((item) => item.key);
  }
  const sanitized: OverlaySectionKey[] = [];
  const seen = new Set<string>();
  order.forEach((key) => {
    if (!ALLOWED_KEYS.has(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    sanitized.push(key);
  });
  if (sanitized.length === 0) {
    return PLACEHOLDERS.map((item) => item.key);
  }
  return sanitized;
}

const MIN_DWELL_MS = 1_000;
const MAX_DWELL_MS = 120_000;
const MIN_TRANSITION_MS = 150;
const MAX_TRANSITION_MS = 10_000;

export const Rotator = ({ order, dwellSeconds, transitionMs, className }: RotatorProps) => {
  const sanitizedOrder = useMemo(() => sanitizeOrder(order), [order]);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const dwellMs = useMemo(() => {
    const fallback = 15_000;
    const requested = typeof dwellSeconds === 'number' ? Math.round(dwellSeconds * 1000) : fallback;
    return Math.min(Math.max(requested, MIN_DWELL_MS), MAX_DWELL_MS);
  }, [dwellSeconds]);
  const fadeMs = useMemo(() => {
    const fallback = 450;
    const requested = typeof transitionMs === 'number' ? Math.round(transitionMs) : fallback;
    return Math.min(Math.max(requested, MIN_TRANSITION_MS), MAX_TRANSITION_MS);
  }, [transitionMs]);

  const fadeTimeoutRef = useRef<number | null>(null);
  const dwellTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setIndex(0);
    setVisible(true);
  }, [sanitizedOrder.join('|')]);

  useEffect(() => {
    if (sanitizedOrder.length === 0) return () => undefined;
    const scheduleNext = () => {
      dwellTimeoutRef.current = window.setTimeout(() => {
        setVisible(false);
        fadeTimeoutRef.current = window.setTimeout(() => {
          setIndex((prev) => (prev + 1) % sanitizedOrder.length);
          setVisible(true);
        }, fadeMs);
      }, dwellMs);
    };

    scheduleNext();

    return () => {
      if (dwellTimeoutRef.current !== null) {
        window.clearTimeout(dwellTimeoutRef.current);
        dwellTimeoutRef.current = null;
      }
      if (fadeTimeoutRef.current !== null) {
        window.clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    };
  }, [dwellMs, fadeMs, sanitizedOrder]);

  const currentKey = sanitizedOrder[index % sanitizedOrder.length];
  const currentItem = PLACEHOLDERS.find((item) => item.key === currentKey) ?? PLACEHOLDERS[0];

  const rootClassName = ['relative min-h-[180px] w-full overflow-hidden', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName}>
      <div
        className="absolute inset-0 flex flex-col justify-center gap-3 transition-opacity duration-500 ease-in-out"
        style={{ opacity: visible ? 1 : 0, transitionDuration: `${fadeMs}ms` }}
      >
        <div className="text-xs uppercase tracking-[0.35em] text-white/60">{currentItem.title}</div>
        <div className="text-xl font-semibold leading-snug text-white drop-shadow-lg">
          {currentItem.subtitle}
        </div>
      </div>
    </div>
  );
};

export default Rotator;
