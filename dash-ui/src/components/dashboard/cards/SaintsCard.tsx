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

// Panel lateral de santoral
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
    // If we have an EnrichedSaint with data, use it directly
    if (typeof currentEntry !== "string" && currentEntry.bio) {
      setSaintInfo({
        extract: currentEntry.bio,
        originalimage: currentEntry.image ? { source: currentEntry.image } : undefined
      });
      setLoading(false);
      return;
    }

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
  }, [currentName, fullName, currentEntry]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentIndex]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let rafId: number;
    const step = () => {
      if (!el) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll > 2) {
        el.scrollTop = (el.scrollTop + 0.5) % (maxScroll + 14);
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [currentIndex, saintInfo?.extract]);

  if (!saints || saints.length === 0) {
    return (
      <div className="saints-card-dark saints-card-dark__empty" data-testid="panel-santoral">
        <span className="saints-card-dark__empty-text panel-item-title">Hoy no hay santos destacados</span>
      </div>
    );
  }

  // Use fetched image or fallback to icon
  const imageUrl = saintInfo?.originalimage?.source || saintInfo?.thumbnail?.source || "/icons/misc/santoral.svg";

  return (
    <div className="saints-card-dark" data-testid="panel-santoral">
      <div className="saints-card-dark__header">
        <img src="/icons/misc/santoral.svg" alt="" className="saints-card-dark__header-icon panel-title-icon" />
        <span className="saints-card-dark__title panel-title-text">Santoral</span>
      </div>

      <div className="saints-card-dark__body panel-body">
        <div className="saints-card-dark__image-container">
          <img src={imageUrl} alt={fullName} className="saints-card-dark__image" />
        </div>

        <div className="saints-card-dark__info">
          <h2 className="saints-card-dark__name panel-item-title">{fullName}</h2>
          <div ref={scrollRef} className="saints-card-dark__bio no-scrollbar panel-scroll-auto">
            {loading ? (
              <p className="saints-card-dark__loading">Buscando información...</p>
            ) : saintInfo?.extract ? (
              <p>{saintInfo.extract}</p>
            ) : (
              <p className="saints-card-dark__loading">No se encontró información detallada.</p>
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
          padding: 1rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #78350f 0%, #1c1917 100%);
          color: white;
          overflow: hidden;
          border-radius: 1rem;
        }
        .saints-card-dark__empty {
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.7;
        }
        .saints-card-dark__empty-text {
          font-size: 1.5rem;
          font-weight: 600;
        }
        .saints-card-dark__header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .saints-card-dark__header-icon {
          width: 64px;
          height: 64px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .saints-card-dark__title {
          font-size: 1.8rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }
        .saints-card-dark__body {
          flex: 1;
          display: flex;
          gap: 1.5rem;
          min-height: 0;
          animation: fadeIn-dark 0.5s ease-out;
        }
        .saints-card-dark__image-container {
          width: 140px;
          height: 140px;
          flex-shrink: 0;
          border-radius: 1rem;
          overflow: hidden;
          background: rgba(255,255,255,0.1);
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
          font-size: 2rem;
          font-weight: 800;
          color: #fbbf24;
          margin: 0 0 0.5rem 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 2px 8px rgba(0,0,0,0.5);
        }
        .saints-card-dark__bio {
          flex: 1;
          overflow-y: auto;
          font-size: 1.3rem;
          line-height: 1.5;
          opacity: 0.95;
          padding-right: 0.5rem;
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
          gap: 0.5rem;
          margin-top: 1rem;
        }
        .saints-card-dark__dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .saints-card-dark__dot.active {
          background: #fbbf24;
          width: 24px;
          border-radius: 5px;
        }
        @keyframes fadeIn-dark {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
