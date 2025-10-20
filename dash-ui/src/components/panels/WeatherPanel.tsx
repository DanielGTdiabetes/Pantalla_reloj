import GlassPanel from '../GlassPanel';
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
    <GlassPanel className="justify-between">
      <div className="flex items-start justify-between gap-4">
        <div className="text-[96px] leading-none">{icon}</div>
        <div className="flex flex-col items-end">
          <div className="text-6xl font-light text-white/90">{Math.round(weather.temp)}°</div>
          <div className="text-lg text-white/70">{weather.condition}</div>
          <div className="text-sm text-white/60">{weather.city}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 text-sm text-white/70">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/50">Mínima</div>
          <div className="text-xl text-white/80">{Math.round(weather.min)}°</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-white/50">Máxima</div>
          <div className="text-xl text-white/80">{Math.round(weather.max)}°</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-white/50">Lluvia</div>
          <div className="text-xl text-white/80">{Math.round(weather.rainProb)}%</div>
        </div>
      </div>
      <div className="text-right text-xs text-white/55">
        {updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
      </div>
    </GlassPanel>
  );
};

export default WeatherPanel;
