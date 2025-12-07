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

  // Auto-scroll for long text
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
    <div className="historical-card-3d">
      <div className="historical-card-3d__header">📜 Efemérides Históricas</div>

      <div className="historical-card-3d__content" key={currentIndex}>
        {current.year && (
          <div className="historical-card-3d__year">{current.year}</div>
        )}
        <div ref={scrollRef} className="historical-card-3d__text">
          <p>{current.text}</p>
        </div>
      </div>

      {parsedEvents.length > 1 && (
        <div className="historical-card-3d__dots">
          {parsedEvents.map((_, idx) => (
            <span key={idx} className={`historical-card-3d__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .historical-card-3d {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          overflow: hidden;
        }
        .historical-card-3d__header {
          font-size: 0.9rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          opacity: 0.8;
          margin-bottom: 0.5rem;
          text-align: center;
        }
        .historical-card-3d__content {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          min-height: 0;
          animation: fadeIn3d 0.5s ease-out;
        }
        .historical-card-3d__year {
          font-size: 1.5rem;
          font-weight: 900;
          color: #fbbf24;
          background: rgba(251,191,36,0.15);
          padding: 0.25rem 0.75rem;
          border-radius: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .historical-card-3d__text {
          flex: 1;
          overflow-y: auto;
          text-align: center;
          font-size: 0.95rem;
          line-height: 1.5;
          padding: 0 0.5rem;
        }
        .historical-card-3d__text p {
          margin: 0;
        }
        .historical-card-3d__dots {
          display: flex;
          justify-content: center;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .historical-card-3d__dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .historical-card-3d__dot.active {
          background: #fbbf24;
          width: 14px;
          border-radius: 3px;
        }
        @keyframes fadeIn3d {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default HistoricalEventsCard;
