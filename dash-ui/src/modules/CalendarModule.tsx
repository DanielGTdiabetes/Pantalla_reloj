import React from "react";

type Props = {
  data: Record<string, unknown>;
};

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

export const CalendarModule: React.FC<Props> = ({ data }) => {
  const generatedAt = data.generated_at ?? data.generatedAt ?? "";

  return (
    <div className="module-wrapper">
      <div>
        <h2>Calendario</h2>
        <div className="module-content" style={{ gap: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "10px" }}>
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                style={{
                  textAlign: "center",
                  padding: "16px 0",
                  borderRadius: "12px",
                  background: "rgba(22, 42, 60, 0.35)",
                  border: "1px solid rgba(77,128,184,0.18)",
                  fontSize: "1.1rem",
                  letterSpacing: "0.2em"
                }}
              >
                {day}
              </div>
            ))}
          </div>
          {generatedAt && (
            <div style={{ fontSize: "0.85rem", color: "rgba(173,203,239,0.45)" }}>
              Fuente generada: {String(generatedAt)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
