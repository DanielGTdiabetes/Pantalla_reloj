import { useState, useEffect } from "react";

type TransportData = {
  planes?: Array<{
    callsign?: string;
    origin?: string;
    destination?: string;
    altitude?: number;
    speed?: number; // m/s usually from backend
    heading?: number;
    distance_km?: number;
    airline?: string;
    aircraft_type?: string;
    lat?: number;
    lon?: number;
    spd?: number; // fallback key from backend
    hdg?: number; // fallback key from backend
  }>;
  ships?: Array<{
    name?: string;
    type?: string;
    destination?: string;
    speed?: number;
    heading?: number;
    distance_km?: number;
    mmsi?: string;
    spd?: number; // fallback
    hdg?: number; // fallback
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
  // Use new modern icons
  const iconUrl = isPlane ? "/img/icons/modern/plane.png" : "/img/icons/modern/ship.png";

  const getSpeed = (item: any) => {
    const s = item.speed ?? item.spd;
    if (s === undefined || s === null) return null;
    // Plane speed usually m/s, Ship usually knots.
    // Let's assume input matches domain or just display unitless if unsure, but standardizing is good.
    // If it's OpenSky velocity (m/s) -> km/h
    if (isPlane) return `${Math.round(s * 3.6)} km/h`;
    // If it's AIS speed (knots) -> km/h or kn
    return `${s.toFixed(1)} kn`;
  };

  const getHeading = (item: any) => {
    const h = item.heading ?? item.hdg;
    if (h === undefined || h === null) return null;
    // Convert degrees to cardinal? Or just arrow.
    return Math.round(h);
  };

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
            <span className="transport-card-dark__empty-text">Escaneando...</span>
          </div>
        ) : (
          <div className="transport-card-dark__content" key={`${activeTab}-${currentIndex}`}>
            <div className="transport-card-dark__icon-container">
              <img src={iconUrl} alt={isPlane ? "avión" : "barco"} className="transport-card-dark__main-icon" />
            </div>

            <div className="transport-card-dark__info">
              <div className="transport-card-dark__name">
                {isPlane ? (current as any).callsign || "Vuelo Desconocido" : (current as any).name || "Barco Desconocido"}
              </div>

              {isPlane && (current as any).destination && (
                <div className="transport-card-dark__detail">✈️ {(current as any).destination}</div>
              )}
              {!isPlane && (current as any).destination && (
                <div className="transport-card-dark__detail">⚓ {(current as any).destination}</div>
              )}

              <div className="transport-card-dark__meta-row">
                {(current as any).distance_km && (
                  <div className="transport-card-dark__detail highlight">
                    📍 {(current as any).distance_km.toFixed(1)} km
                  </div>
                )}
                {getSpeed(current) && (
                  <div className="transport-card-dark__detail">
                    💨 {getSpeed(current)}
                  </div>
                )}
                {getHeading(current) !== null && (
                  <div className="transport-card-dark__detail">
                    🧭 {getHeading(current)}°
                  </div>
                )}
              </div>
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
          padding: 1rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
          color: white;
          border-radius: 1rem;
        }
        .transport-card-dark__header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .transport-card-dark__header-icon {
          width: 64px;
          height: 64px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .transport-card-dark__title {
          font-size: 1.8rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
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
          gap: 1rem;
          opacity: 0.7;
        }
        .transport-card-dark__empty-icon {
          width: 120px;
          height: 120px;
          object-fit: contain;
          animation: pulse-dark 2s ease-in-out infinite;
        }
        .transport-card-dark__empty-text {
          font-size: 1.5rem;
          font-weight: 600;
        }
        .transport-card-dark__content {
          display: flex;
          align-items: center;
          gap: 2rem;
          width: 100%;
          animation: fadeIn-dark 0.6s ease-out;
        }
        .transport-card-dark__icon-container {
          width: 180px;
          height: 180px;
          flex-shrink: 0;
        }
        .transport-card-dark__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 8px 16px rgba(0,0,0,0.5));
          animation: float-dark 6s ease-in-out infinite;
        }
        .transport-card-dark__info {
          text-align: left;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .transport-card-dark__name {
          font-size: 2.2rem;
          font-weight: 800;
          line-height: 1.1;
          margin-bottom: 0.5rem;
          text-shadow: 0 2px 8px rgba(0,0,0,0.6);
        }
        .transport-card-dark__detail {
          font-size: 1.4rem;
          opacity: 0.9;
          font-weight: 500;
        }
        .transport-card-dark__meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          margin-top: 0.5rem;
        }
        .transport-card-dark__detail.highlight {
          color: #38bdf8;
          font-weight: 700;
        }
        .transport-card-dark__dots {
          display: flex;
          gap: 0.5rem;
          margin-top: 1.5rem;
        }
        .transport-card-dark__dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .transport-card-dark__dot.active {
          background: white;
          width: 24px;
          border-radius: 5px;
        }
        @keyframes float-dark {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-12px) rotate(2deg); }
        }
        @keyframes fadeIn-dark {
          from { opacity: 0; transform: translateY(10px); }
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
