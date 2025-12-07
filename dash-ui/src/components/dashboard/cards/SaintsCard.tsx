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
    // Already has prefix?
    if (name.includes("San ") || name.includes("Santo ") || name.includes("Santa ") || name.includes("Beato ") || name.includes("Beata ")) return name;

    // Specific fixes
    if (name.toLowerCase() === "ambrosio") return "San Ambrosio";

    // Gender guessing (naive but functional for simple lists)
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

    <div className="saints-card-container">
      {/* Top Half: Image Container */}
      <div className="saints-card__image-container">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={fullName}
            className="saints-card__image"
          />
        ) : (
          <div className="saints-card__placeholder">
            <span style={{ fontSize: "4rem", opacity: 0.2 }}>✝️</span>
          </div>
        )}
      </div>

      {/* Bottom Half: Text Content */}
      <div className="saints-card__content">
        {/* Title */}
        <h2 className="saints-card__title">
          {fullName}
        </h2>

        {/* Scrollable Bio */}
        <div
          ref={scrollRef}
          className="saints-card__bio"
        >
          {saintInfo?.extract ? (
            <p className="pb-2">{saintInfo?.extract}</p>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="saints-card__loading">Buscando biografía...</p>
            </div>
          )}
        </div>

        {/* Progress Indicators */}
        <div className="saints-card__progress">
          {saints.map((_, idx) => (
            <div
              key={idx}
              className={`saints-card__dot ${idx === currentIndex ? "active" : ""}`}
            />
          ))}
        </div>
      </div>

      <style>{`
        .saints-card-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          overflow: hidden;
          color: white;
          background: linear-gradient(135deg, #1c1917 0%, #292524 100%);
          border-radius: 1.5rem;
          border: 1px solid rgba(255,255,255,0.1);
          font-family: system-ui, -apple-system, sans-serif;
        }

        .saints-card__image-container {
          position: relative;
          flex: 1;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem;
          min-height: 0;
        }

        .saints-card__image {
          height: 100%;
          width: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));
        }

        .saints-card__placeholder {
          display: flex;
          height: 100%;
          width: 100%;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.05);
          border-radius: 0.5rem;
        }

        .saints-card__content {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 1rem;
          border-top: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.02);
          min-height: 0;
        }

        .saints-card__title {
          margin-bottom: 0.5rem;
          text-align: center;
          font-size: 1.25rem;
          font-weight: 700;
          color: #fbbf24; /* amber-400 */
          letter-spacing: 0.025em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: system-ui, -apple-system, sans-serif;
        }

        .saints-card__bio {
          flex: 1;
          overflow-y: auto;
          padding-right: 0.25rem;
          font-size: 0.875rem;
          line-height: 1.5;
          color: #dbeafe; /* blue-100 */
          font-weight: 500;
          text-align: center;
        }

        .saints-card__loading {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          color: rgba(255,255,255,0.4);
          font-style: italic;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .5; }
        }

        .saints-card__progress {
          margin-top: 0.5rem;
          display: flex;
          justify-content: center;
          gap: 0.375rem;
          padding-top: 0.5rem;
          border-top: 1px solid rgba(255,255,255,0.05);
          flex-shrink: 0;
        }

        .saints-card__dot {
          height: 0.375rem;
          border-radius: 9999px;
          transition: all 0.3s;
          background-color: rgba(255,255,255,0.2);
          width: 0.375rem;
        }
        .saints-card__dot.active {
          width: 1.5rem;
          background-color: #fbbf24;
        }
      `}</style>
    </div>
  );
};
