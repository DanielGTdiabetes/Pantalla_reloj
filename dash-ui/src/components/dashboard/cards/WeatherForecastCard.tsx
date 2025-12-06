import { useState, useEffect } from "react";
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

export const WeatherForecastCard = ({ forecast, unit }: WeatherForecastCardProps): JSX.Element | null => {
  // Use up to 7 days for the carousel
  const days = forecast.slice(0, 7);
  const [currentIndex, setCurrentIndex] = useState(0);
  const ROTATION_INTERVAL = 3000; // 3 seconds per day

  useEffect(() => {
    if (days.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % days.length);
    }, ROTATION_INTERVAL);

    return () => clearInterval(interval);
  }, [days.length]);

  const currentDay = days[currentIndex];
  if (!currentDay) return null;

  return (
    <div className="card weather-forecast-card weather-forecast-card-enhanced">
      <div className="weather-forecast-card__header">
        <h2>Previsión Semanal ({currentIndex + 1}/{days.length})</h2>
      </div>
      <div className="forecast-single-view fade-in" key={currentIndex}>
        <div className="forecast-day-header">
          <span className="forecast-day-name-large">{currentDay.dayName || currentDay.date}</span>
          <span className="forecast-date-sub">{currentDay.date}</span>
        </div>

        <div className="forecast-main-content">
          <div className="forecast-icon-large">
            <WeatherIcon condition={currentDay.condition} className="weather-icon-xlarge" />
          </div>

          <div className="forecast-temps-large">
            <div className="temp-row max">
              <span className="temp-label">Max</span>
              <span className="temp-value">{currentDay.temperature.max !== null ? Math.round(currentDay.temperature.max) : "--"}°</span>
            </div>
            <div className="temp-row min">
              <span className="temp-label">Min</span>
              <span className="temp-value">{currentDay.temperature.min !== null ? Math.round(currentDay.temperature.min) : "--"}°</span>
            </div>
          </div>
        </div>

        <div className="forecast-footer">
          <div className="forecast-condition">{currentDay.condition}</div>
          {currentDay.precipitation !== null && currentDay.precipitation !== undefined && (
            <div className="forecast-precip">
              🌧️ {Math.round(currentDay.precipitation)}% precip.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WeatherForecastCard;
