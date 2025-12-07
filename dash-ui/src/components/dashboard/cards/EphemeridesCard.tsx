import { useState, useEffect } from "react";

type EphemeridesCardProps = {
  sunrise: string | null;
  sunset: string | null;
  moonPhase: string | null;
  events: string[];
  illumination?: number | null;
};

type AstroState = "sunrise" | "moon" | "sunset";

// Get moon phase icon based on illumination percentage
const getMoonPhaseIcon = (illumination: number | null): string => {
  if (illumination === null || Number.isNaN(illumination)) {
    return "/icons/moon/moon-50.svg";
  }

  // Normalize to 0-1 if percentage
  const illum = illumination > 1 ? illumination / 100 : illumination;
  const normalized = Math.max(0, Math.min(1, illum));

  if (normalized <= 0.12) return "/icons/moon/moon-0.svg";
  if (normalized <= 0.37) return "/icons/moon/moon-25.svg";
  if (normalized <= 0.62) return "/icons/moon/moon-50.svg";
  if (normalized <= 0.87) return "/icons/moon/moon-75.svg";
  return "/icons/moon/moon-100.svg";
};

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
    if (currentState === "moon") {
      return getMoonPhaseIcon(illumination);
    }
    // Sun icons for sunrise/sunset
    if (currentState === "sunset") {
      return "/icons/weather/day/sunset.svg"; // Fall back to sunny if no sunset
    }
    return "/icons/weather/day/sunny.svg";
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

  const iconUrl = getIcon();

  return (
    <div className="ephemerides-card-dark">
      <div className="ephemerides-card-dark__header">
        <img src={iconUrl} alt="" className="ephemerides-card-dark__header-icon" />
        <span className="ephemerides-card-dark__title">Astronomía</span>
      </div>

      <div className="ephemerides-card-dark__body">
        <div className="ephemerides-card-dark__label">{getLabel()}</div>

        <div className="ephemerides-card-dark__icon-container">
          <img
            src={iconUrl}
            alt={getLabel()}
            className={`ephemerides-card-dark__main-icon ${currentState === "sunset" ? "sunset-filter" : ""}`}
          />
        </div>

        <div className="ephemerides-card-dark__value">{getValue()}</div>

        {currentState === "moon" && illuminationPercent !== null && (
          <div className="ephemerides-card-dark__illumination">{illuminationPercent}% iluminación</div>
        )}
      </div>

      <style>{`
        .ephemerides-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #312e81 0%, #0f172a 100%);
          color: white;
        }
        .ephemerides-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .ephemerides-card-dark__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .ephemerides-card-dark__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .ephemerides-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }
        .ephemerides-card-dark__label {
          font-size: 1.1rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          opacity: 0.9;
        }
        .ephemerides-card-dark__icon-container {
          width: 120px;
          height: 120px;
          margin: 0.25rem 0;
        }
        .ephemerides-card-dark__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(255,255,255,0.2));
          animation: float-dark 4s ease-in-out infinite;
        }
        .ephemerides-card-dark__main-icon.sunset-filter {
          filter: drop-shadow(0 4px 12px rgba(255,150,50,0.4)) sepia(0.3) saturate(1.3);
        }
        .ephemerides-card-dark__value {
          font-size: 2.5rem;
          font-weight: 900;
          line-height: 1;
          font-family: monospace;
          text-shadow: 0 2px 10px rgba(0,0,0,0.5);
        }
        .ephemerides-card-dark__illumination {
          font-size: 0.85rem;
          opacity: 0.7;
        }
        @keyframes float-dark {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default EphemeridesCard;
