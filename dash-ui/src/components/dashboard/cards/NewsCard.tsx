import { NewspaperIcon } from "../../icons";
import { useState, useEffect, useMemo, useRef } from "react";
import { StandardCard } from "../StandardCard";

type NewsItem = {
  title: string;
  summary?: string;
  source?: string;
};

type NewsCardProps = {
  items: NewsItem[];
};

const STORAGE_KEY_READ_NEWS = "pantalla-reloj-read-news";

// Función helper para obtener noticias leídas desde localStorage
const getReadNewsIds = (): Set<string> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_READ_NEWS);
    if (stored) {
      const data = JSON.parse(stored);
      // Limpiar IDs antiguos (más de 24 horas)
      const now = Date.now();
      const validIds = new Set<string>();
      for (const [id, timestamp] of Object.entries(data)) {
        if (typeof timestamp === "number" && (now - timestamp) < 24 * 60 * 60 * 1000) {
          validIds.add(id);
        }
      }
      return validIds;
    }
  } catch (error) {
    console.warn("[NewsCard] Error reading read news from localStorage:", error);
  }
  return new Set<string>();
};

// Función helper para generar un ID único para una noticia
const getNewsId = (item: NewsItem): string => {
  const text = `${item.title}|${item.source || ""}|${item.summary || ""}`;
  // Usar hash simple basado en el texto
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convertir a 32bit integer
  }
  return Math.abs(hash).toString(36);
};

// Función helper para marcar noticias como leídas
const markNewsAsRead = (items: NewsItem[]): void => {
  try {
    const stored = getReadNewsIds();
    const now = Date.now();
    const readData: Record<string, number> = {};

    // Mantener noticias leídas existentes
    stored.forEach(id => {
      readData[id] = now; // Actualizar timestamp
    });

    // Marcar todas las noticias actuales como leídas después de mostrarlas
    items.forEach(item => {
      const id = getNewsId(item);
      readData[id] = now;
    });

    localStorage.setItem(STORAGE_KEY_READ_NEWS, JSON.stringify(readData));
  } catch (error) {
    console.warn("[NewsCard] Error marking news as read:", error);
  }
};

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

const NewsIconImage: React.FC<{ size?: number; className?: string }> = ({ size = 48, className = "" }) => {
  const [iconError, setIconError] = useState(false);
  const iconPath = "/icons/misc/news.svg";
  const emojiFallback = "📰";

  useEffect(() => {
    setIconError(false);
  }, [iconPath]);

  if (iconError || !iconPath) {
    return (
      <span style={{ fontSize: `${size}px`, lineHeight: 1 }} className={className} role="img" aria-label="Noticias">
        {emojiFallback}
      </span>
    );
  }

  return (
    <img
      src={iconPath}
      alt="Noticias"
      className={className}
      style={{ width: `${size}px`, height: `${size}px`, objectFit: "contain" }}
      onError={() => setIconError(true)}
      loading="lazy"
    />
  );
};

export const NewsCard = ({ items }: NewsCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Rotation logic - 8 seconds per headline
  useEffect(() => {
    if (items.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [items.length]);

  const currentItem = items[currentIndex] || { title: "Cargando noticias...", summary: "Espere un momento..." };

  return (
    <StandardCard
      title="Noticias"
      subtitle={currentItem.source || "Última Hora"}
      icon={<NewsIconImage size={32} className="drop-shadow-lg" />}
      className="news-card-root relative overflow-hidden"
    >
      {/* Subtle Background Pattern */}
      <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

      <div className="flex flex-col h-full justify-between py-2 relative z-10" key={currentIndex}>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col justify-center gap-4 px-2 animate-fade-in-up">
          <div className="w-12 h-1 bg-cyan-400 rounded-full mb-2 opacity-80" />

          <h2 className="text-xl md:text-2xl font-black text-white leading-tight drop-shadow-md line-clamp-4">
            {currentItem.title}
          </h2>

          {currentItem.summary && (
            <div className="mt-2 p-3 bg-white/10 rounded-lg border-l-2 border-cyan-400 backdrop-blur-sm">
              <p className="text-sm md:text-base text-gray-100 font-medium leading-relaxed line-clamp-3">
                {currentItem.summary}
              </p>
            </div>
          )}
        </div>

        {/* Pagination/Progress */}
        {items.length > 1 && (
          <div className="flex gap-1.5 mt-auto pt-4 justify-center opacity-60">
            {items.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'w-6 bg-cyan-400' : 'w-1.5 bg-white/30'}`}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .news-card-root {
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%) !important;
            color: white !important;
        }
        .animate-fade-in-up {
            animation: fadeInUp 0.5s ease-out forwards;
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </StandardCard>
  );
};

export default NewsCard;
