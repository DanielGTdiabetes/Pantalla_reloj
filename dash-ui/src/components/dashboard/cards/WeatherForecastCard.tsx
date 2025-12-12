import { useState, useEffect, useMemo } from "react";
import { formatWeatherKindLabel, resolveWeatherKind, sanitizeWeatherCondition } from "../../../utils/weather";
import type { WeatherKind } from "../../../types/weather";
import { WeatherIcon } from "../../weather/WeatherIcon";
import { getPanelTimeOfDay, getWeatherBackgroundClass } from "../../../theme/panelTheme";

type ForecastDay = {
  date: string;
  dayName?: string;
  condition: string;
  pictocode?: number | null;
  kind?: WeatherKind;
  temperature: {
    min: number | null;
    max: number | null;
  };
  precipitation?: number | null;
  icon?: string;
};

type WeatherForecastCardProps = {
  forecast: ForecastDay[];
  unit: string;
};

// Panel lateral de predicción meteorológica
export const WeatherForecastCard = ({ forecast }: WeatherForecastCardProps): JSX.Element | null => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const days = useMemo(() => {
    return forecast
      .filter(d => d.date)
      .slice(0, 7)
      .map((day) => {
        const averageTemp = [day.temperature.min, day.temperature.max]
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
          .reduce((acc, value, _, arr) => acc + value / arr.length, 0);

        const kind = day.kind || resolveWeatherKind({
          symbol: day.pictocode,
          condition: day.condition,
          precipitation: typeof day.precipitation === "number" ? day.precipitation : null,
          icon: day.icon ?? null,
        });

        return {
          ...day,
          kind,
          condition: sanitizeWeatherCondition(day.condition, averageTemp || null)
        };
      });
  }, [forecast]);

  useEffect(() => {
    if (days.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % days.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [days.length]);

  const day = days[currentIndex];
  if (!day) return null;

  const now = new Date();
  const backgroundClass = getWeatherBackgroundClass(day.kind, getPanelTimeOfDay(now));

  return (
    <div className={`forecast-card-dark ${backgroundClass}`} data-testid="panel-weather-forecast">
      <div className="forecast-card-dark__header">
        <div className="forecast-card-dark__header-icon panel-title-icon">
          <WeatherIcon kind={day.kind || "unknown"} size={44} />
        </div>
        <span className="forecast-card-dark__title panel-title-text">Tiempo 7 Días</span>
      </div>

      <div className="forecast-card-dark__body panel-body">
        <div className="forecast-card-dark__top-info">
          <span className="forecast-card-dark__dayname panel-item-title">{day.dayName || "Hoy"}</span>
          <span className="forecast-card-dark__condition-inline">{formatWeatherKindLabel(day.kind || "unknown", day.condition)}</span>
        </div>

        <div className="forecast-card-dark__main-content">
          <div className="forecast-card-dark__icon-container">
            <WeatherIcon kind={day.kind || "unknown"} size={110} className="forecast-card-dark__main-icon" />
          </div>

          <div className="forecast-card-dark__temps">
            <div className="forecast-card-dark__max-container">
              <span className="forecast-card-dark__max panel-item-title">
                {day.temperature.max !== null ? Math.round(day.temperature.max) : "--"}°
              </span>
              <small>MÁX</small>
            </div>
            <div className="forecast-card-dark__min-container">
              <span className="forecast-card-dark__min panel-item-subtitle">
                {day.temperature.min !== null ? Math.round(day.temperature.min) : "--"}°
              </span>
              <small>MÍN</small>
            </div>
          </div>
        </div>

        {days.length > 1 && (
          <div className="forecast-card-dark__dots">
            {days.map((_, idx) => (
              <span key={idx} className={`forecast-card-dark__dot ${idx === currentIndex ? "active" : ""}`} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .forecast-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 
            0 20px 40px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset 0 10px 20px rgba(0,0,0,0.2);
        }
        .forecast-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.25rem;
          flex-shrink: 0;
        }
        .forecast-card-dark__header-icon {
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          background: rgba(255,255,255,0.08);
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14);
        }
        .forecast-card-dark__title {
          font-size: 1.1rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .forecast-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          gap: 0.25rem;
        }
        .forecast-card-dark__top-info {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex-shrink: 0;
          margin-bottom: 0.25rem;
        }
        .forecast-card-dark__dayname {
          font-size: 1.8rem;
          font-weight: 800;
          text-transform: capitalize;
          text-shadow: 0 2px 8px rgba(0,0,0,0.5);
          line-height: 1.1;
        }
        .forecast-card-dark__condition-inline {
          font-size: 1rem;
          font-weight: 600;
          text-transform: capitalize;
          color: rgba(255, 255, 255, 0.9);
          text-align: center;
        }
        .forecast-card-dark__main-content {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-evenly;
          gap: 0.5rem;
        }
        .forecast-card-dark__icon-container {
          width: 110px;
          height: 110px;
          filter: drop-shadow(0 8px 24px rgba(0,0,0,0.3));
        }
        .forecast-card-dark__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          animation: float-dark 4s ease-in-out infinite;
        }
        .forecast-card-dark__temps {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.5rem;
          min-width: 80px;
        }
        .forecast-card-dark__max-container,
        .forecast-card-dark__min-container {
          display: flex;
          flex-direction: column;
          align-items: flex-end; /* Align numbers to right or center */
        }
        .forecast-card-dark__max,
        .forecast-card-dark__min {
          font-size: 3rem;
          font-weight: 800;
          line-height: 0.9;
        }
        .forecast-card-dark__max-container small,
        .forecast-card-dark__min-container small {
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          opacity: 0.6;
          margin-top: 0.1rem;
        }
        .forecast-card-dark__max { color: #fbbf24; }
        .forecast-card-dark__min { color: #38bdf8; }
        .forecast-card-dark__condition-inline {
          font-size: 1.1rem;
          font-weight: 600;
          text-transform: capitalize;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 0.2rem;
          text-align: center;
        }
        .forecast-card-dark__dots {
          display: flex;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .forecast-card-dark__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .forecast-card-dark__dot.active {
          background: white;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes float-dark {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default WeatherForecastCard;
