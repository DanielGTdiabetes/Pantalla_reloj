import React from "react";
import { coerceToDisplayString } from "../utils/text";

type Props = {
  data: Record<string, unknown>;
};

export const AstronomyModule: React.FC<Props> = ({ data }) => {
  const moonPhase = coerceToDisplayString(data.moon_phase ?? data.moonPhase);
  const sunrise = coerceToDisplayString(data.sunrise);
  const sunset = coerceToDisplayString(data.sunset);

  return (
    <div className="module-wrapper">
      <div>
        <h2>Astronomía</h2>
        <div className="module-content">
          <div style={{ fontSize: "2.5rem", fontWeight: 600 }}>{moonPhase}</div>
          <div style={{ display: "flex", gap: "18px", fontSize: "1.2rem" }}>
            <span>🌅 {sunrise}</span>
            <span>🌇 {sunset}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
