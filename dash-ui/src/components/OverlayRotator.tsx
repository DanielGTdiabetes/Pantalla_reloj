import React, { useEffect, useMemo, useState } from "react";

import { withConfigDefaults } from "../config/defaults";
import { apiGet } from "../lib/api";
import { isStaticMode } from "../lib/flags";
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

type TimeCardWrapperProps = React.ComponentProps<typeof TimeCard>;
const TimeCardWrapper: React.FC<TimeCardWrapperProps> = (props) => <TimeCard {...props} />;

type WeatherCardWrapperProps = React.ComponentProps<typeof WeatherCard>;
const WeatherCardWrapper: React.FC<WeatherCardWrapperProps> = (props) => <WeatherCard {...props} />;

type CalendarCardWrapperProps = React.ComponentProps<typeof CalendarCard>;
const CalendarCardWrapper: React.FC<CalendarCardWrapperProps> = (props) => <CalendarCard {...props} />;

type MoonCardWrapperProps = React.ComponentProps<typeof MoonCard>;
const MoonCardWrapper: React.FC<MoonCardWrapperProps> = (props) => <MoonCard {...props} />;

type HarvestCardWrapperProps = React.ComponentProps<typeof HarvestCard>;
const HarvestCardWrapper: React.FC<HarvestCardWrapperProps> = (props) => <HarvestCard {...props} />;

type SaintsCardWrapperProps = React.ComponentProps<typeof SaintsCard>;
const SaintsCardWrapper: React.FC<SaintsCardWrapperProps> = (props) => <SaintsCard {...props} />;

type NewsCardWrapperProps = React.ComponentProps<typeof NewsCard>;
const NewsCardWrapper: React.FC<NewsCardWrapperProps> = (props) => <NewsCard {...props} />;

type EphemeridesCardWrapperProps = React.ComponentProps<typeof EphemeridesCard>;
const EphemeridesCardWrapper: React.FC<EphemeridesCardWrapperProps> = (props) => (
  <EphemeridesCard {...props} />
);

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

