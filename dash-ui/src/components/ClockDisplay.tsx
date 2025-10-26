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
  className?: string;
  timeClassName?: string;
  dateClassName?: string;
};

export const ClockDisplay: React.FC<ClockDisplayProps> = ({
  timezone,
  format,
  className,
  timeClassName,
  dateClassName
}) => {
  const [now, setNow] = useState(() => dayjs().tz(timezone));

  useEffect(() => {
    setNow(dayjs().tz(timezone));
    const timer = window.setInterval(() => {
      setNow(dayjs().tz(timezone));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timezone]);

  const containerClass = className ?? "public-clock";
  const timeClass = timeClassName ?? "public-clock__time";
  const dateClass = dateClassName ?? "public-clock__date";

  return (
    <div className={containerClass} aria-live="polite">
      <div className={timeClass}>{now.format(format)}</div>
      <div className={dateClass}>{now.format("dddd, D [de] MMMM YYYY")}</div>
    </div>
  );
};
