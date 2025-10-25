import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { OverlayConfig, OverlaySectionKey } from '../services/config';

export interface ResolvedOverlayConfig {
  position: 'left' | 'right';
  width_px: number;
  opacity: number;
  blur_px: number;
  dwell_seconds: number;
  transition_ms: number;
  order: OverlaySectionKey[];
}

interface OverlayPanelProps {
  settings: ResolvedOverlayConfig;
  children: ReactNode;
}

const DEFAULT_ORDER: OverlaySectionKey[] = [
  'weather_now',
  'weather_week',
  'moon',
  'season',
  'ephemeris',
  'news',
  'saints',
  'calendar',
];

export const DEFAULT_OVERLAY: ResolvedOverlayConfig = {
  position: 'right',
  width_px: 420,
  opacity: 0.85,
  blur_px: 6,
  dwell_seconds: 15,
  transition_ms: 450,
  order: DEFAULT_ORDER,
};

function clampWithFallback(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function sanitizeOrder(order: OverlaySectionKey[] | undefined): OverlaySectionKey[] {
  if (!Array.isArray(order) || order.length === 0) {
    return DEFAULT_ORDER;
  }
  const seen = new Set<OverlaySectionKey>();
  const normalized: OverlaySectionKey[] = [];
  order.forEach((key) => {
    if (!DEFAULT_ORDER.includes(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(key);
  });
  return normalized.length > 0 ? normalized : DEFAULT_ORDER;
}

export function resolveOverlay(config: OverlayConfig | undefined): ResolvedOverlayConfig {
  if (!config) {
    return { ...DEFAULT_OVERLAY, order: [...DEFAULT_OVERLAY.order] };
  }

  const position = config.position === 'left' ? 'left' : 'right';
  const width_px = clampWithFallback(config.width_px, 280, 640, DEFAULT_OVERLAY.width_px);
  const opacity = clampWithFallback(config.opacity, 0.3, 1, DEFAULT_OVERLAY.opacity);
  const blur_px = clampWithFallback(config.blur_px, 0, 10, DEFAULT_OVERLAY.blur_px);
  const dwell_seconds = clampWithFallback(config.dwell_seconds, 3, 180, DEFAULT_OVERLAY.dwell_seconds);
  const transition_ms = clampWithFallback(
    config.transition_ms,
    100,
    10_000,
    DEFAULT_OVERLAY.transition_ms,
  );

  return {
    position,
    width_px,
    opacity,
    blur_px,
    dwell_seconds,
    transition_ms,
    order: sanitizeOrder(config.order),
  };
}

const ClockHeader = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [],
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
      }),
    [],
  );

  return (
    <div className="flex flex-col gap-1 text-left">
      <span className="text-3xl font-semibold leading-none tracking-tight text-white drop-shadow">
        {timeFormatter.format(now)}
      </span>
      <span className="text-sm font-medium capitalize text-white/70 drop-shadow">
        {dateFormatter.format(now)}
      </span>
    </div>
  );
};

const OverlayPanel = ({ settings, children }: OverlayPanelProps) => {
  const anchorStyle: CSSProperties = settings.position === 'left' ? { left: 0 } : { right: 0 };
  const panelStyle: CSSProperties = {
    ...anchorStyle,
    position: 'absolute',
    top: 0,
    width: settings.width_px,
    height: '100%',
    pointerEvents: 'none',
    backgroundColor: `rgba(8, 11, 25, ${settings.opacity})`,
    backdropFilter: `blur(${settings.blur_px}px)`,
    WebkitBackdropFilter: `blur(${settings.blur_px}px)`,
    boxShadow: '0 20px 45px rgba(0, 0, 0, 0.35)',
    zIndex: 20,
  };

  return (
    <aside
      id="overlay-panel"
      className="pointer-events-none flex h-full flex-col items-stretch px-7 py-8 text-white"
      style={panelStyle}
    >
      <ClockHeader />
      <div className="relative mt-6 flex-1 overflow-hidden">
        <div className="pointer-events-none flex h-full flex-col">
          {children}
        </div>
      </div>
    </aside>
  );
};

export default OverlayPanel;
