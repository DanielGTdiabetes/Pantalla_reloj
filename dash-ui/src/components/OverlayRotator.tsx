import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import { apiGet, apiPost, getConfigMeta, getSantoralToday } from "../lib/api";
import { useConfig } from "../lib/useConfig";
import type { AppConfigV2 } from "../types/config_v2";
import { dayjs } from "../utils/dayjs";
import { ensurePlainText, sanitizeRichText } from "../utils/sanitize";
import { safeGetTimezone } from "../utils/timezone";
import type { RotatingCardItem } from "./RotatingCard";
import { RotatingCard } from "./RotatingCard";
import { CalendarCard } from "./dashboard/cards/CalendarCard";
import { EphemeridesCard } from "./dashboard/cards/EphemeridesCard";
import { HarvestCard } from "./dashboard/cards/HarvestCard";
import { MoonCard } from "./dashboard/cards/MoonCard";
import { NewsCard } from "./dashboard/cards/NewsCard";
import { SaintsCard } from "./dashboard/cards/SaintsCard";
import { TimeCard } from "./dashboard/cards/TimeCard";
import { WeatherCard } from "./dashboard/cards/WeatherCard";
import { WeatherForecastCard } from "./dashboard/cards/WeatherForecastCard";

type DashboardPayload = {
  weather?: Record<string, unknown>;
  news?: Record<string, unknown>;
  astronomy?: Record<string, unknown>;
  calendar?: Record<string, unknown>;
  santoral?: { saints?: string[]; namedays?: string[] };
};

const REFRESH_INTERVAL_MS = 60_000;

