import { useMemo } from 'react';
import GlassPanel from './GlassPanel';
import type { DayInfoPayload } from '../services/dayinfo';
import type { SideInfoSectionKey } from '../services/config';
import { useNewsHeadlines, type NewsHeadline } from '../hooks/useNewsHeadlines';

interface SideInfoRotatorProps {
  enabled: boolean;
  sections: SideInfoSectionKey[];
  intervalMs: number;
  showSantoralWithEfemerides: boolean;
  showHolidaysWithEfemerides: boolean;
  dayInfo?: DayInfoPayload | null;
  newsEnabled: boolean;
  newsDisabledNote?: string | null;
}

const LABELS: Record<SideInfoSectionKey, string> = {
  efemerides: 'Efemérides',
  news: 'Noticias',
};

const BULLET = '|';
const MAX_NEWS_ITEMS = 8;
const MIN_TICKER_DURATION = 35;
const MAX_TICKER_DURATION = 60;

function sanitizeSections(sections: SideInfoSectionKey[], allowNews: boolean): SideInfoSectionKey[] {
  const allowed = new Set<SideInfoSectionKey>(['efemerides']);
  if (allowNews) {
    allowed.add('news');
  }
  const seen = new Set<SideInfoSectionKey>();
  const normalized: SideInfoSectionKey[] = [];
  sections.forEach((section) => {
    if (!allowed.has(section)) return;
    if (seen.has(section)) return;
    seen.add(section);
    normalized.push(section);
  });
  if (normalized.length === 0) {
    normalized.push('efemerides');
  }
  return normalized;
}

function sanitizeText(value: string | undefined | null): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

