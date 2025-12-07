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

// Map condition to appropriate weather icon
const getWeatherIcon = (condition: string | null): string => {
  const c = (condition || "").toLowerCase();

  // Check time of day for day/night icons
  const hour = new Date().getHours();
  const isNight = hour < 6 || hour >= 21;
  const folder = isNight ? "night" : "day";

  if (c.includes("tormenta") || c.includes("thunder") || c.includes("storm")) {
    return `/icons/weather/${folder}/thunderstorm.svg`;
  }
  if (c.includes("lluvia") || c.includes("rain") || c.includes("lluvioso")) {
    return `/icons/weather/${folder}/rain.svg`;
  }
  if (c.includes("llovizna") || c.includes("drizzle")) {
    return `/icons/weather/${folder}/drizzle.svg`;
  }
  if (c.includes("nieve") || c.includes("snow")) {
    return `/icons/weather/${folder}/snow.svg`;
  }
  if (c.includes("niebla") || c.includes("fog") || c.includes("bruma")) {
    return `/icons/weather/${folder}/fog.svg`;
  }
  if (c.includes("nublado") || c.includes("cloudy") || c.includes("nubes")) {
    return `/icons/weather/${folder}/cloudy.svg`;
  }
  if (c.includes("parcialmente") || c.includes("partly")) {
    return `/icons/weather/${folder}/partly-cloudy.svg`;
  }
  if (c.includes("cubierto") || c.includes("overcast")) {
    return `/icons/weather/${folder}/overcast.svg`;
  }
  if (c.includes("despejado") || c.includes("clear") || c.includes("soleado") || c.includes("sunny") || c.includes("sol")) {
    return `/icons/weather/${folder}/sunny.svg`;
  }

  // Default based on time
  return isNight ? "/icons/weather/night/clear.svg" : "/icons/weather/day/sunny.svg";
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
  const iconUrl = getWeatherIcon(condition);

  return (
    <div className="weather-card-dark">
      <div className="weather-card-dark__header">
        <img src={iconUrl} alt="" className="weather-card-dark__header-icon" />
        <span className="weather-card-dark__title">Tiempo Actual</span>
      </div>

      <div className="weather-card-dark__body">
        <div className="weather-card-dark__main">
          <div className="weather-card-dark__icon-container">
            <img src={iconUrl} alt={condition || "weather"} className="weather-card-dark__main-icon" />
          </div>
          <div className="weather-card-dark__temp-block">
            <span className="weather-card-dark__temp">{tempValue}°</span>
            {feelsLikeLabel && (
              <span className="weather-card-dark__feels">Sensación: {feelsLikeLabel}</span>
            )}
          </div>
        </div>

        <div className="weather-card-dark__condition">{condition || "Sin datos"}</div>

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
          margin-bottom: 0.5rem;
        }
        .weather-card-dark__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .weather-card-dark__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .weather-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }
        .weather-card-dark__main {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
        }
        .weather-card-dark__icon-container {
          width: 120px;
          height: 120px;
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
          font-size: 4rem;
          font-weight: 900;
          line-height: 1;
          text-shadow: 0 2px 10px rgba(0,0,0,0.5);
        }
        .weather-card-dark__feels {
          font-size: 0.85rem;
          opacity: 0.7;
        }
        .weather-card-dark__condition {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: capitalize;
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
          font-size: 0.65rem;
          opacity: 0.7;
          text-transform: uppercase;
          font-weight: 600;
        }
        .weather-card-dark__metric-value {
          font-size: 1rem;
          font-weight: 700;
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
