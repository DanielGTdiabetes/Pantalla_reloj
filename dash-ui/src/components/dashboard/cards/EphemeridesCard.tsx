import { useState, useEffect } from "react";

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
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % states.length;
      setCurrentState(states[idx]);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const illuminationPercent = illumination !== null && illumination !== undefined
    ? Math.round(illumination > 1 ? illumination : illumination * 100)
    : null;

  const getIcon = () => {
    if (currentState === "moon") return "/img/icons/3d/moon-sleep.png";
    return "/img/icons/3d/sun-smile.png";
  };

  const getLabel = () => {
    if (currentState === "sunrise") return "Amanecer";
    if (currentState === "sunset") return "Atardecer";
    return "Luna";
  };

  const getValue = () => {
    if (currentState === "sunrise") return sunrise || "--:--";
    if (currentState === "sunset") return sunset || "--:--";
    return moonPhase || "Luna";
  };

  return (
    <div className="ephemerides-card-3d">
      <div className="ephemerides-card-3d__header">
        <img src={getIcon()} alt="" className="ephemerides-card-3d__header-icon" />
        <span>Astronomía</span>
      </div>

      <div className="ephemerides-card-3d__label">{getLabel()}</div>

      <div className="ephemerides-card-3d__icon-container">
        <img
          src={getIcon()}
          alt={getLabel()}
          className={`ephemerides-card-3d__main-icon ${currentState === "sunset" ? "sunset-filter" : ""}`}
        />
      </div>

      <div className="ephemerides-card-3d__value">{getValue()}</div>

      {currentState === "moon" && illuminationPercent !== null && (
        <div className="ephemerides-card-3d__illumination">{illuminationPercent}% iluminación</div>
      )}

      <style>{`
        .ephemerides-card-3d {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          text-align: center;
          gap: 0.25rem;
        }
        .ephemerides-card-3d__header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.85rem;
          font-weight: 600;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .ephemerides-card-3d__header-icon {
          width: 20px;
          height: 20px;
          object-fit: contain;
        }
        .ephemerides-card-3d__label {
          font-size: 1rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          opacity: 0.9;
        }
        .ephemerides-card-3d__icon-container {
          width: 90px;
          height: 90px;
          margin: 0.5rem 0;
        }
        .ephemerides-card-3d__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(255,200,100,0.4));
          animation: float3d 4s ease-in-out infinite;
        }
        .ephemerides-card-3d__main-icon.sunset-filter {
          filter: drop-shadow(0 4px 12px rgba(255,150,50,0.5)) sepia(0.3) saturate(1.2);
        }
        .ephemerides-card-3d__value {
          font-size: 2.5rem;
          font-weight: 900;
          line-height: 1;
          font-family: monospace;
        }
        .ephemerides-card-3d__illumination {
          font-size: 0.8rem;
          opacity: 0.7;
          margin-top: 0.25rem;
        }
        @keyframes float3d {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default EphemeridesCard;
