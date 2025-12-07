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
    <div className="forecast-card-3d">
      <div className="forecast-card-3d__header">
        <img src="/img/icons/3d/cloud-rain.png" alt="" className="forecast-card-3d__header-icon" />
        <span>Previsión</span>
      </div>

      <div className="forecast-card-3d__day">
        <span className="forecast-card-3d__dayname">{day.dayName || "Hoy"}</span>
        <span className="forecast-card-3d__date">{day.date}</span>
      </div>

      <div className="forecast-card-3d__icon-container">
        <img src={iconUrl} alt={day.condition} className="forecast-card-3d__main-icon" />
      </div>

      <div className="forecast-card-3d__temps">
        <span className="forecast-card-3d__max">
          {day.temperature.max !== null ? Math.round(day.temperature.max) : "--"}°
          <small>máx</small>
        </span>
        <span className="forecast-card-3d__min">
          {day.temperature.min !== null ? Math.round(day.temperature.min) : "--"}°
          <small>mín</small>
        </span>
      </div>

      <div className="forecast-card-3d__condition">{day.condition}</div>

      {days.length > 1 && (
        <div className="forecast-card-3d__dots">
          {days.map((_, idx) => (
            <span key={idx} className={`forecast-card-3d__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .forecast-card-3d {
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
          gap: 0.25rem;
        }
        .forecast-card-3d__header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.85rem;
          font-weight: 600;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .forecast-card-3d__header-icon {
          width: 24px;
          height: 24px;
          object-fit: contain;
        }
        .forecast-card-3d__day {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .forecast-card-3d__dayname {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: capitalize;
        }
        .forecast-card-3d__date {
          font-size: 0.75rem;
          opacity: 0.6;
        }
        .forecast-card-3d__icon-container {
          position: relative;
          width: 80px;
          height: 80px;
          margin: 0.5rem 0;
        }
        .forecast-card-3d__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
          animation: float3d 4s ease-in-out infinite;
        }
        .forecast-card-3d__temps {
          display: flex;
          gap: 1.5rem;
        }
        .forecast-card-3d__max,
        .forecast-card-3d__min {
          display: flex;
          flex-direction: column;
          align-items: center;
          font-size: 1.8rem;
          font-weight: 800;
          line-height: 1;
        }
        .forecast-card-3d__max small,
        .forecast-card-3d__min small {
          font-size: 0.65rem;
          font-weight: 500;
          opacity: 0.6;
          text-transform: uppercase;
        }
        .forecast-card-3d__max { color: #ffb347; }
        .forecast-card-3d__min { color: #87ceeb; }
        .forecast-card-3d__condition {
          font-size: 1rem;
          font-weight: 500;
          text-transform: capitalize;
          margin-top: 0.25rem;
        }
        .forecast-card-3d__dots {
          display: flex;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .forecast-card-3d__dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .forecast-card-3d__dot.active {
          background: white;
          width: 14px;
          border-radius: 3px;
        }
        @keyframes float3d {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default WeatherForecastCard;
