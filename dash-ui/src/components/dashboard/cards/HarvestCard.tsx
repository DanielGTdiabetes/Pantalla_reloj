import { useState, useEffect } from "react";
import { SproutIcon } from "../../icons";
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
  slug: string;
  months: number[];
  icon: string;
  season_summary?: string;
};

/**
 * Obtiene los productos de temporada para el mes actual desde el catálogo completo
 */
const getCurrentSeasonProducts = (): HarvestItem[] => {
  const currentMonth = new Date().getMonth() + 1; // 1-12
  const catalog = harvestCatalog as CatalogItem[];

  return catalog
    .filter((item) => item.months.includes(currentMonth))
    .map((item) => ({
      name: item.name,
      status: "Temporada óptima",
      icon: item.icon
    }));
};

/**
 * Obtiene la URL del icono, priorizando iconos locales del catálogo
 */
const getIconUrl = (item: HarvestItem): string => {
  const baseUrl = import.meta.env.BASE_URL;
  const prefix = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  // Si el item tiene un icono del catálogo, usarlo
  if (item.icon) {
    return `${prefix}icons/soydetemporada/${item.icon}`;
  }

  // Fallback a icono genérico
  return `${prefix}icons/harvest/sprout.svg`;
};

export const HarvestCard = ({ items }: HarvestCardProps): JSX.Element => {
  // Si se pasan items desde props (API legacy), usarlos
  // Si no, usar el catálogo completo filtrado por mes actual
  const seasonProducts = items && items.length > 0
    ? items
    : getCurrentSeasonProducts();

  const entries = seasonProducts.length > 0
    ? seasonProducts
    : [{ name: "Sin productos de temporada" }];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (entries.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % entries.length);
    }, 5000); // 5 seconds per item

    return () => clearInterval(interval);
  }, [entries.length]);

  // Reset error state when index changes
  useEffect(() => {
    setImageError(false);
  }, [currentIndex]);

  const currentItem = entries[currentIndex];
  const iconUrl = getIconUrl(currentItem);

  return (
    <div className="card harvest-card harvest-card-enhanced">
      <div className="harvest-card__header">
        <SproutIcon className="card-icon" aria-hidden="true" />
        <h2>Cosechas de Temporada</h2>
      </div>
      <div className="harvest-carousel">
        <div className="harvest-slide fade-in" key={currentIndex}>
          {!imageError ? (
            <img
              src={iconUrl}
              alt={currentItem.name}
              className="harvest-icon-large"
              style={{ width: "180px", height: "180px", objectFit: "contain" }}
              onError={(e) => {
                console.warn(`HarvestCard: Failed to load image ${iconUrl}`);
                setImageError(true);
              }}
            />
          ) : (
            <SproutIcon
              className="harvest-icon-large"
              style={{ width: "180px", height: "180px", color: "var(--theme-accent)" }}
            />
          )}
          <div className="harvest-info">
            <span className="harvest-name">{currentItem.name}</span>
            {currentItem.status && <span className="harvest-status">{currentItem.status}</span>}
          </div>
        </div>
        {entries.length > 1 && (
          <div className="harvest-indicators">
            {entries.map((_, idx) => (
              <span
                key={idx}
                className={`indicator ${idx === currentIndex ? "active" : ""}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HarvestCard;
