import { DropletsIcon, WindIcon } from "../../icons";
import { AnimatedWeatherIcon } from "../../icons/AnimatedWeatherIcons";
import { WeatherIcon } from "../../WeatherIcon";

type WeatherCardProps = {
  temperatureLabel: string;
  feelsLikeLabel: string | null;
  condition: string | null;
  humidity: number | null;
  wind: number | null;
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
    <div className="card weather-card weather-card-enhanced">
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
    </div>
  );
};

export default WeatherCard;
