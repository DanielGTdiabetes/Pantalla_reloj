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

  return (
    <StandardCard
      title="Astronomía"
      subtitle={currentState === "sunrise" ? "Amanecer" : currentState === "sunset" ? "Anochecer" : "Luna"}
      icon={<div className="text-2xl">✨</div>}
      className="relative overflow-hidden group"
    >
      {/* Generated "Nano Banana" Background */}
      <div className="absolute inset-0 z-0">
        <img
          src="/img/panels/astro-bg.png"
          alt="Space Background"
          className="w-full h-full object-cover opacity-60 scale-110 blur-[2px] transition-transform duration-[20s] ease-linear group-hover:scale-125 group-hover:rotate-1"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/60" />
      </div>

      <div className="flex flex-col items-center justify-center gap-6 animate-fade-in-up">

        {/* Animated Icon Container */}
        <div className="relative w-32 h-32 flex items-center justify-center">
          {/* Glow backing */}
          <div className={`absolute inset-0 blur-2xl rounded-full opacity-30 ${currentState === "sunrise" ? "bg-amber-500" :
            currentState === "sunset" ? "bg-orange-600" : "bg-blue-300"
            } transition-colors duration-1000`} />

          {currentState === "sunrise" && (
            <SunriseIcon className="w-24 h-24 text-amber-300 drop-shadow-[0_0_15px_rgba(251,191,36,0.6)] animate-pulse-slow" />
          )}
          {currentState === "sunset" && (
            <SunsetIcon className="w-24 h-24 text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.6)] animate-pulse-slow" />
          )}
          {currentState === "moon" && (
            <MoonIcon
              phase={moonPhase || "Full Moon"}
              className="w-24 h-24 text-gray-100 drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]"
            />
          )}
        </div>

        {/* Info Text */}
        <div className="flex flex-col items-center gap-1 transition-all duration-500">
          <span className="text-4xl md:text-5xl font-black text-white tracking-widest drop-shadow-xl">
            {currentState === "sunrise" ? (sunrise ?? "--:--") :
              currentState === "sunset" ? (sunset ?? "--:--") :
                moonPhase ?? "Luna"}
          </span>

          {currentState === "moon" && illuminationPercent !== null && (
            <span className="text-lg text-blue-200 font-medium tracking-widest uppercase">
              {illuminationPercent}% Iluminación
            </span>
          )}

          {(currentState === "sunrise" || currentState === "sunset") && (
            <span className="text-sm text-white/60 font-medium tracking-widest uppercase">
              Hora local
            </span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.9; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 4s ease-in-out infinite;
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
