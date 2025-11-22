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

  const illuminationPercent = illumination !== null && illumination !== undefined
    ? Math.round(illumination > 1 ? illumination : illumination * 100)
    : null;

  return (
    <div className="card ephemerides-card ephemerides-card-enhanced">
      <div className="ephemerides-card__header">
        <BookOpenIcon className="card-icon" aria-hidden="true" />
        <h2>Astronomía</h2>
      </div>
      
      <div className="moon-phase">
        <div className="moon-phase-visual" style={{
          background: illuminationPercent !== null
            ? `radial-gradient(circle at ${50 - (illuminationPercent / 2)}% 50%, #f0f0f0, #c0c0c0)`
            : 'radial-gradient(circle at 50% 50%, #f0f0f0, #c0c0c0)',
          boxShadow: illuminationPercent !== null
            ? `inset ${-40 + (illuminationPercent / 2.5)}px 0 0 rgba(0, 0, 0, 0.3), 0 0 20px rgba(0, 0, 0, 0.2)`
            : 'inset -40px 0 0 rgba(0, 0, 0, 0.3), 0 0 20px rgba(0, 0, 0, 0.2)'
        }} />
        <div className="moon-info">
          <span className="phase-name">{moonPhase ?? "Sin datos"}</span>
          {illuminationPercent !== null && (
            <span className="illumination">{illuminationPercent}% iluminada</span>
          )}
        </div>
      </div>

      <div className="sun-timeline">
        <div className="sun-event">
          <SunriseIcon style={{ width: "32px", height: "32px", color: "var(--theme-accent)" }} aria-hidden="true" />
          <span className="label">Amanecer</span>
          <span className="time">{sunrise ?? "--:--"}</span>
        </div>
        <div className="sun-event">
          <SunsetIcon style={{ width: "32px", height: "32px", color: "var(--theme-accent-secondary)" }} aria-hidden="true" />
          <span className="label">Atardecer</span>
          <span className="time">{sunset ?? "--:--"}</span>
        </div>
      </div>

      {items.length > 0 && (
        <div className="astro-events" style={{ flexShrink: 1, minHeight: 0 }}>
          <h3>Eventos</h3>
          <ul>
            {repeatedItems.slice(0, 3).map((item, index) => (
              <li key={`ephemerides-${index}`}>
                <span>⭐</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default EphemeridesCard;
