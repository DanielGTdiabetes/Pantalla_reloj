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
    }, 10000);
    return () => clearInterval(interval);
  }, [validItems.length]);

  const current = validItems[currentIndex];
  const sourceLabel = current.source || "Fuente desconocida";

  const summaryContent = current.summary ? stripHtml(current.summary) : "";

  return (
    <div className="news-card" data-testid="panel-news">
      <div className="news-card__header">
        <img src="/icons/misc/news.svg" alt="" className="news-card__icon panel-title-icon" />
        <span className="news-card__title panel-title-text">Noticias</span>
      </div>

      <div className="news-card__body panel-body" key={currentIndex}>
        <div className="news-card__source panel-item-subtitle">Fuente: {sourceLabel}</div>
        <div className="news-card__content">
          <h3 className="news-card__headline">{stripHtml(current.title)}</h3>
          {summaryContent ? (
            <AutoScrollContainer
              className="news-card__summary-wrapper"
              speed={12}
              pauseAtEndMs={3500}
              overflowThreshold={10}
            >
              <p className="news-card__summary">{summaryContent}</p>
            </AutoScrollContainer>
          ) : (
            <p className="news-card__summary news-card__summary--static">Sin resumen disponible</p>
          )}
        </div>
      </div>

      {validItems.length > 1 && (
        <div className="news-card__dots">
          {validItems.map((_, idx) => (
            <span key={idx} className={`news-card__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .news-card {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 1rem;
          box-sizing: border-box;
          background: linear-gradient(145deg, rgba(18, 27, 48, 0.92), rgba(12, 19, 33, 0.9));
          color: #eaeaea;
          overflow: hidden;
          border-radius: 1rem;
          border: 1px solid rgba(255,255,255,0.06);
          backdrop-filter: blur(10px);
        }
        .news-card__header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .news-card__icon {
          width: 42px;
          height: 42px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25));
        }
        .news-card__title {
          font-size: 1.05rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .news-card__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          gap: 0.35rem;
        }
        .news-card__source {
          font-size: 0.9rem;
          font-weight: 600;
          color: #9ad8ff;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .news-card__content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          min-height: 0;
          padding: 0.35rem 0.25rem 0.25rem;
        }
        .news-card__headline {
          font-size: 1.125rem;
          font-weight: 600;
          line-height: 1.3;
          margin: 0;
          color: #f5f7fb;
        }
        .news-card__summary-wrapper {
          flex: 1;
          overflow: hidden;
          position: relative;
          padding-right: 2px;
        }
        .news-card__summary {
          font-size: 1rem;
          line-height: 1.4;
          font-weight: 400;
          margin: 0;
          color: #e1e7ef;
        }
        .news-card__summary--static {
          opacity: 0.85;
        }
        .news-card__dots {
          display: flex;
          justify-content: center;
          gap: 0.35rem;
          margin-top: 0.75rem;
        }
        .news-card__dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: rgba(255,255,255,0.22);
          transition: all 0.3s ease;
        }
        .news-card__dot.active {
          background: #5dc3ff;
          width: 20px;
          border-radius: 6px;
        }
      `}</style>
    </div>
  );
};

export default NewsCard;
