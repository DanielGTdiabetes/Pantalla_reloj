import { useState, useEffect } from "react";
import { WeatherIcon } from "../../WeatherIcon";

type ForecastDay = {
  date: string;
  dayName?: string;
  condition: string;
  temperature: {
    min: number | null;
    max: number | null;
  };
  precipitation?: number | null;
  icon?: string; // Standard icon name
};

type WeatherForecastCardProps = {
  forecast: ForecastDay[];
  unit: string;
};

// Mapeo de condiciones a iconos 3D (Fluent Animated Emojis)
const get3DIconUrl = (condition: string): string => {
  const baseUrl = "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/";
  const skyUrl = "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Sky%20and%20weather/";

  const c = condition.toLowerCase();

  // Mapeo heurístico
  if (c.includes("despejado") || c.includes("clear")) return `${baseUrl}Sun.png`;
  if (c.includes("parcial") || c.includes("partly")) return `${skyUrl}Sun%20Behind%20Cloud.png`;
  if (c.includes("nublado") || c.includes("cloud") || c.includes("cubierto")) return `${skyUrl}Cloud.png`;
  if (c.includes("lluvia") || c.includes("rain") || c.includes("llovizna")) return `${skyUrl}Cloud%20with%20Rain.png`;
  if (c.includes("tormenta") || c.includes("storm") || c.includes("thunder")) return `${skyUrl}Cloud%20with%20Lightning%20and%20Rain.png`;
  if (c.includes("nieve") || c.includes("snow")) return `${skyUrl}Cloud%20with%20Snow.png`;
  if (c.includes("niebla") || c.includes("fog")) return `${skyUrl}Fog.png`;

  return `${baseUrl}Sun.png`; // Fallback
};

const WeatherIcon3D = ({ condition, className }: { condition: string, className?: string }) => {
  const url = get3DIconUrl(condition);

  return (
    <div className={`relative ${className}`}>
      {/* Container para efecto de flotación */}
      <div className="animate-float drop-shadow-2xl filter hover:scale-110 transition-transform duration-500">
        <img
          src={url}
          alt={condition}
          className="w-full h-full object-contain"
        />
      </div>
    </div>
  );
};

export const WeatherForecastCard = ({ forecast, unit }: WeatherForecastCardProps): JSX.Element | null => {
  // Use up to 7 days for the carousel
  const days = forecast.slice(0, 7);
  const [currentIndex, setCurrentIndex] = useState(0);
  const ROTATION_INTERVAL = 4000; // 4 seconds per day, slower to enjoy the 3D icon

  useEffect(() => {
    if (days.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % days.length);
    }, ROTATION_INTERVAL);

    return () => clearInterval(interval);
  }, [days.length]);

  const currentDay = days[currentIndex];
  if (!currentDay) return null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-gradient-to-br from-[#1a2942] to-[#121b2b] text-white shadow-2xl border border-white/10">
      {/* Header Compacto */}
      <div className="bg-black/20 p-3 text-center backdrop-blur-sm">
        <h2 className="text-sm font-medium uppercase tracking-wider opacity-80">
          Previsión Semanal ({currentIndex + 1}/{days.length})
        </h2>
      </div>

      {/* Cuerpo Principal */}
      <div className="flex flex-1 flex-col items-center justify-between p-4" key={currentIndex}>

        {/* Fecha y Día */}
        <div className="text-center animate-fade-in-down">
          <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-200 to-white">
            {currentDay.dayName || currentDay.date}
          </div>
          <div className="text-sm text-blue-200/60 mt-1">{currentDay.date}</div>
        </div>

        {/* Icono 3D Grande */}
        <div className="flex-1 w-full flex items-center justify-center py-2 h-32">
          <WeatherIcon3D condition={currentDay.condition} className="w-32 h-32 md:w-40 md:h-40" />
        </div>

        {/* Temperaturas Grandes */}
        <div className="flex w-full justify-center gap-8 mb-4">
          <div className="flex flex-col items-center">
            <span className="text-4xl font-bold text-red-400 drop-shadow-lg">
              {currentDay.temperature.max !== null ? Math.round(currentDay.temperature.max) : "--"}°
            </span>
            <span className="text-xs uppercase tracking-widest opacity-60">Max</span>
          </div>
          <div className="w-px bg-white/10 mx-2"></div>
          <div className="flex flex-col items-center">
            <span className="text-4xl font-bold text-blue-400 drop-shadow-lg">
              {currentDay.temperature.min !== null ? Math.round(currentDay.temperature.min) : "--"}°
            </span>
            <span className="text-xs uppercase tracking-widest opacity-60">Min</span>
          </div>
        </div>

        {/* Footer: Precipitación y Condición */}
        <div className="w-full rounded-lg bg-black/30 p-3 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium capitalize text-gray-200 truncate pr-2 max-w-[70%]">
              {currentDay.condition}
            </span>
            {currentDay.precipitation !== null && currentDay.precipitation !== undefined && (
              <div className="flex items-center gap-1.5 text-blue-300 font-bold bg-blue-500/10 px-2 py-1 rounded-full">
                <span>💧</span>
                <span>{Math.round(currentDay.precipitation)}%</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Estilos inline para animación float */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 4s ease-in-out infinite;
        }
        .animate-fade-in-down {
          animation: fadeInDown 0.5s ease-out;
        }
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default WeatherForecastCard;
