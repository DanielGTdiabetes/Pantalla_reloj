import { useEffect, useState } from 'react';
import { formatDate, formatTime, subscribeTime } from '../services/time';

const Clock = () => {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const unsubscribe = subscribeTime(setNow);
    return unsubscribe;
  }, []);

  return (
    <section className="flex h-full w-full flex-col justify-center rounded-3xl bg-black/35 p-8 text-shadow-strong backdrop-blur">
      <p className="text-[160px] font-display leading-none tracking-tight" aria-live="polite" aria-atomic="true">
        {formatTime(now)}
      </p>
      <p className="mt-6 text-3xl font-medium uppercase tracking-[0.45em] text-slate-200/90">
        {formatDate(now)}
      </p>
    </section>
  );
};

export default Clock;
