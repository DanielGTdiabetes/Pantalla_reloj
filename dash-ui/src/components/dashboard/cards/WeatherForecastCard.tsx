import { useState, useEffect } from "react";

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

const get3DIcon = (condition: string): string => {
  const c = (condition || "").toLowerCase();
  if (c.includes("lluvia") || c.includes("rain") || c.includes("tormenta") || c.includes("nube")) {
    return "/img/icons/3d/cloud-rain.png";
  }
  if (c.includes("noche") || c.includes("night") || c.includes("moon")) {
    return "/img/icons/3d/moon-sleep.png";
  }
  return "/img/icons/3d/sun-smile.png";
};

export const WeatherForecastCard = ({ forecast }: WeatherForecastCardProps): JSX.Element | null => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const days = forecast.filter(d => d.date).slice(0, 7);

  useEffect(() => {
    if (days.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % days.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [days.length]);

  const day = days[currentIndex];
  if (!day) return null;

  const iconUrl = get3DIcon(day.condition);

  return (
    <div className="forecast-card-v2">
      <div className="forecast-card-v2__header">
        <img src="/img/icons/3d/cloud-rain.png" alt="" className="forecast-card-v2__header-icon" />
        <span className="forecast-card-v2__title">Previsión Semanal</span>
      </div>

      <div className="forecast-card-v2__body">
        <div className="forecast-card-v2__day">
          <span className="forecast-card-v2__dayname">{day.dayName || "Hoy"}</span>
          <span className="forecast-card-v2__date">{day.date}</span>
        </div>

        <div className="forecast-card-v2__icon-container">
          <img src={iconUrl} alt={day.condition} className="forecast-card-v2__main-icon" />
        </div>

        <div className="forecast-card-v2__temps">
          <span className="forecast-card-v2__max">
            {day.temperature.max !== null ? Math.round(day.temperature.max) : "--"}°
            <small>máx</small>
          </span>
          <span className="forecast-card-v2__min">
            {day.temperature.min !== null ? Math.round(day.temperature.min) : "--"}°
            <small>mín</small>
          </span>
        </div>

        <div className="forecast-card-v2__condition">{day.condition}</div>

        {days.length > 1 && (
          <div className="forecast-card-v2__dots">
            {days.map((_, idx) => (
              <span key={idx} className={`forecast-card-v2__dot ${idx === currentIndex ? "active" : ""}`} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .forecast-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
        }
        .forecast-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .forecast-card-v2__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        .forecast-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .forecast-card-v2__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }
        .forecast-card-v2__day {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .forecast-card-v2__dayname {
          font-size: 1.5rem;
          font-weight: 700;
          text-transform: capitalize;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .forecast-card-v2__date {
          font-size: 0.8rem;
          color: #64748b;
        }
        .forecast-card-v2__icon-container {
          width: 120px;
          height: 120px;
          margin: 0.25rem 0;
        }
        .forecast-card-v2__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.25));
          animation: float-v2 4s ease-in-out infinite;
        }
        .forecast-card-v2__temps {
          display: flex;
          gap: 2rem;
        }
        .forecast-card-v2__max,
        .forecast-card-v2__min {
          display: flex;
          flex-direction: column;
          align-items: center;
          font-size: 2rem;
          font-weight: 800;
          line-height: 1;
        }
        .forecast-card-v2__max small,
        .forecast-card-v2__min small {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          color: #64748b;
        }
        .forecast-card-v2__max {
          color: #c2410c;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .forecast-card-v2__min {
          color: #0369a1;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .forecast-card-v2__condition {
          font-size: 1.1rem;
          font-weight: 600;
          text-transform: capitalize;
          color: #334155;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .forecast-card-v2__dots {
          display: flex;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .forecast-card-v2__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(0,0,0,0.2);
          transition: all 0.3s;
        }
        .forecast-card-v2__dot.active {
          background: #1e293b;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes float-v2 {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default WeatherForecastCard;
