import { useState, useEffect } from "react";

const astroAsset = (path: string) => new URL(`../../../assets/astronomy/${path}`, import.meta.url).href;

const MOON_ICON_MAP: Record<string, string> = {
  new: astroAsset("moon/new.png"),
  "waxing-crescent-1": astroAsset("moon/waxing_crescent-1.png"),
  "first-quarter": astroAsset("moon/first-quarter.png"),
  "waxing-gibbous-1": astroAsset("moon/waxing_gibbous-1.png"),
  full: astroAsset("moon/full.png"),
  "waning-gibbous-1": astroAsset("moon/waning_gibbous-1.png"),
  "last-quarter": astroAsset("moon/last-quarter.png"),
  "waning-crescent-1": astroAsset("moon/waning_crescent-1.png"),
};

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
    return MOON_ICON_MAP.full;
  }

  // Normalize to 0-1 if percentage
  const illum = illumination > 1 ? illumination / 100 : illumination;
  const normalized = Math.max(0, Math.min(1, illum));

  if (normalized <= 0.12) return MOON_ICON_MAP.new;
  if (normalized <= 0.25) return MOON_ICON_MAP["waxing-crescent-1"];
  if (normalized <= 0.37) return MOON_ICON_MAP["first-quarter"];
  if (normalized <= 0.5) return MOON_ICON_MAP["waxing-gibbous-1"];
  if (normalized <= 0.62) return MOON_ICON_MAP.full;
  if (normalized <= 0.75) return MOON_ICON_MAP["waning-gibbous-1"];
  if (normalized <= 0.87) return MOON_ICON_MAP["last-quarter"];
  return MOON_ICON_MAP["waning-crescent-1"];
};

// Panel lateral de astronomía (amanecer, atardecer y luna)
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
      return getMoonPhaseIcon(illumination ?? null);
    }
    // Sun icons for sunrise/sunset
    if (currentState === "sunset") {
      return astroAsset("sunset.png");
    }
    return astroAsset("sunrise.png");
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
    <div className="ephemerides-card-dark" data-testid="panel-astronomy">
      <div className="ephemerides-card-dark__header">
        <img src={iconUrl} alt="" className="ephemerides-card-dark__header-icon panel-title-icon" />
        <span className="ephemerides-card-dark__title panel-title-text">Astronomía</span>
      </div>

      <div className="ephemerides-card-dark__body panel-body">
        <div className="ephemerides-card-dark__label panel-item-title">{getLabel()}</div>

        <div className="ephemerides-card-dark__icon-container">
          <img
            src={iconUrl}
            alt={getLabel()}
            className={`ephemerides-card-dark__main-icon ${currentState === "sunset" ? "sunset-filter" : ""}`}
          />
        </div>

        <div className="ephemerides-card-dark__value panel-item-title">{getValue()}</div>

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
          background: linear-gradient(145deg, rgba(49, 46, 129, 0.75) 0%, rgba(15, 23, 42, 0.85) 100%);
          color: white;
          overflow: hidden;
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 
            0 20px 40px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset 0 10px 20px rgba(0,0,0,0.2);
        }
        .ephemerides-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .ephemerides-card-dark__header-icon {
          width: 52px;
          height: 52px;
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
          width: 124px;
          height: 124px;
          margin: 0.4rem 0;
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
