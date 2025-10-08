import { useEffect, useState } from 'react';
import { formatDate, formatTime, subscribeTime } from '../services/time';

const Clock = () => {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const unsubscribe = subscribeTime(setNow);
    return unsubscribe;
  }, []);

  return (
    <div className="text-center">
      <p className="text-8xl font-display tracking-tight" aria-live="polite" aria-atomic="true">
        {formatTime(now)}
      </p>
      <p className="mt-2 text-xl font-medium uppercase tracking-[0.3em] text-slate-200/80">
        {formatDate(now)}
      </p>
    </div>
  );
};

export default Clock;
