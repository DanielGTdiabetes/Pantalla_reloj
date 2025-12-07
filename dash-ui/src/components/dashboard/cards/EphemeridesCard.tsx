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

// Professional SVG Icons
const Icons = {
  Sunrise: () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      <path d="M12 2v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="M20 12h2" />
      <path d="m19.07 4.93-1.41 1.41" />
      <path d="M15.91 11.63c1.3 2.24-1.4 4.86-3.82 3.6a2.79 2.79 0 0 1 0-4.8c2.42-1.26 5.12 1.37 3.82 3.59z" />
      <path d="M2 12h2" />
      <path d="M22 22H2" />
      <path d="m8 6 4-4 4 4" />
      <path d="M16 18a4 4 0 0 0-8 0" />
    </svg>
  ),
  Sunset: () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      <path d="M12 10V2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="M20 12h2" />
      <path d="m19.07 4.93-1.41 1.41" />
      <path d="M22 22H2" />
      <path d="m16 6-4 4-4-4" />
      <path d="M16 18a4 4 0 0 0-8 0" />
    </svg>
  ),
  Moon: () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="w-full h-full">
      <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" />
    </svg>
  )
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
      case "sunrise": return <div className="w-8 h-8 text-amber-300 drop-shadow-md"><Icons.Sunrise /></div>;
      case "sunset": return <div className="w-8 h-8 text-orange-400 drop-shadow-md"><Icons.Sunset /></div>;
      case "moon": return <div className="w-8 h-8 text-blue-200 drop-shadow-md"><Icons.Moon /></div>;
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

          <div className="relative z-10 transition-all duration-700 transform flex items-center justify-center">
            {currentState === "sunrise" && (
              <div className="w-[120px] h-[120px] text-amber-300 drop-shadow-[0_0_25px_rgba(251,191,36,0.6)] animate-pulse-slow">
                <Icons.Sunrise />
              </div>
            )}
            {currentState === "sunset" && (
              <div className="w-[120px] h-[120px] text-orange-400 drop-shadow-[0_0_25px_rgba(251,146,60,0.6)] animate-pulse-slow">
                <Icons.Sunset />
              </div>
            )}
            {currentState === "moon" && (
              <div className="w-[100px] h-[100px] text-blue-100 drop-shadow-[0_0_30px_rgba(255,255,255,0.4)] animate-float">
                <Icons.Moon />
              </div>
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
