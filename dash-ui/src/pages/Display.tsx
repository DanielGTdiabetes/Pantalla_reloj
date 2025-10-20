import { useCallback, useEffect, useMemo, useState } from 'react';
import Background from '../components/Background';
import ClockPanel from '../components/panels/ClockPanel';
import WeatherPanel from '../components/panels/WeatherPanel';
import InfoPanel from '../components/panels/InfoPanel';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import { fetchWeatherToday, type WeatherToday } from '../services/weather';
import { fetchDayBrief, type DayInfoPayload } from '../services/dayinfo';
import { fetchHealth, fetchOfflineState, type HealthStatus, type OfflineState } from '../services/system';

const REFRESH_INTERVAL_MS = 60_000;

const Display = () => {
  const { config, refresh: refreshConfig } = useDashboardConfig();
  const [weather, setWeather] = useState<WeatherToday | null>(null);
  const [dayInfo, setDayInfo] = useState<DayInfoPayload | null>(null);
  const [offlineState, setOfflineState] = useState<OfflineState | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [weatherData, dayInfoData, offlineData, healthData] = await Promise.all([
      fetchWeatherToday().catch((error) => {
        console.warn('No se pudo cargar el clima', error);
        return null;
      }),
      fetchDayBrief().catch((error) => {
        console.warn('No se pudo cargar la información del día', error);
        return null;
      }),
      fetchOfflineState().catch((error) => {
        console.warn('No se pudo cargar el estado offline', error);
        return null;
      }),
      fetchHealth().catch((error) => {
        console.warn('No se pudo cargar healthcheck', error);
        return null;
      }),
    ]);

    if (weatherData) setWeather(weatherData);
    if (dayInfoData) setDayInfo(dayInfoData);
    if (offlineData) setOfflineState(offlineData);
    if (healthData) setHealth(healthData);
    setLastRefresh(Date.now());

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

  const healthLabel = useMemo(() => {
    if (!health) return '';
    if (health.status?.toLowerCase() === 'ok') {
      return 'Sistema estable';
    }
    return `Estado: ${health.status}`;
  }, [health]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <Background refreshMinutes={config?.background?.intervalMinutes ?? 60} />
      <div className="relative z-10 flex h-full w-full items-center justify-center px-12 py-8">
        <div className="grid h-full w-full max-w-[1840px] grid-cols-3 gap-8">
          <ClockPanel
            locale={config?.locale}
            offlineState={offlineState}
            healthStatus={healthLabel}
            lastRefresh={lastRefresh ?? undefined}
          />
          <WeatherPanel weather={weather} />
          <InfoPanel dayInfo={dayInfo} />
        </div>
      </div>
    </div>
  );
};

export default Display;
