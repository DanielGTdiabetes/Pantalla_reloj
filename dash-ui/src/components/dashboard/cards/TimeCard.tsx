import { useState, useEffect } from "react";

type TimeCardProps = {
  timezone: string;
};

export const TimeCard = ({ timezone }: TimeCardProps): JSX.Element => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const options: Intl.DateTimeFormatOptions = { timeZone: timezone };
  const hours = time.toLocaleTimeString("es-ES", { ...options, hour: "2-digit", minute: "2-digit" }).split(":")[0];
  const minutes = time.toLocaleTimeString("es-ES", { ...options, hour: "2-digit", minute: "2-digit" }).split(":")[1];
  const seconds = time.toLocaleTimeString("es-ES", { ...options, second: "2-digit" }).split(":")[2];

  const dayName = time.toLocaleDateString("es-ES", { ...options, weekday: "long" });
  const fullDate = time.toLocaleDateString("es-ES", { ...options, day: "numeric", month: "long", year: "numeric" });

  const hour = time.getHours();
  const greeting = hour >= 6 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 21 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="time-card-v2">
      <div className="time-card-v2__header">
        <span className="time-card-v2__icon">🕐</span>
        <span className="time-card-v2__title">Reloj</span>
      </div>

      <div className="time-card-v2__body">
        <div className="time-card-v2__greeting">{greeting}</div>
        <div className="time-card-v2__clock">
          <span className="time-card-v2__hours">{hours}</span>
          <span className="time-card-v2__sep">:</span>
          <span className="time-card-v2__minutes">{minutes}</span>
          <span className="time-card-v2__seconds">{seconds}</span>
        </div>
        <div className="time-card-v2__date">
          <div className="time-card-v2__dayname">{dayName}</div>
          <div className="time-card-v2__fulldate">{fullDate}</div>
        </div>
      </div>

      <style>{`
        .time-card-v2 {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 0.5rem;
          box-sizing: border-box;
        }
        .time-card-v2__header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .time-card-v2__icon {
          font-size: 2rem;
        }
        .time-card-v2__title {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
        }
        .time-card-v2__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .time-card-v2__greeting {
          font-size: 1.1rem;
          font-weight: 600;
          color: #334155;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
          margin-bottom: 0.25rem;
        }
        .time-card-v2__clock {
          display: flex;
          align-items: baseline;
          gap: 0.15rem;
        }
        .time-card-v2__hours,
        .time-card-v2__minutes {
          font-size: 4.5rem;
          font-weight: 900;
          line-height: 1;
          color: #0f172a;
          text-shadow: 0 2px 4px rgba(255,255,255,0.6);
        }
        .time-card-v2__sep {
          font-size: 3.5rem;
          font-weight: 700;
          color: #334155;
          animation: blink-v2 1s step-end infinite;
        }
        .time-card-v2__seconds {
          font-size: 1.5rem;
          font-weight: 600;
          color: #475569;
          margin-left: 0.25rem;
        }
        .time-card-v2__date {
          margin-top: 0.75rem;
          text-align: center;
        }
        .time-card-v2__dayname {
          font-size: 1.4rem;
          font-weight: 700;
          text-transform: capitalize;
          color: #1e293b;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        .time-card-v2__fulldate {
          font-size: 1rem;
          color: #475569;
          text-transform: capitalize;
          text-shadow: 0 1px 2px rgba(255,255,255,0.5);
        }
        @keyframes blink-v2 {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

export default TimeCard;
