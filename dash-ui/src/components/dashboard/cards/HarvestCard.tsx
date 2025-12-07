import { useState, useEffect } from "react";
import { SproutIcon } from "../../icons";
import harvestCatalog from "../../../data/harvest_catalog.json";
import { StandardCard } from "../StandardCard";

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
    <StandardCard
      title="Temporada"
      subtitle="Recolección ideal este mes"
      icon={<img src="/img/icons/3d/harvest-basket.png" className="w-8 h-8 drop-shadow-md animate-bounce-slow" alt="icon" />}
      className="bg-gradient-to-br from-green-500 to-emerald-700 relative overflow-hidden"
    >
      {/* Subtle Pattern Overlay instead of Image */}
      <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

      <div className="flex flex-col items-center justify-between py-4 h-full w-full relative z-10" key={currentIndex}>

        {/* Floating Header Pill */}
        <div className="bg-white/20 backdrop-blur-md px-4 py-1 rounded-full border border-white/30 shadow-sm mb-2">
          <h2 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">
            De Temporada
          </h2>
        </div>

        {/* Main Icon - Centered */}
        <div className="relative group cursor-pointer flex-1 flex items-center justify-center w-full min-h-0">
          <div className="absolute inset-0 bg-white/20 rounded-full blur-[50px] animate-pulse-slow pointer-events-none scale-125" />

          <img
            src={iconUrl} // Keep existing logic for specific vegetable/fruit icon if avaialble, or fallback
            alt={currentItem.name}
            className="w-auto h-[65%] max-h-[180px] object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.25)] transition-transform duration-500 hover:scale-110 animate-beat z-10"
            onError={() => setImageError(true)}
          />
        </div>

        {/* Info Box */}
        <div className="mt-4 flex flex-col items-center gap-1 z-20 w-full">
          <h3 className="text-3xl md:text-4xl font-black text-white tracking-tight leading-none text-center drop-shadow-md">
            {currentItem.name}
          </h3>
          {currentItem.status && (
            <span className="text-emerald-100 font-bold uppercase tracking-widest text-xs bg-black/20 px-3 py-1 rounded-full border border-white/10">
              {currentItem.status}
            </span>
          )}
        </div>

        {/* Indicators */}
        {entries.length > 1 && (
          <div className="absolute bottom-1 flex gap-2 z-30 opacity-60">
            {entries.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 shadow-sm ${idx === currentIndex ? "bg-white w-6" : "bg-white/40 w-1.5"
                  }`}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes beat {
           0%, 100% { transform: scale(1); }
           50% { transform: scale(1.03); }
        }
        .animate-beat {
           animation: beat 4s ease-in-out infinite;
        }
        @keyframes bounce-slow {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
        }
        .animate-bounce-slow {
            animation: bounce-slow 3s ease-in-out infinite;
        }
      `}</style>
    </StandardCard>
  );
};

export default HarvestCard;
