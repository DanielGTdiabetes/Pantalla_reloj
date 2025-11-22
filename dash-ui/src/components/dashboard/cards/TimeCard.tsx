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
  const timeLabel = localized.format("HH:mm");
  const secondsLabel = localized.format("ss");
  const dateLabel = localized.format("dddd, D [de] MMMM [de] YYYY");
  const hour = localized.hour();
  const greeting = useMemo(() => getGreeting(hour), [hour]);

  return (
    <div className="card time-card">
      <ClockIcon className="card-icon breathe-effect" aria-hidden="true" />
      <div className="time-card__body">
        <p className="time-card__greeting">{greeting}</p>
        <div className="time-card__time-container">
          <span className="time-card__time">{timeLabel}</span>
          <span className="time-card__separator">:</span>
          <span className="time-card__seconds">{secondsLabel}</span>
        </div>
        <p className="time-card__date">{dateLabel}</p>
      </div>
    </div>
  );
};

export default TimeCard;
