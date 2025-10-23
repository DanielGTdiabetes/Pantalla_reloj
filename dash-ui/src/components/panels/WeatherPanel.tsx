import GlassPanel from '../GlassPanel';
import WeeklyForecast from '../WeeklyForecast';
import type { WeatherToday } from '../../services/weather';

interface WeatherPanelProps {
  weather?: WeatherToday | null;
}

const iconMap: Record<string, string> = {
  sun: '☀️',
  cloud: '☁️',
  rain: '🌧️',
  storm: '⛈️',
  snow: '❄️',
  fog: '🌫️',
};

const WeatherPanel = ({ weather }: WeatherPanelProps) => {
  if (!weather) {
    return (
      <GlassPanel className="justify-center text-center text-white/75">
        <div className="text-2xl">Cargando clima…</div>
      </GlassPanel>
    );
  }

  const icon = iconMap[weather.icon] ?? '🌡️';
  const updatedAt = weather.updatedAt ? new Date(weather.updatedAt * 1000) : null;

  return (
    <GlassPanel className="justify-between gap-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="text-[104px] leading-none text-white/90">{icon}</div>
          <div className="flex flex-col items-end gap-2 text-right">
            <div className="text-7xl font-light text-white/95">{Math.round(weather.temp)}°</div>
            <div className="text-lg text-white/75">{weather.condition}</div>
            <div className="text-sm text-white/60">{weather.city}</div>
          </div>
        </div>
        <div className="grid w-full grid-cols-3 gap-4 rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/75">
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wide text-white/55">Mínima</div>
            <div className="text-xl text-white/85">{Math.round(weather.min)}°</div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wide text-white/55">Máxima</div>
            <div className="text-xl text-white/85">{Math.round(weather.max)}°</div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wide text-white/55">Precipitación</div>
            <div className="text-xl text-white/85">{Math.round(weather.rainProb)}%</div>
          </div>
        </div>
        <div className="text-right text-xs text-white/60">
          {updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
      </div>
      <div className="rounded-2xl border border-white/10">
        <div className="px-4 pt-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.35em] text-white/70">Semana</h3>
        </div>
        <WeeklyForecast />
      </div>
    </GlassPanel>
  );
};

export default WeatherPanel;
