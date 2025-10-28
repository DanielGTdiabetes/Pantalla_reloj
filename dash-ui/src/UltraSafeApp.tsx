import React from "react";

// ZERO timers, ZERO effects, ZERO rotating/map. Pure render only.
export const UltraSafeApp: React.FC = () => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "system-ui, sans-serif"
      }}
    >
      <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 8 }}>
        ULTRA-SAFE MODE
      </div>
      <div style={{ fontSize: 120, lineHeight: 1, letterSpacing: 2 }}>
        {hh}:{mm}
      </div>
      <div style={{ marginTop: 12, fontSize: 18 }}>
        Kiosk minimal sin rotaciones ni mapa
      </div>
    </div>
  );
};

export default UltraSafeApp;
