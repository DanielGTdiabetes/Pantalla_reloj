import { WeatherIcon } from "../../WeatherIcon";

type ForecastDay = {
  date: string;
  dayName?: string;
  condition: string;
  temperature: {
    min: number | null;
    max: number | null;
  };
  precipitation?: number | null;
};

type WeatherForecastCardProps = {
  forecast: ForecastDay[];
  unit: string;
};

export const WeatherForecastCard = ({ forecast, unit }: WeatherForecastCardProps): JSX.Element => {
  // Take first 5 days
  const days = forecast.slice(0, 5);

  return (
    <div className="card weather-forecast-card weather-forecast-card-enhanced">
      <div className="weather-forecast-card__header">
        <h2>Previsión Semanal</h2>
      </div>
      <div className="forecast-list">
        {days.map((day, index) => (
          <div key={`forecast-${index}`} className="forecast-item">
            <div className="forecast-day-name">{day.dayName?.substring(0, 3) || day.date}</div>
            <div className="forecast-icon">
              <WeatherIcon condition={day.condition} className="weather-icon-small" />
            </div>
            <div className="forecast-temps">
              <span className="temp-max">{day.temperature.max !== null ? Math.round(day.temperature.max) : "--"}°</span>
              <span className="temp-min">{day.temperature.min !== null ? Math.round(day.temperature.min) : "--"}°</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WeatherForecastCard;
