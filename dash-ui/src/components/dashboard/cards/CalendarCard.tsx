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
    <div className="calendar-card-3d">
      <div className="calendar-card-3d__header">📅 Agenda</div>

      <div className="calendar-card-3d__main">
        <div className="calendar-card-3d__leaf">
          <span className="calendar-card-3d__month">{monthName}</span>
          <span className="calendar-card-3d__day">{dayNum}</span>
        </div>

        <div className="calendar-card-3d__events">
          {validEvents.length === 0 ? (
            <div className="calendar-card-3d__empty">
              <span>☕</span>
              <span>Sin eventos</span>
            </div>
          ) : (
            <div className="calendar-card-3d__event" key={currentIndex}>
              <div className="calendar-card-3d__event-title">{current.title}</div>
              {current.start && (
                <div className="calendar-card-3d__event-time">{formatTime(current.start, timezone)}</div>
              )}
              {current.location && (
                <div className="calendar-card-3d__event-location">📍 {current.location}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="calendar-card-3d__dayname">{dayName}</div>

      {validEvents.length > 1 && (
        <div className="calendar-card-3d__dots">
          {validEvents.map((_, idx) => (
            <span key={idx} className={`calendar-card-3d__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .calendar-card-3d {
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          overflow: hidden;
        }
        .calendar-card-3d__header {
          font-size: 0.9rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          opacity: 0.8;
          margin-bottom: 0.5rem;
        }
        .calendar-card-3d__main {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex: 1;
          width: 100%;
        }
        .calendar-card-3d__leaf {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: white;
          color: #1e293b;
          border-radius: 0.5rem;
          padding: 0.5rem;
          width: 60px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.3);
          border-top: 4px solid #ef4444;
          transform: rotate(-2deg);
        }
        .calendar-card-3d__month {
          font-size: 0.6rem;
          font-weight: 700;
          text-transform: uppercase;
          color: #ef4444;
        }
        .calendar-card-3d__day {
          font-size: 2rem;
          font-weight: 900;
          line-height: 1;
        }
        .calendar-card-3d__events {
          flex: 1;
          min-width: 0;
        }
        .calendar-card-3d__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          opacity: 0.6;
          font-size: 0.9rem;
        }
        .calendar-card-3d__event {
          animation: fadeIn3d 0.4s ease-out;
        }
        .calendar-card-3d__event-title {
          font-size: 1rem;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .calendar-card-3d__event-time {
          font-size: 0.85rem;
          color: #fbbf24;
          font-weight: 600;
          font-family: monospace;
        }
        .calendar-card-3d__event-location {
          font-size: 0.75rem;
          opacity: 0.7;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .calendar-card-3d__dayname {
          font-size: 1rem;
          font-weight: 600;
          text-transform: capitalize;
          opacity: 0.8;
          margin-top: 0.25rem;
        }
        .calendar-card-3d__dots {
          display: flex;
          justify-content: center;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .calendar-card-3d__dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .calendar-card-3d__dot.active {
          background: #fbbf24;
          width: 14px;
          border-radius: 3px;
        }
        @keyframes fadeIn3d {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default CalendarCard;
