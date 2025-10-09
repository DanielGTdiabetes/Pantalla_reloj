import { useEffect, useState } from 'react';
import { formatDate, formatTime, subscribeTime } from '../services/time';

interface ClockProps {
  tone?: 'light' | 'dark';
}

const Clock = ({ tone = 'dark' }: ClockProps) => {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const unsubscribe = subscribeTime(setNow);
    return unsubscribe;
  }, []);

  return (
    <section
      className={`glass-surface ${tone === 'light' ? 'glass-light' : 'glass'} flex w-full max-w-3xl flex-col items-center px-12 py-10 text-center shadow-lg shadow-black/30 transition`}
    >
      <p className="text-8xl font-display tracking-tight" aria-live="polite" aria-atomic="true">
        {formatTime(now)}
      </p>
      <p
        className={`mt-2 text-xl font-medium uppercase tracking-[0.3em] ${
          tone === 'light' ? 'text-slate-700/80' : 'text-slate-200/80'
        }`}
      >
        {formatDate(now)}
      </p>
    </section>
  );
};

export default Clock;
