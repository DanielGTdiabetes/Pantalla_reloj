import { CalendarIcon } from "../../icons";
import { dayjs } from "../../../utils/dayjs";
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

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

const CalendarIconImage: React.FC<{ size?: number; className?: string }> = ({ size = 48, className = "" }) => {
  const [iconError, setIconError] = useState(false);
  const iconPath = "/icons/misc/calendar.svg";
  const emojiFallback = "📅";

  useEffect(() => {
    setIconError(false);
  }, [iconPath]);

  if (iconError || !iconPath) {
    return (
      <span style={{ fontSize: `${size}px`, lineHeight: 1 }} className={className} role="img" aria-label="Calendario">
        {emojiFallback}
      </span>
    );
  }

  return (
    <img
      src={iconPath}
      alt="Calendario"
      className={className}
      style={{ width: `${size}px`, height: `${size}px`, objectFit: "contain" }}
      onError={() => setIconError(true)}
      loading="lazy"
    />
  );
};

export const CalendarCard = ({ events, timezone }: CalendarCardProps): JSX.Element => {
  const normalized = events.slice(0, 10);
  const repeatedEvents = normalized.length > 0 ? repeatItems(normalized) : [];
  
  // Determinar si un evento está ocurriendo ahora
  const now = dayjs().tz(timezone);
  const getEventStatus = (event: CalendarEvent): { isNow: boolean; minutesUntil: number | null } => {
    if (!event.start || !event.end) {
      return { isNow: false, minutesUntil: null };
    }
    const start = dayjs(event.start).tz(timezone);
    const end = dayjs(event.end).tz(timezone);
    const nowTime = Number(now.valueOf());
    const startTime = Number(start.valueOf());
    const endTime = Number(end.valueOf());
    const isNow = nowTime >= startTime && nowTime <= endTime;
    const minutesUntil = isNow ? 0 : Math.round((startTime - nowTime) / (60 * 1000));
    return { isNow, minutesUntil };
  };

  return (
    <div className="card calendar-card">
      <div className="calendar-card__header">
        <CalendarIconImage size={48} className="card-icon" />
        <h2>Agenda</h2>
      </div>
      {normalized.length === 0 ? (
        <p className="calendar-card__empty">No hay eventos próximos</p>
      ) : (
        <div className="calendar-card__scroller">
          <ul className="calendar-card__list">
            {repeatedEvents.map((event, index) => {
              const label = event.title || "Evento";
              const startDate = event.start
                ? dayjs(event.start).tz(timezone).format("ddd D MMM, HH:mm")
                : null;
              const endDate = event.end
                ? dayjs(event.end).tz(timezone).format("HH:mm")
                : null;
              const dateRange = startDate && endDate
                ? `${startDate} - ${endDate}`
                : startDate || null;
              const location = event.location || null;
              const { isNow, minutesUntil } = getEventStatus(event);
              // Usar índice completo para garantizar keys únicos (incluso después de duplicar)
              const uniqueKey = `calendar-${index}`;
              return (
                <li key={uniqueKey}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="calendar-card__event-title">{label}</span>
                    {isNow && (
                      <span
                        style={{
                          backgroundColor: "#FF6B6B",
                          color: "#FFFFFF",
                          padding: "2px 8px",
                          borderRadius: "12px",
                          fontSize: "0.75em",
                          fontWeight: "bold",
                        }}
                      >
                        Ahora
                      </span>
                    )}
                    {!isNow && minutesUntil !== null && minutesUntil > 0 && minutesUntil < 60 && (
                      <span
                        style={{
                          backgroundColor: "#4ECDC4",
                          color: "#FFFFFF",
                          padding: "2px 8px",
                          borderRadius: "12px",
                          fontSize: "0.75em",
                          fontWeight: "bold",
                        }}
                      >
                        en {minutesUntil} min
                      </span>
                    )}
                  </div>
                  {dateRange ? <span className="calendar-card__event-date">{dateRange}</span> : null}
                  {location ? <span className="calendar-card__event-location">{location}</span> : null}
                </li>
              );
            })}
          </ul>
          <div className="calendar-card__gradient" aria-hidden="true" />
        </div>
      )}
    </div>
  );
};

export default CalendarCard;
