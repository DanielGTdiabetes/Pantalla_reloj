import { useState, useEffect } from "react";
import { StandardCard } from "../StandardCard";

type ForecastDay = {
  date: string;
  dayName?: string;
  condition: string;
  temperature: {
    min: number | null;
    max: number | null;
  };
  precipitation?: number | null;
};

type WeatherForecastCardProps = {
  forecast: ForecastDay[];
  unit: string;
};

// Professional SVG Icons
// 3D Image Icons logic
const get3DIconUrl = (condition: string): string => {
  const c = (condition || "").toLowerCase();

  if (c.includes("lluvia") || c.includes("rain") || c.includes("tormenta") || c.includes("nube")) return "/img/icons/3d/cloud-rain.png";
  if (c.includes("noche") || c.includes("night") || c.includes("moon")) return "/img/icons/3d/moon-sleep.png";
  if (c.includes("claro") || c.includes("clear") || c.includes("sol") || c.includes("sunny")) return "/img/icons/3d/sun-smile.png";

  // Default
  return "/img/icons/3d/sun-smile.png";
};

const WeatherIcon3D = ({ condition, className }: { condition: string; className?: string }) => {
  const url = get3DIconUrl(condition);

  return (
    <div className={`relative ${className} flex items-center justify-center`}>
      <img
        src={url}
        alt={condition}
        className="w-full h-full object-contain filter drop-shadow-2xl will-change-transform z-10"
      />
    </div>
  );
};

export const WeatherForecastCard = ({ forecast, unit }: WeatherForecastCardProps): JSX.Element | null => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const ROTATION_INTERVAL = 5000;

  // Filtrar y limitar días válidos
  const validDays = forecast.filter(d => d.date);
  const displayLimit = Math.min(validDays.length, 7);
  const days = validDays.slice(0, displayLimit);

  useEffect(() => {
    if (days.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % days.length);
    }, ROTATION_INTERVAL);
    return () => clearInterval(interval);
  }, [days.length]);

  const currentDay = days[currentIndex];
  if (!currentDay) return null;

  // Header icon - 3D Cloud Rain
  const headerIcon = <img src="/img/icons/3d/cloud-rain.png" className="w-8 h-8 drop-shadow-md animate-bounce-slow" alt="weather" />;

  return (
    <StandardCard
      title="Previsión"
      subtitle="Pronóstico semanal"
      icon={headerIcon}
      className="weather-forecast-root relative overflow-hidden"
    >
      {/* Subtle Pattern Overlay */}
      <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

      {/* Background gradient structure */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-800/20 to-blue-900/50 pointer-events-none" />

      <div className="flex flex-col items-center justify-between py-4 h-full w-full relative z-10 animate-fade-in-up" key={currentIndex}>

        {/* 1. Date Pill */}
        <div className="bg-white/20 backdrop-blur-md px-4 py-1 rounded-full border border-white/30 shadow-sm mb-2">
          <h2 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm flex flex-col items-center leading-none gap-0.5">
            <span>{currentDay.dayName || "Hoy"}</span>
            <span className="text-[10px] opacity-80 font-normal tracking-widest">{currentDay.date}</span>
          </h2>
        </div>

        {/* 2. Main Weather Icon - Centered */}
        <div className="relative group cursor-pointer flex-1 flex items-center justify-center w-full min-h-0">
          <div className="absolute inset-0 bg-white/30 rounded-full blur-[60px] animate-pulse-slow pointer-events-none scale-125" />
          <WeatherIcon3D
            condition={currentDay.condition}
            className="w-auto h-[65%] max-h-[160px] animate-float"
          />
        </div>

        {/* 3. Temps & Condition Box */}
        <div className="w-full bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/20 flex items-center justify-between shadow-lg mt-auto">
          <div className="flex items-center gap-3">
            {/* Min/Max */}
            <div className="flex flex-col items-center">
              <span className="text-xl md:text-2xl font-black text-white drop-shadow-sm leading-none flex gap-0.5">
                {currentDay.temperature.max ? Math.round(currentDay.temperature.max) : "--"}°
                <span className="text-xs text-white/60 font-medium self-start mt-1">MAX</span>
              </span>
            </div>
            <div className="w-px h-6 bg-white/30" />
            <div className="flex flex-col items-center">
              <span className="text-xl md:text-2xl font-black text-cyan-100 drop-shadow-sm leading-none flex gap-0.5">
                {currentDay.temperature.min ? Math.round(currentDay.temperature.min) : "--"}°
                <span className="text-xs text-cyan-100/60 font-medium self-start mt-1">MIN</span>
              </span>
            </div>
          </div>

          {/* Condition Text */}
          <div className="flex flex-col items-end text-right max-w-[100px] leading-tight">
            <span className="text-xs font-bold text-white uppercase drop-shadow-sm line-clamp-2">
              {currentDay.condition}
            </span>
            {currentDay.precipitation !== null && currentDay.precipitation !== undefined && currentDay.precipitation > 0 && (
              <div className="flex items-center gap-1 mt-0.5 text-blue-100 bg-blue-500/30 px-1.5 rounded-md">
                <span className="text-[10px]">💧</span>
                <span className="text-[10px] font-bold">{Math.round(currentDay.precipitation)}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Indicators */}
        {days.length > 1 && (
          <div className="absolute bottom-1 flex gap-2 z-30 opacity-60">
            {days.map((_, idx) => (
              <div
                key={idx}
                className={`h-1 rounded-full transition-all duration-300 shadow-sm ${idx === currentIndex ? "bg-white w-4" : "bg-white/40 w-1"
                  }`}
              />
            ))}
          </div>
        )}

      </div>

      <style>{`
        .weather-forecast-root {
          background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%) !important;
          color: white !important;
        }
        .weather-forecast-root h2,
        .weather-forecast-root span, 
        .weather-forecast-root p {
            color: white !important;
            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
        @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-8px) rotate(2deg); }
        }
        .animate-float {
            animation: float 5s ease-in-out infinite;
        }
            @keyframes bounce-slow {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
        }
        .animate-bounce-slow {
            animation: bounce-slow 3s ease-in-out infinite;
        }
        .animate-fade-in-up {
                animation: fade-in-up 0.4s ease-out forwards;
        }
        @keyframes fade-in-up {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </StandardCard>
  );
};

export default WeatherForecastCard;
