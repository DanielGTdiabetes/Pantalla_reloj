import { NewspaperIcon } from "../../icons";
import { useState, useEffect, useMemo, useRef } from "react";

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
  const readNewsIdsRef = useRef<Set<string>>(getReadNewsIds());
  const hasMarkedAsReadRef = useRef(false);

  // Filtrar noticias no leídas
  const unreadNews = useMemo(() => {
    if (items.length === 0) {
      return [{ title: "Sin titulares disponibles" }];
    }

    // Obtener IDs de noticias leídas
    const readIds = readNewsIdsRef.current;

    // Filtrar noticias no leídas
    const unread = items.filter(item => {
      const id = getNewsId(item);
      return !readIds?.has(id);
    });

    // Si todas están leídas o no hay noticias no leídas, mostrar todas
    // (para que siempre haya algo que mostrar)
    if (unread.length === 0 && items.length > 0) {
      // Resetear noticias leídas si todas están leídas para mostrar de nuevo
      localStorage.removeItem(STORAGE_KEY_READ_NEWS);
      readNewsIdsRef.current = new Set();
      return items;
    }

    return unread.length > 0 ? unread : items;
  }, [items]);

  // Marcar noticias como leídas después de un tiempo de visualización
  useEffect(() => {
    if (hasMarkedAsReadRef.current || unreadNews.length === 0 || unreadNews[0].title === "Sin titulares disponibles") {
      return;
    }

    // Marcar como leídas después de 15 segundos (tiempo suficiente para leer)
    const timer = window.setTimeout(() => {
      markNewsAsRead(unreadNews);
      hasMarkedAsReadRef.current = true;
      readNewsIdsRef.current = getReadNewsIds();
    }, 15000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [unreadNews]);

  const list = unreadNews;

  // Resetear flag cuando cambian los items
  useEffect(() => {
    hasMarkedAsReadRef.current = false;
  }, [items.length]);

  return (
    <StandardCard
      title="Noticias"
      subtitle={new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
      icon={<NewsIconImage size={32} className="drop-shadow-lg" />}
      noPadding
    >
      <div className="w-full h-full relative flex flex-col items-center justify-center p-4">
        {/* Marquee/Scroll Container */}
        <div className="w-full h-full overflow-hidden relative mask-linear-fade">
          <div className="absolute top-0 left-0 w-full animate-marquee-vertical flex flex-col gap-6">
            {repeatItems(list).map((item, index) => (
              <article key={`news-${index}`} className="flex flex-col gap-1 w-full p-4 bg-white/5 rounded-xl border border-white/5 backdrop-blur-sm shadow-sm transition-transform hover:scale-[1.02]">
                {item.source && (
                  <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider opacity-80">
                    {item.source}
                  </span>
                )}
                <h3 className="text-base md:text-lg font-bold text-white leading-tight text-shadow-sm">
                  {item.title}
                </h3>
                {item.summary && (
                  <p className="text-sm text-gray-300 leading-relaxed line-clamp-2">
                    {item.summary}
                  </p>
                )}
              </article>
            ))}
          </div>
        </div>

        {/* Gradients for smooth fade */}
        <div className="absolute top-0 left-0 w-full h-8 bg-gradient-to-b from-black/20 to-transparent pointer-events-none z-10" />
        <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-black/40 to-transparent pointer-events-none z-10" />
      </div>

      <style>{`
        @keyframes marquee-vertical {
          0% { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        .animate-marquee-vertical {
          animation: marquee-vertical ${Math.max(20, list.length * 5)}s linear infinite;
        }
        /* Pause on hover if interactive */
        .animate-marquee-vertical:hover {
          animation-play-state: paused;
        }
        .mask-linear-fade {
          mask-image: linear-gradient(to bottom, transparent, black 10%, black 90%, transparent);
          -webkit-mask-image: linear-gradient(to bottom, transparent, black 10%, black 90%, transparent);
        }
      `}</style>
    </StandardCard>
  );
};

export default NewsCard;
