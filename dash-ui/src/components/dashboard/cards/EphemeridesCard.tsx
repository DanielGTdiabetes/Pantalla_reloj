import { useEffect, useState } from "react";
import { SunriseIcon, SunsetIcon } from "../../icons";
import { MoonIcon } from "../../MoonIcon";
import { StandardCard } from "../StandardCard";

type EphemeridesCardProps = {
  sunrise: string | null;
  sunset: string | null;
  moonPhase: string | null;
  events: string[];
  illumination?: number | null;
};

type AstroState = "sunrise" | "moon" | "sunset";

export const EphemeridesCard = ({ sunrise, sunset, moonPhase, illumination }: EphemeridesCardProps): JSX.Element => {
  const [currentState, setCurrentState] = useState<AstroState>("sunrise");

  useEffect(() => {
    const states: AstroState[] = ["sunrise", "moon", "sunset"];
    let currentIndex = 0;

    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % states.length;
      setCurrentState(states[currentIndex]);
    }, 5000); // 5 seconds per state

    return () => clearInterval(interval);
  }, []);

  const illuminationPercent = illumination !== null && illumination !== undefined
    ? Math.round(illumination > 1 ? illumination : illumination * 100)
    : null;

  const getIconForState = () => {
    switch (currentState) {
      case "sunrise": return <SunriseIcon className="w-8 h-8 text-amber-300 drop-shadow-md" />;
      case "sunset": return <SunsetIcon className="w-8 h-8 text-orange-400 drop-shadow-md" />;
      case "moon": return <img src="/img/icons/3d/moon-sleep.png" className="w-8 h-8 drop-shadow-md animate-bounce-slow" alt="moon" />;
    }
  };

  return (
    <StandardCard
      title="Astronomía"
      subtitle="Ciclos celestes diarios"
      icon={getIconForState()}
      className="ephemerides-card-root relative overflow-hidden"
    >
      {/* Subtle Pattern Overlay */}
      <div className="absolute inset-0 opacity-20 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

      {/* Starry Background Effect */}
      <div className="absolute inset-0 z-0 opacity-40">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent pointer-events-none" />
      </div>

      <div className="flex flex-col items-center justify-between py-4 h-full w-full relative z-10 animate-fade-in-up">

        {/* Floating Header Pill */}
        <div className={`backdrop-blur-md px-4 py-1 rounded-full border shadow-sm mb-2 transition-colors duration-1000 ${currentState === "sunrise" ? "bg-amber-500/20 border-amber-500/30" :
          currentState === "sunset" ? "bg-orange-500/20 border-orange-500/30" :
            "bg-indigo-500/20 border-indigo-500/30"
          }`}>
          <h2 className={`text-lg font-bold uppercase tracking-wider drop-shadow-sm transition-colors duration-1000 ${currentState === "sunrise" ? "text-amber-200" :
            currentState === "sunset" ? "text-orange-200" :
              "text-indigo-200"
            }`}>
            {currentState === "sunrise" ? "Amanecer" : currentState === "sunset" ? "Anochecer" : "Fase Lunar"}
          </h2>
        </div>

        {/* Animated Icon Container */}
        <div className="relative w-full flex-1 flex items-center justify-center min-h-0">
          {/* Glow backing */}
          <div className={`absolute inset-0 blur-[50px] rounded-full opacity-40 transition-colors duration-1000 ${currentState === "sunrise" ? "bg-amber-400" :
            currentState === "sunset" ? "bg-orange-600" :
              "bg-blue-600"
            }`} />

          <div className="relative z-10 transition-all duration-700 transform">
            {currentState === "sunrise" && (
              <img src="/img/icons/3d/sun-smile.png" className="w-auto h-[160px] object-contain drop-shadow-[0_0_25px_rgba(251,191,36,0.6)] animate-pulse-slow" alt="Sunrise" />
            )}
            {currentState === "sunset" && (
              <div className="relative">
                <img src="/img/icons/3d/sun-smile.png" className="w-auto h-[160px] object-contain drop-shadow-[0_0_25px_rgba(251,146,60,0.6)] grayscale-[30%] sepia-[40%] animate-pulse-slow" alt="Sunset" />
                {/* Overlay to darken for sunset look if needed, or just let color grading handle it */}
              </div>
            )}
            {currentState === "moon" && (
              <img src="/img/icons/3d/moon-sleep.png" className="w-auto h-[160px] object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.4)] animate-float" alt="Moon" />
            )}
          </div>
        </div>

        {/* Info Text */}
        <div className="flex flex-col items-center gap-1 transition-all duration-500 mt-4 w-full bg-black/20 p-2 rounded-xl border border-white/5 backdrop-blur-sm">
          <span className="text-4xl md:text-5xl font-black text-white tracking-widest drop-shadow-xl font-mono leading-none">
            {currentState === "sunrise" ? (sunrise ?? "--:--") :
              currentState === "sunset" ? (sunset ?? "--:--") :
                moonPhase ?? "Luna"}
          </span>

          {currentState === "moon" && illuminationPercent !== null && (
            <span className="text-xs text-blue-200 font-bold tracking-widest uppercase bg-blue-900/40 px-2 py-0.5 rounded">
              {illuminationPercent}% Iluminación
            </span>
          )}

          {(currentState === "sunrise" || currentState === "sunset") && (
            <span className="text-xs text-amber-100/60 font-medium tracking-widest uppercase">
              Hora Local
            </span>
          )}
        </div>
      </div>

      <style>{`
        .ephemerides-card-root {
          background: linear-gradient(135deg, #312e81 0%, #0f172a 100%) !important;
          color: white !important;
        }
        .ephemerides-card-root h2,
        .ephemerides-card-root span, 
        .ephemerides-card-root p {
            color: white !important;
            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.95; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 4s ease-in-out infinite;
        }
        @keyframes bounce-slow {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
        }
        .animate-bounce-slow {
            animation: bounce-slow 3s ease-in-out infinite;
        }
        @keyframes float {
           0%, 100% { transform: translateY(0px) rotate(0deg); }
           50% { transform: translateY(-10px) rotate(2deg); }
        }
        .animate-float {
           animation: float 6s ease-in-out infinite;
        }
        .animate-fade-in-up {
            animation: fade-in-up 0.5s ease-out forwards;
        }
        @keyframes fade-in-up {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </StandardCard>
  );
};

export default EphemeridesCard;
