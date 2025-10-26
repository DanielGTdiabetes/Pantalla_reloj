import React, { useEffect, useMemo, useState } from "react";

import { UI_DEFAULTS } from "../config/defaults";
import { WorldMap } from "../components/WorldMap";
import { RotatingCard, type RotatingCardItem } from "../components/RotatingCard";
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

type DashboardPayload = {
  weather?: Record<string, unknown>;
  news?: Record<string, unknown>;
  astronomy?: Record<string, unknown>;
  calendar?: Record<string, unknown>;
};

const REFRESH_INTERVAL_MS = 60_000;
const FALLBACK_PANEL_ORDER = [
  "time",
  "weather",
  "calendar",
  "moon",
  "harvest",
  "saints",
  "news",
  "ephemerides"
];
const SUPPORTED_PANELS = new Set(FALLBACK_PANEL_ORDER);
const PANEL_ALIAS_MAP: Record<string, string> = {
  clock: "time",
  time: "time",
  weather: "weather",
  forecast: "weather",
  calendar: "calendar",
  events: "calendar",
  moon: "moon",
  harvest: "harvest",
  saints: "saints",
  news: "news",
  ephemerides: "ephemerides"
};
const MODULE_ALIASES: Record<string, string[]> = {
  time: ["time", "clock"],
  weather: ["weather", "forecast"],
  calendar: ["calendar", "events"],
  moon: ["moon"],
  harvest: ["harvest"],
  saints: ["saints"],
  news: ["news"],
  ephemerides: ["ephemerides"]
};

const normalizePanelId = (panel: string | null | undefined): string | null => {
  if (!panel) {
    return null;
  }
  const normalized = panel.trim().toLowerCase();
  const canonical = PANEL_ALIAS_MAP[normalized] ?? normalized;
  return SUPPORTED_PANELS.has(canonical) ? canonical : null;
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
      .map((entry) => (typeof entry === "string" ? entry : sanitizeRichText(entry)))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
};

