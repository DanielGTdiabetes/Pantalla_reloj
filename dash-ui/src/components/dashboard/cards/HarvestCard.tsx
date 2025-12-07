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
    <div className="harvest-card-v2">
      <div className="harvest-card-v2__header">
        <img src="/img/icons/3d/harvest-basket.png" alt="" className="harvest-card-v2__header-icon" />
        <span className="harvest-card-v2__title">De Temporada</span>
      </div>

      <div className="harvest-card-v2__body">
        <div className="harvest-card-v2__icon-container" key={currentIndex}>
          <img src={iconUrl} alt={currentItem.name} className="harvest-card-v2__main-icon" />
        </div>

        <div className="harvest-card-v2__name">{currentItem.name}</div>

        {currentItem.status && (
          <div className="harvest-card-v2__status">{currentItem.status}</div>
        )}

        {entries.length > 1 && (
          <div className="harvest-card-v2__dots">
            {entries.map((_, idx) => (
              <span key={idx} className={`harvest-card-v2__dot ${idx === currentIndex ? "active" : ""}`} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .harvest-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
        }
        .harvest-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .harvest-card-v2__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        .harvest-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .harvest-card-v2__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
        }
        .harvest-card-v2__icon-container {
          width: 140px;
          height: 140px;
          animation: scaleIn-v2 0.4s ease-out;
        }
        .harvest-card-v2__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.25));
          animation: float-v2 4s ease-in-out infinite;
        }
        .harvest-card-v2__name {
          font-size: 1.6rem;
          font-weight: 800;
          color: #0f172a;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .harvest-card-v2__status {
          font-size: 0.8rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #166534;
          background: rgba(34,197,94,0.15);
          padding: 0.2rem 0.6rem;
          border-radius: 0.25rem;
        }
        .harvest-card-v2__dots {
          display: flex;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .harvest-card-v2__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(0,0,0,0.2);
          transition: all 0.3s;
        }
        .harvest-card-v2__dot.active {
          background: #166534;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes float-v2 {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes scaleIn-v2 {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default HarvestCard;