function formatSantoral(names: string[] | undefined | null): string {
  if (!names || names.length === 0) return '';
  const filtered = names
    .map((name) => sanitizeText(name))
    .filter((name) => name.length > 0);
  return filtered.join(', ');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

type ExtendedNewsHeadline = NewsHeadline & {
  description?: string;
  summary?: string;
};

function buildNewsSegments(items: NewsHeadline[]): string[] {
  const prepared = items
    .map((item) => {
      const title = sanitizeText(item.title);
      const source = sanitizeText(item.source);
      const extended = item as ExtendedNewsHeadline;
      const rawDescription = sanitizeText(extended.description) || sanitizeText(extended.summary);
      const description = rawDescription ? truncate(rawDescription, 140) : '';
      return { item, title, source, description };
    })
    .filter((entry) => entry.title.length > 0);

  if (prepared.length === 0) {
    return [];
  }

  const prioritized: typeof prepared = [];
  const seenSources = new Set<string>();

  prepared.forEach((entry) => {
    const sourceKey = entry.source.toLowerCase();
    if (!seenSources.has(sourceKey) && prioritized.length < MAX_NEWS_ITEMS) {
      prioritized.push(entry);
      if (sourceKey) {
        seenSources.add(sourceKey);
      }
    }
  });

  prepared.forEach((entry) => {
    if (prioritized.length >= MAX_NEWS_ITEMS) return;
    if (!prioritized.includes(entry)) {
      prioritized.push(entry);
    }
  });

  return prioritized.slice(0, MAX_NEWS_ITEMS).map(({ source, title, description }) => {
    const prefix = source ? `[${source}]` : '';
    const descriptionPart = description ? `- ${description}` : '';
    const parts = [prefix, title, descriptionPart].filter((part) => part && part.length > 0);
    return `>> ${parts.join(' ')}`.trim();
  });
}

function estimateTickerDuration(segments: string[]): number {
  const totalLength = segments.reduce((acc, segment) => acc + segment.length, 0);
  if (totalLength === 0) {
    return MIN_TICKER_DURATION;
  }
  const estimated = Math.max(MIN_TICKER_DURATION, Math.ceil(totalLength * 0.2));
  return Math.min(Math.max(estimated, MIN_TICKER_DURATION), MAX_TICKER_DURATION);
}

const SideInfoRotator = ({
  enabled,
  sections,
  intervalMs: _intervalMs,
  showSantoralWithEfemerides,
  showHolidaysWithEfemerides,
  dayInfo,
  newsEnabled,
  newsDisabledNote,
}: SideInfoRotatorProps) => {
  const normalizedSections = useMemo(
    () => sanitizeSections(sections, newsEnabled),
    [sections, newsEnabled],
  );

  const {
    items: newsItems,
    loading: newsLoading,
    note: newsNote,
  } = useNewsHeadlines(newsEnabled);

  const efemerideText = useMemo(() => {
    const text = dayInfo?.efemerides?.[0]?.text;
    return sanitizeText(text);
  }, [dayInfo?.efemerides]);

  const santoralText = useMemo(() => {
    if (!showSantoralWithEfemerides) return '';
    const names = dayInfo?.santoral?.map((entry) => entry.name);
    return formatSantoral(names);
  }, [dayInfo?.santoral, showSantoralWithEfemerides]);

  const holidayNames = useMemo(() => {
    if (!showHolidaysWithEfemerides) return [] as string[];
    const seen = new Set<string>();
    const result: string[] = [];
    const rawNames = Array.isArray(dayInfo?.holidayNames) ? dayInfo?.holidayNames : [];
    rawNames.forEach((value) => {
      const text = sanitizeText(value);
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(text);
    });
    const fallbackName = sanitizeText(dayInfo?.holiday?.name);
    if (fallbackName) {
      const key = fallbackName.toLowerCase();
      if (!seen.has(key)) {
        result.push(fallbackName);
      }
    }
    return result;
  }, [dayInfo?.holiday?.name, dayInfo?.holidayNames, showHolidaysWithEfemerides]);

  const holidayLine = useMemo(() => {
    if (holidayNames.length === 0) return '';
    const label = holidayNames.length === 1 ? 'Festivo' : 'Festivos';
    return `${label}: ${holidayNames.join(', ')}`;
  }, [holidayNames]);

  const newsSegments = useMemo(() => {
    if (!newsEnabled) return [];
    return buildNewsSegments(newsItems);
  }, [newsEnabled, newsItems]);

  const marqueeSegments = useMemo(() => {
    if (newsSegments.length === 0) return [] as string[];
    if (newsSegments.length === 1) {
      return [newsSegments[0], newsSegments[0], newsSegments[0]];
    }
    if (newsSegments.length === 2) {
      return [...newsSegments, ...newsSegments];
    }
    const doubled = [...newsSegments, ...newsSegments];
    if (doubled.length >= 6) {
      return doubled;
    }
    return [...doubled, ...newsSegments.slice(0, 2)];
  }, [newsSegments]);

  const tickerDuration = useMemo(() => estimateTickerDuration(newsSegments), [newsSegments]);

  if (!enabled) {
    return (
      <GlassPanel className="items-center justify-center text-center text-white/65">
        <div className="text-lg">Panel desactivado</div>
      </GlassPanel>
    );
  }

  if (normalizedSections.length === 0) {
    return (
      <GlassPanel className="items-center justify-center text-center text-white/65">
        <div className="text-lg">Sin secciones disponibles</div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="gap-5">
      {normalizedSections.includes('efemerides') ? (
        <section className="flex flex-col gap-3 rounded-xl border border-white/15 px-4 py-3">
          <span className="text-xs uppercase tracking-[0.3em] text-white/60">{LABELS.efemerides}</span>
          <div className="flex flex-col gap-2 text-sm leading-relaxed text-white/80">
            <p className="text-base font-medium text-white/90">
              {efemerideText || 'Efemérides no disponibles'}
            </p>
            {holidayLine ? <p className="text-white/75">{holidayLine}</p> : null}
            {showSantoralWithEfemerides && santoralText ? (
              <p className="text-white/75">Santoral: {santoralText}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {normalizedSections.includes('news') ? (
        <section className="flex flex-col gap-3 rounded-xl border border-white/15 px-4 py-3">
          <span className="text-xs uppercase tracking-[0.3em] text-white/60">{LABELS.news}</span>
          {!newsEnabled ? (
            <p className="text-sm text-white/65">{newsDisabledNote ?? 'Noticias desactivadas'}</p>
          ) : newsLoading && newsSegments.length === 0 ? (
            <p className="text-sm text-white/65">Cargando noticias…</p>
          ) : newsSegments.length === 0 ? (
            <p className="text-sm text-white/65">{newsNote ?? 'Noticias no disponibles'}</p>
          ) : (
            <div className="marquee-container whitespace-nowrap">
              <div
                className="marquee-track text-sm text-white/80"
                style={{ animationDuration: `${tickerDuration}s` }}
              >
                {marqueeSegments.map((segment, index) => (
                  <span key={`news-segment-${index}`} className="marquee-segment font-medium text-white/85">
                    {segment}
                    <span className="mx-6 text-white/50">{BULLET}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {newsNote && newsSegments.length > 0 ? (
            <p className="text-xs text-white/50">{newsNote}</p>
          ) : null}
        </section>
      ) : null}
    </GlassPanel>
  );
};

export default SideInfoRotator;
