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
    <div className="weather-card-3d">
      <div className="weather-card-3d__header">
        <img src={iconUrl} alt="" className="weather-card-3d__header-icon" />
        <span>Tiempo Actual</span>
      </div>

      <div className="weather-card-3d__main">
        <div className="weather-card-3d__icon-container">
          <img src={iconUrl} alt={condition || "weather"} className="weather-card-3d__main-icon" />
        </div>
        <div className="weather-card-3d__temp-block">
          <span className="weather-card-3d__temp">{tempValue}°</span>
          {feelsLikeLabel && (
            <span className="weather-card-3d__feels">Sensación: {feelsLikeLabel}</span>
          )}
        </div>
      </div>

      <div className="weather-card-3d__condition">{condition || "Sin datos"}</div>

      <div className="weather-card-3d__metrics">
        <div className="weather-card-3d__metric">
          <span className="weather-card-3d__metric-label">Humedad</span>
          <span className="weather-card-3d__metric-value">{humidity ?? "--"}%</span>
        </div>
        <div className="weather-card-3d__metric">
          <span className="weather-card-3d__metric-label">Viento</span>
          <span className="weather-card-3d__metric-value">{wind ?? "--"} km/h</span>
        </div>
        {rain !== null && rain > 0 && (
          <div className="weather-card-3d__metric">
            <span className="weather-card-3d__metric-label">Lluvia</span>
            <span className="weather-card-3d__metric-value">{rain.toFixed(1)} mm</span>
          </div>
        )}
      </div>

      <style>{`
        .weather-card-3d {
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
          gap: 0.5rem;
        }
        .weather-card-3d__header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.85rem;
          font-weight: 600;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .weather-card-3d__header-icon {
          width: 24px;
          height: 24px;
          object-fit: contain;
        }
        .weather-card-3d__main {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
        }
        .weather-card-3d__icon-container {
          width: 70px;
          height: 70px;
        }
        .weather-card-3d__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
          animation: float3d 4s ease-in-out infinite;
        }
        .weather-card-3d__temp-block {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .weather-card-3d__temp {
          font-size: 3.5rem;
          font-weight: 900;
          line-height: 1;
        }
        .weather-card-3d__feels {
          font-size: 0.8rem;
          opacity: 0.7;
        }
        .weather-card-3d__condition {
          font-size: 1.2rem;
          font-weight: 600;
          text-transform: capitalize;
        }
        .weather-card-3d__metrics {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          justify-content: center;
        }
        .weather-card-3d__metric {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0.4rem 0.6rem;
          background: rgba(255,255,255,0.1);
          border-radius: 0.4rem;
          min-width: 55px;
        }
        .weather-card-3d__metric-label {
          font-size: 0.65rem;
          opacity: 0.7;
          text-transform: uppercase;
        }
        .weather-card-3d__metric-value {
          font-size: 0.95rem;
          font-weight: 700;
        }
        @keyframes float3d {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default WeatherCard;
