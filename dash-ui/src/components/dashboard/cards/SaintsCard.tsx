import { useState, useEffect, useRef } from "react";

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

// Better name variations for Wikipedia search
const SAINT_NAME_VARIATIONS: Record<string, string[]> = {
  "ambrosio": ["Ambrosio de Milán", "San Ambrosio de Milán", "Ambrosio (santo)"],
  "nicolas": ["Nicolás de Bari", "San Nicolás de Bari", "Nicolás de Myra"],
  "juan": ["Juan el Bautista", "San Juan Bautista"],
  "pedro": ["San Pedro", "Pedro (apóstol)"],
  "pablo": ["San Pablo", "Pablo de Tarso"],
};

export default function SaintsCard({ saints }: SaintsCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [saintInfo, setSaintInfo] = useState<SaintInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const getSaintName = (s: string | EnrichedSaint) => {
    if (typeof s === "string") return s;
    return s.name;
  };

  const formatName = (name: string) => {
    if (name.includes("San ") || name.includes("Santo ") || name.includes("Santa ") || name.includes("Beato ")) return name;
    if (name.toLowerCase() === "ambrosio") return "San Ambrosio de Milán";
    if (name.endsWith("a") && !["Luka", "Josua"].includes(name)) return `Santa ${name}`;
    return `San ${name}`;
  };

  useEffect(() => {
    if (!saints || saints.length === 0) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % saints.length);
    }, 15000);
    return () => clearInterval(interval);
  }, [saints]);

  const currentEntry = saints && saints.length > 0 ? saints[currentIndex] : "Cargando...";
  const currentName = getSaintName(currentEntry);
  const fullName = formatName(currentName);

  useEffect(() => {
    if (!currentName || currentName === "Cargando...") return;

    const fetchWiki = async () => {
      setLoading(true);
      setSaintInfo(null);

      // Get variations to try
      const baseName = currentName.toLowerCase().replace(/^(san|santa|santo)\s+/i, "");
      const variations = SAINT_NAME_VARIATIONS[baseName] || [];
      const namesToTry = [fullName, currentName, ...variations];

      for (const name of namesToTry) {
        try {
          const searchName = name.replace(/ /g, "_");
          const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchName)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.type === "standard" && data.extract) {
              console.log(`[SaintsCard] Found data for: ${name}`);
              setSaintInfo(data);
              setLoading(false);
              return;
            }
          }
        } catch (err) {
          console.log(`[SaintsCard] Error fetching ${name}:`, err);
        }
      }

      console.log(`[SaintsCard] No data found for any variation of: ${currentName}`);
      setLoading(false);
    };

    fetchWiki();
  }, [currentName, fullName]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentIndex]);

  if (!saints || saints.length === 0) {
    return (
      <div className="saints-card-dark saints-card-dark__empty">
        <span>Hoy no hay santos destacados</span>
      </div>
    );
  }

  const imageUrl = saintInfo?.originalimage?.source || saintInfo?.thumbnail?.source;

  return (
    <div className="saints-card-dark">
      <div className="saints-card-dark__header">
        <span className="saints-card-dark__icon">📿</span>
        <span className="saints-card-dark__title">Santoral</span>
      </div>

      <div className="saints-card-dark__body">
        {imageUrl && (
          <div className="saints-card-dark__image-container">
            <img src={imageUrl} alt={fullName} className="saints-card-dark__image" />
          </div>
        )}

        <div className="saints-card-dark__info">
          <h2 className="saints-card-dark__name">{fullName}</h2>
          <div ref={scrollRef} className="saints-card-dark__bio">
            {loading ? (
              <p className="saints-card-dark__loading">Buscando información...</p>
            ) : saintInfo?.extract ? (
              <p>{saintInfo.extract}</p>
            ) : (
              <p className="saints-card-dark__loading">No se encontró información</p>
            )}
          </div>
        </div>
      </div>

      {saints.length > 1 && (
        <div className="saints-card-dark__dots">
          {saints.map((_, idx) => (
            <span key={idx} className={`saints-card-dark__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .saints-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #78350f 0%, #1c1917 100%);
          color: white;
          overflow: hidden;
        }
        .saints-card-dark__empty {
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.7;
        }
        .saints-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .saints-card-dark__icon {
          font-size: 2rem;
        }
        .saints-card-dark__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .saints-card-dark__body {
          flex: 1;
          display: flex;
          gap: 0.75rem;
          min-height: 0;
          animation: fadeIn-dark 0.5s ease-out;
        }
        .saints-card-dark__image-container {
          width: 100px;
          height: 100px;
          flex-shrink: 0;
          border-radius: 0.5rem;
          overflow: hidden;
          background: rgba(255,255,255,0.1);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .saints-card-dark__image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .saints-card-dark__info {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .saints-card-dark__name {
          font-size: 1.2rem;
          font-weight: 700;
          color: #fbbf24;
          margin: 0 0 0.25rem 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .saints-card-dark__bio {
          flex: 1;
          overflow-y: auto;
          font-size: 0.85rem;
          line-height: 1.4;
          opacity: 0.9;
        }
        .saints-card-dark__bio p {
          margin: 0;
        }
        .saints-card-dark__loading {
          opacity: 0.6;
          font-style: italic;
        }
        .saints-card-dark__dots {
          display: flex;
          justify-content: center;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .saints-card-dark__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .saints-card-dark__dot.active {
          background: #fbbf24;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes fadeIn-dark {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
