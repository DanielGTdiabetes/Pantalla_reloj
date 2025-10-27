import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { UI_DEFAULTS, withConfigDefaults } from "../config/defaults";
import { API_BASE, apiGet, apiPing, apiPut } from "../lib/api";
import { parseErr } from "../lib/errors";
import type { AppConfig, UIScrollSettings } from "../types/config";

const booleanOptions = [
  { value: "true", label: "Sí" },
  { value: "false", label: "No" }
];

const directionOptions = [
  { value: "left", label: "Horizontal" },
  { value: "up", label: "Vertical" }
];

const speedPlaceholders = "slow / normal / fast o px/s";

const API_UNREACHABLE = `No se pudo contactar con /api en ${API_BASE}`;

const defaultScroll = (panel: string): UIScrollSettings => {
  return UI_DEFAULTS.text.scroll[panel] ?? { enabled: true, direction: "left", speed: "normal", gap_px: 48 };
};

const parseSpeedInput = (value: string, current: UIScrollSettings["speed"]): UIScrollSettings["speed"] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return current;
  }
  if (["slow", "normal", "fast"].includes(trimmed)) {
    return trimmed as UIScrollSettings["speed"];
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return current;
};

const parsePanelsInput = (value: string): string[] => {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

type ConfigTab = "wifi" | "api" | "ui" | "system";

const tabs: { id: ConfigTab; label: string }[] = [
  { id: "wifi", label: "Wi-Fi" },
  { id: "api", label: "APIs" },
  { id: "ui", label: "Interfaz" },
  { id: "system", label: "Sistema" }
];

export const ConfigPage: React.FC = () => {
  const navigate = useNavigate();

  const [form, setForm] = useState<AppConfig>(withConfigDefaults());
  const [activeTab, setActiveTab] = useState<ConfigTab>("wifi");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await apiGet<AppConfig>("/config");
      setForm(withConfigDefaults(cfg));
      setError(null);
    } catch {
      setError(API_UNREACHABLE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiPing()
      .then((ok) => {
        if (!cancelled) {
          setApiOnline(ok);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiOnline(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (apiOnline === null) {
      return;
    }
    if (!apiOnline) {
      setLoading(false);
      setError(API_UNREACHABLE);
      return;
    }
    void loadConfig();
  }, [apiOnline, loadConfig]);

  useEffect(() => {
    if (error) {
      setBanner({ kind: "error", text: error });
    } else if (banner?.kind === "error") {
      setBanner(null);
    }
  }, [error, banner]);

  const update = useCallback(<K extends keyof AppConfig>(section: K, value: AppConfig[K]) => {
    setForm((prev) => ({ ...prev, [section]: value }));
  }, []);

  const scrollPanels = useMemo(() => {
    const keys = new Set<string>([...Object.keys(UI_DEFAULTS.text.scroll), ...Object.keys(form.ui.text.scroll)]);
    return Array.from(keys);
  }, [form.ui.text.scroll]);

  const handleScrollChange = useCallback(
    (panel: string, partial: Partial<UIScrollSettings>) => {
      const current = form.ui.text.scroll[panel] ?? defaultScroll(panel);
      update("ui", {
        ...form.ui,
        text: {
          ...form.ui.text,
          scroll: {
            ...form.ui.text.scroll,
            [panel]: { ...current, ...partial }
          }
        }
      });
    },
    [form.ui, update]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setBanner(null);
    try {
      await apiPut("/config", form);
      await loadConfig();
      setApiOnline(true);
      setBanner({ kind: "success", text: "Configuración guardada correctamente" });
    } catch (err) {
      const message = parseErr(err);
      setBanner({ kind: "error", text: message });
      if (message.includes("No se pudo contactar")) {
        setApiOnline(false);
        setError(API_UNREACHABLE);
      }
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || loading;

  const renderWiFiTab = () => (
    <div className="config-card">
      <div>
        <h2>Red Wi-Fi</h2>
        <p>Gestiona la conectividad inalámbrica del dispositivo.</p>
      </div>
      <div className="config-grid">
        <div className="config-field">
          <label>Interfaz</label>
          <input
            type="text"
            value={form.wifi.interface}
            onChange={(event) => update("wifi", { ...form.wifi, interface: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>SSID</label>
          <input
            type="text"
            value={form.wifi.ssid ?? ""}
            onChange={(event) => update("wifi", { ...form.wifi, ssid: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>Contraseña</label>
          <input
            type="password"
            value={form.wifi.psk ?? ""}
            onChange={(event) => update("wifi", { ...form.wifi, psk: event.target.value })}
          />
        </div>
      </div>
    </div>
  );

  const renderAPITab = () => (
    <div className="config-card">
      <div>
        <h2>Claves de API</h2>
        <p>Define las credenciales necesarias para recuperar datos externos.</p>
      </div>
      <div className="config-grid">
        <div className="config-field">
          <label>API Clima</label>
          <input
            type="text"
            value={form.api_keys.weather ?? ""}
            onChange={(event) => update("api_keys", { ...form.api_keys, weather: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>API Noticias</label>
          <input
            type="text"
            value={form.api_keys.news ?? ""}
            onChange={(event) => update("api_keys", { ...form.api_keys, news: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>API Astronomía</label>
          <input
            type="text"
            value={form.api_keys.astronomy ?? ""}
            onChange={(event) => update("api_keys", { ...form.api_keys, astronomy: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>API Calendario</label>
          <input
            type="text"
            value={form.api_keys.calendar ?? ""}
            onChange={(event) => update("api_keys", { ...form.api_keys, calendar: event.target.value })}
          />
        </div>
      </div>
    </div>
  );

  const renderUITab = () => (
    <div className="config-card">
      <div>
        <h2>Interfaz y datos</h2>
        <p>Controla la rotación de módulos, el mapa y el formato de la pantalla.</p>
      </div>

      <section className="config-grid">
        <div className="config-field">
          <label>Zona horaria</label>
          <input
            type="text"
            value={form.display.timezone}
            onChange={(event) => update("display", { ...form.display, timezone: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>Rotación (legacy)</label>
          <select
            value={form.display.rotation}
            onChange={(event) => update("display", { ...form.display, rotation: event.target.value })}
          >
            <option value="left">Izquierda</option>
            <option value="normal">Normal</option>
            <option value="right">Derecha</option>
          </select>
        </div>
        <div className="config-field">
          <label>Segundos por módulo (legacy)</label>
          <input
            type="number"
            min={5}
            max={600}
            value={form.display.module_cycle_seconds}
            onChange={(event) =>
              update("display", { ...form.display, module_cycle_seconds: Number(event.target.value) })
            }
          />
        </div>
      </section>

      <section className="config-grid">
        <div className="config-field">
          <label>Rotación de tarjetas</label>
          <select
            value={form.ui.rotation.enabled ? "true" : "false"}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                rotation: { ...form.ui.rotation, enabled: event.target.value === "true" }
              })
            }
          >
            {booleanOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="config-field">
          <label>Duración por panel (segundos)</label>
          <input
            type="number"
            min={3}
            max={3600}
            value={form.ui.rotation.duration_sec}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                rotation: { ...form.ui.rotation, duration_sec: Number(event.target.value) }
              })
            }
          />
        </div>
        <div className="config-field" style={{ gridColumn: "1 / -1" }}>
          <label>Paneles en rotación (uno por línea)</label>
          <textarea
            value={form.ui.rotation.panels.join("\n")}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                rotation: { ...form.ui.rotation, panels: parsePanelsInput(event.target.value) }
              })
            }
          />
        </div>
      </section>

      <section className="config-grid">
        <div className="config-field">
          <label>Proveedor de mapas</label>
          <input
            type="text"
            value={form.ui.map.provider}
            onChange={(event) => update("ui", { ...form.ui, map: { ...form.ui.map, provider: event.target.value } })}
          />
        </div>
        <div className="config-field">
          <label>Centro (latitud)</label>
          <input
            type="number"
            value={form.ui.map.center[0]}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                map: { ...form.ui.map, center: [Number(event.target.value), form.ui.map.center[1]] }
              })
            }
          />
        </div>
        <div className="config-field">
          <label>Centro (longitud)</label>
          <input
            type="number"
            value={form.ui.map.center[1]}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                map: { ...form.ui.map, center: [form.ui.map.center[0], Number(event.target.value)] }
              })
            }
          />
        </div>
        <div className="config-field">
          <label>Zoom</label>
          <input
            type="number"
            min={0}
            max={18}
            value={form.ui.map.zoom}
            onChange={(event) => update("ui", { ...form.ui, map: { ...form.ui.map, zoom: Number(event.target.value) } })}
          />
        </div>
        <div className="config-field">
          <label>Interacción</label>
          <select
            value={form.ui.map.interactive ? "true" : "false"}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                map: { ...form.ui.map, interactive: event.target.value === "true" }
              })
            }
          >
            {booleanOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="config-field">
          <label>Controles</label>
          <select
            value={form.ui.map.controls ? "true" : "false"}
            onChange={(event) =>
              update("ui", { ...form.ui, map: { ...form.ui.map, controls: event.target.value === "true" } })
            }
          >
            {booleanOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="config-grid">
        <div className="config-field">
          <label>Formato de hora</label>
          <input
            type="text"
            value={form.ui.fixed.clock.format}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                fixed: {
                  ...form.ui.fixed,
                  clock: { ...form.ui.fixed.clock, format: event.target.value }
                }
              })
            }
          />
        </div>
        <div className="config-field">
          <label>Unidad de temperatura (C/F/K)</label>
          <input
            type="text"
            value={form.ui.fixed.temperature.unit}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                fixed: {
                  ...form.ui.fixed,
                  temperature: { ...form.ui.fixed.temperature, unit: event.target.value }
                }
              })
            }
          />
        </div>
      </section>

      <section className="config-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="config-field">
          <label>Scroll automático por panel</label>
          <div className="config-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {scrollPanels.map((panel) => {
              const current = form.ui.text.scroll[panel] ?? defaultScroll(panel);
              const speedValue = typeof current.speed === "number" ? String(current.speed) : current.speed;
              return (
                <fieldset key={panel} className="config-field" style={{ borderRadius: "16px", border: "1px solid rgba(109,182,255,0.2)", padding: "14px 16px" }}>
                  <legend style={{ padding: "0 8px", fontSize: "0.95rem" }}>{panel}</legend>
                  <div className="config-field">
                    <label>Activar scroll</label>
                    <select
                      value={current.enabled ? "true" : "false"}
                      onChange={(event) => handleScrollChange(panel, { enabled: event.target.value === "true" })}
                    >
                      {booleanOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="config-field">
                    <label>Dirección</label>
                    <select
                      value={current.direction}
                      onChange={(event) => handleScrollChange(panel, { direction: event.target.value as "left" | "up" })}
                    >
                      {directionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="config-field">
                    <label>Velocidad ({speedPlaceholders})</label>
                    <input
                      type="text"
                      value={speedValue}
                      onChange={(event) =>
                        handleScrollChange(panel, { speed: parseSpeedInput(event.target.value, current.speed) })
                      }
                      list={`speed-${panel}`}
                    />
                    <datalist id={`speed-${panel}`}>
                      <option value="slow" />
                      <option value="normal" />
                      <option value="fast" />
                    </datalist>
                  </div>
                  <div className="config-field">
                    <label>Separación (px)</label>
                    <input
                      type="number"
                      min={0}
                      value={current.gap_px}
                      onChange={(event) => handleScrollChange(panel, { gap_px: Number(event.target.value) })}
                    />
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );

  const renderSystemTab = () => (
    <div className="config-card">
      <div>
        <h2>Servicios del sistema</h2>
        <p>Configura MQTT y revisa los módulos activos del dashboard.</p>
      </div>
      <section className="config-grid">
        <div className="config-field">
          <label>MQTT habilitado</label>
          <select
            value={form.mqtt.enabled ? "true" : "false"}
            onChange={(event) => update("mqtt", { ...form.mqtt, enabled: event.target.value === "true" })}
          >
            {booleanOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="config-field">
          <label>Host</label>
          <input
            type="text"
            value={form.mqtt.host}
            onChange={(event) => update("mqtt", { ...form.mqtt, host: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>Puerto</label>
          <input
            type="number"
            value={form.mqtt.port}
            onChange={(event) => update("mqtt", { ...form.mqtt, port: Number(event.target.value) })}
          />
        </div>
        <div className="config-field">
          <label>Tópico</label>
          <input
            type="text"
            value={form.mqtt.topic}
            onChange={(event) => update("mqtt", { ...form.mqtt, topic: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>Usuario</label>
          <input
            type="text"
            value={form.mqtt.username ?? ""}
            onChange={(event) => update("mqtt", { ...form.mqtt, username: event.target.value })}
          />
        </div>
        <div className="config-field">
          <label>Contraseña</label>
          <input
            type="password"
            value={form.mqtt.password ?? ""}
            onChange={(event) => update("mqtt", { ...form.mqtt, password: event.target.value })}
          />
        </div>
      </section>
      <section>
        <h3>Módulos de pantalla</h3>
        <p className="config-status">Puedes activar o desactivar los módulos directamente en el archivo de configuración.</p>
        <ul className="saints-card__list" style={{ marginTop: "12px" }}>
          {form.display.modules.map((module) => (
            <li key={module.name}>
              <span className="harvest-card__item">{module.name}</span>
              <span className="harvest-card__status">
                {module.enabled ? `Activo (${module.duration_seconds}s)` : "Desactivado"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  const renderActiveTab = () => {
    switch (activeTab) {
      case "wifi":
        return renderWiFiTab();
      case "api":
        return renderAPITab();
      case "ui":
        return renderUITab();
      case "system":
        return renderSystemTab();
      default:
        return null;
    }
  };

  const apiStatusLabel =
    apiOnline === null ? "API checking" : apiOnline ? "API online" : "API offline";
  const apiStatusClass =
    apiOnline === null ? " is-pending" : apiOnline ? " is-online" : " is-offline";
  const apiHint =
    apiOnline === null
      ? "Comprobando el estado del backend…"
      : apiOnline
      ? "Conectado al backend."
      : `API offline. ${API_UNREACHABLE}.`;

  return (
    <div className="config-page">
      <form className="config-page__container" onSubmit={handleSubmit}>
        <div className={`config-status-bar${apiStatusClass}`}>
          <span className="config-status-bar__label">{apiStatusLabel}</span>
          <span className="config-status-bar__hint">{apiHint}</span>
        </div>
        <header className="config-page__header">
          <h1>Configuración del sistema</h1>
          <p>Gestiona la pantalla desde una red segura. Todas las opciones residen en esta consola.</p>
        </header>

        <div className="config-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`config-tab${activeTab === tab.id ? " is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              disabled={busy}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {banner ? (
          <div
            className={`config-status${banner.kind === "error" ? " config-status--error" : " config-status--success"}`}
            role="status"
            aria-live="polite"
          >
            {banner.text}
          </div>
        ) : null}

        {error ? (
          <div className="config-status config-status--error config-error-callout">
            <p>{error}</p>
            <button
              type="button"
              className="config-button"
              onClick={() => {
                setError(null);
                void loadConfig();
              }}
              disabled={loading}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {renderActiveTab()}

        <div className="config-actions">
          <button
            type="button"
            className="config-button"
            onClick={() => navigate("/")}
            disabled={busy}
          >
            Volver al panel
          </button>
          <button className="config-button primary" type="submit" disabled={busy}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>

        {loading ? (
          <div className="config-status" role="status" aria-live="polite">
            Sincronizando…
          </div>
        ) : null}
      </form>
    </div>
  );
};

export default ConfigPage;
