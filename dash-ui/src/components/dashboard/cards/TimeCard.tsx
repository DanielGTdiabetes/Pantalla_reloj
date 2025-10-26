import { useEffect, useState } from "react";

import { ClockIcon } from "../../icons";
import { dayjs } from "../../../utils/dayjs";

type TimeCardProps = {
  timezone: string;
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
  const timeLabel = localized.format("HH:mm:ss");
  const dateLabel = localized.format("dddd, D [de] MMMM [de] YYYY");

  return (
    <div className="card time-card">
      <ClockIcon className="card-icon" aria-hidden="true" />
      <div className="time-card__body">
        <p className="time-card__time">{timeLabel}</p>
        <p className="time-card__date">{dateLabel}</p>
      </div>
    </div>
  );
};

export default TimeCard;
