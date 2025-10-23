import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RotatingPanelSectionKey } from '../services/config';
import { useSeasonMonth } from '../hooks/useSeasonMonth';
import { useCalendarSummary } from '../hooks/useCalendarSummary';
import { useWeeklyForecast } from '../hooks/useWeeklyForecast';
import { useLunarPhase } from '../hooks/useLunarPhase';

interface RotatingInfoPanelProps {
  sections: RotatingPanelSectionKey[];
  intervalMs?: number;
  height?: number;
}

interface PanelItem {
  key: RotatingPanelSectionKey;
  text: string;
  placeholder: boolean;
}

const DEFAULT_INTERVAL_MS = 7000;
const MIN_INTERVAL_MS = 4000;
const DEFAULT_HEIGHT = 128;
const SCROLL_SPEED_PX_PER_SECOND = 60;
const MIN_SCROLL_DURATION_SECONDS = 12;

const LABELS: Record<RotatingPanelSectionKey, string> = {
  calendar: 'Calendario',
  season: 'Temporada',
  weekly: 'Previsión semanal',
  lunar: 'Fase lunar',
};

function sanitizeSections(sections: RotatingPanelSectionKey[]): RotatingPanelSectionKey[] {
  if (!Array.isArray(sections)) return [];
  const seen = new Set<RotatingPanelSectionKey>();
  const valid: RotatingPanelSectionKey[] = [];
  for (const section of sections) {
    if (LABELS[section] && !seen.has(section)) {
      seen.add(section);
      valid.push(section);
    }
  }
  return valid;
}

const RotatingInfoPanel = ({
  sections,
  intervalMs = DEFAULT_INTERVAL_MS,
  height = DEFAULT_HEIGHT,
}: RotatingInfoPanelProps) => {
  const normalizedSections = useMemo(() => sanitizeSections(sections), [sections]);
  const effectiveInterval = Math.max(intervalMs, MIN_INTERVAL_MS);
  const panelHeight = Math.max(96, height ?? DEFAULT_HEIGHT);

  const { formatted: seasonLine, loading: seasonLoading } = useSeasonMonth();
  const calendar = useCalendarSummary();
  const weekly = useWeeklyForecast();
  const lunar = useLunarPhase();

  const items = useMemo<PanelItem[]>(() => {
    return normalizedSections.map((section) => {
      if (section === 'season') {
        const loading = seasonLoading && !seasonLine;
        return {
          key: section,
          text: loading ? 'Cargando…' : seasonLine ?? 'Temporada no disponible',
          placeholder: loading,
        };
      }
      if (section === 'calendar') {
        const loading = calendar.loading && !calendar.text;
        return {
          key: section,
          text: loading ? 'Cargando…' : calendar.text ?? 'Sin datos',
          placeholder: loading,
        };
      }
      if (section === 'weekly') {
        const loading = weekly.loading && !weekly.text;
        return {
          key: section,
          text: loading ? 'Cargando…' : weekly.text ?? 'Previsión no disponible',
          placeholder: loading,
        };
      }
      // section === 'lunar'
      const loading = lunar.loading && !lunar.text;
      return {
        key: section,
        text: loading ? 'Cargando…' : lunar.text ?? 'Fase lunar no disponible',
        placeholder: loading,
      };
    });
  }, [calendar.loading, calendar.text, lunar.loading, lunar.text, normalizedSections, seasonLine, seasonLoading, weekly.loading, weekly.text]);

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length);
    }, effectiveInterval);
    return () => window.clearInterval(timer);
  }, [effectiveInterval, items.length]);

  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, items.length]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-[24px] border border-white/15 bg-[rgba(20,20,20,0.45)] px-6 py-3 text-white shadow-[0_14px_32px_rgba(0,0,0,0.32)] backdrop-blur-lg backdrop-brightness-[0.88]"
      style={{ height: panelHeight }}
    >
      {items.map((item, index) => (
        <RotatingInfoSlide
          key={`${item.key}-${index}`}
          active={index === activeIndex}
          text={item.text}
          placeholder={item.placeholder}
        />
      ))}
    </div>
  );
};

export default RotatingInfoPanel;

interface RotatingInfoSlideProps {
  active: boolean;
  text: string;
  placeholder: boolean;
}

const RotatingInfoSlide = ({ active, text, placeholder }: RotatingInfoSlideProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(MIN_SCROLL_DURATION_SECONDS);

  const updateScrolling = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      setShouldScroll(false);
      return;
    }
    const needsScroll = content.scrollWidth > container.clientWidth + 8;
    setShouldScroll(needsScroll);
    if (needsScroll) {
      const distance = content.scrollWidth;
      const estimated = distance / SCROLL_SPEED_PX_PER_SECOND;
      setDurationSeconds(Math.max(estimated, MIN_SCROLL_DURATION_SECONDS));
    }
  }, []);

  useEffect(() => {
    updateScrolling();
  }, [text, active, updateScrolling]);

  useEffect(() => {
    const handleResize = () => updateScrolling();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateScrolling]);

  const textClasses = `text-[24px] font-medium leading-snug ${placeholder ? 'text-white/60' : 'text-white/90'}`;

  return (
    <div
      className={`absolute inset-0 flex items-center transition-opacity duration-600 ease-in-out ${
        active ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <div ref={containerRef} className="marquee-container flex-1">
        {shouldScroll ? (
          <div className="marquee-track" style={{ animationDuration: `${durationSeconds}s` }}>
            <span ref={contentRef} className={`marquee-segment ${textClasses}`}>
              {text}
            </span>
            <span className={`marquee-segment ${textClasses}`} aria-hidden>
              {text}
            </span>
          </div>
        ) : (
          <span ref={contentRef} className={`block ${textClasses}`}>
            {text}
          </span>
        )}
      </div>
    </div>
  );
};
