import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import { apiGet, apiPost, getConfigMeta, getSantoralToday } from "../lib/api";
import { useConfig } from "../lib/useConfig";
import { fetchWikipediaEvents } from "../lib/services/wikipedia";
import type { AppConfig } from "../types/config";
import { dayjs } from "../utils/dayjs";
import { ensurePlainText, sanitizeRichText } from "../utils/sanitize";
import { safeGetTimezone } from "../utils/timezone";
import type { RotatingCardItem } from "./RotatingCard";
import { RotatingCard } from "./RotatingCard";
import { RotationProgress } from "./dashboard/RotationProgress";
import { BackgroundGradient } from "./effects/BackgroundGradient";
import { WeatherAmbience } from "./effects/WeatherAmbience";
import { SkeletonLoader } from "./common/SkeletonLoader";
import { CalendarCard } from "./dashboard/cards/CalendarCard";
import { WeatherForecastCard } from "./dashboard/cards/WeatherForecastCard";
import { EphemeridesCard } from "./dashboard/cards/EphemeridesCard";
import { HarvestCard } from "./dashboard/cards/HarvestCard";
import { HistoricalEventsCard } from "./dashboard/cards/HistoricalEventsCard";
import { MoonCard } from "./dashboard/cards/MoonCard";
import { NewsCard } from "./dashboard/cards/NewsCard";
import { SaintsCard } from "./dashboard/cards/SaintsCard";
import { TimeCard } from "./dashboard/cards/TimeCard";
import { WeatherCard } from "./dashboard/cards/WeatherCard";
import { useRotationProgress } from "../hooks/useRotationProgress";
import { useDayNightMode } from "../hooks/useDayNightMode";

type DashboardPayload = {
  weather?: Record<string, unknown>;
  news?: Record<string, unknown>;
  astronomy?: Record<string, unknown>;
  calendar?: Record<string, unknown>;
  santoral?: { saints?: string[]; namedays?: string[] };
  historicalEvents?: { date?: string; count?: number; items?: string[] };
};

const REFRESH_INTERVAL_MS = 60_000;
// Similar a isProduction() en runtimeFlags.ts
type NodeProcess = { env?: { NODE_ENV?: string } };

const getNodeProcess = (): NodeProcess | undefined => {
  if (typeof globalThis === "undefined") {
    return undefined;
  }
  const candidate = (globalThis as { process?: NodeProcess }).process;
  if (candidate && typeof candidate === "object") {
    return candidate;
  }
  return undefined;
};

const isDevelopment = (): boolean => {
  if (typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined") {
    const env = import.meta.env as { MODE?: string; PROD?: boolean };
    if (env.MODE) {
      return env.MODE === 'development';
    }
    if (typeof env.PROD === 'boolean') {
      return !env.PROD;
    }
  }
  // Fallback para Node.js en build time
  const nodeProcess = getNodeProcess();
  if (typeof nodeProcess?.env?.NODE_ENV === "string") {
    return nodeProcess.env.NODE_ENV === 'development';
  }
  return false;
};

const IS_DEV = isDevelopment();

// IDs de paneles soportados, mapeo v2 (nuevos nombres) a v1 (legacy)
const PANEL_ID_MAP: Record<string, string> = {
  "clock": "time",
  "weather": "weather",
  "astronomy": "ephemerides",
  "santoral": "saints",
  "calendar": "calendar",
  "harvest": "harvest",
  "news": "news",
  "historicalEvents": "historicalEvents",
};
const DEFAULT_FALLBACK_PANEL = "clock";
const DEFAULT_DURATIONS_SEC = {
  clock: 10,
  weather: 12,
  forecast: 15,
  astronomy: 10,
  santoral: 8,
  calendar: 12,
  harvest: 10,
  news: 12,
  historicalEvents: 6,
};

const ROTATION_DEFAULT_ORDER = [
  "clock",
  "weather",
  "forecast",
  "astronomy",
  "santoral",
  "calendar",
  "harvest",
  "news",
  "historicalEvents",
] as const;

// Mapeo de nombres legacy v1 a v2 para conversión automática
// IMPORTANTE: Este mapeo solo se usa para normalización, los paneles legacy ya no se renderizan directamente
const LEGACY_ROTATION_PANEL_MAP: Record<string, string> = {
  // Nombres canónicos v2
  clock: "clock",
  weather: "weather",
  forecast: "forecast",
  astronomy: "astronomy",
  santoral: "santoral",
  calendar: "calendar",
  harvest: "harvest",
  news: "news",
  historicalEvents: "historicalEvents",

  // Mapeos legacy v1 → v2 (solo para conversión automática)
  time: "clock",
  ephemerides: "astronomy",
  moon: "astronomy",  // moon ahora se incluye en astronomy
  saints: "santoral",

  // Variaciones en español (mapeo a harvest)
  cosecha: "harvest",
  cosechas: "harvest",
  hortaliza: "harvest",
  hortalizas: "harvest",
  verdura: "harvest",
  verduras: "harvest",
  fruta: "harvest",
  frutas: "harvest",
  siembra: "harvest",
  siembras: "harvest",
  cultivo: "harvest",
  cultivos: "harvest",

  // Variaciones de nombres
  historicalevents: "historicalEvents",
};

const DEFAULT_ROTATION_DURATION_SEC = 10;

const normalizeRotationPanelId = (panelId: unknown): string | null => {
  if (typeof panelId !== "string") {
    return null;
  }
  const trimmed = panelId.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const mapped = LEGACY_ROTATION_PANEL_MAP[lower as keyof typeof LEGACY_ROTATION_PANEL_MAP] ?? trimmed;
  return ROTATION_DEFAULT_ORDER.includes(mapped as (typeof ROTATION_DEFAULT_ORDER)[number]) ? mapped : null;
};

const sanitizeRotationPanelOrder = (panels: unknown): string[] => {
  if (!Array.isArray(panels)) {
    return [...ROTATION_DEFAULT_ORDER];
  }
  const normalized: string[] = [];
  for (const panel of panels) {
    const mapped = normalizeRotationPanelId(panel);
    if (mapped && !normalized.includes(mapped)) {
      normalized.push(mapped);
    }
  }
  return normalized.length > 0 ? normalized : [...ROTATION_DEFAULT_ORDER];
};

const temperatureToUnit = (value: number, from: string, to: string): number => {
  const normalize = (unit: string) => unit.replace("°", "").trim().toUpperCase();
  const source = normalize(from || "C");
  const target = normalize(to || "C");

  if (source === target) {
    return value;
  }

  const toCelsius = (temp: number, unit: string) => {
    switch (unit) {
      case "C":
        return temp;
      case "F":
        return ((temp - 32) * 5) / 9;
      case "K":
        return temp - 273.15;
      default:
        return temp;
    }
  };

  const fromCelsius = (temp: number, unit: string) => {
    switch (unit) {
      case "C":
        return temp;
      case "F":
        return (temp * 9) / 5 + 32;
      case "K":
        return temp + 273.15;
      default:
        return temp;
    }
  };

  const celsius = toCelsius(value, source);
  return fromCelsius(celsius, target);
};

