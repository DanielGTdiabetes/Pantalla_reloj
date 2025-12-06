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

  // Robust heuristic mapping
  if (c.includes("despejado") || c.includes("clear") || c.includes("soleado")) return `${baseUrl}Sun.png`;
  if (c.includes("parcial") || c.includes("partly") || c.includes("cloud") && c.includes("sun")) return `${skyUrl}Sun%20Behind%20Cloud.png`;
  if (c.includes("nublado") || c.includes("cloud") || c.includes("cubierto") || c.includes("overcast")) return `${skyUrl}Cloud.png`;
  if (c.includes("lluvia") || c.includes("rain") || c.includes("llovizna") || c.includes("chubasco")) return `${skyUrl}Cloud%20with%20Rain.png`;
  if (c.includes("tormenta") || c.includes("storm") || c.includes("thunder")) return `${skyUrl}Cloud%20with%20Lightning%20and%20Rain.png`;
  if (c.includes("nieve") || c.includes("snow")) return `${skyUrl}Cloud%20with%20Snow.png`;
  if (c.includes("niebla") || c.includes("fog") || c.includes("mist")) return `${skyUrl}Fog.png`;

  return `${baseUrl}Sun.png`; // Fallback
};

const WeatherIcon3D = ({ condition, className }: { condition: string, className?: string }) => {
  const url = get3DIconUrl(condition);
  const [error, setError] = useState(false);

  if (error) {
    // Fallback to simpler or text representation if image fails
    return (
      <div className={`flex items-center justify-center ${className} bg-white/10 rounded-full`}>
        <span className="text-4xl">🌤️</span>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div className="animate-float drop-shadow-2xl filter hover:scale-110 transition-transform duration-500 w-full h-full">
        <img
          src={url}
          alt={condition}
          className="w-full h-full object-contain"
          onError={() => setError(true)}
        />
      </div>
    </div>
  );
};

export const WeatherForecastCard = ({ forecast, unit }: WeatherForecastCardProps): JSX.Element | null => {
  // Use up to 7 days for the carousel
  const days = forecast.slice(0, 7);
  const [currentIndex, setCurrentIndex] = useState(0);
  const ROTATION_INTERVAL = 4000; // 4 seconds per day

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
    <div className="flex h-full w-full flex-col text-white">
      {/* Header Compacto */}
      <div className="p-2 text-center border-b border-white/10 bg-white/5 rounded-t-lg">
        <h2 className="text-sm font-medium uppercase tracking-wider opacity-80">
          Previsión ({currentIndex + 1}/{days.length})
        </h2>
      </div>

      {/* Cuerpo Principal */}
      <div className="flex flex-1 flex-col items-center justify-between p-2" key={currentIndex}>

        {/* Fecha y Día */}
        <div className="text-center animate-fade-in-down mt-1">
          <div className="text-2xl font-bold text-blue-100">
            {currentDay.dayName || currentDay.date}
          </div>
          <div className="text-xs text-blue-200/60">{currentDay.date}</div>
        </div>

        {/* Icono 3D Grande */}
        <div className="flex-1 w-full flex items-center justify-center py-1 min-h-0">
          <WeatherIcon3D condition={currentDay.condition} className="w-24 h-24 md:w-32 md:h-32" />
        </div>

        {/* Temperaturas Grandes */}
        <div className="flex w-full justify-center gap-6 mb-2">
          <div className="flex flex-col items-center">
            <span className="text-3xl font-bold text-red-400">
              {currentDay.temperature.max !== null ? Math.round(currentDay.temperature.max) : "--"}°
            </span>
            <span className="text-[10px] uppercase tracking-widest opacity-60">Max</span>
          </div>
          <div className="w-px bg-white/10 mx-2"></div>
          <div className="flex flex-col items-center">
            <span className="text-3xl font-bold text-blue-400">
              {currentDay.temperature.min !== null ? Math.round(currentDay.temperature.min) : "--"}°
            </span>
            <span className="text-[10px] uppercase tracking-widest opacity-60">Min</span>
          </div>
        </div>

        {/* Footer: Precipitación y Condición */}
        <div className="w-full rounded-lg bg-white/5 p-2 border border-white/5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium capitalize text-gray-200 truncate flex-1 block text-left">
              {currentDay.condition}
            </span>
            {currentDay.precipitation !== null && currentDay.precipitation !== undefined && (
              <div className="flex items-center gap-1 text-blue-300 font-bold bg-blue-500/10 px-2 py-1 rounded-full text-xs whitespace-nowrap">
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
          50% { transform: translateY(-6px); }
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
