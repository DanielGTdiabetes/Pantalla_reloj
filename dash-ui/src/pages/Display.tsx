import { useCallback, useEffect, useState } from 'react';
import Background from '../components/Background';
import ClockPanel from '../components/panels/ClockPanel';
import WeatherPanel from '../components/panels/WeatherPanel';
import InfoPanel from '../components/panels/InfoPanel';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import { fetchWeatherToday, type WeatherToday } from '../services/weather';
import { fetchDayBrief, type DayInfoPayload } from '../services/dayinfo';

const REFRESH_INTERVAL_MS = 60_000;

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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <Background refreshMinutes={config?.background?.intervalMinutes ?? 60} />
      <div className="relative z-10 flex h-full w-full items-center justify-center px-12 py-8">
        <div className="grid h-full w-full max-w-[1840px] grid-cols-3 gap-8">
          <ClockPanel locale={config?.locale} />
          <WeatherPanel weather={weather} />
          <InfoPanel dayInfo={dayInfo} />
        </div>
      </div>
    </div>
  );
};

export default Display;
