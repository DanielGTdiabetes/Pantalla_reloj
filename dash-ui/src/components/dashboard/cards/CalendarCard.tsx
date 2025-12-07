import { StandardCard } from "../StandardCard";
import { dayjs } from "../../../utils/dayjs";
import { useState, useEffect } from "react";

type CalendarEvent = {
  title: string;
  start?: string | null;
  end?: string | null;
  location?: string | null;
};

type CalendarCardProps = {
  events: CalendarEvent[];
  timezone: string;
};

const getCountdown = (startTime: string | null | undefined, timezone: string): string | null => {
  if (!startTime) return null;
  const now = dayjs().tz(timezone);
  const start = dayjs(startTime).tz(timezone);
  const diffMs = Number(start.valueOf()) - Number(now.valueOf());
  const diff = Math.round(diffMs / (60 * 1000));

  if (diff < 0) return "En curso";
  if (diff < 60) return `En ${diff} min`;

  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  if (minutes === 0) return `En ${hours}h`;
  return `En ${hours}h ${minutes}m`;
};

export const CalendarCard = ({ events, timezone }: CalendarCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const validEvents = events || [];

  // Rotation for events if more than 3, or just show list? 
  // Given the "premium" look with large text, showing one focal event + list might be better, 
  // or a rotating list of pages. Let's do a rotating spotlight if many, or static list if few.
  // Actually, StandardCard is tall. Let's do a vertical list with "next up" highlighted.

  // Filter only future or current events
  const upcomingEvents = validEvents.filter(e => {
    if (!e.end) return true;
    return dayjs(e.end).tz(timezone).valueOf() > dayjs().tz(timezone).valueOf();
  }).slice(0, 4); // Show max 4

  const now = dayjs().tz(timezone);
  const dateNum = now.format("D");
  const monthName = now.format("MMM");
  const dayName = now.format("dddd");

  return (
    <StandardCard
      title="Agenda"
      subtitle={dayName}
      icon={<span className="text-3xl drop-shadow-md">📅</span>}
      className="calendar-card-root"
    >
      {/* Background Noise */}
      <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

      {/* Background Gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 to-slate-900 -z-10" />

      <div className="flex gap-4 h-full relative z-10 p-2 animate-fade-in-up">

        {/* Left: Big Calendar Leaf Visual */}
        <div className="flex flex-col items-center justify-center bg-white text-slate-900 rounded-xl shadow-2xl overflow-hidden w-24 md:w-28 shrink-0 self-center transform -rotate-2 border-t-8 border-red-500">
          <span className="text-xs font-bold uppercase tracking-widest pt-1 text-red-500">{monthName}</span>
          <span className="text-5xl md:text-6xl font-black tracking-tighter leading-none pb-2">{dateNum}</span>
        </div>

        {/* Right: Event List */}
        <div className="flex-1 flex flex-col justify-center gap-3 overflow-hidden">
          {upcomingEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/50">
              <span className="text-4xl mb-2 opacity-50">☕</span>
              <p className="font-medium">Sin eventos próximos</p>
            </div>
          ) : (
            upcomingEvents.map((evt, idx) => {
              const isFirst = idx === 0;
              const timeStr = evt.start ? dayjs(evt.start).tz(timezone).format("HH:mm") : "";
              const countdown = getCountdown(evt.start, timezone);

              return (
                <div
                  key={idx}
                  className={`flex flex-col p-3 rounded-lg border backdrop-blur-sm transition-all
                                ${isFirst ? 'bg-white/10 border-white/20 shadow-lg scale-[1.02]' : 'bg-white/5 border-white/5 opacity-70'}
                            `}
                >
                  <div className="flex justify-between items-baseline mb-1">
                    <h3 className={`font-bold leading-tight ${isFirst ? 'text-white text-lg' : 'text-gray-200 text-base'} line-clamp-1`}>
                      {evt.title}
                    </h3>
                    <span className="text-amber-400 font-mono font-bold text-sm shrink-0 ml-2">
                      {timeStr}
                    </span>
                  </div>

                  {(evt.location || countdown) && (
                    <div className="flex items-center gap-3 text-xs text-gray-300">
                      {evt.location && (
                        <span className="flex items-center gap-1 truncate max-w-[120px]">
                          📍 {evt.location}
                        </span>
                      )}
                      {countdown && isFirst && (
                        <span className="text-emerald-300 font-bold bg-emerald-900/30 px-1.5 py-0.5 rounded">
                          {countdown}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <style>{`
        .calendar-card-root {
            background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%) !important;
            color: white !important;
        }
        .animate-fade-in-up {
            animation: fadeInUp 0.5s ease-out forwards;
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </StandardCard>
  );
};

export default CalendarCard;
