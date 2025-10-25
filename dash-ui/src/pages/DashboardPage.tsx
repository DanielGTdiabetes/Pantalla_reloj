import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ConfigForm } from "./ConfigPage";
import { UI_DEFAULTS } from "../config/defaults";
import { useConfig } from "../context/ConfigContext";
import { useModuleRotation } from "../hooks/useModuleRotation";
import { AstronomyModule } from "../modules/AstronomyModule";
import { CalendarModule } from "../modules/CalendarModule";
import { ClockModule } from "../modules/ClockModule";
import { EventsModule } from "../modules/EventsModule";
import { NewsModule } from "../modules/NewsModule";
import { WeatherModule } from "../modules/WeatherModule";
import { api } from "../services/api";
import type { AppConfig, DisplayModule } from "../types/config";

const MAP_EMBED_URL =
  "https://www.openstreetmap.org/export/embed.html?bbox=-3.7256%2C40.406%2C-3.681%2C40.43&layer=mapnik&marker=40.4168%2C-3.7038";

type DashboardData = Record<string, any>;

type FullDashboardProps = {
  config: AppConfig;
  data: DashboardData;
  stormMode: Record<string, any>;
};

const extractArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

const FullDashboard: React.FC<FullDashboardProps> = ({ config, data, stormMode }) => {
  const weatherData = data.weather ?? {};
  const astronomyData = data.astronomy ?? {};
  const calendarData = data.calendar ?? {};
  const newsData = data.news ?? {};

  const temperature = typeof weatherData.temperature === "number" ? weatherData.temperature : null;
  const temperatureUnit = typeof weatherData.unit === "string" ? weatherData.unit : "°C";
  const location = typeof weatherData.location === "string" ? weatherData.location : "Madrid";
  const condition = typeof weatherData.condition === "string" ? weatherData.condition : "Sin datos";

  const newsItems = extractArray(newsData.items);
  const topNews = newsItems[0] as { title?: string; source?: string } | undefined;

  const upcomingEvents = extractArray(calendarData.upcoming);
  const nextEvent = upcomingEvents[0] as { title?: string; start?: string } | undefined;

  const moonPhase = typeof astronomyData.moon_phase === "string" ? astronomyData.moon_phase : "Sin datos";
  const stormEnabled = Boolean(stormMode.enabled);

  return (
    <div className="full-dashboard">
      <section className="full-dashboard__map">
        <iframe src={MAP_EMBED_URL} title="Mapa en vivo" loading="lazy" referrerPolicy="no-referrer" />
        <div className="full-dashboard__map-overlay">
          <span className="full-dashboard__map-location">{location}</span>
          <span className="full-dashboard__map-temp">
            {temperature !== null ? `${temperature.toFixed(0)}${temperatureUnit}` : "--"}
          </span>
          <span className="full-dashboard__map-condition">{condition}</span>
        </div>
      </section>
      <section className="full-dashboard__cards">
        <div className="full-dashboard__card">
          <h3>Noticias destacadas</h3>
          <p>{topNews?.title ?? "Sin titulares"}</p>
          {topNews?.source && <small>{topNews.source}</small>}
        </div>
        <div className="full-dashboard__card">
          <h3>Próximo evento</h3>
          <p>{nextEvent?.title ?? "No hay eventos"}</p>
          {nextEvent?.start && <small>{nextEvent.start}</small>}
        </div>
        <div className="full-dashboard__card">
          <h3>Fase lunar</h3>
          <p>{moonPhase}</p>
        </div>
        <div className="full-dashboard__card">
          <h3>Modo tormenta</h3>
          <p style={{ color: stormEnabled ? "#ffb347" : "#74d99f" }}>
            {stormEnabled ? "Activo" : "Inactivo"}
          </p>
        </div>
        <div className="full-dashboard__card">
          <h3>Rotación configurada</h3>
          <p>{config.display.module_cycle_seconds}s</p>
        </div>
      </section>
    </div>
  );
};

const ModuleRenderer: React.FC<{
  module: DisplayModule;
  config: AppConfig;
  data: DashboardData;
}> = ({ module, config, data }) => {
  switch (module.name) {
    case "clock":
      return <ClockModule timezone={config.display.timezone} />;
    case "weather":
      return <WeatherModule data={data.weather ?? {}} />;
    case "moon":
    case "astronomy":
      return <AstronomyModule data={data.astronomy ?? {}} />;
    case "news":
      return <NewsModule data={data.news ?? {}} />;
    case "events":
      return <EventsModule data={data.calendar ?? {}} />;
    case "calendar":
      return <CalendarModule data={data.calendar ?? {}} />;
    default:
      return (
        <div className="module-wrapper">
          <div>
            <h2>{module.name}</h2>
            <div className="module-content">Módulo no configurado</div>
          </div>
        </div>
      );
  }
};