export const OverlayRotator: React.FC = () => {
  const { data, loading } = useConfig();
  const config = useMemo(() => data ?? withConfigDefaults(), [data]);
  const [payload, setPayload] = useState<DashboardPayload>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const STATIC_MODE = isStaticMode();

  useEffect(() => {
    let mounted = true;

    if (STATIC_MODE) {
      const fetchStaticPayload = async () => {
        const [weather, astronomy] = await Promise.all([
          apiGet<Record<string, unknown>>("/api/weather").catch((error) => {
            console.error("Failed to load weather data", error);
            return {};
          }),
          apiGet<Record<string, unknown>>("/api/astronomy").catch((error) => {
            console.error("Failed to load astronomy data", error);
            return {};
          })
        ]);

        if (mounted) {
          setPayload({ weather, astronomy });
          setLastUpdatedAt(Date.now());
        }
      };

      void fetchStaticPayload();

      return () => {
        mounted = false;
      };
    }

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
  }, [STATIC_MODE]);

  const weather = (payload.weather ?? {}) as Record<string, unknown>;
  const astronomy = (payload.astronomy ?? {}) as Record<string, unknown>;
  const news = (payload.news ?? {}) as Record<string, unknown>;
  const calendar = (payload.calendar ?? {}) as Record<string, unknown>;

  const targetUnit = "C";
  const rawTemperature = typeof weather.temperature === "number" ? weather.temperature : null;
  const rawUnit = ensurePlainText(weather.unit) || "C";
  const temperature = useMemo(
    () => formatTemperature(rawTemperature, rawUnit, targetUnit),
    [rawTemperature, rawUnit, targetUnit]
  );

  const feelsLikeValue = useMemo(() => {
    if (typeof weather.feels_like === "number") {
      return formatTemperature(weather.feels_like as number, rawUnit, targetUnit);
    }
    return null;
  }, [rawUnit, targetUnit, weather.feels_like]);

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

  const ephemeridesEvents = useMemo(() => {
    return safeArray(astronomy.events)
      .map((entry) => sanitizeRichText(entry?.description ?? entry?.title ?? ""))
      .filter((value): value is string => Boolean(value));
  }, [astronomy.events]);

  const newsItems = useMemo(
    () =>
      safeArray(news.items).map((item) => ({
        title: sanitizeRichText(item.title) || "Titular",
        summary: sanitizeRichText(item.summary) || sanitizeRichText(item.description) || undefined,
        source: sanitizeRichText(item.source) || undefined
      })),
    [news.items]
  );

  const calendarEvents = useMemo(
    () =>
      safeArray(calendar.upcoming).map((event) => ({
        title: sanitizeRichText(event.title) || "Evento",
        start: ensurePlainText(event.start) || ensurePlainText(event.when) || null
      })),
    [calendar.upcoming]
  );

  const harvestItems = useMemo(
    () =>
      safeArray(calendar.harvest).map((item) => ({
        name: sanitizeRichText(item.name) || sanitizeRichText(item.crop) || "Actividad",
        status: sanitizeRichText(item.status) || sanitizeRichText(item.detail) || null
      })),
    [calendar.harvest]
  );

  const saintsEntries = useMemo(() => {
    const fromSaints = extractStrings(calendar.saints);
    const fromNamedays = extractStrings(calendar.namedays);
    return [...fromSaints, ...fromNamedays];
  }, [calendar.namedays, calendar.saints]);

  const payloadKey = useMemo(() => {
    const joinRecords = (items: Array<Record<string, unknown>>) =>
      items
        .map((item) =>
          Object.entries(item)
            .map(([key, value]) => `${key}:${value ?? ""}`)
            .join(",")
        )
        .join("|");
    const joinStrings = (items: string[]) => items.join("|");

    const feelsLikeSignature = feelsLikeValue
      ? `${feelsLikeValue.value}${feelsLikeValue.unit}`
      : "";

    return [
      config.display.timezone,
      `${temperature.value}${temperature.unit}`,
      feelsLikeSignature,
      condition ?? "",
      humidity ?? "",
      wind ?? "",
      sunrise ?? "",
      sunset ?? "",
      moonPhase ?? "",
      moonIllumination ?? "",
      joinRecords(calendarEvents as Array<Record<string, unknown>>),
      joinStrings(ephemeridesEvents),
      joinRecords(harvestItems as Array<Record<string, unknown>>),
      joinStrings(saintsEntries),
      joinRecords(newsItems as Array<Record<string, unknown>>)
    ].join("||");
  }, [
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
  ]);

  const rotatingCards = useMemo<RotatingCardItem[]>(() => {
    const weatherProps = {
      temperatureLabel: `${temperature.value}${temperature.unit}`,
      feelsLikeLabel: feelsLikeValue ? `${feelsLikeValue.value}${feelsLikeValue.unit}` : null,
      condition,
      humidity,
      wind,
      unit: temperature.unit
    };

    const cardOrder = (config?.ui?.rotation?.panels ?? [
      "time",
      "weather",
      "news",
      "moon",
      "ephemerides",
      "calendar",
      "harvest",
      "saints"
    ]) as string[];

    const available: Record<string, RotatingCardItem> = {
      time: {
        id: "time",
        duration: 8000,
        render: () => <TimeCardWrapper timezone={config.display.timezone} />
      },
      weather: {
        id: "weather",
        duration: 10000,
        render: () => <WeatherCardWrapper {...weatherProps} />
      },
      calendar: {
        id: "calendar",
        duration: 10000,
        render: () => (
          <CalendarCardWrapper events={calendarEvents} timezone={config.display.timezone} />
        )
      },
      moon: {
        id: "moon",
        duration: 10000,
        render: () => <MoonCardWrapper moonPhase={moonPhase} illumination={moonIllumination} />
      },
      harvest: {
        id: "harvest",
        duration: 12000,
        render: () => <HarvestCardWrapper items={harvestItems} />
      },
      saints: {
        id: "saints",
        duration: 12000,
        render: () => <SaintsCardWrapper saints={saintsEntries} />
      },
      news: {
        id: "news",
        duration: 20000,
        render: () => <NewsCardWrapper items={newsItems} />
      },
      ephemerides: {
        id: "ephemerides",
        duration: 20000,
        render: () => (
          <EphemeridesCardWrapper
            sunrise={sunrise}
            sunset={sunset}
            moonPhase={moonPhase}
            events={ephemeridesEvents}
          />
        )
      }
    };

    const list = cardOrder.map((key) => available[key]).filter(Boolean) as RotatingCardItem[];
    return list.length > 0 ? list : [available.time];
  }, [
    calendarEvents,
    config?.ui?.rotation?.panels,
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
    wind,
    payloadKey
  ]);

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

  if (STATIC_MODE) {
    const now = dayjs().tz(config.display.timezone);
    const timeLabel = now.format("HH:mm");
    const dateLabel = now.format("dddd, D MMMM");
    const weatherLineParts: string[] = [];

    if (temperature.value !== "--") {
      weatherLineParts.push(`${temperature.value}${temperature.unit}`);
    }

    if (condition) {
      weatherLineParts.push(condition);
    }

    const weatherLine = weatherLineParts.join(" · ");

    return (
      <section className="overlay-rotator" role="complementary" aria-live="polite">
        <div className="overlay-rotator__content overlay-rotator__content--static">
          <p className="overlay-rotator__time" aria-label="Hora actual">
            {timeLabel}
          </p>
          <p className="overlay-rotator__date" aria-label="Fecha actual">
            {dateLabel}
          </p>
          {weatherLine ? (
            <p className="overlay-rotator__weather" aria-label="Condición meteorológica">
              {weatherLine}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

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
