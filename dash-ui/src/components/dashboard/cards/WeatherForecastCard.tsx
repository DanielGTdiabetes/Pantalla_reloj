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
  if (c.includes("lluvia") || c.includes("rain") || c.includes("llovizna") || c.includes("chubasco")) return `${skyUrl}Cloud%20with%20Rain.png`;
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
      className={`${className} object-contain filter drop-shadow-2xl will-change-transform`}
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
    <div className="h-full w-full bg-gradient-to-br from-blue-950 to-slate-900 flex flex-col items-center justify-between p-4 overflow-hidden relative border border-white/5 rounded-3xl shadow-2xl">
      {/* Background Accent - Aurora effect */}
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-purple-500/20 blur-3xl rounded-full pointer-events-none" />
      <div className="absolute top-20 -left-10 w-40 h-40 bg-blue-500/10 blur-3xl rounded-full pointer-events-none" />

      {/* Header */}
      <div className="w-full flex justify-between items-start z-10">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200/60">
          Previsión Semanal
        </h2>
      </div>

      {/* Content Container - Flex layout for better distribution */}
      <div className="flex-1 w-full flex flex-col items-center justify-center gap-2 z-10 mt-1">

        {/* 1. Date & Day Name */}
        <div className="text-center flex flex-col items-center">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-black text-white tracking-wide drop-shadow-lg leading-none uppercase">
            {currentDay.dayName || "Día"}
          </h1>
          <span className="text-lg md:text-xl text-cyan-100/80 font-medium mt-1 tracking-wider">
            {currentDay.date}
          </span>
        </div>

        {/* 2. Icon (Dynamic Float) */}
        <div className="relative flex-1 w-full flex items-center justify-center min-h-[100px] animate-float-slow">
          <WeatherIcon3D
            condition={currentDay.condition}
            className="h-28 w-28 md:h-36 md:w-36 drop-shadow-2xl"
          />
        </div>

        {/* 3. Temps & Condition */}
        <div className="w-full flex items-center justify-between bg-white/5 p-3 rounded-2xl backdrop-blur-sm border border-white/10 shadow-lg mt-auto">

          {/* Temps */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center">
              <span className="text-3xl font-bold text-red-300 drop-shadow-sm leading-none">
                {currentDay.temperature.max ? Math.round(currentDay.temperature.max) : "--"}°
              </span>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="flex flex-col items-center">
              <span className="text-3xl font-bold text-cyan-300 drop-shadow-sm leading-none">
                {currentDay.temperature.min ? Math.round(currentDay.temperature.min) : "--"}°
              </span>
            </div>
          </div>

          {/* Condition Text */}
          <div className="flex flex-col items-end text-right max-w-[120px]">
            <span className="text-xs md:text-sm font-medium text-white/90 capitalize leading-tight">
              {currentDay.condition}
            </span>
            {currentDay.precipitation !== null && currentDay.precipitation !== undefined && currentDay.precipitation > 0 && (
              <div className="flex items-center gap-1 mt-1 text-blue-300">
                <span className="text-xs">💧</span>
                <span className="text-xs font-bold">{Math.round(currentDay.precipitation)}%</span>
              </div>
            )}
          </div>

        </div>
      </div>

      <style>{`
            @keyframes float-slow {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                50% { transform: translateY(-6px) rotate(1deg); }
            }
            .animate-float-slow {
                animation: float-slow 5s ease-in-out infinite;
            }
        `}</style>
    </div>
  );
};

export default WeatherForecastCard;
