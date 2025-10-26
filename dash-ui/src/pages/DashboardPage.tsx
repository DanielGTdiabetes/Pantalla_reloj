import React, { useEffect, useMemo, useState } from "react";

import { ClockDisplay } from "../components/ClockDisplay";
import { RotatingCard, type RotatingPanel } from "../components/RotatingCard";
import { WorldMap } from "../components/WorldMap";
import { UI_DEFAULTS } from "../config/defaults";
import { useConfig } from "../context/ConfigContext";
import { api } from "../services/api";
import type { UIScrollSettings } from "../types/config";
import { ensurePlainText, sanitizeRichText } from "../utils/sanitize";

import dayjs from "dayjs";
import "dayjs/locale/es";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("es");

type DashboardPayload = {
  weather?: Record<string, unknown>;
  news?: Record<string, unknown>;
  astronomy?: Record<string, unknown>;
  calendar?: Record<string, unknown>;
};

const REFRESH_INTERVAL_MS = 60_000;

const normalizeScroll = (
  scroll: Record<string, UIScrollSettings>,
  panel: string,
  fallback: UIScrollSettings
): UIScrollSettings => {
  const settings = scroll[panel];
  if (!settings) {
    return fallback;
  }
  return {
    enabled: settings.enabled ?? fallback.enabled,
    direction: (settings.direction as "left" | "up") ?? fallback.direction,
    speed: settings.speed ?? fallback.speed,
    gap_px: typeof settings.gap_px === "number" ? settings.gap_px : fallback.gap_px
  };
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

const joinWithBreaks = (lines: string[], double = false): string => {
  return lines.filter(Boolean).join(double ? "<br /><br />" : "<br />");
};

export const DashboardPage: React.FC = () => {
  const { config, loading } = useConfig();
  const [payload, setPayload] = useState<DashboardPayload>({});

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

  const rawTemperature = typeof weather.temperature === "number" ? weather.temperature : null;
  const rawUnit = ensurePlainText(weather.unit);
  const targetUnit = config.ui.fixed.temperature.unit ?? UI_DEFAULTS.fixed.temperature.unit;
  const location = ensurePlainText(weather.location) || "Ubicación desconocida";
  const condition = ensurePlainText(weather.condition) || "Sin datos";

  const { value: temperatureValue, unit: temperatureUnit } = formatTemperature(
    rawTemperature,
    rawUnit || "C",
    targetUnit
  );

  const scrollSettings = config.ui.text?.scroll ?? UI_DEFAULTS.text.scroll;

  const newsScroll = normalizeScroll(scrollSettings, "news", UI_DEFAULTS.text.scroll.news);
  const ephemeridesScroll = normalizeScroll(
    scrollSettings,
    "ephemerides",
    UI_DEFAULTS.text.scroll.ephemerides
  );
  const forecastScroll = normalizeScroll(scrollSettings, "forecast", UI_DEFAULTS.text.scroll.forecast);

  const rotationSettings = config.ui.rotation ?? UI_DEFAULTS.rotation;

  const panels = useMemo<RotatingPanel[]>(() => {
    const selectedPanels = rotationSettings.panels?.length
      ? rotationSettings.panels
      : UI_DEFAULTS.rotation.panels;

    const buildNewsPanel = (): RotatingPanel => {
      const items = Array.isArray(news.items) ? (news.items as Record<string, unknown>[]) : [];
      if (items.length === 0) {
        return {
          id: "news",
          title: "Noticias",
          content: "Sin titulares disponibles",
          direction: newsScroll.direction,
          enableScroll: newsScroll.enabled,
          speed: newsScroll.speed,
          gap: newsScroll.gap_px
        };
      }
      const segments = items
        .map((item) => {
          const title = sanitizeRichText(item?.title);
          const source = sanitizeRichText(item?.source);
          if (title && source) {
            return `${title} — ${source}`;
          }
          return title || source;
        })
        .filter(Boolean);
      return {
        id: "news",
        title: "Noticias",
        content: segments.length > 0 ? segments.join(" • ") : "Sin titulares disponibles",
        direction: newsScroll.direction,
        enableScroll: newsScroll.enabled,
        speed: newsScroll.speed,
        gap: newsScroll.gap_px
      };
    };

    const buildEphemeridesPanel = (): RotatingPanel => {
      const sunrise = sanitizeRichText(astronomy.sunrise);
      const sunset = sanitizeRichText(astronomy.sunset);
      const moonPhase = sanitizeRichText(astronomy.moon_phase);
      const lines = [
        sunrise ? `Amanecer: ${sunrise}` : "",
        sunset ? `Anochecer: ${sunset}` : "",
        moonPhase ? `Fase lunar: ${moonPhase}` : ""
      ].filter(Boolean);
      return {
        id: "ephemerides",
        title: "Efemérides",
        content: lines.length > 0 ? joinWithBreaks(lines, true) : "Sin efemérides disponibles",
        direction: ephemeridesScroll.direction,
        enableScroll: ephemeridesScroll.enabled,
        speed: ephemeridesScroll.speed,
        gap: ephemeridesScroll.gap_px
      };
    };

    const buildMoonPanel = (): RotatingPanel => {
      const moonPhase = sanitizeRichText(astronomy.moon_phase) || "Sin datos";
      return {
        id: "moon",
        title: "Fase lunar",
        content: moonPhase,
        direction: ephemeridesScroll.direction,
        enableScroll: ephemeridesScroll.enabled,
        speed: ephemeridesScroll.speed,
        gap: ephemeridesScroll.gap_px
      };
    };

    const buildForecastPanel = (): RotatingPanel => {
      const forecastItems = Array.isArray(weather.forecast)
        ? (weather.forecast as Record<string, unknown>[])
        : [];
      if (forecastItems.length === 0) {
        const summary = sanitizeRichText(weather.summary) || sanitizeRichText(weather.condition);
        const fallback = summary || "Sin previsión disponible";
        return {
          id: "forecast",
          title: "Pronóstico",
          content: fallback,
          direction: forecastScroll.direction,
          enableScroll: forecastScroll.enabled,
          speed: forecastScroll.speed,
          gap: forecastScroll.gap_px
        };
      }
      const lines = forecastItems
        .map((entry) => {
          const label = sanitizeRichText(entry.period ?? entry.label ?? "");
          const detail = sanitizeRichText(entry.summary ?? entry.condition ?? "");
          if (label && detail) {
            return `${label}: ${detail}`;
          }
          return label || detail;
        })
        .filter(Boolean);
      return {
        id: "forecast",
        title: "Pronóstico",
        content: lines.length > 0 ? joinWithBreaks(lines, true) : "Sin previsión disponible",
        direction: forecastScroll.direction,
        enableScroll: forecastScroll.enabled,
        speed: forecastScroll.speed,
        gap: forecastScroll.gap_px
      };
    };

    const buildCalendarPanel = (): RotatingPanel => {
      const entries = Array.isArray(calendar.upcoming)
        ? (calendar.upcoming as Record<string, unknown>[])
        : [];
      if (entries.length === 0) {
        return {
          id: "calendar",
          title: "Agenda",
          content: "Sin eventos próximos",
          direction: ephemeridesScroll.direction,
          enableScroll: ephemeridesScroll.enabled,
          speed: ephemeridesScroll.speed,
          gap: ephemeridesScroll.gap_px
        };
      }
      const lines = entries.slice(0, 5).map((entry) => {
        const title = sanitizeRichText(entry.title);
        const start = ensurePlainText(entry.start);
        if (start) {
          const localized = dayjs(start).tz(config.display.timezone).format("ddd D MMM, HH:mm");
          return `${title || "Evento"} — ${localized}`;
        }
        return title || "Evento";
      });
      return {
        id: "calendar",
        title: "Agenda",
        content: lines.length > 0 ? joinWithBreaks(lines, true) : "Sin eventos próximos",
        direction: ephemeridesScroll.direction,
        enableScroll: ephemeridesScroll.enabled,
        speed: ephemeridesScroll.speed,
        gap: ephemeridesScroll.gap_px
      };
    };

    const builders: Record<string, () => RotatingPanel> = {
      news: buildNewsPanel,
      ephemerides: buildEphemeridesPanel,
      moon: buildMoonPanel,
      forecast: buildForecastPanel,
      calendar: buildCalendarPanel
    };

    return selectedPanels
      .map((panel) => builders[panel]?.())
      .filter((panel): panel is RotatingPanel => Boolean(panel));
  }, [
    astronomy,
    calendar,
    config.display.timezone,
    ephemeridesScroll.direction,
    ephemeridesScroll.enabled,
    ephemeridesScroll.gap_px,
    ephemeridesScroll.speed,
    forecastScroll.direction,
    forecastScroll.enabled,
    forecastScroll.gap_px,
    forecastScroll.speed,
    news,
    newsScroll.direction,
    newsScroll.enabled,
    newsScroll.gap_px,
    newsScroll.speed,
    rotationSettings.panels,
    weather
  ]);

  return (
    <div className="public-dashboard" aria-busy={loading}>
      <div className="public-dashboard__map">
        <WorldMap />
        <div className="public-dashboard__map-overlay">
          <span className="public-dashboard__map-location">{location}</span>
          <span className="public-dashboard__map-temp">
            {temperatureValue}
            {temperatureUnit}
          </span>
          <span className="public-dashboard__map-condition">{condition}</span>
        </div>
        <div className="public-dashboard__map-attribution">© OpenStreetMap contributors</div>
      </div>
      <div className="public-dashboard__info">
        <ClockDisplay timezone={config.display.timezone} format={config.ui.fixed.clock.format} />
        <div className="public-weather" aria-live="polite">
          <div className="public-weather__temp">
            {temperatureValue}
            {temperatureUnit}
          </div>
          <div className="public-weather__condition">{condition}</div>
          <div className="public-weather__meta">{location}</div>
        </div>
        <RotatingCard
          panels={panels}
          rotationEnabled={rotationSettings.enabled}
          durationSeconds={rotationSettings.duration_sec ?? UI_DEFAULTS.rotation.duration_sec}
        />
      </div>
    </div>
  );
};
