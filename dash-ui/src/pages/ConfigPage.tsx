import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useConfig } from "../context/ConfigContext";
import type { AppConfig } from "../types/config";

const rotationOptions = [
  { value: "left", label: "Izquierda" },
  { value: "normal", label: "Normal" },
  { value: "right", label: "Derecha" }
];

export const ConfigPage: React.FC = () => {
  const navigate = useNavigate();
  const { config, save, loading, error } = useConfig();
  const [form, setForm] = useState<AppConfig>(config);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm(config);
  }, [config]);

  const update = <K extends keyof AppConfig>(section: K, value: AppConfig[K]) => {
    setForm((prev) => ({ ...prev, [section]: value }));
  };

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

  return (
    <div className="config-wrapper">
      <div>
        <h1>Configuración de Pantalla</h1>
        <p style={{ color: "rgba(173,203,239,0.7)" }}>
          Ajusta la rotación, credenciales y conectividad de la pantalla de información.
        </p>
      </div>
      <form id="config-form" className="config-form" onSubmit={handleSubmit}>
        <label>
          Rotación
          <select
            value={form.display.rotation}
            onChange={(event) => update("display", { ...form.display, rotation: event.target.value })}
          >
            {rotationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
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
          Segundos por módulo
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
        <label>
          MQTT Activo
          <select
            value={form.mqtt.enabled ? "true" : "false"}
            onChange={(event) => update("mqtt", { ...form.mqtt, enabled: event.target.value === "true" })}
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
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
        <button className="secondary" type="button" onClick={() => navigate("/")}>
          Volver
        </button>
      </div>
      {(error || message) && (
        <div style={{ color: error ? "#ff9f89" : "#74d99f", fontSize: "0.95rem" }}>{error ?? message}</div>
      )}
      {loading && <div style={{ color: "rgba(173,203,239,0.65)" }}>Sincronizando…</div>}
    </div>
  );
};
