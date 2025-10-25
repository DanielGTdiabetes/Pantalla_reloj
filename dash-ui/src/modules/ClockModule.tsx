import dayjs from "dayjs";
import "dayjs/locale/es";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import React, { useEffect, useState } from "react";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("es");

type Props = {
  timezone: string;
};

export const ClockModule: React.FC<Props> = ({ timezone }) => {
  const [now, setNow] = useState(() => dayjs().tz(timezone));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(dayjs().tz(timezone));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timezone]);

  return (
    <div className="module-wrapper">
      <div>
        <h2>Hora local</h2>
        <div className="module-content">
          <div className="clock-display">{now.format("HH:mm:ss")}</div>
          <div className="clock-date">{now.format("dddd, D MMMM YYYY")}</div>
        </div>
      </div>
    </div>
  );
};
