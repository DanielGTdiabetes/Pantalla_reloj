import React, { useEffect, useMemo } from "react";
import { AutoScrollContainer } from "../../common/AutoScrollContainer";
import { PlaneIcon, ShipIcon, TransportRadarIcon } from "../../icons/TransportIcons";

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
  type?: string | null;
  ship_type?: string | null;
  destination?: string | null;
  speed?: number | null;
  speed_kts?: number | null;
  heading?: number | null;
  heading_deg?: number | null;
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

      const speedKts = normalizeNumber(item.speed_kts ?? item.speed);
      const heading = normalizeNumber(item.heading_deg ?? (item as any).heading ?? (item as any).hdg);

      return {
        id: item.id || (item as any).ic || (item as any).icao24 || item.callsign || `${item.lat}-${item.lon}`,
        callsign: item.callsign ?? (item as any).cs ?? (item as any).flight ?? null,
        origin: item.origin ?? (item as any).from ?? null,
        destination: item.destination ?? (item as any).dest ?? null,
        altitude_ft: computedAltitudeFt !== null ? Math.round(computedAltitudeFt) : null,
        speed_kts: speedKts !== null ? Math.round(speedKts) : null,
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
    .map(item => {
      const resolvedType = item.ship_type ?? item.type ?? item.vessel_type ?? null;
      return {
        id: item.id || item.mmsi || item.name || `${item.lat}-${item.lon}`,
        name: item.name ?? item.vessel ?? item.mmsi ?? "",
        mmsi: item.mmsi,
        type: resolvedType,
        ship_type: resolvedType,
        destination: item.destination ?? item.dest ?? null,
        speed: normalizeNumber(item.speed_kts ?? item.speed ?? item.spd),
        heading: normalizeNumber(item.heading_deg ?? item.heading ?? item.hdg),
        distance_km: normalizeNumber(item.distance_km ?? item.distance),
      };
    });
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
  const aircraftListClass = `transport-card-dark__list ${aircraft.length > 3 ? "transport-card-dark__list--scroll" : ""}`;
  const shipsListClass = `transport-card-dark__list ${ships.length > 3 ? "transport-card-dark__list--scroll" : ""}`;

  useEffect(() => {
    if (IS_DEV) {
      console.debug("[TransportCard] ships=", ships.length, "aircraft=", aircraft.length, { ships, aircraft });
    }
  }, [aircraft, ships]);

  const renderShips = ships.length > 0 && (
    <section className="transport-card-dark__section" data-testid="panel-ships">
      <div className="transport-card-dark__section-header">
        <div className="transport-card-dark__section-icon panel-title-icon"><ShipIcon size={38} /></div>
        <span className="transport-card-dark__section-title">Barcos cercanos</span>
      </div>
      <div className={shipsListClass}>
        {ships.map(ship => {
          const hasDistance = ship.distance_km !== null && ship.distance_km !== undefined;
          const distanceLabel = hasDistance && typeof ship.distance_km === "number"
            ? `${ship.distance_km.toFixed(1)} km`
            : null;
          return (
            <div key={ship.id} className="transport-card-dark__item">
              <div className="transport-card-dark__item-header">
                <div className="transport-card-dark__name panel-item-title">
                  {ship.name || ship.mmsi || "Barco desconocido"}
                </div>
                {distanceLabel && (
                  <div className="transport-card-dark__badge">
                    {distanceLabel}
                  </div>
                )}
              </div>
              {(ship.ship_type || distanceLabel) && (
                <div className="transport-card-dark__inline-meta">
                  {ship.ship_type && <span className="transport-card-dark__chip">{ship.ship_type}</span>}
                  {ship.ship_type && distanceLabel && (
                    <span className="transport-card-dark__separator">·</span>
                  )}
                  {distanceLabel && (
                    <span className="transport-card-dark__meta-distance">{distanceLabel}</span>
                  )}
                </div>
              )}
              {ship.destination && (
                <div className="transport-card-dark__subtitle panel-item-subtitle">{ship.destination}</div>
              )}
              <div className="transport-card-dark__meta-grid">
                {renderDetail("Velocidad", formatNumber(ship.speed ?? ship.speed_kts, " kn"))}
                {renderDetail("Rumbo", formatNumber(ship.heading, "°"))}
                {renderDetail("Tipo", ship.ship_type || ship.type || "--")}
                {renderDetail("MMSI", ship.mmsi || "--")}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const renderAircraft = aircraft.length > 0 && (
    <section className="transport-card-dark__section" data-testid="panel-flights">
      <div className="transport-card-dark__section-header">
        <div className="transport-card-dark__section-icon panel-title-icon"><PlaneIcon size={38} /></div>
        <span className="transport-card-dark__section-title">Vuelos cercanos</span>
      </div>
      <div className={aircraftListClass}>
        {aircraft.map(flight => {
          const route = formatRoute(flight.origin, flight.destination);
          const distanceLabel =
            flight.distance_km !== null && flight.distance_km !== undefined && typeof flight.distance_km === "number"
              ? `${flight.distance_km.toFixed(1)} km`
              : null;
          return (
            <div key={flight.id} className="transport-card-dark__item">
              <div className="transport-card-dark__item-header">
                <div className="transport-card-dark__name panel-item-title">
                  {flight.callsign || "Vuelo desconocido"}
                </div>
                {distanceLabel && (
                  <div className="transport-card-dark__badge">
                    {distanceLabel}
                  </div>
                )}
              </div>
              {route && <div className="transport-card-dark__subtitle panel-item-subtitle">{route}</div>}
              <div className="transport-card-dark__meta-grid">
                {renderDetail("Altitud", formatNumber(flight.altitude_ft, " ft"))}
                {renderDetail("Velocidad", formatNumber(flight.speed_kts, " kt"))}
                {renderDetail("Rumbo", formatNumber(flight.heading_deg, "°"))}
                {renderDetail("Info", flight.aircraft_type || flight.airline || "--")}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="transport-card-dark" data-testid="panel-transport">
      <div className="transport-card-dark__header">
        <div className="transport-card-dark__header-icon panel-title-icon">
          <TransportRadarIcon size={54} />
        </div>
        <span className="transport-card-dark__title panel-title-text">Transporte cercano</span>
      </div>

      <AutoScrollContainer speed={8} pauseAtEndMs={4000} className="transport-card-dark__scroller">
        <div className="transport-card-dark__stack">
          {renderAircraft}
          {renderShips}
          {!hasAnyTransport && (
            <div className="transport-card-dark__empty-all">
              <PlaneIcon size={72} className="transport-card-dark__empty-icon panel-title-icon" />
              <span className="transport-card-dark__empty-text">No hay barcos ni vuelos cercanos en este momento</span>
            </div>
          )}
        </div>
      </AutoScrollContainer>

      <style>{`
        .transport-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 1rem;
          box-sizing: border-box;
          background: linear-gradient(145deg, rgba(15, 23, 42, 0.85) 0%, rgba(30, 41, 59, 0.9) 100%);
          color: white;
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 
            0 20px 40px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset 0 10px 20px rgba(0,0,0,0.2);
          gap: 0.5rem;
        }
        .transport-card-dark__header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.25rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.12);
        }
        .transport-card-dark__header-icon {
          width: 64px;
          height: 64px;
          display: grid;
          place-items: center;
          background: rgba(255,255,255,0.06);
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
        }
        .transport-card-dark__title {
          font-size: 1.8rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }
        .transport-card-dark__scroller {
          flex: 1;
          width: 100%;
        }
        .transport-card-dark__stack {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding-right: 0.25rem;
        }
        .transport-card-dark__section {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 0.8rem;
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        }
        .transport-card-dark__section-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .transport-card-dark__section-icon {
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          background: rgba(255,255,255,0.08);
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.12);
        }
        .transport-card-dark__section-title {
          font-size: 1.2rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .transport-card-dark__list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .transport-card-dark__list--scroll {
          max-height: 320px;
          overflow-y: auto;
          padding-right: 0.35rem;
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
          font-size: 1.25rem;
          font-weight: 800;
          text-transform: uppercase;
        }
        .transport-card-dark__badge {
          background: rgba(56,189,248,0.18);
          border: 1px solid rgba(56,189,248,0.35);
          color: #9ae6ff;
          padding: 0.25rem 0.55rem;
          border-radius: 999px;
          font-weight: 700;
          min-width: 74px;
          text-align: center;
        }
        .transport-card-dark__inline-meta {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          margin-top: -0.2rem;
          color: rgba(226, 232, 240, 0.9);
          font-weight: 700;
        }
        .transport-card-dark__chip {
          display: inline-flex;
          align-items: center;
          padding: 0.15rem 0.65rem;
          background: rgba(255,255,255,0.12);
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          font-size: 0.95rem;
          text-transform: capitalize;
        }
        .transport-card-dark__meta-distance {
          font-weight: 800;
          color: #a5f3fc;
          letter-spacing: 0.02em;
        }
        .transport-card-dark__separator {
          opacity: 0.65;
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
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
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
          font-size: 1.05rem;
        }
        .transport-card-dark__empty-all {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 0.5rem;
          padding: 1rem;
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
        .transport-card-dark__empty-text {
          font-size: 1.1rem;
          font-weight: 700;
          text-align: center;
          opacity: 0.9;
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