const formatTemperature = (
  temperature: number | null,
  fromUnit: string,
  targetUnit: string
): { value: string; unit: string } => {
  if (temperature === null || Number.isNaN(temperature)) {
    const normalizedTarget = targetUnit.replace("°", "").trim().toUpperCase() || "C";
    return { value: "--", unit: normalizedTarget === "K" ? "K" : `°${normalizedTarget}` };
  }
  const converted = temperatureToUnit(temperature, fromUnit, targetUnit);
  const normalizedTarget = targetUnit.replace("°", "").trim().toUpperCase() || "C";
  const unitLabel = normalizedTarget === "K" ? "K" : `°${normalizedTarget}`;
  const rounded = Math.round(converted);
  return { value: `${rounded}`, unit: unitLabel };
};

const safeArray = (value: unknown): Record<string, unknown>[] => {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
};

const extractStrings = (value: unknown): string[] => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (entry && typeof entry === "object") {
          const obj = entry as Record<string, unknown>;
          const name = typeof obj.name === "string" ? obj.name
            : typeof obj.title === "string" ? obj.title
              : typeof obj.description === "string" ? obj.description
                : typeof obj.text === "string" ? obj.text
                  : null;
          if (name) {
            return ensurePlainText(name);
          }
          return ensurePlainText(String(entry));
        }
        return ensurePlainText(String(entry));
      })
      .filter((entry): entry is string => Boolean(entry && entry.trim()));
  }
  if (typeof value === "string") {
    return [value.trim()].filter(Boolean);
  }
  return [];
};

