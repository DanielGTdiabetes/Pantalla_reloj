import React from "react";
import { coerceToDisplayString } from "../utils/text";

type Props = {
  data: Record<string, unknown>;
};

export const WeatherModule: React.FC<Props> = ({ data }) => {
  const temperatureValue = coerceToDisplayString(data.temperature);
  const unit = coerceToDisplayString(data.unit, "°C");
  const condition = coerceToDisplayString(data.condition, "Desconocido");
  const location = coerceToDisplayString(data.location);
  const updatedAtRaw = data.updated_at ?? data.updatedAt;
  const updatedAt = updatedAtRaw ? coerceToDisplayString(updatedAtRaw, "") : "";

  return (
    <div className="module-wrapper">
      <div>
        <h2>Condiciones actuales</h2>
        <div className="module-content">
          <div style={{ fontSize: "4.5rem", fontWeight: 600 }}>{`${temperatureValue}${unit}`}</div>
          <div style={{ fontSize: "1.6rem", color: "rgba(231,240,255,0.78)" }}>{condition}</div>
          <div style={{ fontSize: "1.2rem", color: "rgba(173,203,239,0.7)" }}>{location}</div>
          {updatedAt && (
            <div style={{ fontSize: "0.9rem", color: "rgba(173,203,239,0.5)" }}>
              Actualizado: {updatedAt}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
