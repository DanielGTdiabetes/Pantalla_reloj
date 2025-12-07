import { useState, useEffect } from "react";

type TransportData = {
  planes?: Array<{
    callsign?: string;
    origin?: string;
    destination?: string;
    altitude?: number;
    speed?: number;
    heading?: number;
    distance_km?: number;
    airline?: string;
    aircraft_type?: string;
    lat?: number;
    lon?: number;
  }>;
  ships?: Array<{
    name?: string;
    type?: string;
    destination?: string;
    speed?: number;
    heading?: number;
    distance_km?: number;
    mmsi?: string;
  }>;
};

type TransportCardProps = {
  data: TransportData | null;
};

type TransportType = "plane" | "ship";

export const TransportCard = ({ data }: TransportCardProps): JSX.Element => {
  const [activeTab, setActiveTab] = useState<TransportType>("plane");
  const [currentIndex, setCurrentIndex] = useState(0);

  // Debug: log received data
  useEffect(() => {
    console.log("[TransportCard] Received data:", data);
    console.log("[TransportCard] Planes count:", data?.planes?.length ?? 0);
    console.log("[TransportCard] Ships count:", data?.ships?.length ?? 0);
  }, [data]);

  const planes = data?.planes || [];
  const ships = data?.ships || [];
  const isPlane = activeTab === "plane";
  const items = isPlane ? planes : ships;

  useEffect(() => {
    const hasPlanes = planes.length > 0;
    const hasShips = ships.length > 0;

    if (hasPlanes && hasShips) {
      const interval = setInterval(() => {
        setActiveTab(prev => prev === "plane" ? "ship" : "plane");
        setCurrentIndex(0);
      }, 12000);
      return () => clearInterval(interval);
    } else if (hasPlanes) {
      setActiveTab("plane");
    } else if (hasShips) {
      setActiveTab("ship");
    }
  }, [planes.length, ships.length]);

  useEffect(() => {
    if (items.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % items.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [items.length, activeTab]);

  const current = items[currentIndex];
  const iconUrl = isPlane ? "/img/icons/3d/plane.png" : "/img/icons/3d/ship.png";

  return (
    <div className="transport-card-dark">
      <div className="transport-card-dark__header">
        <img src={iconUrl} alt="" className="transport-card-dark__header-icon" />
        <span className="transport-card-dark__title">{isPlane ? "Aviones Cercanos" : "Barcos Cercanos"}</span>
      </div>

      <div className="transport-card-dark__body">
        {items.length === 0 ? (
          <div className="transport-card-dark__empty">
            <img src={iconUrl} alt="" className="transport-card-dark__empty-icon" />
            <span>Escaneando... ({isPlane ? planes.length : ships.length})</span>
          </div>
        ) : (
          <div className="transport-card-dark__content" key={`${activeTab}-${currentIndex}`}>
            <div className="transport-card-dark__icon-container">
              <img src={iconUrl} alt={isPlane ? "avión" : "barco"} className="transport-card-dark__main-icon" />
            </div>

            <div className="transport-card-dark__info">
              <div className="transport-card-dark__name">
                {isPlane ? (current as any).callsign || "Vuelo" : (current as any).name || "Barco"}
              </div>

              {isPlane && (current as any).destination && (
                <div className="transport-card-dark__detail">✈️ {(current as any).destination}</div>
              )}
              {!isPlane && (current as any).destination && (
                <div className="transport-card-dark__detail">⚓ {(current as any).destination}</div>
              )}

              {(current as any).distance_km && (
                <div className="transport-card-dark__distance">
                  📍 {(current as any).distance_km.toFixed(1)} km
                </div>
              )}
            </div>
          </div>
        )}

        {items.length > 1 && (
          <div className="transport-card-dark__dots">
            {items.map((_, idx) => (
              <span key={idx} className={`transport-card-dark__dot ${idx === currentIndex ? "active" : ""}`} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .transport-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
          color: white;
        }
        .transport-card-dark__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .transport-card-dark__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .transport-card-dark__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .transport-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .transport-card-dark__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          opacity: 0.7;
        }
        .transport-card-dark__empty-icon {
          width: 80px;
          height: 80px;
          object-fit: contain;
          animation: pulse-dark 2s ease-in-out infinite;
        }
        .transport-card-dark__content {
          display: flex;
          align-items: center;
          gap: 1rem;
          animation: fadeIn-dark 0.4s ease-out;
        }
        .transport-card-dark__icon-container {
          width: 120px;
          height: 120px;
        }
        .transport-card-dark__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
          animation: float-dark 4s ease-in-out infinite;
        }
        .transport-card-dark__info {
          text-align: left;
        }
        .transport-card-dark__name {
          font-size: 1.5rem;
          font-weight: 700;
        }
        .transport-card-dark__detail {
          font-size: 1rem;
          opacity: 0.8;
        }
        .transport-card-dark__distance {
          font-size: 0.9rem;
          color: #38bdf8;
          font-weight: 600;
        }
        .transport-card-dark__dots {
          display: flex;
          gap: 0.3rem;
          margin-top: 0.75rem;
        }
        .transport-card-dark__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .transport-card-dark__dot.active {
          background: white;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes float-dark {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
        @keyframes fadeIn-dark {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-dark {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
};

export default TransportCard;
