import { useEffect, useMemo, useState } from 'react';
import GlassPanel from '../GlassPanel';
import type { OfflineState } from '../../services/system';
import type { LocaleConfig } from '../../services/config';

interface ClockPanelProps {
  locale?: LocaleConfig;
  offlineState?: OfflineState | null;
  healthStatus?: string;
  lastRefresh?: number;
}

const ClockPanel = ({ locale, offlineState, healthStatus, lastRefresh }: ClockPanelProps) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const localeCode = useMemo(() => {
    const pieces = [locale?.language, locale?.country].filter(Boolean);
    if (pieces.length > 0) {
      return pieces.join('-');
    }
    if (locale?.country) {
      return `es-${locale.country}`;
    }
    return 'es-ES';
  }, [locale]);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(localeCode, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [localeCode],
  );

  const secondsFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(localeCode, {
        second: '2-digit',
      }),
    [localeCode],
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(localeCode, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    [localeCode],
  );

  const formattedTime = useMemo(() => timeFormatter.format(now), [timeFormatter, now]);
  const formattedSeconds = useMemo(() => secondsFormatter.format(now), [secondsFormatter, now]);
  const formattedDate = useMemo(() => dateFormatter.format(now), [dateFormatter, now]);

  const offlineLabel = useMemo(() => {
    if (!offlineState) return 'Sincronizando';
    if (!offlineState.offline) return 'Conectado';
    return 'Sin conexión';
  }, [offlineState]);

  const refreshLabel = useMemo(() => {
    if (!lastRefresh) return null;
    return new Intl.DateTimeFormat(localeCode, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(lastRefresh));
  }, [lastRefresh, localeCode]);

  return (
    <GlassPanel className="justify-between">
      <div className="flex flex-col gap-2">
        <div className="text-[112px] font-light leading-none tracking-tight text-white/95">
          <span>{formattedTime}</span>
          <span className="text-[64px] align-top text-white/60">{formattedSeconds}</span>
        </div>
        <div className="text-2xl capitalize text-white/80">{formattedDate}</div>
      </div>
      <div className="flex items-center justify-between text-sm text-white/65">
        <span>{offlineLabel}</span>
        <span>{healthStatus ?? ''}</span>
        <span>{refreshLabel ? `Actualizado ${refreshLabel}` : ''}</span>
      </div>
    </GlassPanel>
  );
};

export default ClockPanel;
