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
  icon?: string;
};

type WeatherForecastCardProps = {
  forecast: ForecastDay[];
  unit: string;
};

// Map condition to weather icon (day icons for forecast)
const getWeatherIcon = (condition: string): string => {
  const c = (condition || "").toLowerCase();

  if (c.includes("tormenta") || c.includes("thunder") || c.includes("storm")) {
    return "/icons/weather/day/thunderstorm.svg";
  }
  if (c.includes("lluvia") || c.includes("rain") || c.includes("lluvioso")) {
    return "/icons/weather/day/rain.svg";
  }
  if (c.includes("llovizna") || c.includes("drizzle")) {
    return "/icons/weather/day/drizzle.svg";
  }
  if (c.includes("nieve") || c.includes("snow")) {
    return "/icons/weather/day/snow.svg";
  }
  if (c.includes("niebla") || c.includes("fog") || c.includes("bruma")) {
    return "/icons/weather/day/fog.svg";
  }
  if (c.includes("nublado") || c.includes("cloudy") || c.includes("nubes")) {
    return "/icons/weather/day/cloudy.svg";
  }
  if (c.includes("parcialmente") || c.includes("partly")) {
    return "/icons/weather/day/partly-cloudy.svg";
  }
  if (c.includes("cubierto") || c.includes("overcast")) {
    return "/icons/weather/day/overcast.svg";
  }
  if (c.includes("despejado") || c.includes("clear") || c.includes("soleado") || c.includes("sunny") || c.includes("sol")) {
    return "/icons/weather/day/sunny.svg";
  }

  return "/icons/weather/day/sunny.svg";
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

  const iconUrl = day.icon ? `/icons/weather/day/${day.icon}.svg` : getWeatherIcon(day.condition);

  return (
    <div className="forecast-card-dark">
      <div className="forecast-card-dark__header">
        <img src="/img/icons/modern/clock.png" alt="" className="forecast-card-dark__header-icon" style={{ opacity: 0 }} />
        <span className="forecast-card-dark__title">Tiempo 7 Días</span>
      </div>
      <style>{`
        .forecast-card-dark__header-icon { display: none; }
        .forecast-card-dark__header::before {
            content: '';
            display: block;
            width: 64px;
            height: 64px;
            background-image: url('/icons/weather/day/partly-cloudy.svg');
            background-size: contain;
            background-repeat: no-repeat;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
      `}</style>
      <div className="forecast-card-dark__header" style={{ marginTop: '-1rem', position: 'absolute', opacity: 0, pointerEvents: 'none' }}>
        {/* Hidden original header to keep layout if needed, but we used pseudo element. Actually let's just replace the header cleanly. */}
      </div>
      {/* Real Header */}
      <div className="forecast-card-dark__header" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
        <img src="/icons/weather/day/partly-cloudy.svg" alt="" className="forecast-card-dark__header-icon-real" style={{ width: '64px', height: '64px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }} />
        <span className="forecast-card-dark__title" style={{ fontSize: '1.8rem', fontWeight: 800 }}>Tiempo 7 Días</span>
      </div>

      <div className="forecast-card-dark__body">
        <div className="forecast-card-dark__day">
          <span className="forecast-card-dark__dayname">{day.dayName || "Hoy"}</span>
          <span className="forecast-card-dark__date">{day.date}</span>
        </div>

        <div className="forecast-card-dark__icon-container">
          <img src={iconUrl} alt={day.condition} className="forecast-card-dark__main-icon" />
        </div>

        <div className="forecast-card-dark__temps">
          <span className="forecast-card-dark__max">
            {day.temperature.max !== null ? Math.round(day.temperature.max) : "--"}°
            <small>máx</small>
          </span>
          <span className="forecast-card-dark__min">
            {day.temperature.min !== null ? Math.round(day.temperature.min) : "--"}°
            <small>mín</small>
          </span>
        </div>

        <div className="forecast-card-dark__condition">{day.condition}</div>

        {days.length > 1 && (
          <div className="forecast-card-dark__dots">
            {days.map((_, idx) => (
              <span key={idx} className={`forecast-card-dark__dot ${idx === currentIndex ? "active" : ""}`} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .forecast-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #0c4a6e 0%, #0f172a 100%);
          color: white;
        }
        .forecast-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .forecast-card-dark__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .forecast-card-dark__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .forecast-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }
        .forecast-card-dark__day {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .forecast-card-dark__dayname {
          font-size: 2.2rem;
          font-weight: 800;
          text-transform: capitalize;
          text-shadow: 0 2px 8px rgba(0,0,0,0.5);
        }
        .forecast-card-dark__date {
          font-size: 0.8rem;
          opacity: 0.6;
        }
        .forecast-card-dark__icon-container {
          width: 150px;
          height: 150px;
          margin: 0.5rem 0;
        }
        .forecast-card-dark__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
          animation: float-dark 4s ease-in-out infinite;
        }
        .forecast-card-dark__temps {
          display: flex;
          gap: 2rem;
        }
        .forecast-card-dark__max,
        .forecast-card-dark__min {
          display: flex;
          flex-direction: column;
          align-items: center;
          font-size: 3.5rem;
          font-weight: 800;
          line-height: 1;
        }
        .forecast-card-dark__max small,
        .forecast-card-dark__min small {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          opacity: 0.7;
        }
        .forecast-card-dark__max { color: #fbbf24; }
        .forecast-card-dark__min { color: #38bdf8; }
        .forecast-card-dark__condition {
          font-size: 1.6rem;
          font-weight: 600;
          text-transform: capitalize;
        }
        .forecast-card-dark__dots {
          display: flex;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .forecast-card-dark__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .forecast-card-dark__dot.active {
          background: white;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes float-dark {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default WeatherForecastCard;
