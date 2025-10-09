import { useEffect, useState } from 'react';
import { subscribeWeather, type WeatherSnapshot } from '../services/weather';
import { Cloud, CloudFog, CloudLightning, CloudRain, Snowflake, Sun } from 'lucide-react';

const ICON_MAP = {
  cloud: Cloud,
  rain: CloudRain,
  sun: Sun,
  snow: Snowflake,
  storm: CloudLightning,
  fog: CloudFog,
} as const;

interface WeatherProps {
  tone?: 'light' | 'dark';
  className?: string;
}

const Weather = ({ tone = 'dark', className = '' }: WeatherProps) => {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeWeather((snapshot) => {
      if (snapshot) {
        setWeather(snapshot);
      }
    });
    return unsubscribe;
  }, []);

  if (!weather) {
    return null;
  }

  const Icon = ICON_MAP[weather.icon] ?? Cloud;

  const toneTextSecondary = tone === 'light' ? 'text-slate-700/80' : 'text-slate-200/80';
  const toneMeta = tone === 'light' ? 'text-slate-600/70' : 'text-slate-200/70';

  return (
    <section
      aria-label="Condiciones del clima"
      className={`glass-surface ${tone === 'light' ? 'glass-light' : 'glass'} w-full max-w-3xl px-10 py-6 transition ${className}`}
    >
      <div className="flex flex-col gap-6 text-left md:flex-row md:items-center">
        <div
          className={`rounded-full border p-4 ${
            tone === 'light' ? 'border-slate-300/40 bg-white/50' : 'border-white/20 bg-black/50'
          }`}
        >
          <Icon className={`h-12 w-12 ${tone === 'light' ? 'text-slate-900' : 'text-white'}`} strokeWidth={1.5} />
        </div>
        <div>
          <p className={`text-5xl font-semibold leading-none ${tone === 'light' ? 'text-slate-900' : 'text-white'}`}>
            {weather.temp.toFixed(0)}º
          </p>
          <p className={`text-sm uppercase tracking-[0.35em] ${toneMeta}`}>{weather.condition}</p>
          <p className={`mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm ${toneTextSecondary}`}>
            <span>Humedad {weather.humidity}%</span>
            <span>Prec. {weather.precipProb}%</span>
            <span>
              Actualizado{' '}
              {new Date(weather.updatedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </p>
          {weather.stale && (
            <p className="mt-2 text-xs text-amber-300/80">
              Usando últimos datos guardados{weather.message ? ` · ${weather.message}` : ''}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default Weather;
