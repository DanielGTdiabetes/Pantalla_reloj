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
    <div className="harvest-card-3d">
      <div className="harvest-card-3d__header">
        <img src="/img/icons/3d/harvest-basket.png" alt="" className="harvest-card-3d__header-icon" />
        <span>De Temporada</span>
      </div>

      <div className="harvest-card-3d__icon-container" key={currentIndex}>
        <img src={iconUrl} alt={currentItem.name} className="harvest-card-3d__main-icon" />
      </div>

      <div className="harvest-card-3d__name">{currentItem.name}</div>

      {currentItem.status && (
        <div className="harvest-card-3d__status">{currentItem.status}</div>
      )}

      {entries.length > 1 && (
        <div className="harvest-card-3d__dots">
          {entries.map((_, idx) => (
            <span key={idx} className={`harvest-card-3d__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .harvest-card-3d {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          text-align: center;
          gap: 0.25rem;
        }
        .harvest-card-3d__header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.85rem;
          font-weight: 600;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .harvest-card-3d__header-icon {
          width: 24px;
          height: 24px;
          object-fit: contain;
        }
        .harvest-card-3d__icon-container {
          width: 100px;
          height: 100px;
          margin: 0.5rem 0;
          animation: scaleIn3d 0.4s ease-out;
        }
        .harvest-card-3d__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
          animation: float3d 4s ease-in-out infinite;
        }
        .harvest-card-3d__name {
          font-size: 1.5rem;
          font-weight: 800;
        }
        .harvest-card-3d__status {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          opacity: 0.7;
          background: rgba(255,255,255,0.1);
          padding: 0.2rem 0.5rem;
          border-radius: 0.25rem;
        }
        .harvest-card-3d__dots {
          display: flex;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .harvest-card-3d__dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .harvest-card-3d__dot.active {
          background: #22c55e;
          width: 14px;
          border-radius: 3px;
        }
        @keyframes float3d {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes scaleIn3d {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default HarvestCard;
