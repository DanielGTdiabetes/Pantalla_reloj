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
      {/* Header Compacto - Fixed Height */}
      <div className="flex-none p-3 text-center border-b border-white/10 bg-white/5 rounded-t-lg backdrop-blur-sm z-20">
        <h2 className="text-sm font-bold uppercase tracking-widest opacity-90 shadow-sm">
          Previsión ({currentIndex + 1}/{days.length})
        </h2>
      </div>

      {/* Cuerpo Principal - Flex Grow to fill space */}
      <div className="flex flex-1 flex-col items-center justify-between p-4 w-full h-full min-h-0 relative z-10" key={currentIndex}>

        {/* Fecha y Día - Top aligned but centered */}
        <div className="flex-none text-center animate-fade-in-down mb-2">
          <div className="text-3xl font-black text-white drop-shadow-md">
            {currentDay.dayName || currentDay.date}
          </div>
          <div className="text-sm font-medium text-blue-200 uppercase tracking-wider opacity-80 mt-1">
            {currentDay.date}
          </div>
        </div>

        {/* Icono 3D Grande - Centered and allowed to grow */}
        <div className="flex-1 w-full flex items-center justify-center min-h-0 py-2">
          <WeatherIcon3D
            condition={currentDay.condition}
            className="w-48 h-48 md:w-56 md:h-56 filter drop-shadow-[0_15px_25px_rgba(0,0,0,0.6)] animate-float"
          />
        </div>

        {/* Temperaturas Grandes - Distinct block */}
        <div className="flex-none flex w-full justify-center items-center gap-8 mb-4 bg-black/20 rounded-2xl p-3 backdrop-blur-sm border border-white/5 mx-auto max-w-[90%]">
          <div className="flex flex-col items-center">
            <span className="text-4xl md:text-5xl font-black text-red-400 drop-shadow-sm">
              {currentDay.temperature.max !== null ? Math.round(currentDay.temperature.max) : "--"}°
            </span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-red-200/70">Max</span>
          </div>
          <div className="h-12 w-px bg-white/20"></div>
          <div className="flex flex-col items-center">
            <span className="text-4xl md:text-5xl font-black text-blue-400 drop-shadow-sm">
              {currentDay.temperature.min !== null ? Math.round(currentDay.temperature.min) : "--"}°
            </span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-blue-200/70">Min</span>
          </div>
        </div>

        {/* Footer: Precipitación y Condición - Bottom aligned */}
        <div className="flex-none w-full">
          <div className="w-full rounded-xl bg-white/10 p-3 border border-white/10 backdrop-blur-md shadow-lg flex items-center justify-between gap-3">
            <span className="text-base font-bold capitalize text-white truncate flex-1 block text-left pl-1">
              {currentDay.condition}
            </span>
            {currentDay.precipitation !== null && currentDay.precipitation !== undefined && (
              <div className="flex items-center gap-1.5 text-blue-100 font-bold bg-blue-500/30 px-3 py-1.5 rounded-lg text-sm border border-blue-400/30 shadow-inner">
                <span className="text-blue-300">💧</span>
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
