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
    <div className="news-card-v2">
      <div className="news-card-v2__header">
        <span className="news-card-v2__icon">📰</span>
        <span className="news-card-v2__title">Noticias</span>
      </div>

      <div className="news-card-v2__body" key={currentIndex}>
        {current.source && (
          <div className="news-card-v2__source">{current.source}</div>
        )}
        <h2 className="news-card-v2__headline">{current.title}</h2>
        {current.summary && (
          <p className="news-card-v2__summary">{current.summary}</p>
        )}
      </div>

      {validItems.length > 1 && (
        <div className="news-card-v2__dots">
          {validItems.map((_, idx) => (
            <span key={idx} className={`news-card-v2__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .news-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          overflow: hidden;
        }
        .news-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .news-card-v2__icon {
          font-size: 2rem;
        }
        .news-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .news-card-v2__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 0;
          animation: fadeIn-v2 0.5s ease-out;
        }
        .news-card-v2__source {
          font-size: 0.75rem;
          font-weight: 700;
          color: #0369a1;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 0.25rem;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .news-card-v2__headline {
          font-size: 1.2rem;
          font-weight: 700;
          line-height: 1.3;
          margin: 0;
          color: #0f172a;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .news-card-v2__summary {
          font-size: 0.9rem;
          line-height: 1.4;
          color: #475569;
          margin: 0.5rem 0 0 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .news-card-v2__dots {
          display: flex;
          justify-content: center;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .news-card-v2__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(0,0,0,0.2);
          transition: all 0.3s;
        }
        .news-card-v2__dot.active {
          background: #0369a1;
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

export default NewsCard;
