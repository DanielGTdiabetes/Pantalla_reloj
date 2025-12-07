import { useState, useEffect } from "react";
import harvestCatalog from "../../../data/harvest_catalog.json";

type HarvestItem = {
  name: string;
  status?: string | null;
  icon?: string | null;
};

type HarvestCardProps = {
  items?: HarvestItem[];
};

type CatalogItem = {
  name: string;
  months: number[];
  icon: string;
};

const getCurrentSeasonProducts = (): HarvestItem[] => {
  const currentMonth = new Date().getMonth() + 1;
  const catalog = harvestCatalog as CatalogItem[];
  return catalog
    .filter((item) => item.months.includes(currentMonth))
    .map((item) => ({
      name: item.name,
      status: "Temporada óptima",
      icon: item.icon
    }));
};

const getIconUrl = (item: HarvestItem): string => {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const prefix = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  let iconName = item.icon;
  if (!iconName) {
    const catalog = harvestCatalog as CatalogItem[];
    const found = catalog.find(c => c.name.toLowerCase() === item.name.toLowerCase());
    if (found) iconName = found.icon;
  }

  if (iconName) {
    return `${prefix}icons/soydetemporada/${iconName}`;
  }
  return `${prefix}icons/harvest/sprout.svg`;
};

export const HarvestCard = ({ items }: HarvestCardProps): JSX.Element => {
  const seasonProducts = items && items.length > 0 ? items : getCurrentSeasonProducts();
  const entries = seasonProducts.length > 0 ? seasonProducts : [{ name: "Sin productos de temporada" }];

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (entries.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % entries.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [entries.length]);

  const currentItem = entries[currentIndex];
  const iconUrl = getIconUrl(currentItem);

  return (
    <div className="harvest-card-dark">
      <div className="harvest-card-dark__header">
        <span className="harvest-card-dark__icon-emoji">🧺</span>
        <span className="harvest-card-dark__title">De Temporada</span>
      </div>

      <div className="harvest-card-dark__body">
        <div className="harvest-card-dark__icon-container" key={currentIndex}>
          <img src={iconUrl} alt={currentItem.name} className="harvest-card-dark__main-icon" />
        </div>

        <div className="harvest-card-dark__name">{currentItem.name}</div>

        {currentItem.status && (
          <div className="harvest-card-dark__status">{currentItem.status}</div>
        )}

        {entries.length > 1 && (
          <div className="harvest-card-dark__dots">
            {entries.map((_, idx) => (
              <span key={idx} className={`harvest-card-dark__dot ${idx === currentIndex ? "active" : ""}`} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .harvest-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%);
          color: #166534;
          border-radius: 1rem;
        }
        .harvest-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
          border-bottom: 2px solid #e1e7e3;
          padding-bottom: 0.5rem;
        }
        .harvest-card-dark__icon-emoji {
          display: none;
        }
        .harvest-card-dark__header::before {
            content: '';
            display: block;
            width: 48px;
            height: 48px;
            background-image: url('/img/icons/modern/harvest.png');
            background-size: contain;
            background-repeat: no-repeat;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        .harvest-card-dark__title {
          font-size: 1.8rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #14532d;
        }
        .harvest-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }
        .harvest-card-dark__icon-container {
          width: 160px;
          height: 160px;
          animation: scaleIn-dark 0.4s ease-out;
          filter: drop-shadow(0 8px 16px rgba(0,0,0,0.1));
        }
        .harvest-card-dark__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          animation: float-dark 4s ease-in-out infinite;
        }
        .harvest-card-dark__name {
          font-size: 2.5rem;
          font-weight: 900;
          color: #1a2e05;
          text-align: center;
          margin-top: 0.5rem;
        }
        .harvest-card-dark__status {
          font-size: 0.9rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          background: #dcfce7;
          color: #166534;
          padding: 0.3rem 0.8rem;
          border-radius: 1rem;
          margin-top: 0.2rem;
        }
        .harvest-card-dark__dots {
          display: flex;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .harvest-card-dark__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(22, 101, 52, 0.2);
          transition: all 0.3s;
        }
        .harvest-card-dark__dot.active {
          background: #166534;
          width: 20px;
          border-radius: 4px;
        }
        @keyframes float-dark {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes scaleIn-dark {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default HarvestCard;
