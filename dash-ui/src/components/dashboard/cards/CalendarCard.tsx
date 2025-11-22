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

const getCountdown = (startTime: string | null | undefined, timezone: string): string | null => {
  if (!startTime) return null;
  const now = dayjs().tz(timezone);
  const start = dayjs(startTime).tz(timezone);
  // Calcular diferencia en minutos usando valueOf()
  const diffMs = start.valueOf() - now.valueOf();
  const diff = Math.round(diffMs / (60 * 1000));
  
  if (diff < 0) return null; // Ya pasó
  if (diff < 60) return `En ${diff} min`;
  
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  if (minutes === 0) return `En ${hours} hora${hours > 1 ? 's' : ''}`;
  return `En ${hours}h ${minutes}min`;
};

const getEventColor = (event: CalendarEvent): string => {
  // Determinar color según tipo de evento (puede extenderse)
  const title = event.title?.toLowerCase() || '';
  if (title.includes('trabajo') || title.includes('work') || title.includes('reunión')) {
    return '#4dabf7'; // Azul para trabajo
  }
  if (title.includes('personal') || title.includes('familia')) {
    return '#51cf66'; // Verde para personal
  }
  if (title.includes('importante') || title.includes('urgente')) {
    return '#ff6b6b'; // Rojo para importante
  }
  return '#4ec9ff'; // Color por defecto (acento)
};

export const CalendarCard = ({ events, timezone }: CalendarCardProps): JSX.Element => {
  const normalized = events.slice(0, 3); // Máximo 3 eventos visibles
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
    <div className="card calendar-card calendar-card-enhanced">
      <div className="calendar-card__header">
        <CalendarIconImage size={48} className="card-icon" />
        <h2>Próximos Eventos</h2>
      </div>
      {normalized.length === 0 ? (
        <p className="calendar-card__empty">No hay eventos próximos</p>
      ) : (
        <div className="calendar-card__scroller">
          <ul className="calendar-card__list">
            {repeatedEvents.map((event, index) => {
              const label = event.title || "Evento";
              const startTime = event.start
                ? dayjs(event.start).tz(timezone).format("HH:mm")
                : null;
              const location = event.location || null;
              const countdown = getCountdown(event.start, timezone);
              const eventColor = getEventColor(event);
              // Usar índice completo para garantizar keys únicos (incluso después de duplicar)
              const uniqueKey = `calendar-${index}`;
              return (
                <li key={uniqueKey} className="calendar-event" style={{ borderLeftColor: eventColor }}>
                  {startTime && (
                    <div className="event-time">{startTime}</div>
                  )}
                  <div className="event-details">
                    <h3 className="event-title">{label}</h3>
                    {location && (
                      <div className="event-location">
                        <span>📍</span>
                        <span>{location}</span>
                      </div>
                    )}
                    {countdown && (
                      <div className="event-countdown">{countdown}</div>
                    )}
                  </div>
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
