import React from "react";

import { ClockDisplay } from "./ClockDisplay";

type MapFallbackProps = {
  timezone: string;
  reason?: string | null;
};

export const MapFallback: React.FC<MapFallbackProps> = ({ timezone, reason }) => {
  const statusMessage = reason ? `WebGL no disponible: ${reason}` : "WebGL no está disponible en este dispositivo";
  return (
    <div className="map-fallback" role="presentation">
      <span className="map-fallback__badge">Modo básico</span>
      <h2 className="map-fallback__title">Mapa no disponible</h2>
      <p className="map-fallback__status">{statusMessage}</p>
      <ClockDisplay
        timezone={timezone}
        format="HH:mm:ss"
        className="map-fallback__clock-container"
        timeClassName="map-fallback__clock"
        dateClassName="map-fallback__date"
      />
    </div>
  );
};

export default MapFallback;
