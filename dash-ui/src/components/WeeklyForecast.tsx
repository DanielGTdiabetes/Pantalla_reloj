import { useMemo } from 'react';
import { Cloud, CloudFog, CloudLightning, CloudRain, Snowflake, Sun } from 'lucide-react';
import { useWeeklyForecast } from '../hooks/useWeeklyForecast';
import type { WeatherDay, WeatherIcon } from '../services/weather';

const ICON_COMPONENTS: Record<WeatherIcon, typeof Cloud> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  snow: Snowflake,
  fog: CloudFog,
};

const DAY_LABELS: Record<string, string> = {
  Lun: 'Lu',
  Mar: 'Ma',
  Mie: 'Mi',
  Mié: 'Mi',
  Jue: 'Ju',
  Vie: 'Vi',
  Sab: 'Sá',
  Sáb: 'Sá',
  Dom: 'Do',
  Mon: 'Lu',
  Tue: 'Ma',
  Wed: 'Mi',
  Thu: 'Ju',
  Fri: 'Vi',
  Sat: 'Sá',
  Sun: 'Do',
};

function formatDayLabel(day: WeatherDay['day']): string {
  if (!day) return '—';
  return DAY_LABELS[day] ?? day.slice(0, 2);
}

const WeeklyForecast = () => {
  const { days, loading } = useWeeklyForecast();

  const displayDays = useMemo(() => {
    if (!Array.isArray(days)) return [];
    return days.slice(0, 7);
  }, [days]);

  if (loading && displayDays.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-3 px-4 pb-3 pt-2 text-white/70 md:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={`weekly-skeleton-${index}`}
            className="flex flex-col items-center gap-2 rounded-lg border border-white/15 px-3 py-2"
          >
            <span className="h-3 w-10 animate-pulse rounded-full bg-white/20" />
            <span className="h-9 w-9 animate-pulse rounded-full bg-white/15" />
            <span className="h-3 w-16 animate-pulse rounded-full bg-white/20" />
          </div>
        ))}
      </div>
    );
  }

  if (displayDays.length === 0) {
    return (
      <div className="px-4 pb-3 pt-2 text-center text-sm text-white/65">
        No hay previsión semanal disponible.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 px-4 pb-3 pt-2 md:grid-cols-7">
      {displayDays.map((day) => {
        const IconComponent = ICON_COMPONENTS[day.icon] ?? Cloud;
        const max = Number.isFinite(day.max) ? `${Math.round(day.max)}°` : '—';
        const min = Number.isFinite(day.min) ? `${Math.round(day.min)}°` : '—';
        const rain = Number.isFinite(day.rainProb) ? `${Math.round(day.rainProb)}%` : '—';
        return (
          <div
            key={day.date ?? `${day.day}-${max}-${min}`}
            className="flex flex-col items-center rounded-lg border border-white/15 px-3 py-2 text-center"
          >
            <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/85">
              {formatDayLabel(day.day)}
            </span>
            <div className="mb-1 flex h-9 w-9 items-center justify-center">
              <IconComponent className="h-5 w-5 text-white/90" strokeWidth={1.6} />
            </div>
            <div className="flex flex-col gap-1 text-[0.75rem] leading-tight text-white/80">
              <span className="truncate max-w-[100px]">{day.condition}</span>
              <span className="truncate max-w-[100px]">{max} / {min}</span>
              <span className="truncate max-w-[100px]">Prec. {rain}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WeeklyForecast;
