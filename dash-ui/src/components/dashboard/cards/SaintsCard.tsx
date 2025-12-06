import { useState, useEffect, useRef } from "react";

// Restore EnrichedSaint for compatibility
export type EnrichedSaint = {
  name: string;
  bio?: string | null;
  image?: string | null;
  url?: string | null;
};

interface SaintsCardProps {
  saints: (string | EnrichedSaint)[];
}

interface SaintInfo {
  extract?: string;
  thumbnail?: { source: string };
  originalimage?: { source: string };
}

export default function SaintsCard({ saints }: SaintsCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [saintInfo, setSaintInfo] = useState<SaintInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Helper to get name
  const getSaintName = (s: string | EnrichedSaint) => {
    if (typeof s === 'string') return s;
    return s.name;
  };

  // 1. Rotation Logic - 15 seconds per saint
  useEffect(() => {
    if (!saints || saints.length === 0) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % saints.length);
    }, 15000);
    return () => clearInterval(interval);
  }, [saints]);

  // 2. Smart Prefix Logic
  const formatName = (name: string) => {
    if (name.includes("San") || name.includes("Beato") || name.includes("Santa")) return name;
    if (name.endsWith("a") && !["Luka", "Josua", "Bautisma"].includes(name)) return `Santa ${name}`;
    return `San ${name}`;
  };

  const currentEntry = saints && saints.length > 0 ? saints[currentIndex] : "Cargando...";
  const currentName = getSaintName(currentEntry);
  const fullName = formatName(currentName);

  // 3. Wikipedia Integration
  useEffect(() => {
    if (!currentName || currentName === "Cargando...") return;

    const fetchWiki = async () => {
      try {
        const searchName = fullName.replace(/ /g, "_");
        const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${searchName}`);

        if (res.ok) {
          const data = await res.json();
          if (data.type === 'standard') {
            setSaintInfo(data);
            return;
          }
        }

        const res2 = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${currentName}`);
        if (res2.ok) {
          const data2 = await res2.json();
          setSaintInfo(data2);
        } else {
          setSaintInfo(null);
        }
      } catch (e) {
        console.warn("Wiki fetch error", e);
        setSaintInfo(null);
      }
    };

    fetchWiki();
  }, [currentName, fullName]);

  // Reset scroll when saint changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [currentIndex]);

  if (!saints || saints.length === 0) {
    return <div className="flex h-full items-center justify-center p-4 text-white/50">Hoy no hay santos destacados</div>;
  }

  // Upgrade image quality helper
  const upgradeImageQuality = (url: string) => {
    if (!url) return url;
    if (url.includes("/thumb/")) {
      const parts = url.split("/thumb/");
      if (parts.length === 2) {
        const pathParts = parts[1].split("/");
        if (pathParts.length > 1) {
          pathParts.pop();
          return `${parts[0]}/${pathParts.join("/")}`;
        }
      }
    }
    return url;
  };

  let imageUrl = saintInfo?.originalimage?.source;
  if (!imageUrl && saintInfo?.thumbnail?.source) {
    imageUrl = upgradeImageQuality(saintInfo.thumbnail.source);
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-gray-900 border border-white/10 shadow-2xl">
      {/* Top Half: Image Container */}
      <div className="relative h-[55%] w-full bg-black/40 p-4">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={fullName}
            className="h-full w-full object-contain drop-shadow-2xl"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-6xl opacity-20">✝️</span>
          </div>
        )}
      </div>

      {/* Bottom Half: Text Content */}
      <div className="flex h-[45%] flex-col bg-gradient-to-b from-gray-800 to-gray-900 p-4">
        {/* Title */}
        <h2 className="mb-2 text-center text-2xl font-bold text-yellow-400 drop-shadow-sm truncate">
          {fullName}
        </h2>

        {/* Scrollable Bio */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto pr-2 text-sm leading-relaxed text-gray-200 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
        >
          {saintInfo?.extract ? (
            <p className="pb-2">{saintInfo.extract}</p>
          ) : (
            <p className="animate-pulse text-white/40 italic text-center mt-4">
              Buscando información...
            </p>
          )}
        </div>

        {/* Progress Indicators */}
        <div className="mt-3 flex justify-center gap-1.5 pt-2 border-t border-white/5">
          {saints.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 rounded-full transition-all duration-500 ${idx === currentIndex ? "w-6 bg-yellow-500" : "w-1.5 bg-white/20"
                }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
