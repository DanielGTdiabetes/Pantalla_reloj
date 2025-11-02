import { NewspaperIcon } from "../../icons";
import { useState, useEffect } from "react";

type NewsItem = {
  title: string;
  summary?: string;
  source?: string;
};

type NewsCardProps = {
  items: NewsItem[];
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
  const list = items.length > 0 ? items : [{ title: "Sin titulares disponibles" }];

  return (
    <div className="card news-card">
      <div className="news-card__header">
        <NewsIconImage size={48} className="card-icon" />
        <h2>Noticias del día</h2>
      </div>
      <div className="news-card__scroller">
        <div className="news-card__list">
          {repeatItems(list).map((item, index) => (
            // Usar índice completo para garantizar keys únicas (incluso después de duplicar)
            <article key={`news-${index}`} className="news-card__item">
              <h3>{item.title}</h3>
              {item.summary ? <p>{item.summary}</p> : null}
              {item.source ? <span className="news-card__source">{item.source}</span> : null}
            </article>
          ))}
        </div>
      </div>
      <div className="news-card__gradient" aria-hidden="true" />
    </div>
  );
};

export default NewsCard;
