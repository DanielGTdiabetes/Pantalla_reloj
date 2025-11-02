import { CalendarIcon } from "../../icons";
import { dayjs } from "../../../utils/dayjs";

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

export const CalendarCard = ({ events, timezone }: CalendarCardProps): JSX.Element => {
  const normalized = events.slice(0, 10);
  const repeatedEvents = normalized.length > 0 ? repeatItems(normalized) : [];

  return (
    <div className="card calendar-card">
      <div className="calendar-card__header">
        <CalendarIcon className="card-icon" aria-hidden="true" />
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
              // Usar índice completo para garantizar keys únicas (incluso después de duplicar)
              const uniqueKey = `calendar-${index}`;
              return (
                <li key={uniqueKey}>
                  <span className="calendar-card__event-title">{label}</span>
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