export const DashboardPage: React.FC = () => {
  const { config, loading } = useConfig();
  const [data, setData] = useState<DashboardData>({});
  const [stormMode, setStormMode] = useState<Record<string, any>>({ enabled: false });
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const layout = config.ui.layout ?? UI_DEFAULTS.layout;
  const sidePanel = config.ui.side_panel ?? UI_DEFAULTS.side_panel;
  const showDemo = config.ui.enable_demo ?? UI_DEFAULTS.enable_demo;
  const carouselEnabled = config.ui.carousel ?? UI_DEFAULTS.carousel;
  const overlayConfigured = config.ui.show_config ?? UI_DEFAULTS.show_config;

  const rotation = useModuleRotation(
    config.display.modules,
    config.display.module_cycle_seconds,
    { enabled: showDemo && carouselEnabled }
  );

  const fetchData = useMemo(() => {
    return async () => {
      const [weather, news, astronomy, calendar, storm] = await Promise.all([
        api.fetchWeather().catch(() => ({})),
        api.fetchNews().catch(() => ({})),
        api.fetchAstronomy().catch(() => ({})),
        api.fetchCalendar().catch(() => ({})),
        api.fetchStormMode().catch(() => ({}))
      ]);
      setData({ weather, news, astronomy, calendar });
      setStormMode(storm);
    };
  }, []);

  useEffect(() => {
    void fetchData();
    const timer = window.setInterval(() => {
      void fetchData();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [fetchData]);

  const overlayParam = searchParams.get("overlay");
  const overlayRequested =
    overlayParam === "1" || overlayParam?.toLowerCase() === "true" || overlayParam === "yes";
  const overlayEnabled = (overlayConfigured || overlayRequested) && !overlayDismissed;

  useEffect(() => {
    if (overlayConfigured || overlayRequested) {
      setOverlayDismissed(false);
    }
  }, [overlayConfigured, overlayRequested]);

  const closeOverlay = () => {
    setOverlayDismissed(true);
    if (overlayParam) {
      const next = new URLSearchParams(searchParams);
      next.delete("overlay");
      setSearchParams(next, { replace: true });
    }
  };

  const layoutLabel = layout === "full" ? "Panel completo" : "Rotación de módulos";
  const sidePanelLabel = sidePanel === "left" ? "Izquierda" : "Derecha";
  const stormActive = Boolean(stormMode.enabled);
  const weatherForPanel = data.weather ?? {};
  const temperatureCard = typeof weatherForPanel.temperature === "number" ? weatherForPanel.temperature : null;
  const temperatureUnit = typeof weatherForPanel.unit === "string" ? weatherForPanel.unit : "°C";

  const renderPanel = () => (
    <aside className="dashboard-panel">
      <div className="panel-summary">
        <div className="panel-summary__title">Disposición</div>
        <div className="panel-summary__value">{layoutLabel}</div>
        <div className="panel-summary__meta">Panel lateral: {sidePanelLabel}</div>
      </div>
      {showDemo && rotation.modules.length > 0 && (
        <div className="module-tabs">
          {rotation.modules.map((module, idx) => (
            <div key={module.name} className={`module-tab ${idx === rotation.index ? "active" : ""}`}>
              {module.name.toUpperCase()}
            </div>
          ))}
        </div>
      )}
      <div className="panel-cards">
        <div className="panel-card">
          <div className="panel-card__label">Rotación</div>
          <div className="panel-card__value">
            {showDemo ? `${config.display.module_cycle_seconds}s` : "Desactivada"}
          </div>
        </div>
        <div className="panel-card">
          <div className="panel-card__label">Modo tormenta</div>
          <div className="panel-card__value" style={{ color: stormActive ? "#ffb347" : "#74d99f" }}>
            {stormActive ? "Activo" : "Inactivo"}
          </div>
        </div>
        <div className="panel-card">
          <div className="panel-card__label">Temperatura</div>
          <div className="panel-card__value">
            {typeof temperatureCard === "number" ? `${temperatureCard.toFixed(0)}${temperatureUnit}` : "--"}
          </div>
        </div>
      </div>
      <button className="secondary" onClick={() => navigate("/config")}>Configurar</button>
    </aside>
  );

  const shouldShowFullLayout = !showDemo && layout === "full";

  let mainContent: React.ReactNode;
  if (shouldShowFullLayout) {
    mainContent = <FullDashboard config={config} data={data} stormMode={stormMode} />;
  } else if (showDemo && rotation.active) {
    mainContent = <ModuleRenderer module={rotation.active} config={config} data={data} />;
  } else if (showDemo) {
    mainContent = (
      <div className="module-wrapper">
        <div>
          <h2>Sin módulos activos</h2>
          <div className="module-content">Active módulos desde la página de configuración.</div>
        </div>
      </div>
    );
  } else {
    mainContent = <FullDashboard config={config} data={data} stormMode={stormMode} />;
  }

  if (loading && showDemo && rotation.modules.length === 0) {
    return <div className="dashboard-main">Cargando configuración…</div>;
  }

  return (
    <div className={`dashboard-layout layout-${layout} side-${sidePanel}`}>
      {sidePanel === "left" && renderPanel()}
      <main className="dashboard-main">{mainContent}</main>
      {sidePanel === "right" && renderPanel()}
      {overlayEnabled && (
        <div className="config-overlay">
          <div className="config-overlay__panel">
            <button
              type="button"
              className="config-overlay__close"
              onClick={closeOverlay}
              aria-label="Cerrar configuración"
            >
              ×
            </button>
            <ConfigForm mode="overlay" onClose={closeOverlay} />
          </div>
        </div>
      )}
    </div>
  );
};
