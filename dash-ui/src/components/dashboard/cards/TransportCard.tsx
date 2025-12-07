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

    // Auto-switch between planes and ships
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

    // Rotate through items
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
        <div className="transport-card-3d">
            <div className="transport-card-3d__header">
                <img src={iconUrl} alt="" className="transport-card-3d__header-icon" />
                <span>{isPlane ? "Aviones Cercanos" : "Barcos Cercanos"}</span>
            </div>

            {items.length === 0 ? (
                <div className="transport-card-3d__empty">
                    <img src={iconUrl} alt="" className="transport-card-3d__empty-icon" />
                    <span>Escaneando...</span>
                </div>
            ) : (
                <div className="transport-card-3d__content" key={`${activeTab}-${currentIndex}`}>
                    <div className="transport-card-3d__icon-container">
                        <img src={iconUrl} alt={isPlane ? "avión" : "barco"} className="transport-card-3d__main-icon" />
                    </div>

                    <div className="transport-card-3d__info">
                        <div className="transport-card-3d__name">
                            {isPlane ? (current as any).callsign || "Vuelo" : (current as any).name || "Barco"}
                        </div>

                        {isPlane && (current as any).destination && (
                            <div className="transport-card-3d__detail">✈️ {(current as any).destination}</div>
                        )}
                        {!isPlane && (current as any).destination && (
                            <div className="transport-card-3d__detail">⚓ {(current as any).destination}</div>
                        )}

                        {(current as any).distance_km && (
                            <div className="transport-card-3d__distance">
                                📍 {(current as any).distance_km.toFixed(1)} km
                            </div>
                        )}
                    </div>
                </div>
            )}

            {items.length > 1 && (
                <div className="transport-card-3d__dots">
                    {items.map((_, idx) => (
                        <span key={idx} className={`transport-card-3d__dot ${idx === currentIndex ? "active" : ""}`} />
                    ))}
                </div>
            )}

            <style>{`
        .transport-card-3d {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          width: 100%;
          padding: 0.75rem;
          box-sizing: border-box;
          color: white;
          text-align: center;
          gap: 0.25rem;
        }
        .transport-card-3d__header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          opacity: 0.8;
        }
        .transport-card-3d__header-icon {
          width: 24px;
          height: 24px;
          object-fit: contain;
        }
        .transport-card-3d__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          flex: 1;
          justify-content: center;
          opacity: 0.6;
        }
        .transport-card-3d__empty-icon {
          width: 50px;
          height: 50px;
          object-fit: contain;
          animation: pulse3d 2s ease-in-out infinite;
        }
        .transport-card-3d__content {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex: 1;
          animation: fadeIn3d 0.4s ease-out;
        }
        .transport-card-3d__icon-container {
          width: 70px;
          height: 70px;
        }
        .transport-card-3d__main-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
          animation: float3d 4s ease-in-out infinite;
        }
        .transport-card-3d__info {
          text-align: left;
        }
        .transport-card-3d__name {
          font-size: 1.3rem;
          font-weight: 700;
        }
        .transport-card-3d__detail {
          font-size: 0.85rem;
          opacity: 0.8;
        }
        .transport-card-3d__distance {
          font-size: 0.8rem;
          color: #38bdf8;
          font-weight: 600;
        }
        .transport-card-3d__dots {
          display: flex;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .transport-card-3d__dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .transport-card-3d__dot.active {
          background: #38bdf8;
          width: 14px;
          border-radius: 3px;
        }
        @keyframes float3d {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(2deg); }
        }
        @keyframes fadeIn3d {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse3d {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
        </div>
    );
};

export default TransportCard;
