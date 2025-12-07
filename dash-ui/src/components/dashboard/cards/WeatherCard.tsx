import { useState, useEffect } from "react";

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

const get3DIcon = (condition: string | null): string => {
  const c = (condition || "").toLowerCase();
  if (c.includes("lluvia") || c.includes("rain") || c.includes("tormenta") || c.includes("nube")) {
    return "/img/icons/3d/cloud-rain.png";
  }
  if (c.includes("noche") || c.includes("night") || c.includes("moon")) {
    return "/img/icons/3d/moon-sleep.png";
  }
  return "/img/icons/3d/sun-smile.png";
};

export const WeatherCard = ({
  temperatureLabel,
  feelsLikeLabel,
  condition,
  humidity,
  wind,
  rain
}: WeatherCardProps): JSX.Element => {
  const tempValue = temperatureLabel.replace(/[^\d-]/g, "");
  const iconUrl = get3DIcon(condition);

  return (
    <div className="weather-card-v2">
      <div className="weather-card-v2__header">
        <img src={iconUrl} alt="" className="weather-card-v2__header-icon" />
        <span className="weather-card-v2__title">Tiempo Actual</span>
      </div>

      <div className="weather-card-v2__body">
        <div className="weather-card-v2__main">
          <div className="weather-card-v2__icon-container">
            <img src={iconUrl} alt={condition || "weather"} className="weather-card-v2__main-icon" />
          </div>
          <div className="weather-card-v2__temp-block">
            <span className="weather-card-v2__temp">{tempValue}°</span>
            {feelsLikeLabel && (
              <span className="weather-card-v2__feels">Sensación: {feelsLikeLabel}</span>
            )}
          </div>
        </div>

        <div className="weather-card-v2__condition">{condition || "Sin datos"}</div>

        <div className="weather-card-v2__metrics">
          <div className="weather-card-v2__metric">
            <span className="weather-card-v2__metric-label">Humedad</span>
            <span className="weather-card-v2__metric-value">{humidity ?? "--"}%</span>
          </div>
          <div className="weather-card-v2__metric">
            <span className="weather-card-v2__metric-label">Viento</span>
            <span className="weather-card-v2__metric-value">{wind ?? "--"} km/h</span>
          </div>
          {rain !== null && rain > 0 && (
            <div className="weather-card-v2__metric">
              <span className="weather-card-v2__metric-label">Lluvia</span>
              <span className="weather-card-v2__metric-value">{rain.toFixed(1)} mm</span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .weather-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
        }
        .weather-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .weather-card-v2__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        .weather-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .weather-card-v2__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }
        .weather-card-v2__main {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
        }
        .weather-card-v2__icon-container {
          width: 120px;
          height: 120px;
        }
        .weather-card-v2__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.25));
          animation: float-v2 4s ease-in-out infinite;
        }
        .weather-card-v2__temp-block {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .weather-card-v2__temp {
          font-size: 4rem;
          font-weight: 900;
          line-height: 1;
          color: #0f172a;
          text-shadow: 0 2px 4px rgba(255,255,255,0.6);
        }
        .weather-card-v2__feels {
          font-size: 0.85rem;
          color: #475569;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .weather-card-v2__condition {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: capitalize;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .weather-card-v2__metrics {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          justify-content: center;
          margin-top: 0.5rem;
        }
        .weather-card-v2__metric {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0.4rem 0.6rem;
          background: rgba(0,0,0,0.1);
          border-radius: 0.4rem;
          min-width: 60px;
        }
        .weather-card-v2__metric-label {
          font-size: 0.65rem;
          color: #64748b;
          text-transform: uppercase;
          font-weight: 600;
        }
        .weather-card-v2__metric-value {
          font-size: 1rem;
          font-weight: 700;
          color: #1e293b;
        }
        @keyframes float-v2 {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default WeatherCard;
