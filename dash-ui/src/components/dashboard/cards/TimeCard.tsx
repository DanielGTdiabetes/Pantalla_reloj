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
    <div className="time-card-simple">
      <div className="time-card-simple__greeting">{greeting}</div>
      <div className="time-card-simple__clock">
        <span className="time-card-simple__hours">{hours}</span>
        <span className="time-card-simple__sep">:</span>
        <span className="time-card-simple__minutes">{minutes}</span>
        <span className="time-card-simple__seconds">{seconds}</span>
      </div>
      <div className="time-card-simple__date">
        <div className="time-card-simple__dayname">{dayName}</div>
        <div className="time-card-simple__fulldate">{fullDate}</div>
      </div>

      <style>{`
        .time-card-simple {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          width: 100%;
          padding: 1rem;
          box-sizing: border-box;
          color: white;
          text-align: center;
        }
        .time-card-simple__greeting {
          font-size: 1.2rem;
          font-weight: 500;
          opacity: 0.8;
          margin-bottom: 0.5rem;
        }
        .time-card-simple__clock {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
        }
        .time-card-simple__hours,
        .time-card-simple__minutes {
          font-size: 4rem;
          font-weight: 900;
          line-height: 1;
        }
        .time-card-simple__sep {
          font-size: 3rem;
          font-weight: 700;
          animation: blink 1s step-end infinite;
        }
        .time-card-simple__seconds {
          font-size: 1.5rem;
          font-weight: 600;
          opacity: 0.6;
          margin-left: 0.25rem;
        }
        .time-card-simple__date {
          margin-top: 1rem;
        }
        .time-card-simple__dayname {
          font-size: 1.3rem;
          font-weight: 700;
          text-transform: capitalize;
        }
        .time-card-simple__fulldate {
          font-size: 1rem;
          opacity: 0.7;
          text-transform: capitalize;
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

export default TimeCard;
