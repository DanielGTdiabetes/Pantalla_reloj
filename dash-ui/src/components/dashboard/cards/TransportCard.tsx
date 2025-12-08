import React, { useEffect, useMemo, useState } from "react";

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

// Panel lateral de transporte: aviones y barcos cercanos
export const TransportCard = ({ data }: TransportCardProps): JSX.Element => {
  const [activeTab, setActiveTab] = useState<TransportType>("plane");
  const [currentIndex, setCurrentIndex] = useState(0);

  const normalizedPlanes = useMemo(() => {
    return (data?.planes || []).map((plane: any) => ({
      callsign: plane.callsign ?? plane.cs ?? plane.flight ?? "",
      origin: plane.origin ?? plane.from ?? "",
      destination: plane.destination ?? plane.dest ?? "",
      altitude: plane.altitude ?? plane.alt ?? null,
      speed: plane.speed ?? plane.spd ?? null,
      heading: plane.heading ?? plane.hdg ?? null,
      distance_km: plane.distance_km ?? plane.distance ?? null,
      airline: plane.airline ?? plane.co ?? "",
      aircraft_type: plane.aircraft_type ?? plane.type ?? "",
      lat: plane.lat,
      lon: plane.lon,
    }));
  }, [data?.planes]);

  const normalizedShips = useMemo(() => {
    return (data?.ships || []).map((ship: any) => ({
      name: ship.name ?? ship.vessel ?? ship.mmsi ?? "",
      type: ship.type ?? ship.vessel_type ?? "",
      destination: ship.destination ?? ship.dest ?? "",
      speed: ship.speed ?? ship.spd ?? null,
      heading: ship.heading ?? ship.hdg ?? null,
      distance_km: ship.distance_km ?? ship.distance ?? null,
    }));
  }, [data?.ships]);

  const planes = normalizedPlanes;
  const ships = normalizedShips;
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
  const iconUrl = isPlane ? "/icons/transport/plane.svg" : "/icons/transport/ship.svg";

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

  const getType = (item: any) => {
    if (isPlane) return item.aircraft_type || item.airline || "";
    return item.type || "";
  };

  const renderEmpty = () => {
    const label = isPlane ? "Sin vuelos cercanos" : "Sin barcos cercanos";
    return (
      <div className="transport-card-dark__empty" data-testid={isPlane ? "panel-flights" : "panel-ships"}>
        <img src={iconUrl} alt="" className="transport-card-dark__empty-icon panel-title-icon" />
        <span className="transport-card-dark__empty-text panel-item-title">{label}</span>
      </div>
    );
  };

  const renderDetail = (label: string, value: React.ReactNode, highlight?: boolean) => (
    <div className={`transport-card-dark__detail ${highlight ? "highlight" : ""}`}>
      <span className="transport-card-dark__detail-label">{label}</span>
      <span className="transport-card-dark__detail-value">{value}</span>
    </div>
  );

  return (
    <div className="transport-card-dark" data-testid="panel-transport">
      <div className="transport-card-dark__header">
        <img src={iconUrl} alt="" className="transport-card-dark__header-icon panel-title-icon" />
        <span className="transport-card-dark__title panel-title-text">{isPlane ? "Aviones Cercanos" : "Barcos Cercanos"}</span>
      </div>

      <div className="transport-card-dark__body panel-body">
        {items.length === 0 ? (
          renderEmpty()
        ) : (
          <div
            className="transport-card-dark__content"
            key={`${activeTab}-${currentIndex}`}
            data-testid={isPlane ? "panel-flights" : "panel-ships"}
          >
            <div className="transport-card-dark__icon-container">
              <img
                src={iconUrl}
                alt={isPlane ? "avión" : "barco"}
                className="transport-card-dark__main-icon panel-title-icon"
              />
            </div>

            <div className="transport-card-dark__info">
              <div className="transport-card-dark__name panel-item-title">
                {isPlane ? (current as any).callsign || "Vuelo Desconocido" : (current as any).name || "Barco Desconocido"}
              </div>

              {(current as any).destination && (
                <div className="transport-card-dark__destination panel-item-subtitle">{(current as any).destination}</div>
              )}

              <div className="transport-card-dark__meta-grid">
                {renderDetail("Altitud", (current as any).altitude ? `${Math.round((current as any).altitude)} m` : "--")}
                {renderDetail("Distancia", (current as any).distance_km ? `${(current as any).distance_km.toFixed(1)} km` : "--", true)}
                {renderDetail("Velocidad", getSpeed(current) || "--")}
                {renderDetail("Rumbo", getHeading(current) !== null ? `${getHeading(current)}°` : "--")}
                {renderDetail("Tipo", getType(current) || "--")}
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
          margin-bottom: 0.2rem;
          text-shadow: 0 2px 8px rgba(0,0,0,0.6);
          text-transform: uppercase;
        }
        .transport-card-dark__destination {
          font-size: 1.1rem;
          opacity: 0.85;
        }
        .transport-card-dark__meta-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.65rem;
          margin-top: 0.75rem;
        }
        .transport-card-dark__detail {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          padding: 0.65rem 0.75rem;
          background: rgba(255,255,255,0.08);
          border-radius: 0.6rem;
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 1.05rem;
        }
        .transport-card-dark__detail-label {
          font-size: 0.8rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.7;
          font-weight: 700;
        }
        .transport-card-dark__detail-value {
          font-weight: 800;
          font-size: 1.25rem;
        }
        .transport-card-dark__detail.highlight {
          border-color: rgba(56,189,248,0.4);
          box-shadow: 0 6px 14px rgba(56,189,248,0.18);
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
