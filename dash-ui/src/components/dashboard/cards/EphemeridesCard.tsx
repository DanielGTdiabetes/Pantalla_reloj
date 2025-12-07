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

// Professional SVG Icons - Not used in favor of 3D images
const Icons = {
  // Keeping structure but not using them
};

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
      case "sunrise": return <img src="/img/icons/3d/sun-smile.png" className="w-8 h-8 drop-shadow-md animate-bounce-slow" alt="sunrise" />;
      case "sunset": return <img src="/img/icons/3d/sun-smile.png" className="w-8 h-8 drop-shadow-md animate-bounce-slow grayscale opacity-80" alt="sunset" />;
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
      /* Dynamic background based on state */
      <div className={`absolute inset-0 transition-colors duration-1000 ${currentState === "sunrise" ? "bg-gradient-to-br from-indigo-900 to-amber-900/40" :
          currentState === "sunset" ? "bg-gradient-to-br from-indigo-900 to-orange-900/40" :
            "bg-gradient-to-br from-slate-900 to-indigo-950"
        }`} />

      {/* Subtle Pattern Overlay */}
      <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

      <div className="flex flex-col items-center justify-between py-4 h-full w-full relative z-10 animate-fade-in-up">

        {/* Floating Header Pill */}
        <div className={`backdrop-blur-md px-4 py-1 rounded-full border shadow-sm mb-2 transition-all duration-1000 ${currentState === "sunrise" ? "bg-amber-500/10 border-amber-500/20" :
            currentState === "sunset" ? "bg-orange-500/10 border-orange-500/20" :
              "bg-indigo-500/10 border-indigo-500/20"
          }`}>
          <h2 className={`text-xl font-bold uppercase tracking-wider drop-shadow-sm transition-colors duration-1000 ${currentState === "sunrise" ? "text-amber-300" :
              currentState === "sunset" ? "text-orange-300" :
                "text-indigo-300"
            }`}>
            {currentState === "sunrise" ? "Amanecer" : currentState === "sunset" ? "Atardecer" : "Luna"}
          </h2>
        </div>

        {/* Animated Icon Container */}
        <div className="relative w-full flex-1 flex items-center justify-center min-h-0">
          {/* Main Glow */}
          <div className={`absolute w-40 h-40 blur-[80px] rounded-full opacity-30 transition-colors duration-1000 ${currentState === "sunrise" ? "bg-amber-400" :
              currentState === "sunset" ? "bg-orange-500" :
                "bg-indigo-400"
            }`} />

          <div className="relative z-10 transition-all duration-700 transform flex items-center justify-center">
            {currentState === "sunrise" && (
              <img src="/img/icons/3d/sun-smile.png" className="w-auto h-[180px] object-contain drop-shadow-2xl animate-float" alt="Sunrise" />
            )}
            {currentState === "sunset" && (
              <div className="relative">
                <img src="/img/icons/3d/sun-smile.png" className="w-auto h-[180px] object-contain drop-shadow-2xl grayscale-[30%] sepia-[60%] animate-float" alt="Sunset" />
              </div>
            )}
            {currentState === "moon" && (
              <img src="/img/icons/3d/moon-sleep.png" className="w-auto h-[180px] object-contain drop-shadow-2xl animate-float" alt="Moon" />
            )}
          </div>
        </div>

        {/* Info Text */}
        <div className="flex flex-col items-center gap-2 mt-4 w-full px-4">
          {/* Time Display */}
          <span className="text-[4.5rem] md:text-[5.5rem] font-black tracking-tighter drop-shadow-lg font-mono leading-none text-white">
            {currentState === "sunrise" ? (sunrise ?? "--:--") :
              currentState === "sunset" ? (sunset ?? "--:--") :
                moonPhase ?? "Luna"}
          </span>

          {currentState === "moon" && illuminationPercent !== null && (
            <div className="flex items-center gap-2 bg-indigo-950/50 px-3 py-1 rounded-full border border-indigo-500/30">
              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-sm text-indigo-200 font-bold tracking-widest uppercase">
                {illuminationPercent}% Iluminación
              </span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .ephemerides-card-root {
          /* Fallback background if gradients fail to render */
          background-color: #0f172a !important; 
          color: white !important;
        }
        @keyframes float {
           0%, 100% { transform: translateY(0px); }
           50% { transform: translateY(-8px); }
        }
        .animate-float {
           animation: float 5s ease-in-out infinite;
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
