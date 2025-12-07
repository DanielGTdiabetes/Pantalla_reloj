import { DropletsIcon, WindIcon } from "../../icons";
import { AnimatedWeatherIcon } from "../../icons/AnimatedWeatherIcons";
import { WeatherIcon } from "../../WeatherIcon";

type WeatherCardProps = {
  temperatureLabel: string;
  feelsLikeLabel: string | null;
  condition: string | null;
  humidity: number | null;
  wind: number | null;
  rain: number | null; // mm de lluvia acumulada
  unit: string;
  timezone?: string;
};

const formatMetric = (value: number | null, suffix: string): string => {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value)}${suffix}`;
};

export const WeatherCard = ({
  temperatureLabel,
  feelsLikeLabel,
  condition,
  humidity,
  wind,
  rain,
  unit,
  timezone = "Europe/Madrid"
}: WeatherCardProps): JSX.Element => {
  // Determinar si necesita animación según condición
  const getIconAnimation = () => {
    const cond = condition?.toLowerCase() || "";
    if (cond.includes("sol") || cond.includes("sunny") || cond.includes("clear")) {
      return "sun-animation";
    } else if (cond.includes("nube") || cond.includes("cloud")) {
      return "cloud-animation";
    } else if (cond.includes("lluvia") || cond.includes("rain")) {
      return "rain-animation";
    }
    return "";
  };

  // Extraer valor numérico de la temperatura
  const tempValue = temperatureLabel.replace(/[^\d-]/g, '');
  const tempUnit = temperatureLabel.replace(/[\d-]/g, '').trim();

  return (
    <div className="weather-card-root">
      <div className="weather-card__main">
        <AnimatedWeatherIcon
          condition={condition}
          size={90}
          className="weather-card__main-icon"
        />
        <div className="weather-card__temp-container">
          <div className="weather-card__temperature-display">
            <span className="weather-card__temp-value">{tempValue}</span>
            <span className="weather-card__temp-unit">{tempUnit}</span>
          </div>
          {feelsLikeLabel && (
            <p className="weather-card__feels-like">
              Sensación: {feelsLikeLabel}
            </p>
          )}
        </div>
      </div>

      <p className="weather-card__condition">{condition ?? "Sin datos meteorológicos"}</p>

      <div className="weather-card__metrics">
        <div className="weather-card__metric">
          <DropletsIcon className="weather-card__metric-icon breathe-effect" aria-hidden="true" />
          <div className="weather-card__metric-content">
            <span className="weather-card__metric-label">Humedad</span>
            <span className="weather-card__metric-value">{formatMetric(humidity, "%")}</span>
            {humidity !== null && (
              <div className="weather-card__metric-bar">
                <div
                  className="weather-card__metric-bar-fill"
                  style={{ width: `${Math.min(100, humidity)}%` }}
                />
              </div>
            )}
          </div>
        </div>
        {rain !== null && rain > 0 && (
          <div className="weather-card__metric weather-card__metric--rain">
            <DropletsIcon className="weather-card__metric-icon breathe-effect" aria-hidden="true" />
            <div className="weather-card__metric-content">
              <span className="weather-card__metric-label">Lluvia</span>
              <span className="weather-card__metric-value">{formatMetric(rain, " mm")}</span>
              <span className="weather-card__metric-hint">({rain.toFixed(1)} L/m²)</span>
            </div>
          </div>
        )}
        <div className="weather-card__metric">
          <WindIcon className="weather-card__metric-icon breathe-effect" aria-hidden="true" />
          <div className="weather-card__metric-content">
            <span className="weather-card__metric-label">Viento</span>
            <span className="weather-card__metric-value">{formatMetric(wind, " km/h")}</span>
            {wind !== null && (
              <div className="weather-card__metric-bar">
                <div
                  className="weather-card__metric-bar-fill"
                  style={{ width: `${Math.min(100, (wind / 50) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .weather-card-root {
          background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%) !important;
          color: white !important;
          position: relative;
          overflow: hidden;
          border-radius: 1.5rem;
          padding: 1.5rem;
          border: 1px solid rgba(255,255,255,0.1);
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .weather-card__main {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2rem;
            flex: 1;
        }
        .weather-card__main-icon {
            filter: drop-shadow(0 0 15px rgba(255,255,255,0.3));
        }
        .weather-card__temp-container {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }
        .weather-card__temperature-display {
            display: flex;
            align-items: flex-start;
            line-height: 1;
        }
        .weather-card__temp-value {
             font-size: 5rem;
             font-weight: 900;
             letter-spacing: -0.05em;
        }
        .weather-card__temp-unit {
             font-size: 2rem;
             font-weight: 500;
             margin-top: 0.5rem;
             opacity: 0.8;
        }
        .weather-card__feels-like {
             font-size: 0.9rem;
             opacity: 0.8;
             margin-top: 0.5rem;
        }
        .weather-card__condition {
             text-align: center;
             font-size: 1.5rem;
             font-weight: 700;
             margin-bottom: 2rem;
             text-transform: capitalize;
             opacity: 0.9;
        }
        .weather-card__metrics {
             display: grid;
             grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
             gap: 1rem;
             background: rgba(0,0,0,0.1);
             padding: 1rem;
             border-radius: 1rem;
        }
        .weather-card__metric {
             display: flex;
             align-items: center;
             gap: 0.75rem;
        }
        .weather-card__metric-icon {
             width: 1.5rem;
             height: 1.5rem;
             opacity: 0.8;
        }
        .weather-card__metric-content {
             display: flex;
             flex-direction: column;
             flex: 1;
        }
        .weather-card__metric-label {
             font-size: 0.7rem;
             text-transform: uppercase;
             opacity: 0.6;
             font-weight: 600;
        }
        .weather-card__metric-value {
             font-size: 1rem;
             font-weight: 700;
        }
        .weather-card__metric-bar {
             height: 4px;
             background: rgba(255,255,255,0.1);
             border-radius: 2px;
             margin-top: 0.25rem;
             overflow: hidden;
        }
        .weather-card__metric-bar-fill {
             height: 100%;
             background: white;
             border-radius: 2px;
        }
        .breathe-effect {
             animation: breathe 3s ease-in-out infinite;
        }
        @keyframes breathe {
             0%, 100% { opacity: 0.8; transform: scale(1); }
             50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
};

export default WeatherCard;
