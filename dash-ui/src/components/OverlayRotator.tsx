import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import { apiGet, apiPost } from "../lib/api";
import { useConfig } from "../lib/useConfig";
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
};

const REFRESH_INTERVAL_MS = 60_000;

// IDs de paneles soportados, en orden de fallback
const SUPPORTED_PANEL_IDS = ["time", "forecast", "calendar", "news", "moon", "ephemerides", "harvest"] as const;
const DEFAULT_FALLBACK_PANEL = "time";

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
  
  const timezone = useMemo(() => {
    const tz = safeGetTimezone(config as Record<string, unknown>);
    return tz;
  }, [config]);

  // Leer configuración de rotación
  const rotationConfig = useMemo(() => {
    const uiConfig = config.ui || (config as unknown as { ui?: { rotation?: { enabled?: boolean; duration_sec?: number; panels?: string[] } } }).ui;
    const rotation = uiConfig?.rotation || {};
    const panels = Array.isArray(rotation.panels) && rotation.panels.length > 0
      ? rotation.panels.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    
    return {
      enabled: rotation.enabled ?? false,
      duration_sec: Math.max(3, Math.min(3600, rotation.duration_sec ?? 10)),
      panels
    };
  }, [config]);

  // Estado para el índice actual del panel rotativo
  const [currentPanelIndex, setCurrentPanelIndex] = useState(0);
  const rotationTimerRef = useRef<number | null>(null);
  const availablePanelsRef = useRef<RotatingCardItem[]>([]);

  // Fetch de datos (sin cambios)
  useEffect(() => {
    let mounted = true;

    const fetchAll = async () => {
      try {
        const [weather, news, astronomy, calendar] = await Promise.all([
          (async () => {
            try {
              const v2Config = config as unknown as { panels?: { weather?: { latitude?: number; longitude?: number } } };
              const lat = v2Config.panels?.weather?.latitude ?? 39.98;
              const lon = v2Config.panels?.weather?.longitude ?? 0.20;
              return await apiGet<Record<string, unknown>>(`/api/weather/weekly?lat=${lat}&lon=${lon}`);
            } catch {
              return {};
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
          apiGet<Record<string, unknown>>("/api/astronomy").catch(() => ({})),
          (async () => {
            try {
              const fromDate = new Date().toISOString();
              const toDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
              const events = await apiGet<Array<Record<string, unknown>>>(`/api/calendar/events?from_date=${fromDate}&to_date=${toDate}`);
              return { events };
            } catch {
              return { events: [] };
            }
          })()
        ]);

        if (mounted) {
          setPayload({ weather, news, astronomy, calendar });
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

  // Crear mapa de todos los paneles disponibles
  const allPanelsMap = useMemo<Map<string, RotatingCardItem>>(() => {
    const map = new Map<string, RotatingCardItem>();
    
    map.set("time", {
      id: "time",
      duration: rotationConfig.duration_sec * 1000,
      render: () => <TimeCard timezone={timezone} />
    });
    
    map.set("weather", {
      id: "weather",
      duration: rotationConfig.duration_sec * 1000,
      render: () => (
        <WeatherCard
          temperatureLabel={`${temperature.value}${temperature.unit}`}
          feelsLikeLabel={feelsLikeValue ? `${feelsLikeValue.value}${feelsLikeValue.unit}` : null}
          condition={condition}
          humidity={humidity}
          wind={wind}
          unit={temperature.unit}
        />
      )
    });

    map.set("forecast", {
      id: "forecast",
      duration: rotationConfig.duration_sec * 1000,
      render: () => (
        <WeatherForecastCard
          forecast={forecastDays}
          unit={temperature.unit}
        />
      )
    });

    map.set("calendar", {
      id: "calendar",
      duration: rotationConfig.duration_sec * 1000,
      render: () => <CalendarCard events={calendarEvents} timezone={timezone} />
    });

    map.set("moon", {
      id: "moon",
      duration: rotationConfig.duration_sec * 1000,
      render: () => <MoonCard moonPhase={moonPhase} illumination={moonIllumination} />
    });

    map.set("harvest", {
      id: "harvest",
      duration: rotationConfig.duration_sec * 1000,
      render: () => <HarvestCard items={harvestItems} />
    });

    map.set("news", {
      id: "news",
      duration: rotationConfig.duration_sec * 1000,
      render: () => <NewsCard items={newsItems} />
    });

    map.set("ephemerides", {
      id: "ephemerides",
      duration: rotationConfig.duration_sec * 1000,
      render: () => (
        <EphemeridesCard
          sunrise={sunrise}
          sunset={sunset}
          moonPhase={moonPhase}
          events={ephemeridesEvents}
        />
      )
    });

    return map;
  }, [
    rotationConfig.duration_sec,
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
    ephemeridesEvents
  ]);

  // Filtrar y validar paneles según configuración y disponibilidad
  const availablePanels = useMemo<RotatingCardItem[]>(() => {
    const panelsToUse = rotationConfig.panels.length > 0 
      ? rotationConfig.panels 
      : (rotationConfig.enabled ? [] : [DEFAULT_FALLBACK_PANEL]);

    const validPanels: RotatingCardItem[] = [];
    
    for (const panelId of panelsToUse) {
      // Validar que el panel existe en el mapa
      const panel = allPanelsMap.get(panelId);
      if (!panel) {
        // En dev, log leve si el panel no está implementado
        if (import.meta.env.MODE === 'development') {
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
      } else if (import.meta.env.MODE === 'development') {
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
        if (import.meta.env.MODE === 'development') {
        console.log("[OverlayRotator] Timer limpiado (dependencias cambiaron)");
      }
    }

    // Si rotation está deshabilitado o lista vacía o solo hay un panel, no crear timer
    if (!rotationConfig.enabled || availablePanels.length <= 1) {
        if (import.meta.env.MODE === 'development') {
        console.log(`[OverlayRotator] Timer no iniciado: enabled=${rotationConfig.enabled}, panels=${availablePanels.length}`);
      }
      return;
    }

    // Crear un único setInterval para la rotación
    const intervalMs = rotationConfig.duration_sec * 1000;
    
    rotationTimerRef.current = window.setInterval(() => {
      setCurrentPanelIndex((prevIndex) => {
        const currentPanels = availablePanelsRef.current;
        if (!currentPanels || currentPanels.length === 0) {
          return 0;
        }
        const nextIndex = (prevIndex + 1) % currentPanels.length;
        if (import.meta.env.MODE === 'development') {
          console.log(`[OverlayRotator] Rotando de panel ${prevIndex} a ${nextIndex} (${currentPanels[nextIndex]?.id})`);
        }
        return nextIndex;
      });
    }, intervalMs);

        if (import.meta.env.MODE === 'development') {
      console.log(`[OverlayRotator] Timer iniciado: ${intervalMs}ms, ${availablePanels.length} paneles`);
    }

    // Cleanup: siempre limpiar el timer
    return () => {
      if (rotationTimerRef.current !== null) {
        window.clearInterval(rotationTimerRef.current);
        rotationTimerRef.current = null;
        if (import.meta.env.MODE === 'development') {
          console.log("[OverlayRotator] Timer limpiado (cleanup)");
        }
      }
    };
  }, [rotationConfig.enabled, rotationConfig.duration_sec, availablePanels.length, availablePanelIds]);

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