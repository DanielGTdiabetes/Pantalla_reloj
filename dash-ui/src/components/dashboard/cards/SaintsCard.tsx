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

export default function SaintsCard({ saints }: SaintsCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [saintInfo, setSaintInfo] = useState<SaintInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const getSaintName = (s: string | EnrichedSaint) => {
    if (typeof s === "string") return s;
    return s.name;
  };

  const formatName = (name: string) => {
    if (name.includes("San ") || name.includes("Santo ") || name.includes("Santa ") || name.includes("Beato ")) return name;
    if (name.toLowerCase() === "ambrosio") return "San Ambrosio";
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
      try {
        const searchName = fullName.replace(/ /g, "_");
        const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${searchName}`);
        if (res.ok) {
          const data = await res.json();
          if (data.type === "standard") {
            setSaintInfo(data);
            return;
          }
        }
        const res2 = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${currentName}`);
        if (res2.ok) {
          setSaintInfo(await res2.json());
        } else {
          setSaintInfo(null);
        }
      } catch {
        setSaintInfo(null);
      }
    };
    fetchWiki();
  }, [currentName, fullName]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentIndex]);

  if (!saints || saints.length === 0) {
    return <div className="saints-card-v2__empty">Hoy no hay santos destacados</div>;
  }

  const imageUrl = saintInfo?.originalimage?.source || saintInfo?.thumbnail?.source;

  return (
    <div className="saints-card-v2">
      <div className="saints-card-v2__header">
        <span className="saints-card-v2__icon">📿</span>
        <span className="saints-card-v2__title">Santoral</span>
      </div>

      <div className="saints-card-v2__body">
        {imageUrl && (
          <div className="saints-card-v2__image-container">
            <img src={imageUrl} alt={fullName} className="saints-card-v2__image" />
          </div>
        )}

        <div className="saints-card-v2__info">
          <h2 className="saints-card-v2__name">{fullName}</h2>
          <div ref={scrollRef} className="saints-card-v2__bio">
            {saintInfo?.extract ? (
              <p>{saintInfo.extract}</p>
            ) : (
              <p className="saints-card-v2__loading">Buscando biografía...</p>
            )}
          </div>
        </div>
      </div>

      {saints.length > 1 && (
        <div className="saints-card-v2__dots">
          {saints.map((_, idx) => (
            <span key={idx} className={`saints-card-v2__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .saints-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          overflow: hidden;
        }
        .saints-card-v2__empty {
          display: flex;
          height: 100%;
          align-items: center;
          justify-content: center;
          color: #64748b;
        }
        .saints-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .saints-card-v2__icon {
          font-size: 2rem;
        }
        .saints-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .saints-card-v2__body {
          flex: 1;
          display: flex;
          gap: 0.75rem;
          min-height: 0;
          animation: fadeIn-v2 0.5s ease-out;
        }
        .saints-card-v2__image-container {
          width: 100px;
          height: 100px;
          flex-shrink: 0;
          border-radius: 0.5rem;
          overflow: hidden;
          background: rgba(0,0,0,0.1);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .saints-card-v2__image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .saints-card-v2__info {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .saints-card-v2__name {
          font-size: 1.2rem;
          font-weight: 700;
          color: #92400e;
          margin: 0 0 0.25rem 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .saints-card-v2__bio {
          flex: 1;
          overflow-y: auto;
          font-size: 0.85rem;
          line-height: 1.4;
          color: #334155;
        }
        .saints-card-v2__bio p {
          margin: 0;
        }
        .saints-card-v2__loading {
          color: #64748b;
          font-style: italic;
        }
        .saints-card-v2__dots {
          display: flex;
          justify-content: center;
          gap: 0.3rem;
          margin-top: 0.5rem;
        }
        .saints-card-v2__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(0,0,0,0.2);
          transition: all 0.3s;
        }
        .saints-card-v2__dot.active {
          background: #92400e;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes fadeIn-v2 {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
