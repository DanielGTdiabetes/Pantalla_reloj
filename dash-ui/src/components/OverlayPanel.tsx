import type { CSSProperties, ReactNode } from 'react';
import { useMemo, useState, useEffect } from 'react';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import type { OverlayConfig } from '../services/config';

interface OverlayPanelProps {
  children: ReactNode;
}

export const DEFAULT_OVERLAY: Required<OverlayConfig> = {
  enabled: true,
  opacity: 0.28,
  blur_px: 6,
  corner_radius: 20,
  position: 'bottom',
  margin_px: 24,
  dwell_seconds: 15,
  transition_ms: 450,
  order: [
    'weather_now',
    'weather_week',
    'moon',
    'season',
    'ephemeris',
    'news',
    'saints',
    'calendar',
  ],
};

function clampWithFallback(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export function resolveOverlay(config: OverlayConfig | undefined): Required<OverlayConfig> {
  if (!config) return DEFAULT_OVERLAY;
  const order = Array.isArray(config.order) && config.order.length > 0 ? config.order : DEFAULT_OVERLAY.order;
  return {
    enabled: config.enabled ?? DEFAULT_OVERLAY.enabled,
    opacity: clampWithFallback(config.opacity, 0, 1, DEFAULT_OVERLAY.opacity),
    blur_px: clampWithFallback(config.blur_px, 0, 128, DEFAULT_OVERLAY.blur_px),
    corner_radius: clampWithFallback(config.corner_radius, 0, 200, DEFAULT_OVERLAY.corner_radius),
    position:
      config.position && ['top', 'bottom', 'left', 'right', 'center'].includes(config.position)
        ? config.position
        : DEFAULT_OVERLAY.position,
    margin_px: clampWithFallback(config.margin_px, 0, 200, DEFAULT_OVERLAY.margin_px),
    dwell_seconds: clampWithFallback(config.dwell_seconds, 3, 180, DEFAULT_OVERLAY.dwell_seconds),
    transition_ms: clampWithFallback(config.transition_ms, 100, 10_000, DEFAULT_OVERLAY.transition_ms),
    order,
  };
}

const positionStyles: Record<Required<OverlayConfig>['position'], CSSProperties> = {
  top: { top: 0, left: '50%', transform: 'translate(-50%, 0)' },
  bottom: { bottom: 0, left: '50%', transform: 'translate(-50%, 0)' },
  left: { left: 0, top: '50%', transform: 'translate(0, -50%)' },
  right: { right: 0, top: '50%', transform: 'translate(0, -50%)' },
  center: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
};

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
      <span className="text-6xl font-semibold leading-none tracking-tight text-white drop-shadow">{timeFormatter.format(now)}</span>
      <span className="text-lg font-medium capitalize text-white/75 drop-shadow">
        {dateFormatter.format(now)}
      </span>
    </div>
  );
};

const OverlayPanel = ({ children }: OverlayPanelProps) => {
  const { config } = useDashboardConfig();

  const overlay = useMemo(() => resolveOverlay(config?.ui?.overlay), [config?.ui?.overlay]);

  if (!overlay.enabled) {
    return null;
  }

  const baseStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  };

  const panelStyle: CSSProperties = {
    pointerEvents: 'auto',
    backgroundColor: `rgba(0, 0, 0, ${overlay.opacity})`,
    borderRadius: `${overlay.corner_radius}px`,
    backdropFilter: `blur(${overlay.blur_px}px)`,
    WebkitBackdropFilter: `blur(${overlay.blur_px}px)`,
    boxShadow: '0 25px 60px rgba(0, 0, 0, 0.35)',
    padding: '32px',
    minWidth: 'min(90vw, 780px)',
    maxWidth: 'min(90vw, 820px)',
    display: 'flex',
    flexDirection: 'column',
    gap: '28px',
  };

  const offsetStyle = positionStyles[overlay.position];
  const positionStyle: CSSProperties = {
    ...offsetStyle,
  };

  positionStyle.transform = offsetStyle.transform;
  if (overlay.position === 'top' || overlay.position === 'bottom') {
    positionStyle.left = '50%';
  }
  if (overlay.position === 'left' || overlay.position === 'right') {
    positionStyle.top = '50%';
  }
  if (overlay.position === 'top') {
    positionStyle.top = overlay.margin_px;
  }
  if (overlay.position === 'bottom') {
    positionStyle.bottom = overlay.margin_px;
  }
  if (overlay.position === 'left') {
    positionStyle.left = overlay.margin_px;
  }
  if (overlay.position === 'right') {
    positionStyle.right = overlay.margin_px;
  }

  return (
    <div style={baseStyle}>
      <div className="absolute" style={positionStyle}>
        <div style={panelStyle} className="text-white">
          <ClockHeader />
          {children}
        </div>
      </div>
    </div>
  );
};

export default OverlayPanel;
