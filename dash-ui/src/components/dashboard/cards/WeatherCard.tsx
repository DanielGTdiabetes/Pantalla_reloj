import { CloudIcon, DropletsIcon, WindIcon } from "../../icons";

type WeatherCardProps = {
  temperatureLabel: string;
  feelsLikeLabel: string | null;
  condition: string | null;
  humidity: number | null;
  wind: number | null;
  unit: string;
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
  unit
}: WeatherCardProps): JSX.Element => {
  return (
    <div className="card weather-card">
      <div className="weather-card__header">
        <CloudIcon className="card-icon" aria-hidden="true" />
        <div>
          <p className="weather-card__temperature">{temperatureLabel}</p>
          <p className="weather-card__feels-like">
            {feelsLikeLabel ? `Sensación ${feelsLikeLabel}` : `Unidad ${unit}`}
          </p>
        </div>
      </div>

      <p className="weather-card__condition">{condition ?? "Sin datos meteorológicos"}</p>

      <div className="weather-card__metrics">
        <div className="weather-card__metric">
          <DropletsIcon className="weather-card__metric-icon" aria-hidden="true" />
          <div>
            <span className="weather-card__metric-label">Humedad</span>
            <span className="weather-card__metric-value">{formatMetric(humidity, "%")}</span>
          </div>
        </div>
        <div className="weather-card__metric">
          <WindIcon className="weather-card__metric-icon" aria-hidden="true" />
          <div>
            <span className="weather-card__metric-label">Viento</span>
            <span className="weather-card__metric-value">{formatMetric(wind, " km/h")}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeatherCard;
