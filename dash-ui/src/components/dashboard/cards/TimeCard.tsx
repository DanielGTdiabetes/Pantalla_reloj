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
    <div className="time-card-dark">
      <div className="time-card-dark__header">
        <img src="/img/icons/3d/sun-smile.png" alt="" className="time-card-dark__header-icon" />
        <span className="time-card-dark__title">Reloj</span>
      </div>

      <div className="time-card-dark__body">
        <div className="time-card-dark__greeting">{greeting}</div>
        <div className="time-card-dark__clock">
          <span className="time-card-dark__hours">{hours}</span>
          <span className="time-card-dark__sep">:</span>
          <span className="time-card-dark__minutes">{minutes}</span>
          <span className="time-card-dark__seconds">{seconds}</span>
        </div>
        <div className="time-card-dark__date">
          <div className="time-card-dark__dayname">{dayName}</div>
          <div className="time-card-dark__fulldate">{fullDate}</div>
        </div>
      </div>

      <style>{`
        .time-card-dark {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          padding: 1rem;
          box-sizing: border-box;
          background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%);
          color: white;
          border-radius: 1rem;
        }
        .time-card-dark__header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .time-card-dark__header-icon {
          width: 64px;
          height: 64px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .time-card-dark__title {
          font-size: 1.8rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }
        .time-card-dark__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .time-card-dark__greeting {
          font-size: 2rem;
          font-weight: 600;
          opacity: 0.8;
          margin-bottom: 0.5rem;
        }
        .time-card-dark__clock {
          display: flex;
          align-items: baseline;
          gap: 0.2rem;
        }
        .time-card-dark__hours,
        .time-card-dark__minutes {
          font-size: 8rem;
          font-weight: 900;
          line-height: 1;
          text-shadow: 0 4px 16px rgba(0,0,0,0.6);
        }
        .time-card-dark__sep {
          font-size: 6rem;
          font-weight: 700;
          opacity: 0.7;
          animation: blink-dark 1s step-end infinite;
          margin: 0 0.5rem;
        }
        .time-card-dark__seconds {
          font-size: 2.5rem;
          font-weight: 600;
          opacity: 0.6;
          margin-left: 0.5rem;
        }
        .time-card-dark__date {
          margin-top: 2rem;
          text-align: center;
        }
        .time-card-dark__dayname {
          font-size: 2.2rem;
          font-weight: 800;
          text-transform: capitalize;
          margin-bottom: 0.5rem;
        }
        .time-card-dark__fulldate {
          font-size: 1.5rem;
          opacity: 0.7;
          text-transform: capitalize;
        }
        @keyframes blink-dark {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

export default TimeCard;
