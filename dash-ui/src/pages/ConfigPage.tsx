import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { UI_DEFAULTS } from "../config/defaults";
import { useConfig } from "../context/ConfigContext";
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

export type ConfigFormProps = {
  mode: "page" | "overlay";
  onClose?: () => void;
};

export const ConfigForm: React.FC<ConfigFormProps> = ({ mode, onClose }) => {
  const { config, save, loading, error } = useConfig();
  const [form, setForm] = useState<AppConfig>(config);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm(config);
  }, [config]);

  const update = useCallback(<K extends keyof AppConfig>(section: K, value: AppConfig[K]) => {
    setForm((prev) => ({ ...prev, [section]: value }));
  }, []);

  const scrollPanels = useMemo(() => {
    const keys = new Set<string>([...Object.keys(UI_DEFAULTS.text.scroll), ...Object.keys(form.ui.text.scroll)]);
    return Array.from(keys);
  }, [form.ui.text.scroll]);

  const rotationEnabled = form.ui.rotation.enabled;

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
    setMessage(null);
    try {
      await save(form);
      setMessage("Configuración guardada correctamente");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  return (
    <div className={`config-wrapper${mode === "overlay" ? " config-wrapper--overlay" : ""}`}>
      <div>
        <h1>Configuración de Pantalla</h1>
        <p style={{ color: "rgba(173,203,239,0.7)" }}>
          Ajusta la rotación pública, el mapa, el scroll de texto y la conectividad del dispositivo.
        </p>
      </div>
      <form id="config-form" className="config-form" onSubmit={handleSubmit}>
        <label>
          Rotación de módulos (legacy)
          <select
            value={form.display.rotation}
            onChange={(event) => update("display", { ...form.display, rotation: event.target.value })}
          >
            <option value="left">Izquierda</option>
            <option value="normal">Normal</option>
            <option value="right">Derecha</option>
          </select>
        </label>
        <label>
          Zona horaria
          <input
            type="text"
            value={form.display.timezone}
            onChange={(event) => update("display", { ...form.display, timezone: event.target.value })}
          />
        </label>
        <label>
          Segundos por módulo (legacy)
          <input
            type="number"
            min={5}
            max={600}
            value={form.display.module_cycle_seconds}
            onChange={(event) =>
              update("display", { ...form.display, module_cycle_seconds: Number(event.target.value) })
            }
          />
        </label>

        <h2>Rotación de tarjeta</h2>
        <label>
          Rotación habilitada
          <select
            value={rotationEnabled ? "true" : "false"}
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
        </label>
        <label>
          Duración por panel (segundos)
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
        </label>
        <label>
          Paneles en rotación (uno por línea)
          <textarea
            rows={5}
            value={form.ui.rotation.panels.join("\n")}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                rotation: { ...form.ui.rotation, panels: parsePanelsInput(event.target.value) }
              })
            }
          />
        </label>

        <h2>Mapa mundial</h2>
        <label>
          Proveedor de mapas
          <input
            type="text"
            value={form.ui.map.provider}
            onChange={(event) => update("ui", { ...form.ui, map: { ...form.ui.map, provider: event.target.value } })}
          />
        </label>
        <label>
          Centro (latitud)
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
        </label>
        <label>
          Centro (longitud)
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
        </label>
        <label>
          Zoom
          <input
            type="number"
            min={0}
            max={18}
            value={form.ui.map.zoom}
            onChange={(event) => update("ui", { ...form.ui, map: { ...form.ui.map, zoom: Number(event.target.value) } })}
          />
        </label>
        <label>
          Permitir interacción
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
        </label>
        <label>
          Mostrar controles
          <select
            value={form.ui.map.controls ? "true" : "false"}
            onChange={(event) =>
              update("ui", {
                ...form.ui,
                map: { ...form.ui.map, controls: event.target.value === "true" }
              })
            }
          >
            {booleanOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <h2>Formato de reloj y temperatura</h2>
        <label>
          Formato de hora
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
        </label>
        <label>
          Unidad de temperatura (C/F/K)
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
        </label>

        <h2>Scroll automático por panel</h2>
        {scrollPanels.map((panel) => {
          const current = form.ui.text.scroll[panel] ?? defaultScroll(panel);
          const speedValue = typeof current.speed === "number" ? String(current.speed) : current.speed;
          return (
            <fieldset key={panel} style={{ border: "1px solid rgba(173,203,239,0.25)", borderRadius: "12px", padding: "12px 16px" }}>
              <legend style={{ padding: "0 8px", fontSize: "0.95rem" }}>{panel}</legend>
              <label>
                Activar scroll
                <select
                  value={current.enabled ? "true" : "false"}
                  onChange={(event) =>
                    handleScrollChange(panel, { enabled: event.target.value === "true" })
                  }
                >
                  {booleanOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dirección
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
              </label>
              <label>
                Velocidad ({speedPlaceholders})
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
              </label>
              <label>
                Gap (px)
                <input
                  type="number"
                  min={0}
                  value={current.gap_px}
                  onChange={(event) => handleScrollChange(panel, { gap_px: Number(event.target.value) })}
                />
              </label>
            </fieldset>
          );
        })}

        <h2>Claves API</h2>
        <label>
          API Clima
          <input
            type="text"
            value={form.api_keys.weather ?? ""}
            onChange={(event) => update("api_keys", { ...form.api_keys, weather: event.target.value })}
          />
        </label>
        <label>
          API Noticias
          <input
            type="text"
            value={form.api_keys.news ?? ""}
            onChange={(event) => update("api_keys", { ...form.api_keys, news: event.target.value })}
          />
        </label>
        <label>
          API Astronomía
          <input
            type="text"
            value={form.api_keys.astronomy ?? ""}
            onChange={(event) => update("api_keys", { ...form.api_keys, astronomy: event.target.value })}
          />
        </label>
        <label>
          API Calendario
          <input
            type="text"
            value={form.api_keys.calendar ?? ""}
            onChange={(event) => update("api_keys", { ...form.api_keys, calendar: event.target.value })}
          />
        </label>

        <h2>MQTT</h2>
        <label>
          MQTT Activo
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
        </label>
        <label>
          MQTT Host
          <input
            type="text"
            value={form.mqtt.host}
            onChange={(event) => update("mqtt", { ...form.mqtt, host: event.target.value })}
          />
        </label>
        <label>
          MQTT Puerto
          <input
            type="number"
            value={form.mqtt.port}
            onChange={(event) => update("mqtt", { ...form.mqtt, port: Number(event.target.value) })}
          />
        </label>
        <label>
          MQTT Topic
          <input
            type="text"
            value={form.mqtt.topic}
            onChange={(event) => update("mqtt", { ...form.mqtt, topic: event.target.value })}
          />
        </label>
        <label>
          MQTT Usuario
          <input
            type="text"
            value={form.mqtt.username ?? ""}
            onChange={(event) => update("mqtt", { ...form.mqtt, username: event.target.value })}
          />
        </label>
        <label>
          MQTT Password
          <input
            type="password"
            value={form.mqtt.password ?? ""}
            onChange={(event) => update("mqtt", { ...form.mqtt, password: event.target.value })}
          />
        </label>

        <h2>Wi-Fi</h2>
        <label>
          Wi-Fi Interfaz
          <input
            type="text"
            value={form.wifi.interface}
            onChange={(event) => update("wifi", { ...form.wifi, interface: event.target.value })}
          />
        </label>
        <label>
          Wi-Fi SSID
          <input
            type="text"
            value={form.wifi.ssid ?? ""}
            onChange={(event) => update("wifi", { ...form.wifi, ssid: event.target.value })}
          />
        </label>
        <label>
          Wi-Fi Contraseña
          <input
            type="password"
            value={form.wifi.psk ?? ""}
            onChange={(event) => update("wifi", { ...form.wifi, psk: event.target.value })}
          />
        </label>
      </form>
      <div className="config-actions">
        <button className="primary" type="submit" form="config-form" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button className="secondary" type="button" onClick={handleClose}>
          {mode === "overlay" ? "Cerrar" : "Volver"}
        </button>
      </div>
      {(error || message) && (
        <div style={{ color: error ? "#ff9f89" : "#74d99f", fontSize: "0.95rem" }}>{error ?? message}</div>
      )}
      {loading && <div style={{ color: "rgba(173,203,239,0.65)" }}>Sincronizando…</div>}
    </div>
  );
};

export const ConfigPage: React.FC = () => {
  const navigate = useNavigate();
  const handleClose = useCallback(() => navigate("/"), [navigate]);
  return <ConfigForm mode="page" onClose={handleClose} />;
};
