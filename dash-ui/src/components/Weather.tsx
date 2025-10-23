import { useEffect, useState } from 'react';
import { Cloud, CloudFog, CloudLightning, CloudRain, Snowflake, Sun } from 'lucide-react';
import { fetchWeatherToday, fetchWeatherWeekly, type WeatherDay, type WeatherToday } from '../services/weather';
import LottieIcon, { type LottieIconName } from './LottieIcon';
import { ENABLE_LOTTIE } from '../utils/runtimeFlags';

const ICON_COMPONENTS = {
  cloud: Cloud,
  rain: CloudRain,
  sun: Sun,
  snow: Snowflake,
  storm: CloudLightning,
  fog: CloudFog,
} as const;

const LOTTIE_MAP: Record<string, LottieIconName> = {
  sun: 'weather-sun',
  rain: 'weather-rain',
  cloud: 'weather-cloud',
  fog: 'weather-cloud',
  storm: 'weather-storm',
  snow: 'weather-rain',
};

const REFRESH_INTERVAL = 15 * 60 * 1000;

const Weather = () => {
  const [today, setToday] = useState<WeatherToday | null>(null);
  const [weekly, setWeekly] = useState<WeatherDay[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const [todayData, weeklyData] = await Promise.all([fetchWeatherToday(), fetchWeatherWeekly()]);
        if (!cancelled) {
          setToday(todayData);
          setWeekly(weeklyData);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sin datos');
        }
      }
    };

    void load();
    timer = window.setInterval(() => {
      void load();
    }, REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, []);

  const Icon = today ? ICON_COMPONENTS[today.icon] ?? Cloud : Cloud;
  const lottieName = today ? LOTTIE_MAP[today.icon] ?? 'weather-cloud' : 'weather-cloud';
  const updatedAt = today
    ? new Date(today.updatedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <section
      className="flex h-full w-full flex-col rounded-3xl bg-slate-900/30 p-8 text-shadow-soft backdrop-blur"
      data-depth-blur="true"
    >
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-cyan-200/80">Clima</p>
          <h2 className="mt-2 text-3xl font-semibold text-cyan-50">{today?.city ?? '---'}</h2>
        </div>
        <div className="flex items-center gap-3 text-sm text-cyan-100/80">
          {updatedAt && <span>Actualizado {updatedAt}</span>}
          {today?.cached && <span className="text-amber-300">(cache)</span>}
        </div>
      </header>
      <div className="mt-6 flex flex-1 flex-col gap-6">
        {today ? (
          <div className="flex items-center gap-6">
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-cyan-500/15">
              {ENABLE_LOTTIE ? (
                <LottieIcon name={lottieName} className="h-20 w-20" />
              ) : (
                <Icon className="h-12 w-12 text-cyan-100" strokeWidth={1.3} />
              )}
            </div>
            <div>
              <p className="text-7xl font-semibold leading-none">{today.temp.toFixed(0)}º</p>
              <p className="mt-2 text-lg uppercase tracking-[0.35em] text-cyan-100/80">{today.condition}</p>
              <p className="mt-3 flex flex-wrap gap-4 text-sm text-cyan-100/70">
                <span>Máx {today.max.toFixed(0)}º</span>
                <span>Mín {today.min.toFixed(0)}º</span>
                <span>Prec. {today.rainProb.toFixed(0)}%</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-cyan-100/70">{error ?? 'Sin datos de clima en este momento.'}</p>
        )}
        <div className="flex flex-1 flex-col justify-between">
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-100/60">Semana</p>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-cyan-50/90">
            {weekly.slice(0, 5).map((day) => {
              const DayIcon = ICON_COMPONENTS[day.icon] ?? Cloud;
              return (
                <div
                  key={day.date}
                  className="flex items-center justify-between rounded-2xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-2"
                >
                  <span className="w-20 uppercase tracking-[0.25em] text-cyan-100/70">{day.day}</span>
                  <div className="flex items-center gap-2 text-cyan-100/80">
                    <DayIcon className="h-5 w-5" />
                    <span>{day.condition}</span>
                  </div>
                  <span className="w-28 text-right text-cyan-100/70">{day.min.toFixed(0)}º / {day.max.toFixed(0)}º</span>
                  <span className="w-16 text-right text-cyan-200/80">{day.rainProb.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {error && (
        <p className="mt-4 text-xs text-amber-300">{error}</p>
      )}
    </section>
  );
};

export default Weather;
