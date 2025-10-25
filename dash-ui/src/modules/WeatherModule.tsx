import React from "react";

type Props = {
  data: Record<string, unknown>;
};

export const WeatherModule: React.FC<Props> = ({ data }) => {
  const temperature = data.temperature ?? "--";
  const unit = data.unit ?? "°C";
  const condition = data.condition ?? "Desconocido";
  const location = data.location ?? "--";
  const updatedAt = data.updated_at ?? data.updatedAt ?? "";

  return (
    <div className="module-wrapper">
      <div>
        <h2>Condiciones actuales</h2>
        <div className="module-content">
          <div style={{ fontSize: "4.5rem", fontWeight: 600 }}>{`${temperature}${unit}`}</div>
          <div style={{ fontSize: "1.6rem", color: "rgba(231,240,255,0.78)" }}>{condition}</div>
          <div style={{ fontSize: "1.2rem", color: "rgba(173,203,239,0.7)" }}>{location}</div>
          {updatedAt && <div style={{ fontSize: "0.9rem", color: "rgba(173,203,239,0.5)" }}>Actualizado: {String(updatedAt)}</div>}
        </div>
      </div>
    </div>
  );
};
