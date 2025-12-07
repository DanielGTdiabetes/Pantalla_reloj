import { useEffect, useMemo, useState } from "react";
import { StandardCard } from "../StandardCard";
import { dayjs } from "../../../utils/dayjs";

type TimeCardProps = {
  timezone: string;
};

const getGreeting = (hour: number): string => {
  if (hour >= 6 && hour < 12) {
    return "Buenos días";
  } else if (hour >= 12 && hour < 21) {
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
    <StandardCard
      title="Reloj"
      subtitle={greeting}
      icon={<img src="/img/icons/3d/sun-smile.png" className="w-8 h-8 opacity-0" alt="clock" />} // Placeholder icon hidden to not distract
      className="time-card-root"
      noPadding
    >
      {/* Background Noise & Gradient */}
      <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 to-purple-900 pointer-events-none" />

      <div className="flex flex-col items-center justify-center h-full w-full relative z-10 p-4">

        {/* Main Time Display */}
        <div className="flex items-baseline gap-1 relative z-20">
          <span className="text-[6rem] md:text-[8rem] font-black tracking-tighter leading-[0.85] text-white drop-shadow-lg font-mono">
            {hours}
          </span>
          <div className="flex flex-col justify-center h-full pb-6">
            <span className="text-[4rem] md:text-[5rem] font-bold text-white/50 animate-pulse">:</span>
          </div>
          <span className="text-[6rem] md:text-[8rem] font-black tracking-tighter leading-[0.85] text-white drop-shadow-lg font-mono">
            {minutes}
          </span>
          <span className="text-2xl md:text-3xl font-bold text-indigo-300 self-end mb-6 ml-2 font-mono">
            {seconds}
          </span>
        </div>

        {/* Date Display */}
        <div className="mt-4 text-center z-20">
          <div className="text-2xl md:text-3xl font-bold text-indigo-100 uppercase tracking-widest drop-shadow-sm">
            {dayName}
          </div>
          <div className="text-lg md:text-xl text-indigo-200/80 font-medium">
            {day} de {month}, {year}
          </div>
        </div>

        {/* Decorative Circles */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] border border-white/5 rounded-full animate-spin-slow pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-white/5 rounded-full animate-spin-reverse pointer-events-none" />

      </div>

      <style>{`
        .time-card-root {
            background: #1e1b4b !important;
            color: white !important;
        }
        @keyframes spin-slow {
            from { transform: translate(-50%, -50%) rotate(0deg); }
            to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        .animate-spin-slow {
            animation: spin-slow 20s linear infinite;
        }
        @keyframes spin-reverse {
            from { transform: translate(-50%, -50%) rotate(360deg); }
            to { transform: translate(-50%, -50%) rotate(0deg); }
        }
        .animate-spin-reverse {
            animation: spin-reverse 30s linear infinite;
        }
      `}</style>
    </StandardCard>
  );
};

export default TimeCard;
