import { useEffect, useMemo, useState } from 'react';
import { useSeasonMonth } from '../hooks/useSeasonMonth';
import type { WeatherToday } from '../services/weather';
import type { DayInfoPayload } from '../services/dayinfo';
import type { RotatingPanelSectionKey } from '../services/config';

interface RotatingInfoPanelProps {
  sections: RotatingPanelSectionKey[];
  intervalMs?: number;
  height?: number;
  weather?: WeatherToday | null;
  dayInfo?: DayInfoPayload | null;
}

interface PanelItem {
  key: RotatingPanelSectionKey;
  text: string;
  placeholder: boolean;
}

const DEFAULT_INTERVAL_MS = 7000;
const MIN_INTERVAL_MS = 4000;
const DEFAULT_HEIGHT = 128;
const MAX_WEATHER_TEXT = 180;
const MAX_CALENDAR_TEXT = 200;

const LABELS: Record<RotatingPanelSectionKey, string> = {
  weather: 'Clima',
  calendar: 'Calendario',
  season: 'Temporada',
};

function sanitizeSections(sections: RotatingPanelSectionKey[]): RotatingPanelSectionKey[] {
  if (!Array.isArray(sections)) return [];
  const seen = new Set<RotatingPanelSectionKey>();
  const valid: RotatingPanelSectionKey[] = [];
  for (const section of sections) {
    if (!seen.has(section)) {
      seen.add(section);
      valid.push(section);
    }
  }
  return valid;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return '…';
  const slice = text.slice(0, maxLength - 1);
  const lastSeparator = Math.max(slice.lastIndexOf(' · '), slice.lastIndexOf(', '), slice.lastIndexOf(' '));
  const safeSlice = lastSeparator > 20 ? slice.slice(0, lastSeparator) : slice;
  return `${safeSlice.replace(/[·,\s]+$/u, '')}…`;
}

function formatWeather(weather: WeatherToday): string {
  const parts: string[] = [];
  if (weather.city) parts.push(weather.city);
  if (weather.condition) parts.push(weather.condition);
  parts.push(`${Math.round(weather.temp)}°`);
  parts.push(`↓${Math.round(weather.min)}° ↑${Math.round(weather.max)}°`);
  parts.push(`Lluvia ${Math.round(weather.rainProb)}%`);
  return truncate(parts.join(' · '), MAX_WEATHER_TEXT);
}

function formatCalendar(dayInfo: DayInfoPayload): string {
  const efemeride = dayInfo.efemerides?.[0]?.text?.trim();
  const santoral = dayInfo.santoral
    ?.map((item) => item.name?.trim())
    .filter((name): name is string => Boolean(name && name.length > 0))
    .join(', ');
  const holiday = dayInfo.holiday?.is_holiday ? dayInfo.holiday?.name?.trim() : null;
  const patronName = dayInfo.patron?.name?.trim();
  const patronPlace = dayInfo.patron?.place?.trim();
  const patron = patronName ? (patronPlace ? `${patronName} (${patronPlace})` : patronName) : null;

  const segments: string[] = [];
  if (efemeride) segments.push(efemeride);
  if (santoral) segments.push(`Santoral: ${santoral}`);
  if (holiday) segments.push(`Festivo: ${holiday}`);
  if (patron) segments.push(`Patrón: ${patron}`);

  if (segments.length === 0) {
    return 'Sin información destacada hoy';
  }

  return truncate(segments.join(' · '), MAX_CALENDAR_TEXT);
}

const RotatingInfoPanel = ({
  sections,
  intervalMs = DEFAULT_INTERVAL_MS,
  height = DEFAULT_HEIGHT,
  weather,
  dayInfo,
}: RotatingInfoPanelProps) => {
  const { formatted: seasonLine, loading: seasonLoading } = useSeasonMonth();

  const normalizedSections = useMemo(() => sanitizeSections(sections), [sections]);
  const effectiveInterval = Math.max(intervalMs, MIN_INTERVAL_MS);

  const items = useMemo<PanelItem[]>(() => {
    const collection: PanelItem[] = [];
    normalizedSections.forEach((section) => {
      if (section === 'weather') {
        if (!weather) {
          collection.push({ key: section, text: 'Cargando…', placeholder: true });
        } else {
          collection.push({ key: section, text: formatWeather(weather), placeholder: false });
        }
      } else if (section === 'calendar') {
        if (!dayInfo) {
          collection.push({ key: section, text: 'Cargando…', placeholder: true });
        } else {
          collection.push({ key: section, text: formatCalendar(dayInfo), placeholder: false });
        }
      } else if (section === 'season') {
        if (seasonLoading) {
          collection.push({ key: section, text: 'Cargando…', placeholder: true });
        } else if (seasonLine) {
          collection.push({ key: section, text: seasonLine, placeholder: false });
        }
      }
    });
    return collection;
  }, [dayInfo, normalizedSections, seasonLine, seasonLoading, weather]);

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

  const panelHeight = Math.max(96, height ?? DEFAULT_HEIGHT);

  return (
    <div
      className="relative w-full overflow-hidden rounded-[24px] border border-white/15 bg-[rgba(20,20,20,0.45)] px-6 py-3 text-white shadow-[0_14px_32px_rgba(0,0,0,0.32)] backdrop-blur-lg backdrop-brightness-[0.88]"
      style={{ height: panelHeight }}
    >
      {items.map((item, index) => (
        <div
          key={`${item.key}-${index}`}
          className={`absolute inset-0 flex items-center gap-4 transition-all duration-700 ease-in-out ${
            index === activeIndex
              ? 'pointer-events-auto opacity-100 translate-y-0'
              : 'pointer-events-none opacity-0 translate-y-3'
          }`}
        >
          <span className="rounded-full bg-white/10 px-4 py-1 text-xs uppercase tracking-[0.3em] text-white/65">
            {LABELS[item.key]}
          </span>
          <span
            className={`block flex-1 truncate text-[24px] font-medium leading-snug ${
              item.placeholder ? 'text-white/60' : 'text-white/90'
            }`}
          >
            {item.text}
          </span>
        </div>
      ))}
    </div>
  );
};

export default RotatingInfoPanel;
