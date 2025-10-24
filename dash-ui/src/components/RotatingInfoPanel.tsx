import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RotatingPanelSectionKey } from '../services/config';
import { useSeasonMonth } from '../hooks/useSeasonMonth';
import { useCalendarSummary } from '../hooks/useCalendarSummary';
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
    if (section === 'weekly') continue;
    if (LABELS[section] && !seen.has(section)) {
      seen.add(section);
      valid.push(section);
    }
  }
  return valid;
}

const RotatingInfoPanel = ({
  sections,
  intervalMs: _intervalMs = DEFAULT_INTERVAL_MS,
  height = DEFAULT_HEIGHT,
}: RotatingInfoPanelProps) => {
  const normalizedSections = useMemo(() => sanitizeSections(sections), [sections]);
  const panelHeight = Math.max(96, height ?? DEFAULT_HEIGHT);

  const { formatted: seasonLine, loading: seasonLoading } = useSeasonMonth();
  const calendar = useCalendarSummary();
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
      // section === 'lunar'
      const loading = lunar.loading && !lunar.text;
      return {
        key: section,
        text: loading ? 'Cargando…' : lunar.text ?? 'Fase lunar no disponible',
        placeholder: loading,
      };
    });
  }, [calendar.loading, calendar.text, lunar.loading, lunar.text, normalizedSections, seasonLine, seasonLoading]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-white/15 bg-white/0 px-4 py-3 text-white backdrop-blur-md md:px-6 md:py-5"
      style={{ minHeight: panelHeight }}
    >
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.key} className="flex flex-col gap-2 rounded-xl border border-white/15 px-3 py-2">
            <span className="text-[0.65rem] uppercase tracking-[0.3em] text-white/60">{LABELS[item.key]}</span>
            <MarqueeText
              text={item.text}
              className={`text-base font-medium leading-snug ${item.placeholder ? 'text-white/55' : 'text-white/90'}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

interface MarqueeTextProps {
  text: string;
  className?: string;
}

function MarqueeText({ text, className }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const [needsScroll, setNeedsScroll] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(MIN_SCROLL_DURATION_SECONDS);

  const updateScrolling = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      setNeedsScroll(false);
      return;
    }
    const overflow = content.scrollWidth > container.clientWidth + 8;
    setNeedsScroll(overflow);
    if (overflow) {
      const distance = content.scrollWidth;
      const estimated = distance / SCROLL_SPEED_PX_PER_SECOND;
      setDurationSeconds(Math.max(estimated, MIN_SCROLL_DURATION_SECONDS));
    }
  }, []);

  useEffect(() => {
    updateScrolling();
  }, [text, updateScrolling]);

  useEffect(() => {
    const handleResize = () => updateScrolling();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateScrolling]);

  if (!text) {
    return <span className={className}>—</span>;
  }

  return (
    <div ref={containerRef} className="marquee-container">
      {needsScroll ? (
        <div className="marquee-track" style={{ animationDuration: `${durationSeconds}s` }}>
          <span ref={contentRef} className={`marquee-segment ${className ?? ''}`}>
            {text}
          </span>
          <span className={`marquee-segment ${className ?? ''}`} aria-hidden>
            {text}
          </span>
        </div>
      ) : (
        <span ref={contentRef} className={className}>
          {text}
        </span>
      )}
    </div>
  );
}

export default RotatingInfoPanel;
