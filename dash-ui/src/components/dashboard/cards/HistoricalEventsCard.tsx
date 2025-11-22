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

const parseEvent = (item: string): { year?: number; text: string; category?: string } => {
  // Intentar extraer año del formato "YYYY: texto" o "texto (YYYY)"
  const yearMatch = item.match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
  
  // Determinar categoría por palabras clave
  const text = item.replace(/\d{4}:\s*/, '').trim();
  let category = 'other';
  const lowerText = text.toLowerCase();
  if (lowerText.includes('ciencia') || lowerText.includes('descubrimiento') || lowerText.includes('invento')) {
    category = 'science';
  } else if (lowerText.includes('política') || lowerText.includes('guerra') || lowerText.includes('revolución')) {
    category = 'politics';
  } else if (lowerText.includes('cultura') || lowerText.includes('arte') || lowerText.includes('literatura')) {
    category = 'culture';
  }
  
  return { year, text, category };
};

const getCategoryColor = (category?: string): string => {
  switch (category) {
    case 'science': return '#4dabf7';
    case 'politics': return '#ff6b6b';
    case 'culture': return '#51cf66';
    default: return '#868e96';
  }
};

export const HistoricalEventsCard = ({ items, rotationSeconds = 6 }: HistoricalEventsCardProps): JSX.Element => {
  const list = items.length > 0 ? items : ["No hay efemérides para este día."];
  // Limitar a 2 eventos para evitar desbordes en pantalla
  const visibleEvents = list.slice(0, 2).map(parseEvent);

  return (
    <div className="card historical-events-card historical-events-card-enhanced">
      <div className="historical-events-card__header">
        <HistoricalEventsIconImage size={48} className="card-icon" />
        <h2>Efemérides Históricas</h2>
      </div>
      <div className="timeline">
        {visibleEvents.map((event, index) => (
          <div key={`timeline-${index}`} className="timeline-item">
            <div 
              className={`timeline-marker timeline-marker--${event.category}`}
              style={{ background: getCategoryColor(event.category) }}
            />
            <div className="timeline-content">
              {event.year && (
                <span className="event-year">{event.year}</span>
              )}
              <p className="event-text">{event.text}</p>
              {event.category && event.category !== 'other' && (
                <span className="event-category">{event.category}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HistoricalEventsCard;

