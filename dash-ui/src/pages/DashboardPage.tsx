import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { api } from "../services/api";
import { useConfig } from "../context/ConfigContext";
import type { AppConfig, DisplayModule } from "../types/config";
import { useModuleRotation } from "../hooks/useModuleRotation";
import { AstronomyModule } from "../modules/AstronomyModule";
import { CalendarModule } from "../modules/CalendarModule";
import { ClockModule } from "../modules/ClockModule";
import { EventsModule } from "../modules/EventsModule";
import { NewsModule } from "../modules/NewsModule";
import { WeatherModule } from "../modules/WeatherModule";

const ModuleRenderer: React.FC<{
  module: DisplayModule;
  config: AppConfig;
  data: Record<string, Record<string, unknown>>;
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
  const [data, setData] = useState<Record<string, Record<string, unknown>>>({});
  const [stormMode, setStormMode] = useState<Record<string, unknown>>({ enabled: false });
  const { modules, active, index } = useModuleRotation(config.display.modules, config.display.module_cycle_seconds);
  const navigate = useNavigate();
  const location = useLocation();

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

  useEffect(() => {
    if (location.pathname !== "/") {
      navigate("/", { replace: true });
    }
  }, [location.pathname, navigate]);

  if (loading && modules.length === 0) {
    return <div className="dashboard-main">Cargando configuración…</div>;
  }

  return (
    <div className="dashboard-layout">
      <main className="dashboard-main">
        {active ? (
          <ModuleRenderer module={active} config={config} data={data} />
        ) : (
          <div className="module-wrapper">
            <div>
              <h2>Sin módulos activos</h2>
              <div className="module-content">Active módulos desde la página de configuración.</div>
            </div>
          </div>
        )}
      </main>
      <aside className="dashboard-panel">
        <div className="module-tabs">
          {modules.map((module, idx) => (
            <div key={module.name} className={`module-tab ${idx === index ? "active" : ""}`}>
              {module.name.toUpperCase()}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gap: "16px" }}>
          <div className="news-item">
            <div style={{ fontSize: "1rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(173,203,239,0.7)" }}>
              Rotación
            </div>
            <div style={{ fontSize: "1.4rem" }}>{config.display.module_cycle_seconds}s</div>
          </div>
          <div className="news-item">
            <div style={{ fontSize: "1rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(173,203,239,0.7)" }}>
              Modo tormenta
            </div>
            <div style={{ fontSize: "1.4rem", color: stormMode.enabled ? "#ffb347" : "#74d99f" }}>
              {stormMode.enabled ? "Activo" : "Inactivo"}
            </div>
          </div>
          <button className="secondary" onClick={() => navigate("/config")}>Configurar</button>
        </div>
      </aside>
    </div>
  );
};
