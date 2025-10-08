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

const Weather = () => {
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

  return (
    <section
      aria-label="Condiciones del clima"
      className="rounded-3xl border border-white/10 bg-white/5 px-10 py-6 backdrop-blur-md reduced-motion"
    >
      <div className="flex items-center gap-6 text-left">
        <div className="rounded-full border border-white/20 bg-black/50 p-4">
          <Icon className="h-12 w-12 text-white" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-5xl font-semibold leading-none">{weather.temp.toFixed(0)}º</p>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-200/70">{weather.condition}</p>
          <p className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-200/80">
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
