import React from "react";

import { ClockDisplay } from "./ClockDisplay";
import { SAFE_MODE_BADGE_LABEL } from "../utils/safeMode";

type SafeModePlaceholderProps = {
  timezone: string;
};

export const SafeModePlaceholder: React.FC<SafeModePlaceholderProps> = ({ timezone }) => {
  return (
    <div className="map-fallback map-fallback--safe" role="presentation">
      <span className="map-fallback__badge map-fallback__badge--safe">{SAFE_MODE_BADGE_LABEL}</span>
      <h2 className="map-fallback__title">Modo seguro activado</h2>
      <p className="map-fallback__status">
        El mapa se ha deshabilitado temporalmente para garantizar la disponibilidad de la pantalla.
      </p>
      <ClockDisplay
        timezone={timezone}
        format="HH:mm:ss"
        className="map-fallback__clock-container"
        timeClassName="map-fallback__clock"
        dateClassName="map-fallback__date"
      />
      <div className="map-safe-placeholder" aria-hidden="true" />
    </div>
  );
};

export default SafeModePlaceholder;