// Detectar si estamos en modo desarrollo
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
  "news": "news",
};
const DEFAULT_FALLBACK_PANEL = "clock";
const DEFAULT_DURATIONS_SEC = {
  clock: 10,
  weather: 12,
  astronomy: 10,
  santoral: 8,
  calendar: 12,
  news: 12,
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
  
  const timezone = useMemo(() => {
    const tz = safeGetTimezone(config as Record<string, unknown>);
    return tz;
  }, [config]);

  // Leer configuración de rotación desde ui_global.overlay.rotator (v2) o ui.rotation (v1 legacy)
  const rotationConfig = useMemo(() => {
    // Intentar leer desde v2 primero
    const v2Config = config as unknown as AppConfigV2;
    if (v2Config.version === 2 && v2Config.ui_global?.overlay?.rotator) {
      const rotator = v2Config.ui_global.overlay.rotator;
      const order = Array.isArray(rotator.order) && rotator.order.length > 0
        ? rotator.order.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        : [];
      const durations_sec = rotator.durations_sec || DEFAULT_DURATIONS_SEC;
      const transition_ms = Math.max(0, Math.min(2000, rotator.transition_ms ?? 400));
      
      return {
        enabled: rotator.enabled ?? true,
        order,
        durations_sec,
        transition_ms,
        pause_on_alert: rotator.pause_on_alert ?? false,
      };
    }
    
    // Fallback a v1 legacy (ui.rotation)
    const uiConfig = config.ui || (config as unknown as { ui?: { rotation?: { enabled?: boolean; duration_sec?: number; panels?: string[] } } }).ui;
    const rotation = uiConfig?.rotation || {};
    const panels = Array.isArray(rotation.panels) && rotation.panels.length > 0
      ? rotation.panels.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    
    // Mapear IDs v1 a v2
    const order = panels.map(p => {
      // Buscar mapeo inverso (v1 -> v2)
      for (const [v2Id, v1Id] of Object.entries(PANEL_ID_MAP)) {
        if (v1Id === p) return v2Id;
      }
      return p; // Si no hay mapeo, usar como está
    });
    
    return {
      enabled: rotation.enabled ?? false,
      order,
      durations_sec: DEFAULT_DURATIONS_SEC,
      transition_ms: 400,
      pause_on_alert: false,
    };
  }, [config]);

  // Estado para el índice actual del panel rotativo
  const [currentPanelIndex, setCurrentPanelIndex] = useState(0);
  const rotationTimerRef = useRef<number | null>(null);
  const availablePanelsRef = useRef<RotatingCardItem[]>([]);

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

  // Fetch de datos con cacheo
  useEffect(() => {
    let mounted = true;

    const fetchAll = async () => {
      try {
        // Verificar cache de weather (2-5 min)
        const weatherCacheAge = weatherCacheRef.current.timestamp 
          ? Date.now() - weatherCacheRef.current.timestamp 
          : Infinity;
        const weatherCacheValid = weatherCacheAge < (2 + Math.random() * 3) * 60 * 1000;

        // Verificar cache de astronomy (1h)
        const astronomyCacheAge = astronomyCacheRef.current.timestamp 
          ? Date.now() - astronomyCacheRef.current.timestamp 
          : Infinity;
        const astronomyCacheValid = astronomyCacheAge < 60 * 60 * 1000;

        // Verificar cache de santoral (1d)
        const santoralCacheAge = santoralCacheRef.current.timestamp 
          ? Date.now() - santoralCacheRef.current.timestamp 
          : Infinity;
        const santoralCacheValid = santoralCacheAge < 24 * 60 * 60 * 1000;

        const [weather, news, astronomy, calendar, santoral] = await Promise.all([
          (async () => {
            if (weatherCacheValid && weatherCacheRef.current.data) {
              return weatherCacheRef.current.data;
            }
            try {
              const v2Config = config as unknown as { panels?: { weather?: { latitude?: number; longitude?: number } } };
              const lat = v2Config.panels?.weather?.latitude ?? 39.98;
              const lon = v2Config.panels?.weather?.longitude ?? 0.20;
              const data = await apiGet<Record<string, unknown>>(`/api/weather/weekly?lat=${lat}&lon=${lon}`);
              if (mounted) {
                weatherCacheRef.current = { data, timestamp: Date.now() };
              }
              return data;
            } catch {
              // Si falla, usar cache si existe
              return weatherCacheRef.current.data || {};
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
            if (astronomyCacheValid && astronomyCacheRef.current.data) {
              return astronomyCacheRef.current.data;
            }
            try {
              const data = await apiGet<Record<string, unknown>>("/api/astronomy");
              if (mounted) {
                astronomyCacheRef.current = { data, timestamp: Date.now() };
              }
              return data;
            } catch {
              return astronomyCacheRef.current.data || {};
            }
          })(),
          (async () => {
            try {
              const fromDate = new Date().toISOString();
              const toDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
              const events = await apiGet<Array<Record<string, unknown>>>(`/api/calendar/events?from_date=${fromDate}&to_date=${toDate}`);
              return { events };
            } catch {
              return { events: [] };
            }
          })(),
          (async () => {
            if (santoralCacheValid && santoralCacheRef.current.data) {
              return { saints: santoralCacheRef.current.data.names, namedays: [] };
            }
            try {
              const data = await getSantoralToday();
              if (mounted) {
                santoralCacheRef.current = { data, timestamp: Date.now() };
              }
              return { saints: data.names, namedays: [] };
            } catch {
              return santoralCacheRef.current.data 
                ? { saints: santoralCacheRef.current.data.names, namedays: [] }
                : { saints: [], namedays: [] };
            }
          })()
        ]);

        if (mounted) {
          setPayload({ weather, news, astronomy, calendar, santoral });
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

  // Procesamiento de datos (sin cambios)
  const weather = (payload.weather ?? {}) as Record<string, unknown>;
  const astronomy = (payload.astronomy ?? {}) as Record<string, unknown>;
  const news = (payload.news ?? {}) as Record<string, unknown>;
  const calendar = (payload.calendar ?? {}) as Record<string, unknown>;

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
    const forecastData = weather.days || weather.forecast || weather.daily || weather.weekly || [];
    if (!Array.isArray(forecastData)) {
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
          unit={temperature.unit}
          timezone={timezone}
        />
      )
    });

    // astronomy (EphemeridesCard - efemérides + fase lunar)
    map.set("astronomy", {
      id: "astronomy",
      duration: (durations.astronomy ?? 10) * 1000,
      render: () => (
        <EphemeridesCard
          sunrise={sunrise}
          sunset={sunset}
          moonPhase={moonPhase}
          illumination={moonIllumination}
          events={ephemeridesEvents}
        />
      )
    });

    // santoral (SaintsCard)
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

    // news (NewsCard)
    map.set("news", {
      id: "news",
      duration: (durations.news ?? 12) * 1000,
      render: () => <NewsCard items={newsItems} />
    });

    // Legacy panels (mapeo v1 -> v2 para retrocompatibilidad)
    map.set("time", map.get("clock")!); // time -> clock
    map.set("ephemerides", map.get("astronomy")!); // ephemerides -> astronomy
    map.set("saints", map.get("santoral")!); // saints -> santoral
    map.set("forecast", {
      id: "forecast",
      duration: (durations.weather ?? 12) * 1000,
      render: () => (
        <WeatherForecastCard
          forecast={forecastDays}
          unit={temperature.unit}
        />
      )
    });
    map.set("moon", {
      id: "moon",
      duration: (durations.astronomy ?? 10) * 1000,
      render: () => <MoonCard moonPhase={moonPhase} illumination={moonIllumination} />
    });
    map.set("harvest", {
      id: "harvest",
      duration: 10 * 1000, // No está en durations_sec por defecto
      render: () => <HarvestCard items={harvestItems} />
    });

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
    forecastDays,
    calendarEvents,
    moonPhase,
    moonIllumination,
    harvestItems,
    newsItems,
    sunrise,
    sunset,
    ephemeridesEvents,
    santoralEntries
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
        shouldInclude = panelsConfig.panels?.calendar?.enabled !== false && calendarEvents.length >= 0;
      } else if (panelId === "harvest") {
        const harvestConfig = config as unknown as { harvest?: { enabled?: boolean } };
        shouldInclude = harvestConfig.harvest?.enabled !== false && harvestItems.length >= 0;
      } else if (panelId === "news") {
        const panelsConfig = config as unknown as { panels?: { news?: { enabled?: boolean } } };
        shouldInclude = panelsConfig.panels?.news?.enabled !== false && newsItems.length >= 0;
      } else if (panelId === "ephemerides") {
        const panelsConfig = config as unknown as { panels?: { ephemerides?: { enabled?: boolean } } };
        const ephemeridesEnabled = panelsConfig.panels?.ephemerides?.enabled !== false;
        const hasData = !!(sunrise || sunset || moonPhase || ephemeridesEvents.length > 0);
        shouldInclude = ephemeridesEnabled && hasData;
      } else if (panelId === "forecast") {
        shouldInclude = forecastDays.length > 0;
      } else if (panelId === "weather") {
        shouldInclude = condition !== null || temperature.value !== "--";
      }
      // "time" y "moon" siempre están disponibles

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
    rotationConfig.panels,
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
    temperature.value
  ]);

  // Mantener ref actualizado con los paneles disponibles
  useEffect(() => {
    availablePanelsRef.current = availablePanels;
  }, [availablePanels]);

  // Memoizar IDs de paneles disponibles para usar como dependencia estable
  const availablePanelIds = useMemo(() => {
    return availablePanels.map(p => p.id).join(",");
  }, [availablePanels]);

  // Resetear índice cuando cambie la lista de paneles
  useEffect(() => {
    setCurrentPanelIndex(0);
  }, [availablePanelIds]);

  // Manejo del timer de rotación
  useEffect(() => {
    // Limpiar timer anterior si existe
    if (rotationTimerRef.current !== null) {
      window.clearInterval(rotationTimerRef.current);
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
      return;
    }

    // Usar duración del panel actual en lugar de una duración global
    const getCurrentPanelDuration = () => {
      const currentPanels = availablePanelsRef.current;
      if (!currentPanels || currentPanels.length === 0) {
        return DEFAULT_DURATIONS_SEC.clock * 1000;
      }
      const currentIndex = currentPanelIndex % currentPanels.length;
      const currentPanel = currentPanels[currentIndex];
      return currentPanel?.duration ?? DEFAULT_DURATIONS_SEC.clock * 1000;
    };

    // Función para avanzar al siguiente panel
    const advanceToNextPanel = () => {
      setCurrentPanelIndex((prevIndex) => {
        const currentPanels = availablePanelsRef.current;
        if (!currentPanels || currentPanels.length === 0) {
          return 0;
        }
        const nextIndex = (prevIndex + 1) % currentPanels.length;
        if (IS_DEV) {
          console.log(`[OverlayRotator] Rotando de panel ${prevIndex} a ${nextIndex} (${currentPanels[nextIndex]?.id})`);
        }
        return nextIndex;
      });
    };

    // Programar el siguiente cambio usando duración del panel actual
    const scheduleNext = () => {
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
  }, [rotationConfig.enabled, rotationConfig.durations_sec, availablePanels.length, availablePanelIds, currentPanelIndex]);

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

  if (!currentPanel) {
    return (
      <section className="overlay-rotator" role="complementary" aria-live="polite">
        <div className="overlay-rotator__content">
          <div className="overlay-rotator__fallback" role="status">
            <p>Datos no disponibles</p>
          </div>
          <p className="overlay-rotator__status">{statusLabel}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overlay-rotator" role="complementary" aria-live="polite">
      <div className="overlay-rotator__content">
        <RotatingCard cards={[currentPanel]} />
        <p className="overlay-rotator__status">{statusLabel}</p>
      </div>
    </section>
  );
};

export default OverlayRotator;