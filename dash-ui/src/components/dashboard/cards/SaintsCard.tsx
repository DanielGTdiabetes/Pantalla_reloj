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
    return <div className="saints-card-3d__empty">Hoy no hay santos destacados</div>;
  }

  const imageUrl = saintInfo?.originalimage?.source || saintInfo?.thumbnail?.source;

  return (
    <div className="saints-card-3d">
      <div className="saints-card-3d__header">📿 Santoral</div>

      <div className="saints-card-3d__content">
        {imageUrl && (
          <div className="saints-card-3d__image-container">
            <img src={imageUrl} alt={fullName} className="saints-card-3d__image" />
          </div>
        )}

        <div className="saints-card-3d__info">
          <h2 className="saints-card-3d__name">{fullName}</h2>
          <div ref={scrollRef} className="saints-card-3d__bio">
            {saintInfo?.extract ? (
              <p>{saintInfo.extract}</p>
            ) : (
              <p className="saints-card-3d__loading">Buscando biografía...</p>
            )}
          </div>
        </div>
      </div>

      {saints.length > 1 && (
        <div className="saints-card-3d__dots">
          {saints.map((_, idx) => (
            <span key={idx} className={`saints-card-3d__dot ${idx === currentIndex ? "active" : ""}`} />
          ))}
        </div>
      )}

      <style>{`
        .saints-card-3d {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          overflow: hidden;
        }
        .saints-card-3d__empty {
          display: flex;
          height: 100%;
          align-items: center;
          justify-content: center;
          color: rgba(255,255,255,0.5);
        }
        .saints-card-3d__header {
          font-size: 0.9rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          opacity: 0.8;
          margin-bottom: 0.5rem;
          text-align: center;
        }
        .saints-card-3d__content {
          display: flex;
          flex: 1;
          gap: 0.75rem;
          min-height: 0;
          animation: fadeIn3d 0.5s ease-out;
        }
        .saints-card-3d__image-container {
          width: 80px;
          height: 80px;
          flex-shrink: 0;
          border-radius: 0.5rem;
          overflow: hidden;
          background: rgba(255,255,255,0.1);
        }
        .saints-card-3d__image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .saints-card-3d__info {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .saints-card-3d__name {
          font-size: 1.1rem;
          font-weight: 700;
          color: #fbbf24;
          margin: 0 0 0.25rem 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .saints-card-3d__bio {
          flex: 1;
          overflow-y: auto;
          font-size: 0.8rem;
          line-height: 1.4;
          color: rgba(255,255,255,0.85);
        }
        .saints-card-3d__bio p {
          margin: 0;
        }
        .saints-card-3d__loading {
          opacity: 0.5;
          font-style: italic;
        }
        .saints-card-3d__dots {
          display: flex;
          justify-content: center;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .saints-card-3d__dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .saints-card-3d__dot.active {
          background: #fbbf24;
          width: 14px;
          border-radius: 3px;
        }
        @keyframes fadeIn3d {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
