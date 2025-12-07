import { useState, useEffect } from "react";

type CalendarEvent = {
  title: string;
  start?: string | null;
  end?: string | null;
  location?: string | null;
};

type CalendarCardProps = {
  events: CalendarEvent[];
  timezone: string;
};

const formatTime = (dateStr: string, tz: string): string => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
};

export const CalendarCard = ({ events, timezone }: CalendarCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const validEvents = events && events.length > 0 ? events.slice(0, 5) : [];

  const now = new Date();
  const dayNum = now.toLocaleDateString("es-ES", { timeZone: timezone, day: "numeric" });
  const monthName = now.toLocaleDateString("es-ES", { timeZone: timezone, month: "short" });
  const dayName = now.toLocaleDateString("es-ES", { timeZone: timezone, weekday: "long" });

  useEffect(() => {
    if (validEvents.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % validEvents.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [validEvents.length]);

  const current = validEvents[currentIndex];

  return (
    <div className="calendar-card-dark">
      <div className="calendar-card-dark__header">
        <span className="calendar-card-dark__icon">📅</span>
        <span className="calendar-card-dark__title">Agenda</span>
      </div>

      <div className="calendar-card-dark__body">
        <div className="calendar-card-dark__leaf">
          <span className="calendar-card-dark__month">{monthName}</span>
          <span className="calendar-card-dark__day">{dayNum}</span>
        </div>

        <div className="calendar-card-dark__events">
          {validEvents.length === 0 ? (
            <div className="calendar-card-dark__empty">
              <span>☕</span>
              <span>Sin eventos</span>
            </div>
          ) : (
            <div className="calendar-card-dark__event" key={currentIndex}>
              <div className="calendar-card-dark__event-title">{current.title}</div>
              {current.start && (
                <div className="calendar-card-dark__event-time">{formatTime(current.start, timezone)}</div>
              )}
              {current.location && (
                <div className="calendar-card-dark__event-location">📍 {current.location}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="calendar-card-dark__dayname">{dayName}</div>

      {validEvents.length > 1 && (
        <div className="calendar-card-dark__dots">
          {validEvents.map((_, idx) => (
            <span key={idx} className={`calendar-card-dark__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .calendar-card-dark {
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%);
          color: white;
          overflow: hidden;
        }
        .calendar-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          margin-bottom: 0.5rem;
        }
        .calendar-card-dark__icon {
          font-size: 2rem;
        }
        .calendar-card-dark__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .calendar-card-dark__body {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex: 1;
          width: 100%;
        }
        .calendar-card-dark__leaf {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: white;
          color: #1e293b;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          width: 70px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          border-top: 5px solid #dc2626;
          transform: rotate(-2deg);
        }
        .calendar-card-dark__month {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          color: #dc2626;
        }
        .calendar-card-dark__day {
          font-size: 2.5rem;
          font-weight: 900;
          line-height: 1;
        }
        .calendar-card-dark__events {
          flex: 1;
          min-width: 0;
        }
        .calendar-card-dark__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          opacity: 0.7;
          font-size: 0.9rem;
        }
        .calendar-card-dark__event {
          animation: fadeIn-dark 0.4s ease-out;
        }
        .calendar-card-dark__event-title {
          font-size: 1.1rem;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .calendar-card-dark__event-time {
          font-size: 1rem;
          color: #fbbf24;
          font-weight: 700;
          font-family: monospace;
        }
        .calendar-card-dark__event-location {
          font-size: 0.8rem;
          opacity: 0.8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .calendar-card-dark__dayname {
          font-size: 1.1rem;
          font-weight: 600;
          text-transform: capitalize;
          opacity: 0.9;
          margin-top: 0.25rem;
        }
        .calendar-card-dark__dots {
          display: flex;
          justify-content: center;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .calendar-card-dark__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .calendar-card-dark__dot.active {
          background: #fbbf24;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes fadeIn-dark {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default CalendarCard;
