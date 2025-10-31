import { BookOpenIcon } from "../../icons";

type EphemeridesCardProps = {
  sunrise: string | null;
  sunset: string | null;
  moonPhase: string | null;
  events: string[];
};

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

export const EphemeridesCard = ({ sunrise, sunset, moonPhase, events }: EphemeridesCardProps): JSX.Element => {
  const items = events.length > 0 ? events : ["Sin efemérides registradas"];
  const repeatedItems = repeatItems(items);

  return (
    <div className="card ephemerides-card">
      <div className="ephemerides-card__header">
        <BookOpenIcon className="card-icon" aria-hidden="true" />
        <h2>Efemérides</h2>
      </div>
      <div className="ephemerides-card__meta">
        <div>
          <span className="ephemerides-card__label">Amanecer</span>
          <span>{sunrise ?? "--:--"}</span>
        </div>
        <div>
          <span className="ephemerides-card__label">Atardecer</span>
          <span>{sunset ?? "--:--"}</span>
        </div>
        <div>
          <span className="ephemerides-card__label">Fase lunar</span>
          <span>{moonPhase ?? "Sin datos"}</span>
        </div>
      </div>
      <div className="ephemerides-card__scroller">
        <div className="ephemerides-card__events">
          {repeatedItems.map((item, index) => (
            // Usar índice completo para garantizar keys únicas (incluso después de duplicar)
            <p key={`ephemerides-${index}`}>{item}</p>
          ))}
        </div>
        <div className="ephemerides-card__gradient" aria-hidden="true" />
      </div>
    </div>
  );
};

export default EphemeridesCard;