export const DashboardPage: React.FC = () => {
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

  const targetUnit = config.ui.fixed.temperature.unit ?? UI_DEFAULTS.fixed.temperature.unit;
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
  const location = ensurePlainText(weather.location) || "Ubicación desconocida";

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

  const rotationSettings = config.ui.rotation ?? UI_DEFAULTS.rotation;
  const moduleSettings = Array.isArray(config.display.modules) ? config.display.modules : [];

  const panelOrder = useMemo(() => {
    const rawPanels = rotationSettings.panels?.length
      ? rotationSettings.panels
      : moduleSettings.map((module) => module.name);

    const normalizedPanels = rawPanels
      .map((panel) => normalizePanelId(panel))
      .filter((panel): panel is string => Boolean(panel));

    const seen = new Set<string>();
    const ordered = normalizedPanels.filter((panel) => {
      if (seen.has(panel)) {
        return false;
      }
      seen.add(panel);
      return true;
    });

    if (ordered.length > 0) {
      return ordered;
    }

    return FALLBACK_PANEL_ORDER;
  }, [moduleSettings, rotationSettings.panels]);

  const baseDurationMs = Math.max(
    rotationSettings.duration_sec ?? UI_DEFAULTS.rotation.duration_sec,
    3
  ) * 1000;

  const mapboxToken = (config.ui.mapbox_token ?? "").trim() || null;

  const rotatingCards = useMemo<RotatingCardItem[]>(() => {
    const modulesMap = new Map<string, (typeof moduleSettings)[number]>();
    moduleSettings.forEach((module) => {
      modulesMap.set(module.name, module);
    });

    const resolveModule = (panelId: string) => {
      const aliases = MODULE_ALIASES[panelId] ?? [panelId];
      for (const alias of aliases) {
        const moduleConfig = modulesMap.get(alias);
        if (moduleConfig) {
          return moduleConfig;
        }
      }
      return null;
    };

    const createCard = (
      panelId: (typeof FALLBACK_PANEL_ORDER)[number],
      render: () => JSX.Element
    ): RotatingCardItem | null => {
      const moduleConfig = resolveModule(panelId);
      if (moduleConfig && moduleConfig.enabled === false) {
        return null;
      }

      const duration =
        moduleConfig && Number.isFinite(moduleConfig.duration_seconds) && moduleConfig.duration_seconds > 0
          ? moduleConfig.duration_seconds * 1000
          : baseDurationMs;

      return {
        id: panelId,
        duration,
        render
      };
    };

    const availableCards: Record<string, RotatingCardItem | null> = {
      time: createCard("time", () => <TimeCard timezone={config.display.timezone} />),
      weather: createCard("weather", () => (
        <WeatherCard
          temperatureLabel={`${temperature.value}${temperature.unit}`}
          feelsLikeLabel={feelsLikeValue ? `${feelsLikeValue.value}${feelsLikeValue.unit}` : null}
          condition={condition}
          humidity={humidity}
          wind={wind}
          unit={temperature.unit}
        />
      )),
      calendar: createCard("calendar", () => (
        <CalendarCard events={calendarEvents} timezone={config.display.timezone} />
      )),
      moon: createCard("moon", () => (
        <MoonCard moonPhase={moonPhase} illumination={moonIllumination} />
      )),
      harvest: createCard("harvest", () => <HarvestCard items={harvestItems} />),
      saints: createCard("saints", () => <SaintsCard saints={saintsEntries} />),
      news: createCard("news", () => <NewsCard items={newsItems} />),
      ephemerides: createCard("ephemerides", () => (
        <EphemeridesCard
          sunrise={sunrise}
          sunset={sunset}
          moonPhase={moonPhase}
          events={ephemeridesEvents}
        />
      ))
    };

    const cards = panelOrder
      .map((panelId) => availableCards[panelId] ?? null)
      .filter((card): card is RotatingCardItem => Boolean(card));

    if (cards.length > 0) {
      return cards;
    }

    return FALLBACK_PANEL_ORDER.map((panelId) => availableCards[panelId] ?? null).filter(
      (card): card is RotatingCardItem => Boolean(card)
    );
  }, [
    baseDurationMs,
    calendarEvents,
    condition,
    config.display.timezone,
    ephemeridesEvents,
    feelsLikeValue,
    harvestItems,
    humidity,
    moduleSettings,
    moonIllumination,
    moonPhase,
    newsItems,
    panelOrder,
    saintsEntries,
    sunrise,
    sunset,
    temperature.unit,
    temperature.value,
    wind
  ]);

  const mapChips = [
    {
      id: "weather",
      label: location,
      value: `${temperature.value}${temperature.unit}`,
      hint: condition ?? ""
    },
    {
      id: "sun",
      label: "Amanecer",
      value: sunrise ?? "--:--",
      hint: sunset ? `Atardecer ${sunset}` : ""
    },
    {
      id: "moon",
      label: "Fase lunar",
      value: moonPhase ?? "Sin datos",
      hint: moonIllumination !== null ? `${Math.round(moonIllumination)}% iluminación` : ""
    }
  ];

  const lastUpdatedLabel = lastUpdatedAt
    ? dayjs(lastUpdatedAt).tz(config.display.timezone).format("HH:mm:ss")
    : null;

  return (
    <main className="dashboard-alt" aria-busy={loading}>
      <section className="dashboard-alt__map" aria-label="Mapa global">
        <WorldMap token={mapboxToken} />
        <div className="dashboard-alt__map-header">
          <div className="map-chip map-chip--title">
            <span className="map-chip__label">Pantalla reloj</span>
            <span className="map-chip__value">{location}</span>
            <span className="map-chip__hint">Zona horaria: {config.display.timezone}</span>
          </div>
          <div className="dashboard-alt__chips">
            {mapChips.map((chip) => (
              <article key={chip.id} className="map-chip">
                <span className="map-chip__label">{chip.label}</span>
                <span className="map-chip__value">{chip.value}</span>
                {chip.hint ? <span className="map-chip__hint">{chip.hint}</span> : null}
              </article>
            ))}
          </div>
        </div>
        <div className="dashboard-alt__map-footer">
          <span>{lastUpdatedLabel ? `Actualizado ${lastUpdatedLabel}` : "Sincronizando datos…"}</span>
          {!mapboxToken ? <span>Configura tu token de Mapbox en /config</span> : null}
        </div>
      </section>

      <aside className="dashboard-alt__sidebar" aria-label="Panel de información">
        <RotatingCard cards={rotatingCards} rotationEnabled={rotationSettings.enabled !== false} />
        <div className="dashboard-alt__sidebar-footer">
          <span>Paneles activos: {rotatingCards.length}</span>
          <span>{lastUpdatedLabel ? `Última actualización ${lastUpdatedLabel}` : "Esperando datos…"}</span>
        </div>
      </aside>
    </main>
  );
};

export default DashboardPage;
