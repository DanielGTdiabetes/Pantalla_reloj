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
    <div className="calendar-card-v2">
      <div className="calendar-card-v2__header">
        <span className="calendar-card-v2__icon">📅</span>
        <span className="calendar-card-v2__title">Agenda</span>
      </div>

      <div className="calendar-card-v2__body">
        <div className="calendar-card-v2__leaf">
          <span className="calendar-card-v2__month">{monthName}</span>
          <span className="calendar-card-v2__day">{dayNum}</span>
        </div>

        <div className="calendar-card-v2__events">
          {validEvents.length === 0 ? (
            <div className="calendar-card-v2__empty">
              <span>☕</span>
              <span>Sin eventos</span>
            </div>
          ) : (
            <div className="calendar-card-v2__event" key={currentIndex}>
              <div className="calendar-card-v2__event-title">{current.title}</div>
              {current.start && (
                <div className="calendar-card-v2__event-time">{formatTime(current.start, timezone)}</div>
              )}
              {current.location && (
                <div className="calendar-card-v2__event-location">📍 {current.location}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="calendar-card-v2__dayname">{dayName}</div>

      {validEvents.length > 1 && (
        <div className="calendar-card-v2__dots">
          {validEvents.map((_, idx) => (
            <span key={idx} className={`calendar-card-v2__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .calendar-card-v2 {
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          overflow: hidden;
        }
        .calendar-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          margin-bottom: 0.5rem;
        }
        .calendar-card-v2__icon {
          font-size: 2rem;
        }
        .calendar-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .calendar-card-v2__body {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex: 1;
          width: 100%;
        }
        .calendar-card-v2__leaf {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: white;
          color: #1e293b;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          width: 70px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          border-top: 5px solid #dc2626;
          transform: rotate(-2deg);
        }
        .calendar-card-v2__month {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          color: #dc2626;
        }
        .calendar-card-v2__day {
          font-size: 2.5rem;
          font-weight: 900;
          line-height: 1;
        }
        .calendar-card-v2__events {
          flex: 1;
          min-width: 0;
        }
        .calendar-card-v2__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          color: #64748b;
          font-size: 0.9rem;
        }
        .calendar-card-v2__event {
          animation: fadeIn-v2 0.4s ease-out;
        }
        .calendar-card-v2__event-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .calendar-card-v2__event-time {
          font-size: 1rem;
          color: #92400e;
          font-weight: 700;
          font-family: monospace;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .calendar-card-v2__event-location {
          font-size: 0.8rem;
          color: #475569;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .calendar-card-v2__dayname {
          font-size: 1.1rem;
          font-weight: 600;
          text-transform: capitalize;
          color: #334155;
          margin-top: 0.25rem;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .calendar-card-v2__dots {
          display: flex;
          justify-content: center;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .calendar-card-v2__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(0,0,0,0.2);
          transition: all 0.3s;
        }
        .calendar-card-v2__dot.active {
          background: #dc2626;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes fadeIn-v2 {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default CalendarCard;
