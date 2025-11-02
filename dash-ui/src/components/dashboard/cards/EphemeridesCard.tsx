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

const getMoonIcon = (phase: string | null): string => {
  if (!phase) {
    return "/icons/moon/moon-50.svg";
  }
  
  const phaseLower = phase.toLowerCase().trim();
  
  // Mapeo de fases lunares a iconos SVG
  const phaseMap: Record<string, string> = {
    "nueva": "moon-0",
    "new": "moon-0",
    "nueva luna": "moon-0",
    "creciente": "moon-25",
    "waxing": "moon-25",
    "cuarto creciente": "moon-25",
    "llena": "moon-100",
    "full": "moon-100",
    "luna llena": "moon-100",
    "menguante": "moon-75",
    "waning": "moon-75",
    "cuarto menguante": "moon-75",
  };
  
  // Buscar coincidencia
  for (const [key, value] of Object.entries(phaseMap)) {
    if (phaseLower.includes(key) || key.includes(phaseLower)) {
      return `/icons/moon/${value}.svg`;
    }
  }
  
  // Fallback: luna en cuarto
  return "/icons/moon/moon-50.svg";
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <img
              src={getMoonIcon(moonPhase)}
              alt="Fase lunar"
              style={{ width: "24px", height: "24px" }}
              aria-hidden="true"
            />
            <span>{moonPhase ?? "Sin datos"}</span>
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
