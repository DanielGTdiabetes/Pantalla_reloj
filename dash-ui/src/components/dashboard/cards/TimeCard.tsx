import { useEffect, useMemo, useState } from "react";

import { ClockIcon } from "../../icons";
import { dayjs } from "../../../utils/dayjs";

type TimeCardProps = {
  timezone: string;
};

const getGreeting = (hour: number): string => {
  if (hour >= 6 && hour < 12) {
    return "Buenos días";
  } else if (hour >= 12 && hour < 20) {
    return "Buenas tardes";
  } else {
    return "Buenas noches";
  }
};

export const TimeCard = ({ timezone }: TimeCardProps): JSX.Element => {
  const [now, setNow] = useState(dayjs());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(dayjs());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const localized = now.tz(timezone);
  const hours = localized.format("HH");
  const minutes = localized.format("mm");
  const seconds = localized.format("ss");
  const dayName = localized.format("dddd");
  const day = localized.format("D");
  const month = localized.format("MMMM");
  const year = localized.format("YYYY");
  const hour = parseInt(localized.format("H"), 10);
  const greeting = useMemo(() => getGreeting(hour), [hour]);

  return (
    <div className="card time-card time-card-enhanced">
      <ClockIcon className="card-icon breathe-effect" aria-hidden="true" />
      <div className="time-card__body">
        <div className="time-card__greeting">{greeting}</div>
        <div className="time-card__time-display">
          <span className="time-card__hours">{hours}</span>
          <span className="time-card__separator blink">:</span>
          <span className="time-card__minutes">{minutes}</span>
          <span className="time-card__seconds-inline">{seconds}</span>
        </div>
        <div className="time-card__date-display">
          <span className="time-card__day-name">{dayName}</span>
          <span className="time-card__date-full">{day} de {month} de {year}</span>
        </div>
      </div>
    </div>
  );
};

export default TimeCard;
