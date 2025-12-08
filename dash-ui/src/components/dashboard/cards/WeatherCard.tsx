import { useMemo } from "react";
import { resolveWeatherIcon, sanitizeWeatherCondition } from "../../../utils/weather";

type WeatherCardProps = {
  temperatureLabel: string;
  feelsLikeLabel: string | null;
  condition: string | null;
  humidity: number | null;
  wind: number | null;
  rain: number | null;
  unit: string;
  timezone?: string;
};

export const WeatherCard = ({
  temperatureLabel,
  feelsLikeLabel,
  condition,
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
  const isNight = now.getHours() < 6 || now.getHours() >= 21;
  const iconUrl = resolveWeatherIcon(normalizedCondition, { isNight });

  return (
    <div className="weather-card-dark">
      <div className="weather-card-dark__header">
        <img src={iconUrl} alt="" className="weather-card-dark__header-icon" />
        <span className="weather-card-dark__title">Tiempo Actual</span>
      </div>

      <div className="weather-card-dark__body">
        <div className="weather-card-dark__main">
          <div className="weather-card-dark__icon-container">
            <img src={iconUrl} alt={normalizedCondition || "weather"} className="weather-card-dark__main-icon" />
          </div>
          <div className="weather-card-dark__temp-block">
            <span className="weather-card-dark__temp">{tempValue}°</span>
            {feelsLikeLabel && (
              <span className="weather-card-dark__feels">Sensación: {feelsLikeLabel}</span>
            )}
          </div>
        </div>

        <div className="weather-card-dark__condition">{normalizedCondition || "Sin datos"}</div>

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
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #0c4a6e 0%, #0f172a 100%);
          color: white;
        }
        .weather-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.25rem;
        }
        .weather-card-dark__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
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
          padding: 0.25rem 0.5rem;
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
