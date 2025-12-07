import { useState, useEffect, useRef } from "react";

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

export const HistoricalEventsCard = ({ items, rotationSeconds = 15 }: HistoricalEventsCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const list = items.length > 0 ? items : ["No hay efemérides para este día."];
  const parsedEvents = list.map(parseEvent);

  // Auto-scroll logic ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (parsedEvents.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % parsedEvents.length);
    }, rotationSeconds * 1000);

    return () => clearInterval(interval);
  }, [parsedEvents.length, rotationSeconds]);

  // Reset scroll on change
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [currentIndex]);

  // Auto-scroll animation logic
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    let animationFrameId: number;
    let startTimestamp: number | null = null;
    const delayBeforeScroll = 2000; // 2s wait before scrolling

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = timestamp - startTimestamp;

      if (progress > delayBeforeScroll) {
        // Slow scroll down
        if (el.scrollHeight > el.clientHeight) {
          el.scrollTop += 0.5; // pixels per frame
        }
      }
      animationFrameId = requestAnimationFrame(step);
    };

    animationFrameId = requestAnimationFrame(step);

    return () => cancelAnimationFrame(animationFrameId);
  }, [currentIndex]);

  const currentEvent = parsedEvents[currentIndex];

  return (
    <div className="card historical-events-card historical-events-card-enhanced relative overflow-hidden bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-3xl border border-white/10 shadow-2xl">

      {/* Background Noise */}
      <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

      {/* Header */}
      <div className="flex items-center gap-3 p-5 border-b border-white/10 bg-black/20 backdrop-blur-md z-10 relative">
        <div className="w-10 h-10 flex items-center justify-center bg-amber-500/20 rounded-full border border-amber-500/30">
          <span className="text-2xl">📜</span>
        </div>
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wider text-amber-100">Efemérides</h2>
          <p className="text-xs text-amber-100/60 font-mono tracking-widest">TAL DÍA COMO HOY</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col h-full p-6 relative z-10 animate-fade-in">
        {/* Year Badge */}
        {currentEvent.year && (
          <div className="self-start mb-4 bg-amber-500 text-black font-black text-xl px-4 py-1 rounded-lg shadow-lg transform -rotate-2">
            {currentEvent.year}
          </div>
        )}

        {/* Scrollable Text Area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-hidden relative"
        >
          <p className="text-lg md:text-xl font-medium leading-relaxed text-indigo-50 text-shadow-sm font-serif">
            {currentEvent.text}
          </p>

          {/* Fade at bottom to indicate more text if needed, though auto-scroll handles it */}
          <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-indigo-950 to-transparent pointer-events-none" />
        </div>

        {/* Pagination Dots */}
        {parsedEvents.length > 1 && (
          <div className="flex justify-center gap-2 mt-4 pt-2 border-t border-white/10">
            {parsedEvents.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'w-6 bg-amber-500' : 'w-1.5 bg-white/20'}`}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
          .historical-events-card-enhanced {
              height: 100%;
              display: flex;
              flex-col: column;
          }
          .animate-fade-in {
              animation: fadeIn 0.5s ease-out;
          }
          @keyframes fadeIn {
              from { opacity: 0; transform: translateY(5px); }
              to { opacity: 1; transform: translateY(0); }
          }
       `}</style>
    </div>
  );
};

export default HistoricalEventsCard;

