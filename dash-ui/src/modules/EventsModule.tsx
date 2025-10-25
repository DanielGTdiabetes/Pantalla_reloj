import React from "react";

type CalendarEvent = {
  title?: string;
  start?: string;
  end?: string;
  location?: string;
};

type Props = {
  data: Record<string, unknown>;
};

export const EventsModule: React.FC<Props> = ({ data }) => {
  const events = (data.upcoming as CalendarEvent[]) ?? [];

  return (
    <div className="module-wrapper">
      <div>
        <h2>Efemérides</h2>
        <div className="module-content" style={{ gap: "14px" }}>
          {events.length === 0 && <div className="news-item">Sin eventos registrados</div>}
          {events.slice(0, 4).map((event, index) => (
            <div key={index} className="news-item">
              <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{event.title ?? "Evento"}</div>
              {(event.start || event.end) && (
                <div style={{ fontSize: "0.95rem", color: "rgba(173,203,239,0.65)" }}>
                  {event.start ?? ""} {event.end ? `→ ${event.end}` : ""}
                </div>
              )}
              {event.location && (
                <div style={{ fontSize: "0.9rem", color: "rgba(173,203,239,0.45)" }}>{event.location}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
