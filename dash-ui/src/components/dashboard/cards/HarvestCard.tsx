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
      icon={<SproutIcon className="w-8 h-8 text-green-400 drop-shadow-md" />}
      className="bg-gradient-to-br from-green-950/50 to-slate-900"
    >
      <div className="flex flex-col items-center justify-center gap-6 w-full h-full relative" key={currentIndex}>

        {/* Main Icon with Glow */}
        <div className="relative group perspective-500">
          <div className="absolute inset-0 bg-green-500/20 rounded-full blur-3xl animate-pulse-slow pointer-events-none" />
          {!imageError ? (
            <img
              src={iconUrl}
              alt={currentItem.name}
              className="w-40 h-40 md:w-56 md:h-56 object-contain drop-shadow-2xl transition-transform duration-700 animate-float"
              onError={() => setImageError(true)}
            />
          ) : (
            <SproutIcon className="w-40 h-40 text-green-500/80 drop-shadow-[0_0_15px_rgba(34,197,94,0.4)]" />
          )}
        </div>

        {/* Info */}
        <div className="text-center z-10 space-y-2">
          <h3 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-300 to-emerald-100 drop-shadow-sm uppercase tracking-tight">
            {currentItem.name}
          </h3>
          {currentItem.status && (
            <span className="inline-block px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-300 text-sm font-bold uppercase tracking-widest backdrop-blur-md">
              {currentItem.status}
            </span>
          )}
        </div>

        {/* Indicators */}
        {entries.length > 1 && (
          <div className="absolute bottom-2 flex gap-2">
            {entries.map((_, idx) => (
              <div
                key={idx}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${idx === currentIndex ? "bg-green-400 w-6 shadow-[0_0_8px_rgba(74,222,128,0.6)]" : "bg-white/10"
                  }`}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes float {
           0%, 100% { transform: translateY(0px) rotate(0deg); }
           50% { transform: translateY(-10px) rotate(2deg); }
        }
        .animate-float {
           animation: float 6s ease-in-out infinite;
        }
      `}</style>
    </StandardCard>
  );
};


export default HarvestCard;
