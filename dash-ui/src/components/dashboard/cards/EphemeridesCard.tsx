import { BookOpenIcon, SunriseIcon, SunsetIcon } from "../../icons";
import { MoonIcon } from "../../MoonIcon";

type EphemeridesCardProps = {
  sunrise: string | null;
  sunset: string | null;
  moonPhase: string | null;
  events: string[];
  illumination?: number | null;
};

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

export const EphemeridesCard = ({ sunrise, sunset, moonPhase, events, illumination }: EphemeridesCardProps): JSX.Element => {
  // Si no hay eventos, no mostrar mensaje "Sin datos" - dejar espacio para que se vean mejor los datos astronómicos
  const items = events.length > 0 ? events : [];
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexDirection: "column" }}>
            <span>{sunrise ?? "--:--"}</span>
            <SunriseIcon style={{ width: "32px", height: "32px", opacity: 0.9 }} aria-hidden="true" />
          </div>
        </div>
        <div>
          <span className="ephemerides-card__label">Atardecer</span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexDirection: "column" }}>
            <span>{sunset ?? "--:--"}</span>
            <SunsetIcon style={{ width: "32px", height: "32px", opacity: 0.9 }} aria-hidden="true" />
          </div>
        </div>
        <div className="ephemerides-card__moon-container">
          <span className="ephemerides-card__label">Fase lunar</span>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "center", width: "100%" }}>
            <MoonIcon
              phase={moonPhase}
              illumination={illumination}
              size={48}
              className="ephemerides-card__moon-icon"
              alt="Fase lunar actual"
            />
            <div className="ephemerides-card__moon-text">
              <span className="ephemerides-card__moon-phase">{moonPhase ?? "Sin datos"}</span>
              {illumination !== null && illumination !== undefined && (
                <span className="ephemerides-card__moon-illumination">
                  {Math.round(illumination > 1 ? illumination : illumination * 100)}%
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {items.length > 0 ? (
        <div className="ephemerides-card__scroller">
          <div className="ephemerides-card__events">
            {repeatedItems.map((item, index) => (
              // Usar índice completo para garantizar keys únicos (incluso después de duplicar)
              <p key={`ephemerides-${index}`}>{item}</p>
            ))}
          </div>
          <div className="ephemerides-card__gradient" aria-hidden="true" />
        </div>
      ) : (
        <div style={{ 
          padding: "20px", 
          textAlign: "center", 
          color: "var(--text-muted)",
          fontSize: "0.95rem",
          opacity: 0.7
        }}>
          Cargando efemérides históricas...
        </div>
      )}
    </div>
  );
};

export default EphemeridesCard;