export const OverlayRotator: React.FC = () => {
  const { data, loading } = useConfig();
  const config = useMemo(() => data ?? withConfigDefaults(), [data]);
  const [payload, setPayload] = useState<DashboardPayload>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [configVersion, setConfigVersion] = useState<number | null>(null);
  const configVersionRef = useRef<number | null>(null);
  const [rotationRestartKey, setRotationRestartKey] = useState(0);
  const historicalEventsCounterRef = useRef<number>(0);

  const timezone = useMemo(() => {
    const tz = safeGetTimezone(config as Record<string, unknown>);
    return tz;
  }, [config]);

  // Detectar modo día/noche
  const isNight = useDayNightMode(timezone) === "night";

  // Leer configuración de rotación desde ui_global.overlay.rotator (v2) o ui.rotation (v1 legacy)
  const rotationConfig = useMemo(() => {
    const configWithUi = config as unknown as {
      ui?: {
        rotation?: {
          enabled?: boolean;
          duration_sec?: number;
          panels?: unknown;
        };
      };
    };

    const uiRotation = configWithUi.ui?.rotation;
    if (uiRotation && typeof uiRotation === "object") {
      const durationCandidate = Number((uiRotation as { duration_sec?: unknown }).duration_sec ?? DEFAULT_ROTATION_DURATION_SEC);
      const duration = Number.isFinite(durationCandidate)
        ? Math.min(3600, Math.max(3, Math.round(durationCandidate)))
        : DEFAULT_ROTATION_DURATION_SEC;
      const order = sanitizeRotationPanelOrder((uiRotation as { panels?: unknown }).panels);
      const durations = { ...DEFAULT_DURATIONS_SEC };
      for (const key of Object.keys(durations)) {
        durations[key as keyof typeof durations] = duration;
      }
      return {
        enabled: Boolean((uiRotation as { enabled?: unknown }).enabled),
        order,
        durations_sec: durations,
        transition_ms: 400,
        pause_on_alert: false,
      };
    }

    const v2Config = config as unknown as AppConfig;
    if (v2Config.version === 2 && v2Config.ui_global?.overlay?.rotator) {
      const rotator = v2Config.ui_global.overlay.rotator;
      const order = Array.isArray(rotator.order) && rotator.order.length > 0
        ? sanitizeRotationPanelOrder(rotator.order)
        : sanitizeRotationPanelOrder(undefined);
      const durations_sec = { ...DEFAULT_DURATIONS_SEC, ...(rotator.durations_sec ?? {}) };
      const transition_ms = Math.max(0, Math.min(2000, rotator.transition_ms ?? 400));

      return {
        enabled: rotator.enabled ?? true,
        order,
        durations_sec,
        transition_ms,
        pause_on_alert: rotator.pause_on_alert ?? false,
      };
    }

    const uiConfigLegacy = config.ui || (config as unknown as { ui?: { rotation?: { enabled?: boolean; duration_sec?: number; panels?: string[] } } }).ui;
    const rotationLegacy = uiConfigLegacy?.rotation || {};
    const panelsLegacy = Array.isArray(rotationLegacy.panels) && rotationLegacy.panels.length > 0
      ? rotationLegacy.panels.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];

    const order = panelsLegacy.map(p => {
      for (const [v2Id, v1Id] of Object.entries(PANEL_ID_MAP)) {
        if (v1Id === p) return v2Id;
      }
      const normalized = normalizeRotationPanelId(p);
      return normalized ?? p;
    });

    return {
      enabled: rotationLegacy.enabled ?? false,
      order: sanitizeRotationPanelOrder(order),
      durations_sec: DEFAULT_DURATIONS_SEC,
      transition_ms: 400,
      pause_on_alert: false,
    };
  }, [config]);

  // Estado para el índice actual del panel rotativo
  const [currentPanelIndex, setCurrentPanelIndex] = useState(0);
  const rotationTimerRef = useRef<number | null>(null);
  const availablePanelsRef = useRef<RotatingCardItem[]>([]);
  const currentPanelIndexRef = useRef<number>(0);

  // Hot-reload: polling de config_version para detectar cambios
  useEffect(() => {
    let mounted = true;
    let timeoutId: number | null = null;

    const pollConfigVersion = async () => {
      try {
        const meta = await getConfigMeta();
        const newVersion = meta.config_version ?? 0;

        if (mounted) {
          if (configVersionRef.current !== null && configVersionRef.current !== newVersion) {
            // Config cambió, recargar config
            if (IS_DEV) {
              console.log(`[OverlayRotator] Config version changed: ${configVersionRef.current} -> ${newVersion}, reloading config`);
            }
            // Trigger reload de useConfig (ya hace polling automático)
            window.dispatchEvent(new CustomEvent('config-changed'));
          }
          configVersionRef.current = newVersion;
          setConfigVersion(newVersion);
        }
      } catch (error) {
        if (IS_DEV) {
          console.warn("[OverlayRotator] Failed to poll config version:", error);
        }
      }

      if (mounted) {
        // Polling con backoff: cada 5-10 segundos
        timeoutId = window.setTimeout(pollConfigVersion, 5000 + Math.random() * 5000);
      }
    };

    void pollConfigVersion();

    return () => {
      mounted = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  // Cacheo de respuestas API (Weather 2-5min, Astronomy 1h)
  const weatherCacheRef = useRef<{ data: Record<string, unknown> | null; timestamp: number | null }>({ data: null, timestamp: null });
  const astronomyCacheRef = useRef<{ data: Record<string, unknown> | null; timestamp: number | null }>({ data: null, timestamp: null });
  const santoralCacheRef = useRef<{ data: { date: string; names: string[] } | null; timestamp: number | null }>({ data: null, timestamp: null });
  const historicalEventsCacheRef = useRef<{ data: { date?: string; count?: number; items?: string[] } | null; timestamp: number | null }>({ data: null, timestamp: null });

  // Invalidar cache de efemérides cuando se dispare el evento
  useEffect(() => {
    const handleCacheInvalidation = () => {
      historicalEventsCacheRef.current = { data: null, timestamp: null };
      if (IS_DEV) {
        console.log("[OverlayRotator] Historical events cache invalidated");
      }
    };

    window.addEventListener('historical-events-cache-invalidated', handleCacheInvalidation);
    window.addEventListener('config-changed', handleCacheInvalidation);

    return () => {
      window.removeEventListener('historical-events-cache-invalidated', handleCacheInvalidation);
      window.removeEventListener('config-changed', handleCacheInvalidation);
    };
  }, []);

  // Fetch de datos con cacheo
  useEffect(() => {
    let mounted = true;

    const fetchAll = async () => {
      try {
        // Verificar cache de weather (2-5 min)
        const weatherCacheAge = weatherCacheRef.current?.timestamp
          ? Date.now() - weatherCacheRef.current.timestamp
          : Infinity;
        const weatherCacheValid = weatherCacheAge < (2 + Math.random() * 3) * 60 * 1000;

        // Verificar cache de astronomy (1h)
        const astronomyCacheAge = astronomyCacheRef.current?.timestamp
          ? Date.now() - astronomyCacheRef.current.timestamp
          : Infinity;
        const astronomyCacheValid = astronomyCacheAge < 60 * 60 * 1000;

        // Verificar cache de santoral (1d)
        const santoralCacheAge = santoralCacheRef.current?.timestamp
          ? Date.now() - santoralCacheRef.current.timestamp
          : Infinity;
        const santoralCacheValid = santoralCacheAge < 24 * 60 * 60 * 1000;

        // Verificar cache de efemérides históricas (5 min)
        const historicalEventsCacheAge = historicalEventsCacheRef.current?.timestamp
          ? Date.now() - historicalEventsCacheRef.current.timestamp
          : Infinity;
        const historicalEventsCacheValid = historicalEventsCacheAge < 5 * 60 * 1000;

        const [weather, news, astronomy, calendar, santoral, historicalEvents] = await Promise.all([
          (async () => {
            if (weatherCacheValid && weatherCacheRef.current?.data) {
              return weatherCacheRef.current.data;
            }
            try {
              const v2Config = config as unknown as { panels?: { weather?: { latitude?: number; longitude?: number } } };
              const lat = v2Config.panels?.weather?.latitude ?? 39.98;
              const lon = v2Config.panels?.weather?.longitude ?? 0.20;
              const data = await apiGet<Record<string, unknown>>(`/api/weather/weekly?lat=${lat}&lon=${lon}`);
              // Asegurar que los datos incluyan el array 'days' o 'daily' para el pronóstico
              if (mounted) {
                weatherCacheRef.current = { data, timestamp: Date.now() };
              }
              return data;
            } catch (error) {
              // Si falla, usar cache si existe
              if (IS_DEV) {
                console.warn("[OverlayRotator] Error fetching weather:", error);
              }
              return weatherCacheRef.current?.data || {};
            }
          })(),
          (async () => {
            try {
              const v2Config = config as unknown as { panels?: { news?: { feeds?: string[] } } };
              const feeds = v2Config.panels?.news?.feeds ?? [];
              if (feeds.length === 0) return {};
              return await apiPost<Record<string, unknown>>("/api/news/rss", { feeds });
            } catch {
              return {};
            }
          })(),
          (async () => {
            if (astronomyCacheValid && astronomyCacheRef.current?.data) {
              return astronomyCacheRef.current.data;
            }
            try {
              const data = await apiGet<Record<string, unknown>>("/api/astronomy");
              if (mounted) {
                astronomyCacheRef.current = { data, timestamp: Date.now() };
              }
              return data;
            } catch {
              return astronomyCacheRef.current?.data || {};
            }
          })(),
          (async () => {
            try {
              // Obtener datos completos del calendario (eventos, harvest, saints)
              const calendarData = await apiGet<Record<string, unknown>>("/api/calendar");
              // Mantener retrocompatibilidad: si viene 'upcoming' usarlo, sino 'events'
              const events = safeArray(calendarData.upcoming || calendarData.events || []);
              const harvest = safeArray(calendarData.harvest || []);
              const saints = safeArray(calendarData.saints || []);
              const namedays = safeArray(calendarData.namedays || []);
              return {
                events,
                harvest,
                saints,
                namedays
              };
            } catch (error) {
              console.warn("[Calendar] API error while fetching /api/calendar:", error);
              return { events: [], harvest: [], saints: [], namedays: [] };
            }
          })(),
          (async () => {
            if (santoralCacheValid && santoralCacheRef.current?.data) {
              return { saints: santoralCacheRef.current.data.names, namedays: [] };
            }
            try {
              const data = await getSantoralToday();
              if (mounted) {
                santoralCacheRef.current = { data, timestamp: Date.now() };
              }
              return { saints: data.names, namedays: [] };
            } catch {
              return santoralCacheRef.current?.data
                ? { saints: santoralCacheRef.current.data.names, namedays: [] }
                : { saints: [], namedays: [] };
            }
          })(),
          (async () => {
            if (historicalEventsCacheValid && historicalEventsCacheRef.current?.data) {
              return historicalEventsCacheRef.current.data;
            }
            try {
              const v2Config = config as unknown as { panels?: { historicalEvents?: { enabled?: boolean } } };
              const enabled = v2Config.panels?.historicalEvents?.enabled !== false;
              if (!enabled) return { count: 0, items: [] };

              // Usar Wikipedia como fuente de datos para efemérides históricas
              const data = await fetchWikipediaEvents();
              if (mounted) {
                historicalEventsCacheRef.current = { data, timestamp: Date.now() };
              }
              return data;
            } catch {
              return historicalEventsCacheRef.current?.data || { count: 0, items: [] };
            }
          })()
        ]);

        if (mounted) {
          setPayload({ weather, news, astronomy, calendar, santoral, historicalEvents });
          setLastUpdatedAt(Date.now());
        }
      } catch (error) {
        console.error("Failed to load dashboard data", error);
      }
    };

    void fetchAll();
    const interval = window.setInterval(() => {
      void fetchAll();
    }, REFRESH_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [config]);

  // Procesamiento de datos
  const weather = (payload.weather ?? {}) as Record<string, unknown>;
  const astronomy = (payload.astronomy ?? {}) as Record<string, unknown>;
  const news = (payload.news ?? {}) as Record<string, unknown>;
  const calendar = (payload.calendar ?? {}) as Record<string, unknown>;
  const historicalEvents = (payload.historicalEvents ?? {}) as { date?: string; count?: number; items?: string[] };

  const targetUnit = "C";
  const rawTemperature = typeof weather.temperature === "number" ? weather.temperature : null;
  const rawUnit = ensurePlainText(weather.unit) || "C";
  const temperature = formatTemperature(rawTemperature, rawUnit, targetUnit);

  const feelsLikeValue =
    typeof weather.feels_like === "number"
      ? formatTemperature(weather.feels_like as number, rawUnit, targetUnit)
      : null;

  const humidity = typeof weather.humidity === "number" ? (weather.humidity as number)
    : typeof weather.relative_humidity === "number" ? (weather.relative_humidity as number)
      : typeof weather.hum === "number" ? (weather.hum as number)
        : null;
  const wind = typeof weather.wind_speed === "number" ? (weather.wind_speed as number)
    : typeof weather.wind === "number" ? (weather.wind as number)
      : typeof weather.windSpeed === "number" ? (weather.windSpeed as number)
        : typeof weather.ws === "number" ? (weather.ws as number)
          : null;
  // Extraer datos de precipitación (lluvia en mm)
  const rain = typeof weather.rain === "number" ? (weather.rain as number)
    : typeof weather.precipitation === "number" ? (weather.precipitation as number)
      : typeof weather.rainfall === "number" ? (weather.rainfall as number)
        : null;
  const condition = sanitizeRichText(weather.summary) || sanitizeRichText(weather.condition) || null;
  const sunrise = sanitizeRichText(astronomy.sunrise) || null;
  const sunset = sanitizeRichText(astronomy.sunset) || null;
  const moonPhase = sanitizeRichText(astronomy.moon_phase) || null;
  const moonIllumination = typeof astronomy.moon_illumination === "number"
    ? (astronomy.moon_illumination as number)
    : typeof astronomy.illumination === "number"
      ? (astronomy.illumination as number)
      : null;

  const ephemeridesEvents = safeArray(astronomy.events || astronomy.ephemerides || astronomy.event)
    .map((entry) => sanitizeRichText(entry?.description ?? entry?.title ?? entry?.name ?? entry?.text ?? ""))
    .filter((value): value is string => Boolean(value));

  const newsItems = safeArray(news.items || news.entries || news.news || news.articles).map((item) => ({
    title: sanitizeRichText(item.title || item.headline || item.name) || "Titular",
    summary: sanitizeRichText(item.summary || item.description || item.content || item.text) || undefined,
    source: sanitizeRichText(item.source || item.author || item.feed || item.publisher) || undefined
  }));

  const calendarEvents = safeArray(calendar.events || calendar.upcoming).map((event) => ({
    title: sanitizeRichText(event.title) || "Evento",
    start: ensurePlainText(event.start) || ensurePlainText(event.when) || null,
    end: ensurePlainText(event.end) || null,
    location: sanitizeRichText(event.location) || null
  }));

  const harvestItems = safeArray(calendar.harvest).map((item) => ({
    name: sanitizeRichText(item.name) || sanitizeRichText(item.crop) || "Actividad",
    status: sanitizeRichText(item.status) || sanitizeRichText(item.detail) || null
  }));

  const saintsEntries = useMemo(() => {
    const fromSaints = extractStrings(calendar.saints);
    const includeNamedays = config.saints?.include_namedays !== false;
    const fromNamedays = includeNamedays ? extractStrings(calendar.namedays) : [];
    const combined = [...fromSaints, ...fromNamedays];
    const unique = combined.filter((entry, index, self) => {
      const normalized = entry.toLowerCase().trim();
      return self.findIndex((e) => e.toLowerCase().trim() === normalized) === index;
    });
    return unique;
  }, [calendar.saints, calendar.namedays, config.saints?.include_namedays]);

  const forecastDays = useMemo(() => {
    // Primero intentar obtener desde weather.days o weather.daily (formato del endpoint /api/weather/weekly)
    const forecastData = weather.days || weather.daily || weather.forecast || weather.weekly || [];
    if (!Array.isArray(forecastData)) {
      return [];
    }
    // Si weather.ok es false, no hay datos disponibles
    if (weather.ok === false) {
      return [];
    }
    return forecastData.slice(0, 7).map((day: Record<string, unknown>) => {
      const date = ensurePlainText(day.date || day.dt || day.time);
      const dayName = ensurePlainText(day.dayName || day.day_name || day.name);
      const condition = sanitizeRichText(day.condition || day.weather || day.summary || day.description);

      let tempMin: number | null = null;
      if (typeof day.temp_min === "number") {
        tempMin = day.temp_min;
      } else if (day.temp && typeof day.temp === "object") {
        const tempObj = day.temp as Record<string, unknown>;
        if (typeof tempObj.min === "number") {
          tempMin = tempObj.min;
        }
      } else if (typeof day.min === "number") {
        tempMin = day.min;
      }

      let tempMax: number | null = null;
      if (typeof day.temp_max === "number") {
        tempMax = day.temp_max;
      } else if (day.temp && typeof day.temp === "object") {
        const tempObj = day.temp as Record<string, unknown>;
        if (typeof tempObj.max === "number") {
          tempMax = tempObj.max;
        }
      } else if (typeof day.max === "number") {
        tempMax = day.max;
      }

      const precipitation = typeof day.precipitation === "number" ? day.precipitation
        : typeof day.precip === "number" ? day.precip
          : typeof day.precipitation_probability === "number" ? day.precipitation_probability
            : typeof day.pop === "number" ? day.pop * 100
              : null;

      const wind = typeof day.wind === "number" ? day.wind
        : typeof day.wind_speed === "number" ? day.wind_speed
          : null;

      const humidity = typeof day.humidity === "number" ? day.humidity : null;

      return {
        date: date || new Date().toISOString().split("T")[0],
        dayName: dayName || undefined,
        condition: condition || "Sin datos",
        temperature: {
          min: tempMin,
          max: tempMax,
        },
        precipitation,
        wind,
        humidity,
      };
    });
  }, [weather.forecast, weather.daily, weather.weekly]);

  // Extraer santoral del payload
  const santoral = (payload.santoral ?? {}) as { saints?: string[]; namedays?: string[] };
  const santoralEntries = useMemo(() => {
    const fromSaints = extractStrings(santoral.saints);
    const fromNamedays = extractStrings(santoral.namedays);
    const combined = [...fromSaints, ...fromNamedays];
    const unique = combined.filter((entry, index, self) => {
      const normalized = entry.toLowerCase().trim();
      return self.findIndex((e) => e.toLowerCase().trim() === normalized) === index;
    });
    return unique;
  }, [santoral.saints, santoral.namedays]);

  // Crear mapa de todos los paneles disponibles (usar nombres v2: clock, weather, astronomy, santoral, calendar, news)
  const allPanelsMap = useMemo<Map<string, RotatingCardItem>>(() => {
    const map = new Map<string, RotatingCardItem>();
    const durations = rotationConfig.durations_sec;

    // clock (TimeCard)
    map.set("clock", {
      id: "clock",
      duration: (durations.clock ?? 10) * 1000,
      render: () => <TimeCard timezone={timezone} />
    });

    // weather (WeatherCard - actual)
    map.set("weather", {
      id: "weather",
      duration: (durations.weather ?? 12) * 1000,
      render: () => (
        <WeatherCard
          temperatureLabel={`${temperature.value}${temperature.unit}`}
          feelsLikeLabel={feelsLikeValue ? `${feelsLikeValue.value}${feelsLikeValue.unit}` : null}
          condition={condition}
          humidity={humidity}
          wind={wind}
          rain={rain}
          unit={temperature.unit}
          timezone={timezone}
        />
      )
    });

    // forecast (WeatherForecastCard - pronóstico semanal)
    // Solo mostrar si hay datos de pronóstico disponibles
    if (forecastDays.length > 0) {
      map.set("forecast", {
        id: "forecast",
        duration: (durations.forecast ?? 15) * 1000,
        render: () => (
          <WeatherForecastCard
            forecast={forecastDays}
            unit={temperature.unit}
          />
        )
      });
    }

    // astronomy (EphemeridesCard - SOLO efemérides astronómicas + fase lunar)
    map.set("santoral", {
      id: "santoral",
      duration: (durations.santoral ?? 8) * 1000,
      render: () => <SaintsCard saints={santoralEntries} />
    });

    // calendar (CalendarCard)
    map.set("calendar", {
      id: "calendar",
      duration: (durations.calendar ?? 12) * 1000,
      render: () => <CalendarCard events={calendarEvents} timezone={timezone} />
    });

    // harvest (HarvestCard)
    map.set("harvest", {
      id: "harvest",
      duration: (durations.harvest ?? 10) * 1000,
      render: () => <HarvestCard items={harvestItems} />
    });

    // news (NewsCard)
    map.set("news", {
      id: "news",
      duration: (durations.news ?? 12) * 1000,
      render: () => <NewsCard items={newsItems} />
    });

    // historicalEvents (HistoricalEventsCard) - Panel EXCLUSIVO para efemérides históricas
    // Este panel muestra SOLO eventos históricos de Wikimedia/local, NO eventos astronómicos
    const historicalEventsItemsForCard = Array.isArray(historicalEvents.items)
      ? historicalEvents.items.map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const obj = item as { year?: number; text?: string; type?: string; source?: string };
          const text = obj.text || "";
          const year = obj.year;
          if (year && text) {
            return `${year}: ${text}`;
          }
          return text;
        }
        return String(item);
      })
      : [];
    const v2ConfigForDuration = config as unknown as { panels?: { historicalEvents?: { rotation_seconds?: number } } };
    const rotationSeconds = v2ConfigForDuration.panels?.historicalEvents?.rotation_seconds ?? 6;

    // Alternar eventos históricos - mostrar diferentes eventos en cada rotación
    map.set("historicalEvents", {
      id: "historicalEvents",
      duration: (durations.historicalEvents ?? 6) * 1000,
      render: () => {
        const totalEvents = historicalEventsItemsForCard.length;
        if (totalEvents === 0) {
          return <HistoricalEventsCard items={["No hay efemérides para este día."]} rotationSeconds={rotationSeconds} />;
        }

        // Limitar a 2 eventos máximo para evitar desbordes en pantalla
        const eventsPerDisplay = 2;

        // Usar el contador ref que se incrementa cada vez que se muestra este panel
        const currentCounter = historicalEventsCounterRef.current ?? 0;
        const displayIndex = currentCounter % Math.max(1, Math.ceil(totalEvents / eventsPerDisplay));
        const startIndex = (displayIndex * eventsPerDisplay) % totalEvents;

        // Tomar los eventos para esta rotación
        let alternatingEvents: string[] = [];
        if (startIndex + eventsPerDisplay <= totalEvents) {
          alternatingEvents = historicalEventsItemsForCard.slice(startIndex, startIndex + eventsPerDisplay);
        } else {
          // Si se cruza el final del array, tomar desde startIndex hasta el final y completar desde el principio
          const fromStart = historicalEventsItemsForCard.slice(startIndex);
          const fromBeginning = historicalEventsItemsForCard.slice(0, eventsPerDisplay - fromStart.length);
          alternatingEvents = [...fromStart, ...fromBeginning];
        }

        // Incrementar contador para la próxima vez que se muestre este panel
        historicalEventsCounterRef.current = (currentCounter + 1) % Math.max(1, Math.ceil(totalEvents / eventsPerDisplay));

        // Asegurar que siempre mostramos exactamente 2 eventos o menos
        const finalEvents = alternatingEvents.slice(0, eventsPerDisplay);

        return <HistoricalEventsCard items={finalEvents} rotationSeconds={rotationSeconds} />;
      }
    });

    // NOTA: Paneles legacy v1 eliminados. Ahora solo se soportan nombres v2.
    // Los mapeos legacy se mantienen en LEGACY_ROTATION_PANEL_MAP para conversión automática.

    return map;
  }, [
    rotationConfig.durations_sec,
    timezone,
    temperature.value,
    temperature.unit,
    feelsLikeValue,
    condition,
    humidity,
    wind,
    rain,
    forecastDays,
    calendarEvents,
    moonPhase,
    moonIllumination,
    harvestItems,
    newsItems,
    sunrise,
    sunset,
    ephemeridesEvents,
    santoralEntries,
    historicalEvents,
    config  // Añadido para detectar cambios en configuración de panels.historicalEvents
  ]);

  // Filtrar y validar paneles según configuración y disponibilidad
  const availablePanels = useMemo<RotatingCardItem[]>(() => {
    const orderToUse = rotationConfig.order.length > 0
      ? rotationConfig.order
      : (rotationConfig.enabled ? [] : [DEFAULT_FALLBACK_PANEL]);

    const validPanels: RotatingCardItem[] = [];

    for (const panelId of orderToUse) {
      // Validar que el panel existe en el mapa
      const panel = allPanelsMap.get(panelId);
      if (!panel) {
        // En dev, log leve si el panel no está implementado
        if (IS_DEV) {
          console.warn(`[OverlayRotator] Panel "${panelId}" no está implementado, ignorando`);
        }
        continue;
      }

      // Validar disponibilidad de datos según el panel
      let shouldInclude = true;

      if (panelId === "calendar") {
        const panelsConfig = config as unknown as { panels?: { calendar?: { enabled?: boolean } } };
        const calendarConfigV1 = config as unknown as { calendar?: { enabled?: boolean } };
        const calendarEnabledV2 = panelsConfig.panels?.calendar?.enabled !== false;
        const calendarEnabledV1 = calendarConfigV1.calendar?.enabled !== false;
        shouldInclude = (calendarEnabledV2 || calendarEnabledV1) && calendarEvents.length >= 0;
      } else if (panelId === "harvest") {
        // Verificar configuración V2 o V1
        const v2Config = config as unknown as { panels?: { harvest?: { enabled?: boolean } } };
        const harvestEnabledV2 = v2Config.panels?.harvest?.enabled !== false;
        const harvestConfigV1 = config as unknown as { harvest?: { enabled?: boolean } };
        const harvestEnabledV1 = harvestConfigV1.harvest?.enabled !== false;
        // Mostrar si está habilitado (V2 o V1) - siempre mostrar cuando está habilitado, incluso sin items
        // El HarvestCard maneja el caso de items vacíos mostrando "Sin datos de cultivo"
        shouldInclude = harvestEnabledV2 || harvestEnabledV1;
      } else if (panelId === "news") {
        const panelsConfig = config as unknown as { panels?: { news?: { enabled?: boolean } } };
        const newsConfigV1 = config as unknown as { news?: { enabled?: boolean } };
        const newsEnabledV2 = panelsConfig.panels?.news?.enabled !== false;
        const newsEnabledV1 = newsConfigV1.news?.enabled !== false;
        shouldInclude = (newsEnabledV2 || newsEnabledV1) && newsItems.length >= 0;
      } else if (panelId === "historicalEvents") {
        const panelsConfig = config as unknown as { panels?: { historicalEvents?: { enabled?: boolean } } };
        const historicalEventsItems = Array.isArray(historicalEvents.items) ? historicalEvents.items : [];
        // Mostrar si está habilitado Y hay items disponibles
        const enabled = panelsConfig.panels?.historicalEvents?.enabled !== false;
        shouldInclude = enabled && historicalEventsItems.length > 0;
      } else if (panelId === "astronomy") {
        // El panel "astronomy" usa la configuración de "ephemerides"
        const panelsConfig = config as unknown as { panels?: { ephemerides?: { enabled?: boolean } } };
        const ephemeridesConfigV1 = config as unknown as { ephemerides?: { enabled?: boolean } };
        const ephemeridesEnabledV2 = panelsConfig.panels?.ephemerides?.enabled !== false;
        const ephemeridesEnabledV1 = ephemeridesConfigV1.ephemerides?.enabled !== false;
        const hasData = !!(sunrise || sunset || moonPhase || ephemeridesEvents.length > 0);
        shouldInclude = (ephemeridesEnabledV2 || ephemeridesEnabledV1) && hasData;
      } else if (panelId === "ephemerides") {
        // Legacy: panel "ephemerides" también debe funcionar
        const panelsConfig = config as unknown as { panels?: { ephemerides?: { enabled?: boolean } } };
        const ephemeridesConfigV1 = config as unknown as { ephemerides?: { enabled?: boolean } };
        const ephemeridesEnabledV2 = panelsConfig.panels?.ephemerides?.enabled !== false;
        const ephemeridesEnabledV1 = ephemeridesConfigV1.ephemerides?.enabled !== false;
        const hasData = !!(sunrise || sunset || moonPhase || ephemeridesEvents.length > 0);
        shouldInclude = (ephemeridesEnabledV2 || ephemeridesEnabledV1) && hasData;
      } else if (panelId === "forecast") {
        // Solo incluir si hay datos de pronóstico y la respuesta es ok
        shouldInclude = forecastDays.length > 0 && weather.ok !== false;
      } else if (panelId === "weather") {
        shouldInclude = condition !== null || temperature.value !== "--";
      }
      // "time", "clock", "santoral" y "moon" siempre están disponibles

      if (shouldInclude) {
        validPanels.push(panel);
      } else if (IS_DEV) {
        console.warn(`[OverlayRotator] Panel "${panelId}" no tiene datos disponibles, saltando`);
      }
    }

    // Si no hay paneles válidos y rotation está deshabilitado o lista vacía, usar fallback
    if (validPanels.length === 0) {
      const fallbackPanel = allPanelsMap.get(DEFAULT_FALLBACK_PANEL);
      if (fallbackPanel) {
        return [fallbackPanel];
      }
    }

    return validPanels;
  }, [
    rotationConfig.order,
    rotationConfig.enabled,
    allPanelsMap,
    config,
    calendarEvents,
    harvestItems,
    newsItems,
    sunrise,
    sunset,
    moonPhase,
    ephemeridesEvents,
    forecastDays,
    condition,
    temperature.value,
    historicalEvents
  ]);

  // Mantener ref actualizado con los paneles disponibles
  useEffect(() => {
    availablePanelsRef.current = availablePanels;
  }, [availablePanels]);

  useEffect(() => {
    const handleRotationRestart = () => {
      if (rotationTimerRef.current !== null) {
        window.clearTimeout(rotationTimerRef.current);
        rotationTimerRef.current = null;
      }
      currentPanelIndexRef.current = 0;
      setCurrentPanelIndex(0);
      setRotationRestartKey((value) => value + 1);
      if (IS_DEV) {
        console.log("[OverlayRotator] Reinicio manual de rotación recibido");
      }
    };

    window.addEventListener("pantalla:rotation:restart", handleRotationRestart);
    return () => {
      window.removeEventListener("pantalla:rotation:restart", handleRotationRestart);
    };
  }, []);

  // Memoizar IDs de paneles disponibles para usar como dependencia estable
  const availablePanelIds = useMemo(() => {
    return availablePanels.map(p => p.id).join(",");
  }, [availablePanels]);

  // Resetear índice cuando cambie la lista de paneles
  useEffect(() => {
    setCurrentPanelIndex(0);
    currentPanelIndexRef.current = 0;
    // No resetear el contador de efemérides históricas para mantener la continuidad del alternado
  }, [availablePanelIds, rotationRestartKey]);

  // Manejo del timer de rotación
  useEffect(() => {
    // Limpiar timer anterior si existe
    if (rotationTimerRef.current !== null) {
      window.clearTimeout(rotationTimerRef.current);
      rotationTimerRef.current = null;
      if (IS_DEV) {
        console.log("[OverlayRotator] Timer limpiado (dependencias cambiaron)");
      }
    }

    // Si rotation está deshabilitado o lista vacía o solo hay un panel, no crear timer
    if (!rotationConfig.enabled || availablePanels.length <= 1) {
      if (IS_DEV) {
        console.log(`[OverlayRotator] Timer no iniciado: enabled=${rotationConfig.enabled}, panels=${availablePanels.length}`);
      }
      // Resetear índice cuando se desactiva la rotación
      if (!rotationConfig.enabled || availablePanels.length <= 1) {
        setCurrentPanelIndex(0);
        currentPanelIndexRef.current = 0;
      }
      return;
    }

    // Asegurar que el índice actual sea válido
    const currentIndexValue = currentPanelIndexRef.current ?? 0;
    const validIndex = currentIndexValue % availablePanels.length;
    if (currentIndexValue !== validIndex) {
      setCurrentPanelIndex(validIndex);
      currentPanelIndexRef.current = validIndex;
    }

    // Usar duración del panel actual en lugar de una duración global
    const getCurrentPanelDuration = () => {
      const currentPanels = availablePanelsRef.current;
      if (!currentPanels || currentPanels.length === 0) {
        return DEFAULT_DURATIONS_SEC.clock * 1000;
      }
      // Usar la ref para obtener el índice actual sin causar re-render del efecto
      const currentIndexValue = currentPanelIndexRef.current ?? 0;
      const currentIndex = currentIndexValue % currentPanels.length;
      const currentPanel = currentPanels[currentIndex];
      return currentPanel?.duration ?? DEFAULT_DURATIONS_SEC.clock * 1000;
    };

    // Función para avanzar al siguiente panel
    const advanceToNextPanel = () => {
      setCurrentPanelIndex((prevIndex) => {
        const currentPanels = availablePanelsRef.current;
        if (!currentPanels || currentPanels.length === 0) {
          currentPanelIndexRef.current = 0;
          return 0;
        }
        const nextIndex = (prevIndex + 1) % currentPanels.length;
        currentPanelIndexRef.current = nextIndex;
        if (IS_DEV) {
          console.log(`[OverlayRotator] Rotando de panel ${prevIndex} a ${nextIndex} (${currentPanels[nextIndex]?.id})`);
        }
        return nextIndex;
      });
    };

    // Programar el siguiente cambio usando duración del panel actual
    const scheduleNext = () => {
      // Verificar que la rotación sigue habilitada antes de programar
      const currentPanels = availablePanelsRef.current;
      if (!rotationConfig.enabled || !currentPanels || currentPanels.length <= 1) {
        return;
      }
      const duration = getCurrentPanelDuration();
      rotationTimerRef.current = window.setTimeout(() => {
        advanceToNextPanel();
        scheduleNext(); // Programar el siguiente
      }, duration);
    };

    // Iniciar el ciclo
    scheduleNext();

    if (IS_DEV) {
      console.log(`[OverlayRotator] Timer iniciado: ${availablePanels.length} paneles con duraciones individuales`);
    }

    // Cleanup: siempre limpiar el timer
    return () => {
      if (rotationTimerRef.current !== null) {
        window.clearTimeout(rotationTimerRef.current);
        rotationTimerRef.current = null;
        if (IS_DEV) {
          console.log("[OverlayRotator] Timer limpiado (cleanup)");
        }
      }
    };
  }, [rotationConfig.enabled, rotationConfig.durations_sec, availablePanels.length, availablePanelIds, rotationRestartKey]);

  // Sincronizar la ref con el estado cuando cambie
  useEffect(() => {
    currentPanelIndexRef.current = currentPanelIndex;
  }, [currentPanelIndex]);

  // Determinar el panel actual a mostrar
  const currentPanel = useMemo<RotatingCardItem | null>(() => {
    if (availablePanels.length === 0) {
      return null;
    }

    // Si rotation está deshabilitado o solo hay un panel, mostrar el primero
    if (!rotationConfig.enabled || availablePanels.length === 1) {
      return availablePanels[0] || null;
    }

    // Usar el índice cíclico
    const index = currentPanelIndex % availablePanels.length;
    return availablePanels[index] || availablePanels[0] || null;
  }, [rotationConfig.enabled, availablePanels, currentPanelIndex]);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) {
      return null;
    }
    return dayjs(lastUpdatedAt).tz(timezone).format("HH:mm:ss");
  }, [timezone, lastUpdatedAt]);

  const statusLabel = useMemo(() => {
    if (loading && !lastUpdatedAt) {
      return "Sincronizando datos…";
    }
    if (lastUpdatedLabel) {
      return `Actualizado ${lastUpdatedLabel}`;
    }
    return "Datos no disponibles";
  }, [lastUpdatedAt, lastUpdatedLabel, loading]);

  // Calcular progreso de rotación
  const { progress: rotationProgress } = useRotationProgress(
    currentPanel?.duration ?? 0,
    currentPanel !== null && rotationConfig.enabled
  );

  // Obtener condición meteorológica para efectos ambientales
  const weatherCondition = useMemo(() => {
    const weather = (payload.weather ?? {}) as Record<string, unknown>;
    return sanitizeRichText(weather.summary) || sanitizeRichText(weather.condition) || null;
  }, [payload.weather]);

  // Obtener velocidad del viento
  const windSpeed = useMemo(() => {
    const weather = (payload.weather ?? {}) as Record<string, unknown>;
    const wind = typeof weather.wind_speed === "number" ? weather.wind_speed
      : typeof weather.wind === "number" ? weather.wind
        : typeof weather.windSpeed === "number" ? weather.windSpeed
          : typeof weather.ws === "number" ? weather.ws
            : 0;
    // Normalizar velocidad del viento para efectos (-10 a 10)
    return Math.max(-10, Math.min(10, (wind / 10) * 2));
  }, [payload.weather]);

  if (!currentPanel) {
    return (
      <section className="overlay-rotator" role="complementary" aria-live="polite">
        <BackgroundGradient />
        <div className="overlay-rotator__content">
          {loading ? (
            <SkeletonLoader variant="card" width="100%" height="400px" />
          ) : (
            <div className="overlay-rotator__fallback" role="status">
              <p>Datos no disponibles</p>
            </div>
          )}
          <p className="overlay-rotator__status">{statusLabel}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overlay-rotator" role="complementary" aria-live="polite">
      <BackgroundGradient />
      <WeatherAmbience
      window.removeEventListener("pantalla:rotation:restart", handleRotationRestart);
    };
  }, []);

  // Memoizar IDs de paneles disponibles para usar como dependencia estable
  const availablePanelIds = useMemo(() => {
    return availablePanels.map(p => p.id).join(",");
  }, [availablePanels]);

  // Resetear índice cuando cambie la lista de paneles
  useEffect(() => {
    setCurrentPanelIndex(0);
    currentPanelIndexRef.current = 0;
    // No resetear el contador de efemérides históricas para mantener la continuidad del alternado
  }, [availablePanelIds, rotationRestartKey]);

  // Manejo del timer de rotación
  useEffect(() => {
    // Limpiar timer anterior si existe
    if (rotationTimerRef.current !== null) {
      window.clearTimeout(rotationTimerRef.current);
      rotationTimerRef.current = null;
      if (IS_DEV) {
        console.log("[OverlayRotator] Timer limpiado (dependencias cambiaron)");
      }
    }

    // Si rotation está deshabilitado o lista vacía o solo hay un panel, no crear timer
    if (!rotationConfig.enabled || availablePanels.length <= 1) {
      if (IS_DEV) {
        console.log(`[OverlayRotator] Timer no iniciado: enabled=${rotationConfig.enabled}, panels=${availablePanels.length}`);
      }
      // Resetear índice cuando se desactiva la rotación
      if (!rotationConfig.enabled || availablePanels.length <= 1) {
        setCurrentPanelIndex(0);
        currentPanelIndexRef.current = 0;
      }
      return;
    }

    // Asegurar que el índice actual sea válido
    const currentIndexValue = currentPanelIndexRef.current ?? 0;
    const validIndex = currentIndexValue % availablePanels.length;
    if (currentIndexValue !== validIndex) {
      setCurrentPanelIndex(validIndex);
      currentPanelIndexRef.current = validIndex;
    }

    // Usar duración del panel actual en lugar de una duración global
    const getCurrentPanelDuration = () => {
      const currentPanels = availablePanelsRef.current;
      if (!currentPanels || currentPanels.length === 0) {
        return DEFAULT_DURATIONS_SEC.clock * 1000;
      }
      // Usar la ref para obtener el índice actual sin causar re-render del efecto
      const currentIndexValue = currentPanelIndexRef.current ?? 0;
      const currentIndex = currentIndexValue % currentPanels.length;
      const currentPanel = currentPanels[currentIndex];
      return currentPanel?.duration ?? DEFAULT_DURATIONS_SEC.clock * 1000;
    };

    // Función para avanzar al siguiente panel
    const advanceToNextPanel = () => {
      setCurrentPanelIndex((prevIndex) => {
        const currentPanels = availablePanelsRef.current;
        if (!currentPanels || currentPanels.length === 0) {
          currentPanelIndexRef.current = 0;
          return 0;
        }
        const nextIndex = (prevIndex + 1) % currentPanels.length;
        currentPanelIndexRef.current = nextIndex;
        if (IS_DEV) {
          console.log(`[OverlayRotator] Rotando de panel ${prevIndex} a ${nextIndex} (${currentPanels[nextIndex]?.id})`);
        }
        return nextIndex;
      });
    };

    // Programar el siguiente cambio usando duración del panel actual
    const scheduleNext = () => {
      // Verificar que la rotación sigue habilitada antes de programar
      const currentPanels = availablePanelsRef.current;
      if (!rotationConfig.enabled || !currentPanels || currentPanels.length <= 1) {
        return;
      }
      const duration = getCurrentPanelDuration();
      rotationTimerRef.current = window.setTimeout(() => {
        advanceToNextPanel();
        scheduleNext(); // Programar el siguiente
      }, duration);
    };

    // Iniciar el ciclo
    scheduleNext();

    if (IS_DEV) {
      console.log(`[OverlayRotator] Timer iniciado: ${availablePanels.length} paneles con duraciones individuales`);
    }

    // Cleanup: siempre limpiar el timer
    return () => {
      if (rotationTimerRef.current !== null) {
        window.clearTimeout(rotationTimerRef.current);
        rotationTimerRef.current = null;
        if (IS_DEV) {
          console.log("[OverlayRotator] Timer limpiado (cleanup)");
        }
      }
    };
  }, [rotationConfig.enabled, rotationConfig.durations_sec, availablePanels.length, availablePanelIds, rotationRestartKey]);

  // Sincronizar la ref con el estado cuando cambie
  useEffect(() => {
    currentPanelIndexRef.current = currentPanelIndex;
  }, [currentPanelIndex]);

  // Determinar el panel actual a mostrar
  const currentPanel = useMemo<RotatingCardItem | null>(() => {
    if (availablePanels.length === 0) {
      return null;
    }

    // Si rotation está deshabilitado o solo hay un panel, mostrar el primero
    if (!rotationConfig.enabled || availablePanels.length === 1) {
      return availablePanels[0] || null;
    }

    // Usar el índice cíclico
    const index = currentPanelIndex % availablePanels.length;
    return availablePanels[index] || availablePanels[0] || null;
  }, [rotationConfig.enabled, availablePanels, currentPanelIndex]);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) {
      return null;
    }
    return dayjs(lastUpdatedAt).tz(timezone).format("HH:mm:ss");
  }, [timezone, lastUpdatedAt]);

  const statusLabel = useMemo(() => {
    if (loading && !lastUpdatedAt) {
      return "Sincronizando datos…";
    }
    if (lastUpdatedLabel) {
      return `Actualizado ${lastUpdatedLabel}`;
    }
    return "Datos no disponibles";
  }, [lastUpdatedAt, lastUpdatedLabel, loading]);

  // Calcular progreso de rotación
  const { progress: rotationProgress } = useRotationProgress(
    currentPanel?.duration ?? 0,
    currentPanel !== null && rotationConfig.enabled
  );

  // Obtener condición meteorológica para efectos ambientales
  const weatherCondition = useMemo(() => {
    const weather = (payload.weather ?? {}) as Record<string, unknown>;
    return sanitizeRichText(weather.summary) || sanitizeRichText(weather.condition) || null;
  }, [payload.weather]);

  // Obtener velocidad del viento
  const windSpeed = useMemo(() => {
    const weather = (payload.weather ?? {}) as Record<string, unknown>;
    const wind = typeof weather.wind_speed === "number" ? weather.wind_speed
      : typeof weather.wind === "number" ? weather.wind
        : typeof weather.windSpeed === "number" ? weather.windSpeed
          : typeof weather.ws === "number" ? weather.ws
            : 0;
    // Normalizar velocidad del viento para efectos (-10 a 10)
    return Math.max(-10, Math.min(10, (wind / 10) * 2));
  }, [payload.weather]);

  if (!currentPanel) {
    return (
      <section className="overlay-rotator" role="complementary" aria-live="polite">
        <BackgroundGradient />
        <div className="overlay-rotator__content">
          {loading ? (
            <SkeletonLoader variant="card" width="100%" height="400px" />
          ) : (
            <div className="overlay-rotator__fallback" role="status">
              <p>Datos no disponibles</p>
            </div>
          )}
          <p className="overlay-rotator__status">{statusLabel}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overlay-rotator" role="complementary" aria-live="polite">
      <BackgroundGradient />
      <WeatherAmbience
        condition={weatherCondition}
        isNight={isNight}
        windSpeed={windSpeed}
        intensity="moderate"
      />
      <div className="overlay-rotator__content">
        {loading && !lastUpdatedAt ? (
          <SkeletonLoader variant="card" width="100%" height="100%" />
        ) : (
          <>
            <div className="rotating-card-wrapper">
              <RotatingCard cards={[currentPanel]} />
              {rotationConfig.enabled && currentPanel.duration > 0 && (
                <RotationProgress progress={rotationProgress} />
              )}
            </div>
            {/* Footer status removed for cleaner UI */}
          </>
        )}
      </div>
    </section>
  );
};

export default OverlayRotator;