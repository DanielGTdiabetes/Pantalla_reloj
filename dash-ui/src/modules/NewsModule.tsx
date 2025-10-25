import React from "react";

type NewsItem = {
  title?: string;
  source?: string;
  published_at?: string;
  publishedAt?: string;
};

type Props = {
  data: Record<string, unknown>;
};

export const NewsModule: React.FC<Props> = ({ data }) => {
  const headline = (data.headline as string) ?? "Últimas noticias";
  const items = (data.items as NewsItem[]) ?? [];

  return (
    <div className="module-wrapper">
      <div>
        <h2>Noticias</h2>
        <div className="module-content">
          <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>{headline}</div>
          <div style={{ display: "grid", gap: "12px" }}>
            {items.length === 0 && <div className="news-item">Sin noticias disponibles</div>}
            {items.map((item, index) => (
              <div key={index} className="news-item">
                <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{item.title}</div>
                <div style={{ fontSize: "0.95rem", color: "rgba(173,203,239,0.65)" }}>{item.source}</div>
                {(item.published_at || item.publishedAt) && (
                  <div style={{ fontSize: "0.85rem", color: "rgba(173,203,239,0.45)" }}>
                    {item.published_at ?? item.publishedAt}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
