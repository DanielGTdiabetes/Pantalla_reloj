import { Cloud, CloudFog, CloudLightning, CloudRain, Snowflake, Sun } from 'lucide-react';
import GlassPanel from '../GlassPanel';
import WeeklyForecast from '../WeeklyForecast';
import type { WeatherIcon, WeatherToday } from '../../services/weather';

interface WeatherPanelProps {
  weather?: WeatherToday | null;
}

const ICON_COMPONENTS: Record<WeatherIcon, typeof Sun> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  snow: Snowflake,
  fog: CloudFog,
};

const WeatherPanel = ({ weather }: WeatherPanelProps) => {
  if (!weather) {
    return (
      <GlassPanel className="items-center justify-center text-center text-white/75">
        <div className="text-2xl">Cargando clima...</div>
      </GlassPanel>
    );
  }

  const IconComponent = ICON_COMPONENTS[weather.icon] ?? Cloud;
  const updatedAt = weather.updatedAt ? new Date(weather.updatedAt * 1000) : null;
  const updatedText = updatedAt
    ? updatedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <GlassPanel className="justify-between gap-6 md:flex-row md:items-stretch md:gap-10">
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col gap-6 rounded-2xl border border-white/15 p-4 md:flex-row md:items-center md:gap-8 md:p-6">
          <div className="flex items-center justify-center self-start rounded-2xl border border-white/20 bg-white/5 p-4 md:self-center">
            <IconComponent className="h-20 w-20 text-white/90" strokeWidth={1.4} />
          </div>
          <div className="flex flex-1 flex-col gap-4 text-white">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <span className="text-7xl font-light leading-none text-white/95">
                {Math.round(weather.temp)}°
              </span>
              <div className="text-right">
                <div className="text-lg font-medium text-white/85">{weather.condition}</div>
                <div className="text-sm text-white/55">{weather.city}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm text-white/80 sm:max-w-md">
              <WeatherMetric label="Minima" value={`${Math.round(weather.min)}°`} />
              <WeatherMetric label="Maxima" value={`${Math.round(weather.max)}°`} />
              <WeatherMetric label="Precipitacion" value={`${Math.round(weather.rainProb)}%`} />
            </div>
            {updatedText ? (
              <div className="text-sm text-white/60">
                Actualizado {updatedText}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col rounded-2xl border border-white/15 md:max-w-sm">
        <div className="px-4 pt-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.35em] text-white/70">Semana</h3>
        </div>
        <WeeklyForecast />
      </div>
    </GlassPanel>
  );
};

interface WeatherMetricProps {
  label: string;
  value: string;
}

const WeatherMetric = ({ label, value }: WeatherMetricProps) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs uppercase tracking-wide text-white/55">{label}</span>
    <span className="text-xl text-white/90">{value}</span>
  </div>
);

export default WeatherPanel;
