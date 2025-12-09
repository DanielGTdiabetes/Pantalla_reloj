import { useState, useEffect } from "react";

import { AutoScrollContainer } from "../../common/AutoScrollContainer";

type HistoricalEventItem = string;

type HistoricalEventsCardProps = {
  items: HistoricalEventItem[];
  rotationSeconds?: number;
};

const parseEvent = (item: string): { year?: number; text: string } => {
  const yearMatch = item.match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
  const text = item.replace(/\d{4}:\s*/, "").trim();
  return { year, text };
};

const capitalizeText = (value: string): string => {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
};

// Panel lateral de efemérides históricas
export const HistoricalEventsCard = ({ items, rotationSeconds = 12 }: HistoricalEventsCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const list = items.length > 0 ? items : ["No hay efemérides para este día."];
  const parsedEvents = list.map(parseEvent);

  useEffect(() => {
    if (parsedEvents.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % parsedEvents.length);
    }, rotationSeconds * 1000);
    return () => clearInterval(interval);
  }, [parsedEvents.length, rotationSeconds]);

  const current = parsedEvents[currentIndex];

  return (
    <div className="historical-card-dark" data-testid="panel-history">
      <div className="historical-card-dark__header">
        <img src="/icons/misc/efemerides.png" alt="" className="historical-card-dark__icon panel-title-icon" />
        <span className="historical-card-dark__title panel-title-text">Efemérides Históricas</span>
      </div>

      <div className="historical-card-dark__body panel-body" key={currentIndex}>
        {current.year && (
          <div className="historical-card-dark__year panel-item-title">{current.year}</div>
        )}
        <AutoScrollContainer className="historical-card-dark__text">
          <p className="panel-item-subtitle">{capitalizeText(current.text)}</p>
        </AutoScrollContainer>
      </div>

      {parsedEvents.length > 1 && (
        <div className="historical-card-dark__dots">
          {parsedEvents.map((_, idx) => (
            <span key={idx} className={`historical-card-dark__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .historical-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(145deg, rgba(68, 64, 60, 0.8) 0%, rgba(28, 25, 23, 0.9) 100%);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          color: white;
          overflow: hidden;
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 
            0 20px 40px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset 0 10px 20px rgba(0,0,0,0.2);
        }
        .historical-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .historical-card-dark__icon {
          width: 42px;
          height: 42px;
          object-fit: contain;
          filter: drop-shadow(0 4px 10px rgba(0,0,0,0.35));
        }
        .historical-card-dark__title {
          font-size: 1.2rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .historical-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          min-height: 0;
          animation: fadeIn-dark 0.5s ease-out;
        }
        .historical-card-dark__year {
          font-size: 1.8rem;
          font-weight: 900;
          color: #fbbf24;
          background: rgba(251,191,36,0.15);
          padding: 0.25rem 0.75rem;
          border-radius: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .historical-card-dark__text {
          flex: 1;
          overflow-y: auto;
          text-align: center;
          font-size: 1rem;
          line-height: 1.5;
          padding: 0 0.5rem;
        }
        .historical-card-dark__text p {
          margin: 0;
        }
        .historical-card-dark__dots {
          display: flex;
          justify-content: center;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .historical-card-dark__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .historical-card-dark__dot.active {
          background: #fbbf24;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes fadeIn-dark {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default HistoricalEventsCard;
