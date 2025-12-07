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
    <div className="historical-card-v2">
      <div className="historical-card-v2__header">
        <span className="historical-card-v2__icon">📜</span>
        <span className="historical-card-v2__title">Efemérides Históricas</span>
      </div>

      <div className="historical-card-v2__body" key={currentIndex}>
        {current.year && (
          <div className="historical-card-v2__year">{current.year}</div>
        )}
        <div ref={scrollRef} className="historical-card-v2__text">
          <p>{current.text}</p>
        </div>
      </div>

      {parsedEvents.length > 1 && (
        <div className="historical-card-v2__dots">
          {parsedEvents.map((_, idx) => (
            <span key={idx} className={`historical-card-v2__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .historical-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          overflow: hidden;
        }
        .historical-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .historical-card-v2__icon {
          font-size: 2rem;
        }
        .historical-card-v2__title {
          font-size: 1.2rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .historical-card-v2__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          min-height: 0;
          animation: fadeIn-v2 0.5s ease-out;
        }
        .historical-card-v2__year {
          font-size: 1.8rem;
          font-weight: 900;
          color: #92400e;
          background: rgba(146,64,14,0.1);
          padding: 0.25rem 0.75rem;
          border-radius: 0.5rem;
          margin-bottom: 0.5rem;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .historical-card-v2__text {
          flex: 1;
          overflow-y: auto;
          text-align: center;
          font-size: 1rem;
          line-height: 1.5;
          padding: 0 0.5rem;
          color: #334155;
        }
        .historical-card-v2__text p {
          margin: 0;
        }
        .historical-card-v2__dots {
          display: flex;
          justify-content: center;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .historical-card-v2__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(0,0,0,0.2);
          transition: all 0.3s;
        }
        .historical-card-v2__dot.active {
          background: #92400e;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes fadeIn-v2 {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default HistoricalEventsCard;
