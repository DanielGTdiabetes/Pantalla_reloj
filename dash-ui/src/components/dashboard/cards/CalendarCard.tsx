import { CalendarIcon } from "../../icons";
import { dayjs } from "../../../utils/dayjs";

type CalendarEvent = {
  title: string;
  start?: string | null;
};

type CalendarCardProps = {
  events: CalendarEvent[];
  timezone: string;
};

export const CalendarCard = ({ events, timezone }: CalendarCardProps): JSX.Element => {
  const normalized = events.slice(0, 6);

  return (
    <div className="card calendar-card">
      <div className="calendar-card__header">
        <CalendarIcon className="card-icon" aria-hidden="true" />
        <h2>Agenda</h2>
      </div>
      {normalized.length === 0 ? (
        <p className="calendar-card__empty">No hay eventos próximos</p>
      ) : (
        <ul className="calendar-card__list">
          {normalized.map((event, index) => {
            const label = event.title || "Evento";
            const date = event.start
              ? dayjs(event.start).tz(timezone).format("ddd D MMM, HH:mm")
              : null;
            return (
              <li key={`${label}-${index}`}>
                <span className="calendar-card__event-title">{label}</span>
                {date ? <span className="calendar-card__event-date">{date}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CalendarCard;
