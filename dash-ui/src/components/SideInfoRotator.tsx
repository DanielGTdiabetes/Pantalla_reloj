import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import GlassPanel from './GlassPanel';
import type { DayInfoPayload } from '../services/dayinfo';
import type { SideInfoSectionKey } from '../services/config';
import { useNewsHeadlines } from '../hooks/useNewsHeadlines';

interface SideInfoRotatorProps {
  enabled: boolean;
  sections: SideInfoSectionKey[];
  intervalMs: number;
  showSantoralWithEfemerides: boolean;
  dayInfo?: DayInfoPayload | null;
  newsEnabled: boolean;
  newsDisabledNote?: string | null;
}

interface SlideContent {
  key: SideInfoSectionKey;
  label: string;
  primary: string;
  secondary?: string | null;
  placeholder?: boolean;
}

const LABELS: Record<SideInfoSectionKey, string> = {
  efemerides: 'Efemérides',
  news: 'Noticias',
};

const PRIMARY_STYLE: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const SECONDARY_STYLE: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const SINGLE_LINE_STYLE: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const MIN_INTERVAL_MS = 5000;

function sanitizeText(value: string | undefined | null): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

function formatSantoral(names: string[] | undefined | null): string {
  if (!names || names.length === 0) return '';
  const joined = names
    .map((value) => sanitizeText(value))
    .filter((value) => value.length > 0);
  return joined.join(', ');
}

const SideInfoRotator = ({
  enabled,
  sections,
  intervalMs,
  showSantoralWithEfemerides,
  dayInfo,
  newsEnabled,
  newsDisabledNote,
}: SideInfoRotatorProps) => {
  const effectiveInterval = Math.max(intervalMs, MIN_INTERVAL_MS);
  const {
    items: newsItems,
    loading: newsLoading,
    note: newsNote,
  } = useNewsHeadlines(newsEnabled);

  const [activeIndex, setActiveIndex] = useState(0);
  const [newsHeadlineIndex, setNewsHeadlineIndex] = useState(0);
  const previousSlideKeyRef = useRef<SideInfoSectionKey | null>(null);

  const efemerideText = useMemo(() => {
    const text = dayInfo?.efemerides?.[0]?.text;
    return sanitizeText(text);
  }, [dayInfo?.efemerides]);

  const santoralText = useMemo(() => {
    if (!showSantoralWithEfemerides) return '';
    const names = dayInfo?.santoral?.map((entry) => entry.name);
    return formatSantoral(names);
  }, [dayInfo?.santoral, showSantoralWithEfemerides]);

  const currentNewsItem = useMemo(() => {
    if (!newsEnabled || newsItems.length === 0) return null;
    const index = newsHeadlineIndex % newsItems.length;
    return newsItems[index];
  }, [newsEnabled, newsItems, newsHeadlineIndex]);

  const slides = useMemo<SlideContent[]>(() => {
    if (!enabled) return [];
    const items: SlideContent[] = [];

    sections.forEach((section) => {
      if (section === 'efemerides') {
        const primary = efemerideText || 'Efemérides no disponibles';
        const secondary = showSantoralWithEfemerides
          ? santoralText || 'Santoral no disponible'
          : null;
        items.push({
          key: section,
          label: LABELS[section],
          primary,
          secondary,
          placeholder: efemerideText.length === 0,
        });
        return;
      }

      if (section === 'news') {
        if (!newsEnabled) {
          items.push({
            key: section,
            label: LABELS[section],
            primary: newsDisabledNote || 'Noticias desactivadas',
            secondary: null,
            placeholder: true,
          });
          return;
        }

        let primary: string;
        let secondary: string | null = null;
        let placeholder = false;

        if (currentNewsItem) {
          const source = sanitizeText(currentNewsItem.source) || 'Medio';
          const title = sanitizeText(currentNewsItem.title);
          primary = `🗞️ [${source}] ${title}`;
        } else if (newsLoading) {
          primary = 'Cargando noticias…';
          placeholder = true;
        } else {
          primary = 'Noticias no disponibles';
          placeholder = true;
          secondary = newsNote ?? null;
        }

        items.push({
          key: section,
          label: LABELS[section],
          primary,
          secondary,
          placeholder,
        });
      }
    });

    return items;
  }, [
    enabled,
    sections,
    efemerideText,
    santoralText,
    showSantoralWithEfemerides,
    newsEnabled,
    newsLoading,
    newsNote,
    currentNewsItem,
    newsDisabledNote,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [sections.length, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (slides.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % slides.length);
    }, effectiveInterval);
    return () => window.clearInterval(timer);
  }, [enabled, slides.length, effectiveInterval]);

  useEffect(() => {
    if (activeIndex >= slides.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, slides.length]);

  useEffect(() => {
    setNewsHeadlineIndex(0);
  }, [newsItems.length]);

  useEffect(() => {
    const currentKey = slides[activeIndex]?.key ?? null;
    const previousKey = previousSlideKeyRef.current;

    if (newsEnabled && newsItems.length > 0) {
      if (previousKey === 'news' && currentKey !== 'news') {
        setNewsHeadlineIndex((prev) => (prev + 1) % newsItems.length);
      }
      if (currentKey === 'news') {
        setNewsHeadlineIndex((prev) => prev % newsItems.length);
      }
    }

    previousSlideKeyRef.current = currentKey;
  }, [activeIndex, slides, newsEnabled, newsItems.length]);

  useEffect(() => {
    if (!newsEnabled || newsItems.length <= 1) return;
    if (slides.length > 1) return;
    const timer = window.setInterval(() => {
      setNewsHeadlineIndex((prev) => (prev + 1) % newsItems.length);
    }, effectiveInterval);
    return () => window.clearInterval(timer);
  }, [newsEnabled, newsItems.length, slides.length, effectiveInterval]);

  if (!enabled) {
    return (
      <GlassPanel className="items-center justify-center text-center text-white/65">
        <div className="text-lg">Panel desactivado</div>
      </GlassPanel>
    );
  }

  if (slides.length === 0) {
    return (
      <GlassPanel className="items-center justify-center text-center text-white/65">
        <div className="text-lg">Sin secciones disponibles</div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="relative overflow-hidden">
      {slides.map((slide, index) => (
        <div
          key={`${slide.key}-${index}`}
          className={`absolute inset-0 flex flex-col justify-center gap-4 transition-opacity duration-700 ease-in-out ${
            index === activeIndex ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <span className="text-xs uppercase tracking-[0.3em] text-white/50">{slide.label}</span>
          <div className="flex flex-col gap-2">
            <p
              className={`text-xl font-medium leading-snug ${
                slide.placeholder ? 'text-white/60' : 'text-white/90'
              }`}
              style={slide.key === 'news' ? SINGLE_LINE_STYLE : PRIMARY_STYLE}
            >
              {slide.primary}
            </p>
            {slide.secondary ? (
              <p className="text-sm text-white/70" style={SECONDARY_STYLE}>
                {slide.secondary}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </GlassPanel>
  );
};

export default SideInfoRotator;
