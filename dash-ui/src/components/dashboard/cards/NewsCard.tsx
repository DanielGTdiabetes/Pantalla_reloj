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
      return !readIds.has(id);
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
    <div className="card news-card news-card-enhanced">
      <div className="news-card__header">
        <NewsIconImage size={48} className="card-icon" />
        <h2>Noticias del día</h2>
      </div>
      <div className="news-card__scroller">
        <div className="news-card__list">
          {repeatItems(list).map((item, index) => (
            // Usar índice completo para garantizar keys únicas (incluso después de duplicar)
            <article key={`news-${index}`} className="news-item">
              {item.source && (
                <div className="news-source">{item.source}</div>
              )}
              <h3 className="news-title">{item.title}</h3>
              {item.summary && (
                <p className="news-summary">{item.summary}</p>
              )}
            </article>
          ))}
        </div>
      </div>
      <div className="news-card__gradient" aria-hidden="true" />
    </div>
  );
};

export default NewsCard;
