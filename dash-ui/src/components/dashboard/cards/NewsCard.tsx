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
    <div className="news-card-dark">
      <div className="news-card-dark__header">
        <span className="news-card-dark__icon">📰</span>
        <span className="news-card-dark__title">Noticias</span>
      </div>

      <div className="news-card-dark__body" key={currentIndex}>
        {current.source && (
          <div className="news-card-dark__source">{current.source}</div>
        )}
        <h2 className="news-card-dark__headline">{current.title}</h2>
        {current.summary && (
          <p className="news-card-dark__summary">{current.summary}</p>
        )}
      </div>

      {validItems.length > 1 && (
        <div className="news-card-dark__dots">
          {validItems.map((_, idx) => (
            <span key={idx} className={`news-card-dark__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .news-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
          color: white;
          overflow: hidden;
        }
        .news-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .news-card-dark__icon {
          font-size: 2rem;
        }
        .news-card-dark__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .news-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 0;
          animation: fadeIn-dark 0.5s ease-out;
        }
        .news-card-dark__source {
          font-size: 0.75rem;
          font-weight: 700;
          color: #38bdf8;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 0.25rem;
        }
        .news-card-dark__headline {
          font-size: 1.2rem;
          font-weight: 700;
          line-height: 1.3;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .news-card-dark__summary {
          font-size: 0.9rem;
          line-height: 1.4;
          opacity: 0.8;
          margin: 0.5rem 0 0 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .news-card-dark__dots {
          display: flex;
          justify-content: center;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .news-card-dark__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .news-card-dark__dot.active {
          background: #38bdf8;
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

export default NewsCard;
