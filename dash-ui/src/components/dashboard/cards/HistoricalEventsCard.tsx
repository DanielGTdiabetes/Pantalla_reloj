import { useState, useEffect } from "react";

type HistoricalEventItem = string;

type HistoricalEventsCardProps = {
  items: HistoricalEventItem[];
  rotationSeconds?: number;
};

const HistoricalEventsIconImage: React.FC<{ size?: number; className?: string }> = ({ size = 48, className = "" }) => {
  const [iconError, setIconError] = useState(false);
  const iconPath = "/icons/misc/efemerides.svg";
  const emojiFallback = "📜";

  useEffect(() => {
    setIconError(false);
  }, [iconPath]);

  if (iconError || !iconPath) {
    return (
      <span style={{ fontSize: `${size}px`, lineHeight: 1 }} className={className} role="img" aria-label="Efemérides históricas">
        {emojiFallback}
      </span>
    );
  }

  return (
    <img
      src={iconPath}
      alt="Efemérides históricas"
      className={className}
      style={{ width: `${size}px`, height: `${size}px`, objectFit: "contain" }}
      onError={() => setIconError(true)}
      loading="lazy"
    />
  );
};

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

export const HistoricalEventsCard = ({ items, rotationSeconds = 6 }: HistoricalEventsCardProps): JSX.Element => {
  const list = items.length > 0 ? items : ["No hay efemérides para este día."];

  // Repetir items para scroll continuo
  const repeatedList = repeatItems(list);

  return (
    <div className="card historical-events-card">
      <div className="historical-events-card__header">
        <HistoricalEventsIconImage size={48} className="card-icon" />
        <h2>Efemérides del día</h2>
      </div>
      <div className="historical-events-card__scroller">
        <div className="historical-events-card__list">
          {repeatedList.map((item, index) => (
            <article key={`historical-event-${index}`} className="historical-events-card__item">
              <p>{item}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="historical-events-card__gradient" aria-hidden="true" />
    </div>
  );
};

export default HistoricalEventsCard;

