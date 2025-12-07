import { useState, useEffect } from "react";

type NewsItem = {
  title: string;
  summary?: string;
  source?: string;
};

type NewsCardProps = {
  items: NewsItem[];
};

export const NewsCard = ({ items }: NewsCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const validItems = items && items.length > 0 ? items : [{ title: "Sin noticias disponibles" }];

  useEffect(() => {
    if (validItems.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % validItems.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [validItems.length]);

  const current = validItems[currentIndex];

  return (
    <div className="news-card-3d">
      <div className="news-card-3d__header">📰 Noticias</div>

      <div className="news-card-3d__content" key={currentIndex}>
        {current.source && (
          <div className="news-card-3d__source">{current.source}</div>
        )}
        <h2 className="news-card-3d__title">{current.title}</h2>
        {current.summary && (
          <p className="news-card-3d__summary">{current.summary}</p>
        )}
      </div>

      {validItems.length > 1 && (
        <div className="news-card-3d__dots">
          {validItems.map((_, idx) => (
            <span key={idx} className={`news-card-3d__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .news-card-3d {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          overflow: hidden;
        }
        .news-card-3d__header {
          font-size: 0.9rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          opacity: 0.8;
          margin-bottom: 0.5rem;
          text-align: center;
        }
        .news-card-3d__content {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 0;
          animation: fadeIn3d 0.5s ease-out;
        }
        .news-card-3d__source {
          font-size: 0.7rem;
          font-weight: 700;
          color: #38bdf8;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 0.25rem;
        }
        .news-card-3d__title {
          font-size: 1.1rem;
          font-weight: 700;
          line-height: 1.3;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .news-card-3d__summary {
          font-size: 0.85rem;
          line-height: 1.4;
          opacity: 0.8;
          margin: 0.5rem 0 0 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .news-card-3d__dots {
          display: flex;
          justify-content: center;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .news-card-3d__dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .news-card-3d__dot.active {
          background: #38bdf8;
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

export default NewsCard;
