import { StandardCard } from "../StandardCard";

type WeatherCardProps = {
  temperatureLabel: string;
  feelsLikeLabel: string | null;
  condition: string | null;
  humidity: number | null;
  wind: number | null;
  rain: number | null;
  unit: string;
  timezone?: string;
};

// 3D Icon Helper
const get3DIconUrl = (condition: string): string => {
  const c = (condition || "").toLowerCase();
  if (c.includes("lluvia") || c.includes("rain") || c.includes("tormenta") || c.includes("nube")) return "/img/icons/3d/cloud-rain.png";
  if (c.includes("noche") || c.includes("night") || c.includes("moon")) return "/img/icons/3d/moon-sleep.png";
  if (c.includes("claro") || c.includes("clear") || c.includes("sol") || c.includes("sunny")) return "/img/icons/3d/sun-smile.png";
  return "/img/icons/3d/sun-smile.png";
};

export const WeatherCard = (props: WeatherCardProps): JSX.Element => {
  const { temperatureLabel, feelsLikeLabel, condition, humidity, wind, rain } = props;

  // Clean temp value
  const tempValue = temperatureLabel.replace(/[^\d-]/g, '');
  const iconUrl = get3DIconUrl(condition || "");

  // Header Icon for Card
  const headerIcon = <img src={iconUrl} className="w-8 h-8 drop-shadow-md animate-bounce-slow" alt="weather" />;

  return (
    <StandardCard
      title="Tiempo Actual"
      subtitle={condition || "Meteorología"}
      icon={headerIcon}
      className="weather-card-root"
    >
      {/* Background Noise */}
      <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

      <div className="flex flex-col h-full justify-between py-6 relative z-10 animate-fade-in-up">

        {/* Top section: Main visual and Temp */}
        <div className="flex items-center justify-center gap-6">
          {/* 3D Main Icon */}
          <div className="relative w-32 h-32 flex items-center justify-center">
            <div className="absolute inset-0 bg-white/20 blur-[60px] rounded-full animate-pulse-slow pointer-events-none scale-110" />
            <img
              src={iconUrl}
              alt={condition || "weather"}
              className="w-full h-full object-contain drop-shadow-2xl animate-float"
            />
          </div>

          {/* Big Temperature */}
          <div className="flex flex-col drop-shadow-lg">
            <span className="text-[5rem] md:text-[6rem] font-black leading-none tracking-tighter text-white">
              {tempValue}°
            </span>
            {feelsLikeLabel && (
              <span className="text-sm font-bold text-white/80 tracking-wide uppercase bg-black/20 px-2 py-0.5 rounded-md self-start">
                Sensación: {feelsLikeLabel.replace(/[^\d-]/g, '')}°
              </span>
            )}
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-auto">
          <div className="bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/5 flex flex-col items-center">
            <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Humedad</span>
            <span className="text-xl font-black text-white">{humidity ?? "--"}%</span>
          </div>
          <div className="bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/5 flex flex-col items-center">
            <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Viento</span>
            <span className="text-xl font-black text-white">{Math.round(wind ?? 0)} <small className="text-sm font-bold">km/h</small></span>
          </div>
          <div className="bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/5 flex flex-col items-center col-span-2 md:col-span-1">
            <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Lluvia</span>
            <span className="text-xl font-black text-white">{rain ? rain.toFixed(1) : "0"} <small className="text-sm font-bold">mm</small></span>
          </div>
        </div>
      </div>

      <style>{`
            .weather-card-root {
               background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%) !important;
               color: white !important; 
            }
            @keyframes float {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                50% { transform: translateY(-10px) rotate(2deg); }
            }
            .animate-float {
                animation: float 6s ease-in-out infinite;
            }
            .animate-fade-in-up {
                animation: fadeInUp 0.5s ease-out forwards;
            }
            @keyframes fadeInUp {
                 from { opacity: 0; transform: translateY(10px); }
                 to { opacity: 1; transform: translateY(0); }
            }
        `}</style>
    </StandardCard>
  );
};

export default WeatherCard;
