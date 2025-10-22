import { useCallback, useEffect, useMemo, useState } from 'react';
import Background from '../components/Background';
import ClockPanel from '../components/panels/ClockPanel';
import WeatherPanel from '../components/panels/WeatherPanel';
import InfoPanel from '../components/panels/InfoPanel';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import { fetchWeatherToday, type WeatherToday } from '../services/weather';
import { fetchDayBrief, type DayInfoPayload } from '../services/dayinfo';
import type { RotatingPanelSectionKey } from '../services/config';

const REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_ROTATING_SECTIONS: RotatingPanelSectionKey[] = ['weather', 'calendar', 'season'];
const DEFAULT_ROTATING_INTERVAL_SECONDS = 7;
const MIN_ROTATING_INTERVAL_SECONDS = 4;
const MAX_ROTATING_INTERVAL_SECONDS = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sanitizeSections(sections: RotatingPanelSectionKey[] | undefined): RotatingPanelSectionKey[] {
  if (!Array.isArray(sections)) return DEFAULT_ROTATING_SECTIONS;
  const seen = new Set<RotatingPanelSectionKey>();
  const valid: RotatingPanelSectionKey[] = [];
  sections.forEach((section) => {
    if (DEFAULT_ROTATING_SECTIONS.includes(section) && !seen.has(section)) {
      seen.add(section);
      valid.push(section);
    }
  });
  return valid.length > 0 ? valid : DEFAULT_ROTATING_SECTIONS;
}

const Display = () => {
  const { config, refresh: refreshConfig } = useDashboardConfig();
  const [weather, setWeather] = useState<WeatherToday | null>(null);
  const [dayInfo, setDayInfo] = useState<DayInfoPayload | null>(null);
  const load = useCallback(async () => {
    const [weatherData, dayInfoData] = await Promise.all([
      fetchWeatherToday().catch((error) => {
        console.warn('No se pudo cargar el clima', error);
        return null;
      }),
      fetchDayBrief().catch((error) => {
        console.warn('No se pudo cargar la información del día', error);
        return null;
      }),
    ]);

    if (weatherData) setWeather(weatherData);
    if (dayInfoData) setDayInfo(dayInfoData);

    try {
      await refreshConfig();
    } catch (error) {
      console.warn('No se pudo refrescar configuración', error);
    }
  }, [refreshConfig]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  const rotatingPanelSettings = useMemo(() => {
    const rotating = config?.ui?.rotatingPanel;
    const enabled = rotating?.enabled ?? true;
    const sections = sanitizeSections(rotating?.sections as RotatingPanelSectionKey[] | undefined);
    const intervalSeconds = clamp(
      typeof rotating?.intervalSeconds === 'number'
        ? Math.round(rotating.intervalSeconds)
        : DEFAULT_ROTATING_INTERVAL_SECONDS,
      MIN_ROTATING_INTERVAL_SECONDS,
      MAX_ROTATING_INTERVAL_SECONDS,
    );

    return {
      enabled,
      sections,
      intervalMs: intervalSeconds * 1000,
    };
  }, [config?.ui?.rotatingPanel]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <Background refreshMinutes={config?.background?.intervalMinutes ?? 60} />
      <div className="relative z-10 flex h-full w-full items-center justify-center px-12 py-8">
        <div className="grid h-full w-full max-w-[1840px] grid-cols-3 gap-8">
          <ClockPanel
            locale={config?.locale}
            weather={weather}
            dayInfo={dayInfo}
            rotatingPanel={rotatingPanelSettings}
          />
          <WeatherPanel weather={weather} />
          <InfoPanel dayInfo={dayInfo} />
        </div>
      </div>
    </div>
  );
};

export default Display;
