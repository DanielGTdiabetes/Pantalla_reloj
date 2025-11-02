import React, { useEffect, useMemo, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import { apiGet } from "../lib/api";
import { useConfig } from "../lib/useConfig";
import { dayjs } from "../utils/dayjs";
import { ensurePlainText, sanitizeRichText } from "../utils/sanitize";
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
        // Si es string, devolver directamente
        if (typeof entry === "string") {
          return entry.trim();
        }
        // Si es objeto, intentar extraer campos comunes
        if (entry && typeof entry === "object") {
          const obj = entry as Record<string, unknown>;
          // Prioridad: name > title > description > text
          const name = typeof obj.name === "string" ? obj.name
            : typeof obj.title === "string" ? obj.title
            : typeof obj.description === "string" ? obj.description
            : typeof obj.text === "string" ? obj.text
            : null;
          if (name) {
            return ensurePlainText(name);
          }
          // Si no hay campo name, intentar convertir el objeto completo a string
          return ensurePlainText(String(entry));
        }
        // Para otros tipos, convertir a string
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

  useEffect(() => {
    let mounted = true;

    const fetchAll = async () => {
      try {
        const [weather, news, astronomy, calendar] = await Promise.all([
          apiGet<Record<string, unknown>>("/api/weather").catch(() => ({})),
          apiGet<Record<string, unknown>>("/api/news").catch(() => ({})),
          apiGet<Record<string, unknown>>("/api/astronomy").catch(() => ({})),
          apiGet<Record<string, unknown>>("/api/calendar").catch(() => ({}))
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
  }, []);

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

  // Extraer humedad con múltiples campos alternativos
  const humidity = typeof weather.humidity === "number" ? (weather.humidity as number)
    : typeof weather.relative_humidity === "number" ? (weather.relative_humidity as number)
    : typeof weather.hum === "number" ? (weather.hum as number)
    : null;
  // Extraer viento con múltiples campos alternativos
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
    source: sanitizeRichText(item.source || item.author || item.feed) || undefined
  }));

  const calendarEvents = safeArray(calendar.upcoming).map((event) => ({
    title: sanitizeRichText(event.title) || "Evento",
    start: ensurePlainText(event.start) || ensurePlainText(event.when) || null
  }));

  const harvestItems = safeArray(calendar.harvest).map((item) => ({
    name: sanitizeRichText(item.name) || sanitizeRichText(item.crop) || "Actividad",
    status: sanitizeRichText(item.status) || sanitizeRichText(item.detail) || null
  }));

  const saintsEntries = useMemo(() => {
    const fromSaints = extractStrings(calendar.saints);
    // Solo incluir onomásticos si está habilitado en config
    const includeNamedays = config.saints?.include_namedays !== false;
    const fromNamedays = includeNamedays ? extractStrings(calendar.namedays) : [];
    // Combinar y eliminar duplicados (case-insensitive)
    const combined = [...fromSaints, ...fromNamedays];
    const unique = combined.filter((entry, index, self) => {
      const normalized = entry.toLowerCase().trim();
      return self.findIndex((e) => e.toLowerCase().trim() === normalized) === index;
    });
    return unique;
  }, [calendar.saints, calendar.namedays, config.saints?.include_namedays]);

  const forecastDays = useMemo(() => {
    const forecastData = weather.forecast || weather.daily || weather.weekly || [];
    if (!Array.isArray(forecastData)) {
      return [];
    }
    return forecastData.slice(0, 7).map((day: Record<string, unknown>) => {
      const date = ensurePlainText(day.date || day.dt || day.time);
      const dayName = ensurePlainText(day.dayName || day.day_name || day.name);
      const condition = sanitizeRichText(day.condition || day.weather || day.summary || day.description);
      
      // Extraer temperatura mínima
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
      
      // Extraer temperatura máxima
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

  const rotatingCards = useMemo<RotatingCardItem[]>(
    () => {
      const cards: RotatingCardItem[] = [
        {
          id: "time",
          duration: 8000,
          render: () => <TimeCard timezone={config.display.timezone} />
        },
        {
          id: "weather",
          duration: 10000,
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
        }
      ];

      // Calendar card - solo si está habilitado
      if (config.calendar?.enabled) {
        cards.push({
          id: "calendar",
          duration: 10000,
          render: () => <CalendarCard events={calendarEvents} timezone={config.display.timezone} />
        });
      }

      // Moon card - solo si efemérides está habilitado
      if (config.ephemerides?.enabled !== false) {
        cards.push({
          id: "moon",
          duration: 10000,
          render: () => <MoonCard moonPhase={moonPhase} illumination={moonIllumination} />
        });
      }

      // Harvest card - solo si está habilitado y hay items
      if (config.harvest?.enabled !== false && harvestItems.length > 0) {
        cards.push({
          id: "harvest",
          duration: 12000,
          render: () => <HarvestCard items={harvestItems} />
        });
      }

      // Saints card - solo si está habilitado y hay entradas
      if (config.saints?.enabled !== false && saintsEntries.length > 0) {
        cards.push({
          id: "saints",
          duration: 12000,
          render: () => <SaintsCard saints={saintsEntries} />
        });
      }

      // News card - solo si está habilitado y hay items
      if (config.news?.enabled !== false && newsItems.length > 0) {
        cards.push({
          id: "news",
          duration: 20000,
          render: () => <NewsCard items={newsItems} />
        });
      }

      // Ephemerides card - solo si está habilitado y hay datos
      if (config.ephemerides?.enabled !== false && (sunrise || sunset || moonPhase || ephemeridesEvents.length > 0)) {
        cards.push({
          id: "ephemerides",
          duration: 20000,
          render: () => (
            <EphemeridesCard
              sunrise={sunrise}
              sunset={sunset}
              moonPhase={moonPhase}
              events={ephemeridesEvents}
            />
          )
        });
      }

      // Weather Forecast card - si hay datos de pronóstico
      if (forecastDays.length > 0) {
        cards.push({
          id: "weather-forecast",
          duration: 20000,
          render: () => (
            <WeatherForecastCard
              forecast={forecastDays}
              unit={temperature.unit}
            />
          )
        });
      }

      return cards;
    }, [
      calendarEvents,
      condition,
      config.display.timezone,
      config.calendar?.enabled,
      config.ephemerides?.enabled,
      config.harvest?.enabled,
      config.saints?.enabled,
      config.news?.enabled,
      ephemeridesEvents,
      feelsLikeValue,
      forecastDays,
      harvestItems,
      humidity,
      moonIllumination,
      moonPhase,
      newsItems,
      saintsEntries,
      sunrise,
      sunset,
      temperature.unit,
      temperature.value,
      wind
    ]
  );

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) {
      return null;
    }
    return dayjs(lastUpdatedAt).tz(config.display.timezone).format("HH:mm:ss");
  }, [config.display.timezone, lastUpdatedAt]);

  const statusLabel = useMemo(() => {
    if (loading && !lastUpdatedAt) {
      return "Sincronizando datos…";
    }
    if (lastUpdatedLabel) {
      return `Actualizado ${lastUpdatedLabel}`;
    }
    return "Datos no disponibles";
  }, [lastUpdatedAt, lastUpdatedLabel, loading]);

  const hasCards = rotatingCards.length > 0;

  return (
    <section className="overlay-rotator" role="complementary" aria-live="polite">
      <div className="overlay-rotator__content">
        {hasCards ? (
          <RotatingCard cards={rotatingCards} />
        ) : (
          <div className="overlay-rotator__fallback" role="status">
            <p>Datos no disponibles</p>
          </div>
        )}
        <p className="overlay-rotator__status">{statusLabel}</p>
      </div>
    </section>
  );
};

export default OverlayRotator;
