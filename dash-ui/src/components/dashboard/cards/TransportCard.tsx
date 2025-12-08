import React, { useEffect, useMemo } from "react";

type Aircraft = {
  id?: string;
  callsign?: string | null;
  origin?: string | null;
  destination?: string | null;
  altitude?: number | null;
  altitude_ft?: number | null;
  alt?: number | null;
  speed_kts?: number | null;
  speed?: number | null;
  heading_deg?: number | null;
  heading?: number | null;
  lat?: number;
  lon?: number;
  distance_km?: number | null;
  airline?: string | null;
  aircraft_type?: string | null;
};

type Ship = {
  id?: string;
  name?: string;
  mmsi?: string;
  type?: string;
  destination?: string | null;
  speed?: number | null;
  heading?: number | null;
  distance_km?: number | null;
  lat?: number;
  lon?: number;
};

type TransportData = {
  aircraft?: Aircraft[];
  planes?: Aircraft[]; // Legacy key used previously
  ships?: Ship[];
};

type TransportCardProps = {
  data: TransportData | null;
};

const IS_DEV = typeof import.meta !== "undefined" && Boolean((import.meta as any)?.env?.DEV);

const formatRoute = (origin?: string | null, destination?: string | null) => {
  if (!origin && !destination) return null;
  if (origin && destination) return `${origin} → ${destination}`;
  return origin || destination;
};

const normalizeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeAircraft = (data?: TransportData | null): Aircraft[] => {
  const items = (data?.aircraft ?? data?.planes ?? []) as Aircraft[];
  return items
    .filter(item => item && normalizeNumber(item.lat) !== null && normalizeNumber(item.lon) !== null)
    .map(item => {
      const altitudeFt = normalizeNumber(item.altitude_ft);
      const altitudeMeters = normalizeNumber((item as any).altitude ?? (item as any).alt);
      const computedAltitudeFt =
        altitudeFt !== null
          ? altitudeFt
          : altitudeMeters !== null
            ? altitudeMeters * 3.28084
            : null;

      const speedKts = normalizeNumber(item.speed_kts);
      const rawSpeed = normalizeNumber((item as any).speed ?? (item as any).spd);
      const computedSpeedKts = speedKts !== null ? speedKts : rawSpeed !== null ? rawSpeed * 1.94384 : null;

      const heading = normalizeNumber(item.heading_deg ?? (item as any).heading ?? (item as any).hdg);

      return {
        id: item.id || (item as any).ic || (item as any).icao24 || item.callsign || `${item.lat}-${item.lon}`,
        callsign: item.callsign ?? (item as any).cs ?? (item as any).flight ?? null,
        origin: item.origin ?? (item as any).from ?? null,
        destination: item.destination ?? (item as any).dest ?? null,
        altitude_ft: computedAltitudeFt !== null ? Math.round(computedAltitudeFt) : null,
        speed_kts: computedSpeedKts !== null ? Math.round(computedSpeedKts) : null,
        heading_deg: heading !== null ? Math.round(heading) : null,
        lat: item.lat,
        lon: item.lon,
        distance_km: normalizeNumber(item.distance_km ?? (item as any).distance),
        airline: item.airline ?? (item as any).co ?? null,
        aircraft_type: (item as any).aircraft_type ?? (item as any).type ?? null,
      };
    });
};

const normalizeShips = (data?: TransportData | null): Ship[] => {
  const items = (data?.ships ?? []) as any[];
  return items
    .filter(item => item && normalizeNumber(item.lat) !== null && normalizeNumber(item.lon) !== null)
    .map(item => ({
      id: item.id || item.mmsi || item.name || `${item.lat}-${item.lon}`,
      name: item.name ?? item.vessel ?? item.mmsi ?? "",
      mmsi: item.mmsi,
      type: item.type ?? item.vessel_type ?? "",
      destination: item.destination ?? item.dest ?? null,
      speed: normalizeNumber(item.speed ?? item.spd),
      heading: normalizeNumber(item.heading ?? item.hdg),
      distance_km: normalizeNumber(item.distance_km ?? item.distance),
    }));
};

const formatNumber = (value: number | null | undefined, suffix: string) =>
  value === null || value === undefined ? "--" : `${value}${suffix}`;

const renderDetail = (label: string, value: string) => (
  <div className="transport-card-dark__detail">
    <span className="transport-card-dark__detail-label">{label}</span>
    <span className="transport-card-dark__detail-value">{value}</span>
  </div>
);

