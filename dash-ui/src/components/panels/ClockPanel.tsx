import { useEffect, useMemo, useState } from 'react';
import GlassPanel from '../GlassPanel';
import RotatingInfoPanel from '../RotatingInfoPanel';
import type { LocaleConfig, RotatingPanelSectionKey } from '../../services/config';
import type { WeatherToday } from '../../services/weather';
import type { DayInfoPayload } from '../../services/dayinfo';

interface ClockPanelProps {
  locale?: LocaleConfig;
  weather?: WeatherToday | null;
  dayInfo?: DayInfoPayload | null;
  rotatingPanel?: {
    enabled: boolean;
    sections: RotatingPanelSectionKey[];
    intervalMs: number;
    height?: number;
  };
}

const ClockPanel = ({ locale, weather, dayInfo, rotatingPanel }: ClockPanelProps) => {
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

  const activeRotatingPanel =
    rotatingPanel && rotatingPanel.enabled && rotatingPanel.sections.length > 0
      ? rotatingPanel
      : null;
  const showRotatingPanel = Boolean(activeRotatingPanel);

  return (
    <GlassPanel className={`justify-between ${showRotatingPanel ? 'gap-6' : 'gap-4'}`}>
      <div className="flex flex-col gap-2">
        <div className="text-[112px] font-light leading-none tracking-tight text-white/95">
          <span>{formattedTime}</span>
          <span className="text-[64px] align-top text-white/60">{formattedSeconds}</span>
        </div>
        <div className="text-2xl capitalize text-white/80">{formattedDate}</div>
      </div>
      {activeRotatingPanel ? (
        <RotatingInfoPanel
          sections={activeRotatingPanel.sections}
          intervalMs={activeRotatingPanel.intervalMs}
          height={activeRotatingPanel.height}
          weather={weather}
          dayInfo={dayInfo}
        />
      ) : null}
    </GlassPanel>
  );
};

export default ClockPanel;
