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
    <div className="ephemerides-card-v2">
      <div className="ephemerides-card-v2__header">
        <img src={getIcon()} alt="" className="ephemerides-card-v2__header-icon" />
        <span className="ephemerides-card-v2__title">Astronomía</span>
      </div>

      <div className="ephemerides-card-v2__body">
        <div className="ephemerides-card-v2__label">{getLabel()}</div>

        <div className="ephemerides-card-v2__icon-container">
          <img
            src={getIcon()}
            alt={getLabel()}
            className={`ephemerides-card-v2__main-icon ${currentState === "sunset" ? "sunset-filter" : ""}`}
          />
        </div>

        <div className="ephemerides-card-v2__value">{getValue()}</div>

        {currentState === "moon" && illuminationPercent !== null && (
          <div className="ephemerides-card-v2__illumination">{illuminationPercent}% iluminación</div>
        )}
      </div>

      <style>{`
        .ephemerides-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
        }
        .ephemerides-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .ephemerides-card-v2__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        .ephemerides-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .ephemerides-card-v2__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }
        .ephemerides-card-v2__label {
          font-size: 1.1rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #334155;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .ephemerides-card-v2__icon-container {
          width: 120px;
          height: 120px;
          margin: 0.25rem 0;
        }
        .ephemerides-card-v2__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.25));
          animation: float-v2 4s ease-in-out infinite;
        }
        .ephemerides-card-v2__main-icon.sunset-filter {
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.25)) sepia(0.3) saturate(1.3);
        }
        .ephemerides-card-v2__value {
          font-size: 2.5rem;
          font-weight: 900;
          line-height: 1;
          font-family: monospace;
          color: #0f172a;
          text-shadow: 0 2px 4px rgba(255,255,255,0.6);
        }
        .ephemerides-card-v2__illumination {
          font-size: 0.85rem;
          color: #475569;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        @keyframes float-v2 {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default EphemeridesCard;
