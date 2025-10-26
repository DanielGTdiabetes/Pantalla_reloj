import React, { useEffect, useMemo, useState } from "react";

import { GeoScopeMap } from "../components/GeoScopeMap";
import { OverlayRotator } from "../components/OverlayRotator";
import { TimeCard } from "../components/dashboard/cards/TimeCard";
import { WeatherCard } from "../components/dashboard/cards/WeatherCard";
import { CalendarCard } from "../components/dashboard/cards/CalendarCard";
import { MoonCard } from "../components/dashboard/cards/MoonCard";
import { HarvestCard } from "../components/dashboard/cards/HarvestCard";
import { SaintsCard } from "../components/dashboard/cards/SaintsCard";
import { NewsCard } from "../components/dashboard/cards/NewsCard";
import { EphemeridesCard } from "../components/dashboard/cards/EphemeridesCard";
import { useConfig } from "../context/ConfigContext";
import { api } from "../services/api";
import { ensurePlainText, sanitizeRichText } from "../utils/sanitize";
import { dayjs } from "../utils/dayjs";
import type { RotatingCardItem } from "../components/RotatingCard";

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
      .map((entry) => (typeof entry === "string" ? entry : sanitizeRichText(entry)))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
};

export default function Index(): JSX.Element {
  const { config, loading } = useConfig();
  const [payload, setPayload] = useState<DashboardPayload>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchAll = async () => {
      try {
        const [weather, news, astronomy, calendar] = await Promise.all([
          api.fetchWeather().catch(() => ({})),
          api.fetchNews().catch(() => ({})),
          api.fetchAstronomy().catch(() => ({})),
          api.fetchCalendar().catch(() => ({}))
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

  const targetUnit = config.ui.fixed.temperature.unit || "C";
  const rawTemperature = typeof weather.temperature === "number" ? weather.temperature : null;
  const rawUnit = ensurePlainText(weather.unit) || "C";
  const temperature = formatTemperature(rawTemperature, rawUnit, targetUnit);

  const feelsLikeValue =
    typeof weather.feels_like === "number"
      ? formatTemperature(weather.feels_like as number, rawUnit, targetUnit)
      : null;

  const humidity = typeof weather.humidity === "number" ? (weather.humidity as number) : null;
  const wind = typeof weather.wind_speed === "number"
    ? (weather.wind_speed as number)
    : typeof weather.wind === "number"
      ? (weather.wind as number)
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

  const ephemeridesEvents = safeArray(astronomy.events)
    .map((entry) => sanitizeRichText(entry?.description ?? entry?.title ?? ""))
    .filter((value): value is string => Boolean(value));

  const newsItems = safeArray(news.items).map((item) => ({
    title: sanitizeRichText(item.title) || "Titular", 
    summary: sanitizeRichText(item.summary) || sanitizeRichText(item.description) || undefined,
    source: sanitizeRichText(item.source) || undefined
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
    const fromNamedays = extractStrings(calendar.namedays);
    return [...fromSaints, ...fromNamedays];
  }, [calendar.saints, calendar.namedays]);

  const rotatingCards = useMemo<RotatingCardItem[]>(
    () => [
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
      },
      {
        id: "calendar",
        duration: 10000,
        render: () => <CalendarCard events={calendarEvents} timezone={config.display.timezone} />
      },
      {
        id: "moon",
        duration: 10000,
        render: () => <MoonCard moonPhase={moonPhase} illumination={moonIllumination} />
      },
      {
        id: "harvest",
        duration: 12000,
        render: () => <HarvestCard items={harvestItems} />
      },
      {
        id: "saints",
        duration: 12000,
        render: () => <SaintsCard saints={saintsEntries} />
      },
      {
        id: "news",
        duration: 20000,
        render: () => <NewsCard items={newsItems} />
      },
      {
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
      }
    ], [
      calendarEvents,
      condition,
      config.display.timezone,
      ephemeridesEvents,
      feelsLikeValue,
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

  const lastUpdatedLabel = lastUpdatedAt
    ? dayjs(lastUpdatedAt).tz(config.display.timezone).format("HH:mm:ss")
    : null;

  const overlayStatus = lastUpdatedLabel ? `Actualizado ${lastUpdatedLabel}` : "datos no disponibles";

  return (
    <div className="app-shell" aria-busy={loading}>
      <div className="app-shell__map" aria-label="Mapa global">
        <GeoScopeMap />
      </div>
      <aside className="app-shell__aside" aria-label="Información rotatoria">
        <OverlayRotator cards={rotatingCards} status={overlayStatus} isLoading={loading && !lastUpdatedAt} />
      </aside>
    </div>
  );
}