// Panel lateral de transporte: aviones y barcos cercanos
export const TransportCard = ({ data }: TransportCardProps): JSX.Element => {
  const aircraft = useMemo(() => normalizeAircraft(data), [data]);
  const ships = useMemo(() => normalizeShips(data), [data]);
  const hasAnyTransport = aircraft.length > 0 || ships.length > 0;

  useEffect(() => {
    if (IS_DEV) {
      console.debug("[TransportCard] ships=", ships.length, "aircraft=", aircraft.length, { ships, aircraft });
    }
  }, [aircraft, ships]);

  return (
    <div className="transport-card-dark" data-testid="panel-transport">
      <div className="transport-card-dark__header">
        <img src="/icons/transport/plane.svg" alt="" className="transport-card-dark__header-icon panel-title-icon" />
        <span className="transport-card-dark__title panel-title-text">Transporte cercano</span>
      </div>

      <div className="transport-card-dark__sections panel-body">
        <div className="transport-card-dark__section" data-testid="panel-flights">
          <div className="transport-card-dark__section-header">
            <img src="/icons/transport/plane.svg" alt="" className="transport-card-dark__section-icon panel-title-icon" />
            <span className="transport-card-dark__section-title">Vuelos cercanos</span>
          </div>
          {aircraft.length === 0 ? (
            <div className="transport-card-dark__empty">
              <span className="transport-card-dark__empty-text">Sin vuelos cercanos</span>
            </div>
          ) : (
            <div className="transport-card-dark__list">
              {aircraft.map(flight => {
                const route = formatRoute(flight.origin, flight.destination);
                return (
                  <div key={flight.id} className="transport-card-dark__item">
                    <div className="transport-card-dark__item-header">
                      <div className="transport-card-dark__name panel-item-title">
                        {flight.callsign || "Vuelo desconocido"}
                      </div>
                      <div className="transport-card-dark__badge">
                        {flight.distance_km !== null && flight.distance_km !== undefined
                          ? `${flight.distance_km.toFixed(1)} km`
                          : "--"}
                      </div>
                    </div>
                    {route && <div className="transport-card-dark__subtitle panel-item-subtitle">{route}</div>}
                    <div className="transport-card-dark__meta-grid">
                      {renderDetail("Altitud", formatNumber(flight.altitude_ft, " ft"))}
                      {renderDetail("Velocidad", formatNumber(flight.speed_kts, " kt"))}
                      {renderDetail("Rumbo", formatNumber(flight.heading_deg, "°"))}
                      {renderDetail("Modelo", flight.aircraft_type || flight.airline || "--")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="transport-card-dark__section" data-testid="panel-ships">
          <div className="transport-card-dark__section-header">
            <img src="/icons/transport/ship.svg" alt="" className="transport-card-dark__section-icon panel-title-icon" />
            <span className="transport-card-dark__section-title">Barcos cercanos</span>
          </div>
          {ships.length === 0 ? (
            <div className="transport-card-dark__empty">
              <span className="transport-card-dark__empty-text">Sin barcos cercanos</span>
            </div>
          ) : (
            <div className="transport-card-dark__list">
              {ships.map(ship => (
                <div key={ship.id} className="transport-card-dark__item">
                  <div className="transport-card-dark__item-header">
                    <div className="transport-card-dark__name panel-item-title">
                      {ship.name || ship.mmsi || "Barco desconocido"}
                    </div>
                    <div className="transport-card-dark__badge">
                      {ship.distance_km !== null && ship.distance_km !== undefined
                        ? `${ship.distance_km.toFixed(1)} km`
                        : "--"}
                    </div>
                  </div>
                  {ship.destination && (
                    <div className="transport-card-dark__subtitle panel-item-subtitle">{ship.destination}</div>
                  )}
                  <div className="transport-card-dark__meta-grid">
                    {renderDetail("Velocidad", formatNumber(ship.speed, " kn"))}
                    {renderDetail("Rumbo", formatNumber(ship.heading, "°"))}
                    {renderDetail("Tipo", ship.type || "--")}
                    {renderDetail("MMSI", ship.mmsi || "--")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!hasAnyTransport && (
          <div className="transport-card-dark__empty-all">
            <img src="/icons/transport/plane.svg" alt="" className="transport-card-dark__empty-icon panel-title-icon" />
            <span className="transport-card-dark__empty-text">No hay barcos ni vuelos cercanos en este momento</span>
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
          gap: 1rem;
        }
        .transport-card-dark__header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.25rem;
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
        .transport-card-dark__sections {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          overflow: hidden;
        }
        .transport-card-dark__section {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 0.8rem;
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .transport-card-dark__section-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .transport-card-dark__section-icon {
          width: 40px;
          height: 40px;
          object-fit: contain;
        }
        .transport-card-dark__section-title {
          font-size: 1.3rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .transport-card-dark__list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          max-height: 18rem;
          overflow: hidden;
        }
        .transport-card-dark__item {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.75rem;
          border-radius: 0.6rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        }
        .transport-card-dark__item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .transport-card-dark__name {
          font-size: 1.4rem;
          font-weight: 800;
          text-transform: uppercase;
        }
        .transport-card-dark__badge {
          background: rgba(56,189,248,0.18);
          border: 1px solid rgba(56,189,248,0.35);
          color: #9ae6ff;
          padding: 0.3rem 0.6rem;
          border-radius: 999px;
          font-weight: 700;
          min-width: 80px;
          text-align: center;
        }
        .transport-card-dark__subtitle {
          font-size: 1rem;
          opacity: 0.85;
        }
        .transport-card-dark__meta-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.6rem;
        }
        .transport-card-dark__detail {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          padding: 0.55rem 0.65rem;
          background: rgba(255,255,255,0.08);
          border-radius: 0.6rem;
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 1rem;
        }
        .transport-card-dark__detail-label {
          font-size: 0.75rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.7;
          font-weight: 700;
        }
        .transport-card-dark__detail-value {
          font-weight: 800;
          font-size: 1.15rem;
        }
        .transport-card-dark__empty,
        .transport-card-dark__empty-all {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          opacity: 0.8;
          text-align: center;
        }
        .transport-card-dark__empty-text {
          font-size: 1.1rem;
          font-weight: 700;
        }
        .transport-card-dark__empty-all {
          flex-direction: column;
          padding: 0.75rem;
          border-radius: 0.75rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .transport-card-dark__empty-icon {
          width: 96px;
          height: 96px;
          object-fit: contain;
          animation: pulse-dark 2s ease-in-out infinite;
        }
        @keyframes pulse-dark {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
};

export default TransportCard;
