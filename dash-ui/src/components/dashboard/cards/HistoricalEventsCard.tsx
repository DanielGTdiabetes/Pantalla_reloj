import { useState, useEffect, useRef } from "react";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const list = items.length > 0 ? items : ["No hay efemérides para este día."];
  const parsedEvents = list.map(parseEvent);

  useEffect(() => {
    if (parsedEvents.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % parsedEvents.length);
    }, rotationSeconds * 1000);
    return () => clearInterval(interval);
  }, [parsedEvents.length, rotationSeconds]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    const el = scrollRef.current;
    if (!el) return;

    let animId: number;
    let start: number | null = null;
    const delay = 2000;

    const step = (ts: number) => {
      if (!start) start = ts;
      if (ts - start > delay && el.scrollHeight > el.clientHeight) {
        el.scrollTop += 0.5;
      }
      animId = requestAnimationFrame(step);
    };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [currentIndex]);

  const current = parsedEvents[currentIndex];

  return (
    <div className="historical-card-dark" data-testid="panel-history">
      <div className="historical-card-dark__header">
        <img src="/icons/misc/efemerides.svg" alt="" className="historical-card-dark__icon panel-title-icon" />
        <span className="historical-card-dark__title panel-title-text">Efemérides Históricas</span>
      </div>

      <div className="historical-card-dark__body panel-body" key={currentIndex}>
        {current.year && (
          <div className="historical-card-dark__year panel-item-title">{current.year}</div>
        )}
        <div ref={scrollRef} className="historical-card-dark__text no-scrollbar panel-scroll-auto">
          <p className="panel-item-subtitle">{capitalizeText(current.text)}</p>
        </div>
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
          background: linear-gradient(135deg, #44403c 0%, #1c1917 100%);
          color: white;
          overflow: hidden;
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
