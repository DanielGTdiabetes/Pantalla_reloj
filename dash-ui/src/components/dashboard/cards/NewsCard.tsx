import { useEffect, useState } from "react";

import { AutoScrollContainer } from "../../common/AutoScrollContainer";

type NewsItem = {
  title: string;
  summary?: string;
  source?: string;
};

type NewsCardProps = {
  items: NewsItem[];
};

// Utility to clean text from simple HTML tags if they leak through
// Utility to clean text from simple HTML tags if they leak through
const stripHtml = (html: string) => {
  if (!html) return "";
  const tmp = document.createElement("DIV");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").trim();
};

// Panel lateral de noticias
export const NewsCard = ({ items }: NewsCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const validItems = items && items.length > 0 ? items : [{ title: "Sin noticias disponibles" }];

  useEffect(() => {
    if (validItems.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % validItems.length);
    }, 10000); // Slower cycle for reading
    return () => clearInterval(interval);
  }, [validItems.length]);

  const current = validItems[currentIndex];
  const sourceLabel = current.source || "El País";

  return (
    <div className="news-card-dark" data-testid="panel-news">
      <div className="news-card-dark__header">
        <img src="/icons/misc/news.svg" alt="" className="news-card-dark__header-icon panel-title-icon" />
        <span className="news-card-dark__title panel-title-text">Noticias</span>
      </div>

      <div className="news-card-dark__body panel-body" key={currentIndex}>
        <div className="news-card-dark__source panel-item-subtitle">Fuente: {sourceLabel}</div>
        <AutoScrollContainer className="news-card-dark__content">
          <h2 className="news-card-dark__headline panel-item-title">{stripHtml(current.title)}</h2>
          {current.summary && (
            <p className="news-card-dark__summary panel-item-subtitle">{stripHtml(current.summary)}</p>
          )}
        </AutoScrollContainer>
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
          padding: 1rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
          color: white;
          overflow: hidden;
          border-radius: 1rem;
        }
        .news-card-dark__header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .news-card-dark__header-icon {
          width: 52px;
          height: 52px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .news-card-dark__title {
          font-size: 1.4rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
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
          font-size: 0.95rem;
          font-weight: 700;
          color: #38bdf8;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 0.35rem;
        }
        .news-card-dark__content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          overflow: hidden;
        }
        .news-card-dark__headline {
          font-size: 1.8rem;
          font-weight: 800;
          line-height: 1.2;
          margin: 0;
          overflow: hidden;
          text-shadow: 0 2px 8px rgba(0,0,0,0.6);
        }
        .news-card-dark__summary {
          font-size: 1.05rem;
          line-height: 1.5;
          opacity: 0.9;
          margin: 0;
          overflow: hidden;
        }
        .news-card-dark__dots {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 1rem;
        }
        .news-card-dark__dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .news-card-dark__dot.active {
          background: #38bdf8;
          width: 24px;
          border-radius: 5px;
        }
        @keyframes fadeIn-dark {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default NewsCard;
