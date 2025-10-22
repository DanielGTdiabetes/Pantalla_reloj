import { useCallback, useEffect, useMemo, useState } from 'react';
import Background from '../components/Background';
import LightningAlertBanner from '../components/LightningAlertBanner';
import ClockPanel from '../components/panels/ClockPanel';
import WeatherPanel from '../components/panels/WeatherPanel';
import SideInfoRotator from '../components/SideInfoRotator';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import { fetchWeatherToday, type WeatherToday } from '../services/weather';
import type { RotatingPanelSectionKey, SideInfoSectionKey } from '../services/config';
import { useDayBrief } from '../hooks/useDayBrief';

const REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_ROTATING_SECTIONS: RotatingPanelSectionKey[] = ['calendar', 'season', 'weekly', 'lunar'];
const DEFAULT_ROTATING_INTERVAL_SECONDS = 7;
const MIN_ROTATING_INTERVAL_SECONDS = 4;
const MAX_ROTATING_INTERVAL_SECONDS = 30;
const DEFAULT_SIDE_SECTIONS: SideInfoSectionKey[] = ['efemerides', 'news'];
const DEFAULT_SIDE_INTERVAL_SECONDS = 10;
const MIN_SIDE_INTERVAL_SECONDS = 5;
const MAX_SIDE_INTERVAL_SECONDS = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const ALLOWED_SECTIONS: RotatingPanelSectionKey[] = ['calendar', 'season', 'weekly', 'lunar'];
const ALLOWED_SIDE_SECTIONS: SideInfoSectionKey[] = ['efemerides', 'news'];

function sanitizeSections(sections: RotatingPanelSectionKey[] | undefined): RotatingPanelSectionKey[] {
  if (!Array.isArray(sections)) return DEFAULT_ROTATING_SECTIONS;
  const seen = new Set<RotatingPanelSectionKey>();
  const valid: RotatingPanelSectionKey[] = [];
  sections.forEach((section) => {
    if (ALLOWED_SECTIONS.includes(section) && !seen.has(section)) {
      seen.add(section);
      valid.push(section);
    }
  });
  return valid.length > 0 ? valid : DEFAULT_ROTATING_SECTIONS;
}

function sanitizeSideSections(
  sections: SideInfoSectionKey[] | undefined,
  allowNews: boolean,
): SideInfoSectionKey[] {
  const fallback = allowNews ? DEFAULT_SIDE_SECTIONS : (['efemerides'] as SideInfoSectionKey[]);
  const raw = Array.isArray(sections) && sections.length > 0 ? sections : fallback;
  const allowed = new Set<SideInfoSectionKey>(['efemerides']);
  if (allowNews) {
    allowed.add('news');
  }
  const seen = new Set<SideInfoSectionKey>();
  const normalized: SideInfoSectionKey[] = [];
  raw.forEach((section) => {
    if (!ALLOWED_SIDE_SECTIONS.includes(section)) return;
    if (!allowed.has(section)) return;
    if (seen.has(section)) return;
    seen.add(section);
    normalized.push(section);
  });
  if (normalized.length === 0) {
    normalized.push('efemerides');
  }
  return normalized;
}

const Display = () => {
  const { config, refresh: refreshConfig } = useDashboardConfig();
  const [weather, setWeather] = useState<WeatherToday | null>(null);
  const { data: dayInfo } = useDayBrief();
  const load = useCallback(async () => {
    const weatherData = await fetchWeatherToday().catch((error) => {
      console.warn('No se pudo cargar el clima', error);
      return null;
    });

    if (weatherData) setWeather(weatherData);

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

  const sideInfoSettings = useMemo(() => {
    const sideInfo = config?.ui?.sideInfo;
    const enabled = sideInfo?.enabled ?? true;
    const uiNewsEnabled = sideInfo?.news?.enabled ?? true;
    const backendNewsEnabled = config?.news?.enabled ?? true;
    const newsEnabled = uiNewsEnabled && backendNewsEnabled;
    const sections = sanitizeSideSections(
      sideInfo?.sections as SideInfoSectionKey[] | undefined,
      newsEnabled,
    );
    const intervalSeconds = clamp(
      typeof sideInfo?.intervalSeconds === 'number'
        ? Math.round(sideInfo.intervalSeconds)
        : DEFAULT_SIDE_INTERVAL_SECONDS,
      MIN_SIDE_INTERVAL_SECONDS,
      MAX_SIDE_INTERVAL_SECONDS,
    );
    const showSantoral = sideInfo?.showSantoralWithEfemerides ?? true;
    const showHolidays = sideInfo?.showHolidaysWithEfemerides ?? true;
    const newsDisabledNote = !backendNewsEnabled
      ? 'Servicio de noticias desactivado'
      : !uiNewsEnabled
      ? 'Noticias desactivadas en la configuración'
      : null;

    return {
      enabled,
      sections,
      intervalMs: intervalSeconds * 1000,
      showSantoral,
      showHolidays,
      newsEnabled,
      newsDisabledNote,
    };
  }, [config?.ui?.sideInfo, config?.news?.enabled]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <LightningAlertBanner />
      <Background refreshMinutes={config?.background?.intervalMinutes ?? 60} />
      <div className="relative z-10 flex h-full w-full items-center justify-center px-12 py-8">
        <div className="grid h-full w-full max-w-[1840px] grid-cols-3 gap-8">
          <ClockPanel
            locale={config?.locale}
            rotatingPanel={rotatingPanelSettings}
          />
          <WeatherPanel weather={weather} />
          <SideInfoRotator
            enabled={sideInfoSettings.enabled}
            sections={sideInfoSettings.sections}
            intervalMs={sideInfoSettings.intervalMs}
            showSantoralWithEfemerides={sideInfoSettings.showSantoral}
            showHolidaysWithEfemerides={sideInfoSettings.showHolidays}
            dayInfo={dayInfo}
            newsEnabled={sideInfoSettings.newsEnabled}
            newsDisabledNote={sideInfoSettings.newsDisabledNote}
          />
        </div>
      </div>
    </div>
  );
};

export default Display;
