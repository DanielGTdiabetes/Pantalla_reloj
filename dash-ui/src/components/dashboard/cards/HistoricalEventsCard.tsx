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

export const HistoricalEventsCard = ({ items, rotationSeconds = 10 }: HistoricalEventsCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fade, setFade] = useState(true);

  const list = items.length > 0 ? items : ["No hay efemérides para este día."];
  const parsedEvents = list.map(parseEvent);

  useEffect(() => {
    if (parsedEvents.length <= 1) return;

    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % parsedEvents.length);
        setFade(true);
      }, 500); // Wait for fade out
    }, rotationSeconds * 1000);

    return () => clearInterval(interval);
  }, [parsedEvents.length, rotationSeconds]);

  const currentEvent = parsedEvents[currentIndex];

  return (
    <div className="card historical-events-card historical-events-card-enhanced">
      <div className="historical-events-card__header">
        <HistoricalEventsIconImage size={48} className="card-icon" />
        <h2>Efemérides Históricas</h2>
      </div>
      <div className="historical-events-content">
        <div className={`event-display ${fade ? 'fade-in' : 'fade-out'}`}>
          <div className="timeline-item single-item">
            <div
              className={`timeline-marker timeline-marker--${currentEvent.category}`}
              style={{ background: getCategoryColor(currentEvent.category) }}
            />
            <div className="timeline-content">
              {currentEvent.year && (
                <span className="event-year">{currentEvent.year}</span>
              )}
              <p className="event-text">{currentEvent.text}</p>
              {currentEvent.category && currentEvent.category !== 'other' && (
                <span className="event-category">{currentEvent.category}</span>
              )}
            </div>
          </div>
        </div>
        <div className="event-pagination">
          {parsedEvents.length > 1 && parsedEvents.map((_, idx) => (
            <span
              key={idx}
              className={`pagination-dot ${idx === currentIndex ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default HistoricalEventsCard;

