import { useState, useEffect } from "react";

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

// Mapeo heurístico a iconos 3D estáticos
const get3DIconUrl = (condition: string): string => {
  const baseUrl = "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/";
  const skyUrl = "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Sky%20and%20weather/";

  const c = (condition || "").toLowerCase();

  if (c.includes("despejado") || c.includes("clear") || c.includes("soleado")) return `${baseUrl}Sun.png`;
  if (c.includes("parcial") || c.includes("partly") || (c.includes("nub") && c.includes("sol"))) return `${skyUrl}Sun%20Behind%20Cloud.png`;
  if (c.includes("lluvia") || c.includes("rain") || c.includes("llovizna")) return `${skyUrl}Cloud%20with%20Rain.png`;
  if (c.includes("tormenta") || c.includes("storm") || c.includes("trueno")) return `${skyUrl}Cloud%20with%20Lightning%20and%20Rain.png`;
  if (c.includes("nieve") || c.includes("snow")) return `${skyUrl}Cloud%20with%20Snow.png`;
  if (c.includes("niebla") || c.includes("fog") || c.includes("mist")) return `${skyUrl}Fog.png`;
  if (c.includes("nublado") || c.includes("cloud") || c.includes("cubierto")) return `${skyUrl}Cloud.png`;

  return `${baseUrl}Sun.png`;
};

const WeatherIcon3D = ({ condition, className }: { condition: string; className?: string }) => {
  const url = get3DIconUrl(condition);
  const [error, setError] = useState(false);

  if (error) {
    return <span className="text-6xl filter drop-shadow-lg">🌤️</span>;
  }

  return (
    <img
      src={url}
      alt={condition}
      className={`${className} object-contain filter drop-shadow-2xl`}
      onError={() => setError(true)}
    />
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

  return (
    <div className="h-full w-full bg-gradient-to-br from-blue-900/40 to-slate-900/60 flex flex-col items-center justify-between p-4 overflow-hidden relative">
      {/* Background Accent */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-cyan-300 opacity-50" />

      {/* Header */}
      <div className="w-full flex justify-between items-center mb-2 z-10 px-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200/80">
          Previsión {days.length > 1 && `(${currentIndex + 1}/${days.length})`}
        </h2>
        <span className="text-xs text-white/50 font-mono">{currentDay.date}</span>
      </div>

      {/* Content Container - Grid for stability */}
      <div className="flex-1 w-full grid grid-rows-[auto_1fr_auto] gap-2 items-center justify-items-center z-10">

        {/* 1. Date Name */}
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight drop-shadow-lg leading-tight uppercase">
            {currentDay.dayName || "Día"}
          </h1>
        </div>

        {/* 2. Icon (Dynamic Float) */}
        <div className="w-full h-full flex items-center justify-center py-2 animate-float-slow">
          <WeatherIcon3D
            condition={currentDay.condition}
            className="h-32 w-32 md:h-40 md:w-40"
          />
        </div>

        {/* 3. Temps & Condition */}
        <div className="w-full flex flex-col items-center gap-3 bg-black/20 p-4 rounded-3xl backdrop-blur-md border border-white/5 shadow-xl">
          {/* Temps Row */}
          <div className="flex items-end gap-6">
            <div className="flex flex-col items-center">
              <span className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-t from-red-100 to-red-400 drop-shadow-sm leading-none">
                {currentDay.temperature.max ? Math.round(currentDay.temperature.max) : "--"}°
              </span>
              <span className="text-[10px] text-red-200/60 uppercase tracking-widest mt-1 font-bold">Máx</span>
            </div>
            <div className="w-px h-10 bg-white/10 mx-2" />
            <div className="flex flex-col items-center">
              <span className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-t from-cyan-100 to-cyan-400 drop-shadow-sm leading-none opacity-90">
                {currentDay.temperature.min ? Math.round(currentDay.temperature.min) : "--"}°
              </span>
              <span className="text-[10px] text-cyan-200/60 uppercase tracking-widest mt-1 font-bold">Mín</span>
            </div>
          </div>

          {/* Condition Text & Rain */}
          <div className="flex items-center gap-3 pt-2 border-t border-white/10 w-full justify-center">
            <span className="text-base font-medium text-blue-50 capitalize truncate max-w-[150px]">
              {currentDay.condition}
            </span>
            {currentDay.precipitation !== null && currentDay.precipitation !== undefined && currentDay.precipitation > 0 && (
              <div className="flex items-center gap-1 bg-blue-500/20 px-2 py-1 rounded-full border border-blue-400/20">
                <span className="text-xs">💧</span>
                <span className="text-xs font-bold text-blue-200">{Math.round(currentDay.precipitation)}%</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
            @keyframes float-slow {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                50% { transform: translateY(-8px) rotate(2deg); }
            }
            .animate-float-slow {
                animation: float-slow 6s ease-in-out infinite;
            }
        `}</style>
    </div>
  );
};

export default WeatherForecastCard;
