import { useEffect, useState } from "react";
import { SunriseIcon, SunsetIcon } from "../../icons";
import { MoonIcon } from "../../MoonIcon";

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
    <div className="card ephemerides-card ephemerides-card-enhanced">
      <div className="ephemerides-carousel">
        {currentState === "sunrise" && (
          <div className="astro-slide fade-in">
            <SunriseIcon className="astro-icon-large" style={{ color: "var(--theme-accent)" }} aria-hidden="true" />
            <div className="astro-info">
              <span className="astro-label">Amanecer</span>
              <span className="astro-time">{sunrise ?? "--:--"}</span>
            </div>
          </div>
        )}

        {currentState === "moon" && (
          <div className="astro-slide fade-in">
            <MoonIcon
              phase={moonPhase || "Full Moon"}
              className="astro-icon-large"
              style={{ color: "#f0f0f0" }}
            />
            <div className="astro-info">
              <span className="astro-label">{moonPhase ?? "Luna"}</span>
              {illuminationPercent !== null && (
                <span className="astro-sublabel">{illuminationPercent}% ilum.</span>
              )}
            </div>
          </div>
        )}

        {currentState === "sunset" && (
          <div className="astro-slide fade-in">
            <SunsetIcon className="astro-icon-large" style={{ color: "var(--theme-accent-secondary)" }} aria-hidden="true" />
            <div className="astro-info">
              <span className="astro-label">Anochecer</span>
              <span className="astro-time">{sunset ?? "--:--"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EphemeridesCard;
