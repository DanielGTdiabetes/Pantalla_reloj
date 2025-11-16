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
        <div>
          <span className="ephemerides-card__label">Fase lunar</span>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
            <MoonIcon
              phase={moonPhase}
              illumination={illumination}
              size={48}
              className="ephemerides-card__moon-icon"
              alt="Fase lunar actual"
            />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", minWidth: 0, flex: "1 1 auto" }}>
              <span style={{ wordBreak: "break-word", textAlign: "center", fontSize: "0.95em" }}>{moonPhase ?? "Sin datos"}</span>
              {illumination !== null && illumination !== undefined && (
                <span style={{ fontSize: "0.85em", opacity: 0.8 }}>
                  {Math.round(illumination > 1 ? illumination : illumination * 100)}%
                </span>
              )}
            </div>
          </div>
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
