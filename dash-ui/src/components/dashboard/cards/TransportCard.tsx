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
    <div className="transport-card-v2">
      <div className="transport-card-v2__header">
        <img src={iconUrl} alt="" className="transport-card-v2__header-icon" />
        <span className="transport-card-v2__title">{isPlane ? "Aviones Cercanos" : "Barcos Cercanos"}</span>
      </div>

      <div className="transport-card-v2__body">
        {items.length === 0 ? (
          <div className="transport-card-v2__empty">
            <img src={iconUrl} alt="" className="transport-card-v2__empty-icon" />
            <span>Escaneando...</span>
          </div>
        ) : (
          <div className="transport-card-v2__content" key={`${activeTab}-${currentIndex}`}>
            <div className="transport-card-v2__icon-container">
              <img src={iconUrl} alt={isPlane ? "avión" : "barco"} className="transport-card-v2__main-icon" />
            </div>

            <div className="transport-card-v2__info">
              <div className="transport-card-v2__name">
                {isPlane ? (current as any).callsign || "Vuelo" : (current as any).name || "Barco"}
              </div>

              {isPlane && (current as any).destination && (
                <div className="transport-card-v2__detail">✈️ {(current as any).destination}</div>
              )}
              {!isPlane && (current as any).destination && (
                <div className="transport-card-v2__detail">⚓ {(current as any).destination}</div>
              )}

              {(current as any).distance_km && (
                <div className="transport-card-v2__distance">
                  📍 {(current as any).distance_km.toFixed(1)} km
                </div>
              )}
            </div>
          </div>
        )}

        {items.length > 1 && (
          <div className="transport-card-v2__dots">
            {items.map((_, idx) => (
              <span key={idx} className={`transport-card-v2__dot ${idx === currentIndex ? "active" : ""}`} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .transport-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
        }
        .transport-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .transport-card-v2__header-icon {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        .transport-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .transport-card-v2__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .transport-card-v2__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          color: #64748b;
        }
        .transport-card-v2__empty-icon {
          width: 80px;
          height: 80px;
          object-fit: contain;
          opacity: 0.6;
          animation: pulse-v2 2s ease-in-out infinite;
        }
        .transport-card-v2__content {
          display: flex;
          align-items: center;
          gap: 1rem;
          animation: fadeIn-v2 0.4s ease-out;
        }
        .transport-card-v2__icon-container {
          width: 120px;
          height: 120px;
        }
        .transport-card-v2__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.25));
          animation: float-v2 4s ease-in-out infinite;
        }
        .transport-card-v2__info {
          text-align: left;
        }
        .transport-card-v2__name {
          font-size: 1.5rem;
          font-weight: 700;
          color: #0f172a;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .transport-card-v2__detail {
          font-size: 1rem;
          color: #334155;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .transport-card-v2__distance {
          font-size: 0.9rem;
          color: #0369a1;
          font-weight: 600;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .transport-card-v2__dots {
          display: flex;
          gap: 0.3rem;
          margin-top: 0.75rem;
        }
        .transport-card-v2__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(0,0,0,0.2);
          transition: all 0.3s;
        }
        .transport-card-v2__dot.active {
          background: #1e293b;
          width: 18px;
          border-radius: 3px;
        }
        @keyframes float-v2 {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
        @keyframes fadeIn-v2 {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-v2 {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
};

export default TransportCard;
