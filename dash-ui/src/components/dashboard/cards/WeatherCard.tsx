import { useMemo } from "react";
import { formatWeatherKindLabel, sanitizeWeatherCondition } from "../../../utils/weather";
import type { WeatherKind } from "../../../types/weather";
import { WeatherIcon } from "../../weather/WeatherIcon";
import { getPanelTimeOfDay, getWeatherBackgroundClass } from "../../../theme/panelTheme";

type WeatherCardProps = {
  temperatureLabel: string;
  feelsLikeLabel: string | null;
  condition: string | null;
  kind?: WeatherKind;
  humidity: number | null;
  wind: number | null;
  rain: number | null;
  unit: string;
  timezone?: string;
};

// Panel lateral de tiempo actual
export const WeatherCard = ({
  temperatureLabel,
  feelsLikeLabel,
  condition,
  kind,
  humidity,
  wind,
  rain
}: WeatherCardProps): JSX.Element => {
  const tempValue = temperatureLabel.replace(/[^\d.-]/g, "");
  const numericTemp = Number.isFinite(Number(tempValue)) ? Number(tempValue) : null;
  const normalizedCondition = useMemo(
    () => sanitizeWeatherCondition(condition, numericTemp),
    [condition, numericTemp]
  );
  const now = new Date();
  const timeOfDay = getPanelTimeOfDay(now);
  const backgroundClass = getWeatherBackgroundClass(kind, timeOfDay);
  const label = formatWeatherKindLabel(kind || "unknown", normalizedCondition);

  return (
    <div className={`weather-card-dark ${backgroundClass}`} data-testid="panel-weather-current">
      <div className="weather-card-dark__header">
        <div className="weather-card-dark__header-icon panel-title-icon">
          <WeatherIcon kind={kind || "unknown"} size={48} />
        </div>
        <span className="weather-card-dark__title panel-title-text">Tiempo para hoy</span>
      </div>

      <div className="weather-card-dark__body panel-body">
        <div className="weather-card-dark__main">
          <div className="weather-card-dark__icon-container">
            <WeatherIcon kind={kind || "unknown"} size={110} className="weather-card-dark__main-icon" />
          </div>
          <div className="weather-card-dark__temp-block">
            <span className="weather-card-dark__temp panel-item-title">{tempValue}°</span>
            {feelsLikeLabel && (
              <span className="weather-card-dark__feels panel-item-subtitle">Sensación: {feelsLikeLabel}</span>
            )}
          </div>
        </div>

        <div className="weather-card-dark__condition panel-item-title">{label}</div>

        <div className="weather-card-dark__metrics">
          <div className="weather-card-dark__metric">
            <span className="weather-card-dark__metric-label">Humedad</span>
            <span className="weather-card-dark__metric-value">{humidity ?? "--"}%</span>
          </div>
          <div className="weather-card-dark__metric">
            <span className="weather-card-dark__metric-label">Viento</span>
            <span className="weather-card-dark__metric-value">{wind ?? "--"} km/h</span>
          </div>
          {rain !== null && rain > 0 && (
            <div className="weather-card-dark__metric">
              <span className="weather-card-dark__metric-label">Lluvia</span>
              <span className="weather-card-dark__metric-value">{rain.toFixed(1)} mm</span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .weather-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          border-radius: 1.5rem;
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 
            0 20px 40px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset 0 10px 20px rgba(0,0,0,0.2);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
        .weather-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.25rem;
        }
        .weather-card-dark__header-icon {
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          background: rgba(255,255,255,0.08);
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.14);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
        }
        .weather-card-dark__title {
          font-size: 1.4rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }
        .weather-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          padding: 0.35rem 0.5rem;
        }
        .weather-card-dark__main {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
        }
        .weather-card-dark__icon-container {
          width: 110px;
          height: 110px;
          filter: drop-shadow(0 10px 28px rgba(0,0,0,0.35));
        }
        .weather-card-dark__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
          animation: float-dark 4s ease-in-out infinite;
        }
        .weather-card-dark__temp-block {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .weather-card-dark__temp {
          font-size: 3.6rem;
          font-weight: 900;
          line-height: 1;
          text-shadow: 0 2px 10px rgba(0,0,0,0.5);
        }
        .weather-card-dark__feels {
          font-size: 0.85rem;
          opacity: 0.7;
        }
        .weather-card-dark__condition {
          font-size: 1.2rem;
          font-weight: 700;
          text-transform: capitalize;
          text-align: center;
          text-shadow: 0 6px 20px rgba(0,0,0,0.28);
        }
        .weather-card-dark__metrics {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          justify-content: center;
          margin-top: 0.5rem;
        }
        .weather-card-dark__metric {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0.4rem 0.6rem;
          background: rgba(255,255,255,0.1);
          border-radius: 0.4rem;
          min-width: 60px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .weather-card-dark__metric-label {
          font-size: 0.7rem;
          opacity: 0.75;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        .weather-card-dark__metric-value {
          font-size: 1.05rem;
          font-weight: 800;
        }
        @keyframes float-dark {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default WeatherCard;
