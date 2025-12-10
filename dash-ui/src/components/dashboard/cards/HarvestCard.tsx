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

const UPGRADED_ICONS = [
  "manzana.png", "naranja.png", "limon.png", "mandarina.png",
  "lechuga.png", "zanahoria.png", "aguacate.png", "brocoli.png",
  "cebolla.png", "espinaca.png", "coliflor.png", "col.png",
  "acelga.png", "ajo.png", "albaricoque.png", "alcachofa.png",
  "apio.png", "batata.png", "berenjena.png", "calabacin.png",
  "calabaza.png", "caqui.png", "cardo.png", "cereza.png",
  "champinon.png", "col-de-bruselas.png", "endibia.png",
  "esparrago.png", "frambuesa.png", "fresa.png",
  "granada.png", "guisante.png", "haba.png",
  "higo.png", "judia.png", "kiwi.png",
  "lima.png", "maiz.png", "melocoton.png",
  "melon.png", "mora.png", "nabo.png"
];

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
    if (UPGRADED_ICONS.includes(iconName)) {
      return `${prefix}icons/3d/${iconName}`;
    }
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
          background: linear-gradient(145deg, rgba(6, 78, 59, 0.75) 0%, rgba(2, 44, 34, 0.85) 100%);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          color: #ecfccb;
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 
            0 20px 40px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset 0 10px 20px rgba(0,0,0,0.2);
        }
        .harvest-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
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
            background-image: url('/img/icons/3d/harvest-basket.png');
            background-size: contain;
            background-repeat: no-repeat;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        .harvest-card-dark__title {
          font-size: 1.8rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #bef264;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
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
          color: #f7fee7;
          text-shadow: 0 2px 8px rgba(0,0,0,0.5);
          text-align: center;
          margin-top: 0.5rem;
        }
        .harvest-card-dark__status {
          font-size: 0.9rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          background: rgba(22, 163, 74, 0.2);
          border: 1px solid rgba(22, 163, 74, 0.4);
          color: #86efac;
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
          background: rgba(255, 255, 255, 0.2);
          transition: all 0.3s;
        }
        .harvest-card-dark__dot.active {
          background: #bef264;
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
