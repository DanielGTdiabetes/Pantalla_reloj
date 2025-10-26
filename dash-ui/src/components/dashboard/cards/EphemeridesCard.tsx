import { BookOpenIcon } from "../../icons";

type EphemeridesCardProps = {
  sunrise: string | null;
  sunset: string | null;
  moonPhase: string | null;
  events: string[];
};

export const EphemeridesCard = ({ sunrise, sunset, moonPhase, events }: EphemeridesCardProps): JSX.Element => {
  const items = events.length > 0 ? events : ["Sin efemérides registradas"];

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
      <div className="ephemerides-card__events">
        {items.map((item, index) => (
          <p key={`${item}-${index}`}>{item}</p>
        ))}
      </div>
    </div>
  );
};

export default EphemeridesCard;
