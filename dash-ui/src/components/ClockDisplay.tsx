import dayjs from "dayjs";
import "dayjs/locale/es";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import React, { useEffect, useState } from "react";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("es");

type ClockDisplayProps = {
  timezone: string;
  format: string;
};

export const ClockDisplay: React.FC<ClockDisplayProps> = ({ timezone, format }) => {
  const [now, setNow] = useState(() => dayjs().tz(timezone));

  useEffect(() => {
    setNow(dayjs().tz(timezone));
    const timer = window.setInterval(() => {
      setNow(dayjs().tz(timezone));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timezone]);

  return (
    <div className="public-clock" aria-live="polite">
      <div className="public-clock__time">{now.format(format)}</div>
      <div className="public-clock__date">{now.format("dddd, D [de] MMMM YYYY")}</div>
    </div>
  );
};
