import React, { useCallback, useEffect, useMemo, useState } from "react";

import { DEFAULT_CONFIG, withConfigDefaults } from "../config/defaults";
import {
  API_ORIGIN,
  ApiError,
  getConfig,
  getHealth,
  getSchema,
  saveConfig,
  wifiConnect,
  wifiDisconnect,
  wifiScan,
  wifiStatus,
  type WiFiNetwork,
  type WiFiStatusResponse,
} from "../lib/api";
import type { AppConfig, MapCinemaBand } from "../types/config";

type LoadStatus = "loading" | "ready" | "error";
type Banner = { kind: "success" | "error"; text: string } | null;
type FieldErrors = Record<string, string>;

type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

type SchemaInspector = {
  has(path: string | string[]): boolean;
};

const API_ERROR_MESSAGE = `No se pudo conectar con el backend en ${API_ORIGIN}`;
const MAP_STYLE_OPTIONS: AppConfig["ui"]["map"]["style"][] = [
  "vector-dark",
  "vector-light",
  "vector-bright",
  "raster-carto-dark",
  "raster-carto-light",
];
const MAP_PROVIDER_OPTIONS: AppConfig["ui"]["map"]["provider"][] = ["maptiler", "osm"];
const MAP_BACKEND_PROVIDERS: AppConfig["map"]["provider"][] = ["maptiler", "osm"];
const MAP_PROVIDER_LABELS: Record<AppConfig["map"]["provider"], string> = {
  maptiler: "MapTiler",
  osm: "OpenStreetMap",
};
const MAPTILER_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAPTILER_DOCS_TEXT = "Obtén la clave en docs.maptiler.com/cloud/api-keys";
const DEFAULT_PANELS = DEFAULT_CONFIG.ui.rotation.panels;
const CINEMA_BAND_COUNT = DEFAULT_CONFIG.ui.map.cinema.bands.length;

const DEFAULT_SCHEMA_PATHS: Set<string> = (() => {
  const paths = new Set<string>();
  const walk = (value: unknown, prefix: string[]) => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) {
        walk(value[0], prefix);
      }
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = [...prefix, key];
      paths.add(nextPath.join("."));
      walk(child, nextPath);
    }
  };
  walk(DEFAULT_CONFIG, []);
  return paths;
})();

const joinPath = (path: string | string[]): string => {
  if (Array.isArray(path)) {
    return path.join(".");
  }
  return path;
};

const decodeJsonPointer = (token: string): string => {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
};

const createSchemaInspector = (schema: Record<string, unknown> | undefined): SchemaInspector => {
  if (!schema || typeof schema !== "object") {
    return { has: (path: string | string[]) => DEFAULT_SCHEMA_PATHS.has(joinPath(path)) };
  }

  const root = schema as JsonSchema & { [key: string]: unknown };
  const pathSet = new Set<string>();
  const visited = new WeakMap<object, Set<string>>();

  const resolveRef = (ref: string | undefined): JsonSchema | undefined => {
    if (!ref || typeof ref !== "string" || !ref.startsWith("#/")) {
      return undefined;
    }
    const segments = ref
      .slice(2)
      .split("/")
      .map(decodeJsonPointer);
    let current: unknown = root;
    for (const segment of segments) {
      if (!current || typeof current !== "object" || !(segment in current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current as JsonSchema;
  };

  const deref = (node: JsonSchema | undefined): JsonSchema | undefined => {
    if (!node || typeof node !== "object") {
      return node;
    }
    if (node.$ref) {
      const target = resolveRef(node.$ref);
      if (target) {
        return deref(target);
      }
    }
    return node;
  };

  const visit = (node: JsonSchema | undefined, prefix: string[]) => {
    const resolved = deref(node);
    if (!resolved || typeof resolved !== "object") {
      return;
    }
    const key = prefix.join(".");
    const marker = visited.get(resolved);
    if (marker?.has(key)) {
      return;
    }
    if (marker) {
      marker.add(key);
    } else {
      visited.set(resolved, new Set(key ? [key] : []));
    }

    const composites = [resolved, ...(resolved.allOf ?? []), ...(resolved.anyOf ?? []), ...(resolved.oneOf ?? [])];
    for (const composite of composites) {
      const concrete = deref(composite);
      if (!concrete || typeof concrete !== "object") {
        continue;
      }
      if (concrete.properties) {
        for (const [name, child] of Object.entries(concrete.properties)) {
          const childPath = [...prefix, name];
          pathSet.add(childPath.join("."));
          visit(child, childPath);
        }
      }
      if (concrete.items) {
        visit(concrete.items, prefix);
      }
    }
  };

  visit(root, []);

  return {
    has: (path: string | string[]) => pathSet.has(joinPath(path)),
  };
};

const extractBackendErrors = (detail: unknown): FieldErrors => {
  if (Array.isArray(detail)) {
    return detail.reduce<FieldErrors>((acc, entry) => {
      if (!entry || typeof entry !== "object") {
        return acc;
      }
      const record = entry as Record<string, unknown>;
      const loc = Array.isArray(record.loc)
        ? (record.loc as (string | number)[])
        : [];
      const path = loc.length ? loc.map(String).join(".") : "__root__";
      const message = typeof record.msg === "string" ? record.msg : "Dato inválido";
      acc[path] = message;
      return acc;
    }, {});
  }

  if (detail && typeof detail === "object" && "detail" in detail) {
    const inner = (detail as Record<string, unknown>).detail;
    if (typeof inner === "string") {
      return { __root__: inner };
    }
    return extractBackendErrors(inner);
  }

  if (typeof detail === "string") {
    return { __root__: detail };
  }

  return {};
};

const validateConfig = (config: AppConfig, supports: SchemaInspector["has"]): FieldErrors => {
  const errors: FieldErrors = {};

  if (supports("display.timezone")) {
    if (!config.display.timezone || !config.display.timezone.trim()) {
      errors["display.timezone"] = "Introduce una zona horaria válida";
    }
  }

  if (supports("display.module_cycle_seconds")) {
    const value = config.display.module_cycle_seconds;
    if (!Number.isFinite(value) || value < 5 || value > 600) {
      errors["display.module_cycle_seconds"] = "Debe estar entre 5 y 600";
    }
  }

  if (supports("map.provider")) {
    if (!MAP_BACKEND_PROVIDERS.includes(config.map.provider)) {
      errors["map.provider"] = "Selecciona un proveedor soportado";
    }
  }

  if (supports("map.maptiler_api_key")) {
    if (config.map.provider === "maptiler") {
      const key = config.map.maptiler_api_key ?? "";
      if (!key.trim()) {
        errors["map.maptiler_api_key"] = "Introduce la API key de MapTiler";
      } else if (!MAPTILER_KEY_PATTERN.test(key.trim())) {
        errors["map.maptiler_api_key"] = "La API key solo puede incluir letras, números, punto, guion y guion bajo";
      }
    }
  }

  if (supports("ui.map.style")) {
    if (!MAP_STYLE_OPTIONS.includes(config.ui.map.style)) {
      errors["ui.map.style"] = "Selecciona un estilo compatible";
    }
  }

  if (supports("ui.map.provider")) {
    if (!MAP_PROVIDER_OPTIONS.includes(config.ui.map.provider)) {
      errors["ui.map.provider"] = "Selecciona un proveedor soportado";
    }
  }

  if (supports("ui.map.cinema.panLngDegPerSec")) {
    if (!Number.isFinite(config.ui.map.cinema.panLngDegPerSec) || config.ui.map.cinema.panLngDegPerSec < 0) {
      errors["ui.map.cinema.panLngDegPerSec"] = "Introduce una velocidad positiva";
    }
  }

  if (supports("ui.map.cinema.bandTransition_sec")) {
    if (!Number.isFinite(config.ui.map.cinema.bandTransition_sec) || config.ui.map.cinema.bandTransition_sec < 1) {
      errors["ui.map.cinema.bandTransition_sec"] = "Debe ser mayor o igual a 1";
    }
  }

  if (supports("ui.map.idlePan.intervalSec")) {
    const value = config.ui.map.idlePan.intervalSec;
    if (!Number.isFinite(value) || value < 10) {
      errors["ui.map.idlePan.intervalSec"] = "Debe ser mayor o igual a 10";
    }
  }

  if (supports("ui.map.cinema.bands")) {
    if (config.ui.map.cinema.bands.length !== CINEMA_BAND_COUNT) {
      errors["ui.map.cinema.bands"] = `Configura exactamente ${CINEMA_BAND_COUNT} bandas`;
    }
    config.ui.map.cinema.bands.forEach((band, index) => {
      const basePath = `ui.map.cinema.bands.${index}`;
      if (!Number.isFinite(band.lat)) {
        errors[`${basePath}.lat`] = "Latitud inválida";
      }
      if (!Number.isFinite(band.zoom)) {
        errors[`${basePath}.zoom`] = "Zoom inválido";
      }
      if (!Number.isFinite(band.pitch)) {
        errors[`${basePath}.pitch`] = "Pitch inválido";
      }
      if (!Number.isFinite(band.minZoom)) {
        errors[`${basePath}.minZoom`] = "minZoom inválido";
      }
      if (!Number.isFinite(band.duration_sec) || band.duration_sec < 1) {
        errors[`${basePath}.duration_sec`] = "Duración inválida";
      }
      if (Number.isFinite(band.minZoom) && Number.isFinite(band.zoom) && band.minZoom > band.zoom) {
        errors[`${basePath}.minZoom`] = "minZoom debe ser menor o igual a zoom";
      }
    });
  }

  if (supports("ui.map.theme.contrast")) {
    if (!Number.isFinite(config.ui.map.theme.contrast)) {
      errors["ui.map.theme.contrast"] = "Introduce un número";
    }
  }

  if (supports("ui.rotation.duration_sec")) {
    const value = config.ui.rotation.duration_sec;
    if (!Number.isFinite(value) || value < 3 || value > 3600) {
      errors["ui.rotation.duration_sec"] = "Debe estar entre 3 y 3600";
    }
  }

  if (supports("ui.rotation.panels")) {
    const panels = config.ui.rotation.panels.filter((panel) => panel.trim().length > 0);
    if (!panels.length) {
      errors["ui.rotation.panels"] = "Selecciona al menos un panel";
    }
    const unique = new Set(panels.map((panel) => panel.toLowerCase()))
      .size;
    if (unique !== panels.length) {
      errors["ui.rotation.panels"] = "Los paneles no pueden repetirse";
    }
  }

  return errors;
};

const ConfigPage: React.FC = () => {
  const [form, setForm] = useState<AppConfig>(withConfigDefaults());
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [newPanel, setNewPanel] = useState("");
  const [showMaptilerKey, setShowMaptilerKey] = useState(false);
  
  // WiFi state
  const [wifiNetworks, setWifiNetworks] = useState<WiFiNetwork[]>([]);
  const [wifiScanning, setWifiScanning] = useState(false);
  const [wifiStatusData, setWifiStatusData] = useState<WiFiStatusResponse | null>(null);
  const [wifiConnecting, setWifiConnecting] = useState(false);
  const [wifiConnectPassword, setWifiConnectPassword] = useState<Record<string, string>>({});
  const [wifiConnectError, setWifiConnectError] = useState<string | null>(null);

  const schemaInspector = useMemo(() => createSchemaInspector(schema ?? undefined), [schema]);
  const supports = useCallback((path: string) => schemaInspector.has(path), [schemaInspector]);

  const panelOptions = useMemo(() => {
    const base = new Set<string>([...DEFAULT_PANELS, ...form.ui.rotation.panels]);
    return Array.from(base);
  }, [form.ui.rotation.panels]);

  const isReady = status === "ready";
  const disableInputs = !isReady || saving;

  // El modo cine horizontal ya no requiere rotation.enabled
  const cinemaBlocked = !form.ui.map.cinema.enabled;
  const disableCinemaControls = disableInputs || cinemaBlocked;
  const disableIdlePanControls =
    disableInputs || cinemaBlocked || !form.ui.map.idlePan.enabled;

  const resetErrorsFor = useCallback((pathPrefix: string) => {
    setFieldErrors((prev) => {
      const next: FieldErrors = {};
      const prefix = `${pathPrefix}`;
      for (const [key, value] of Object.entries(prev)) {
        if (prefix) {
          if (key === prefix || key.startsWith(`${prefix}.`)) {
            continue;
          }
        }
        next[key] = value;
      }
      return next;
    });
  }, []);

  const refreshConfig = useCallback(async () => {
    const cfg = await getConfig();
    setForm(withConfigDefaults(cfg ?? undefined));
    setShowMaptilerKey(false);
  }, []);

  // WiFi functions
  const loadWifiStatus = useCallback(async () => {
    try {
      const status = await wifiStatus();
      setWifiStatusData(status);
    } catch (error) {
      console.error("Failed to load WiFi status:", error);
    }
  }, []);

  const handleWifiScan = useCallback(async () => {
    setWifiScanning(true);
    setWifiConnectError(null);
    try {
      const result = await wifiScan();
      setWifiNetworks(result.networks);
      await loadWifiStatus();
    } catch (error) {
      console.error("Failed to scan WiFi:", error);
      setWifiConnectError(
        error instanceof ApiError
          ? `Error al buscar redes WiFi: ${error.status}`
          : "Error al buscar redes WiFi"
      );
    } finally {
      setWifiScanning(false);
    }
  }, [loadWifiStatus]);

  const handleWifiConnect = useCallback(
    async (ssid: string) => {
      setWifiConnecting(true);
      setWifiConnectError(null);
      try {
        const password = wifiConnectPassword[ssid] || undefined;
        await wifiConnect({ ssid, password });
        setBanner({ kind: "success", text: `Conectado a ${ssid}` });
        await loadWifiStatus();
        // Clear password from state after connection
        setWifiConnectPassword((prev) => {
          const next = { ...prev };
          delete next[ssid];
          return next;
        });
      } catch (error) {
        console.error("Failed to connect to WiFi:", error);
        const errorMsg =
          error instanceof ApiError
            ? `Error al conectar: ${(error.body as { detail?: string })?.detail || error.status}`
            : "Error al conectar a la red WiFi";
        setWifiConnectError(errorMsg);
        setBanner({ kind: "error", text: errorMsg });
      } finally {
        setWifiConnecting(false);
      }
    },
    [wifiConnectPassword, loadWifiStatus]
  );

  const handleWifiDisconnect = useCallback(async () => {
    setWifiConnecting(true);
    setWifiConnectError(null);
    try {
      await wifiDisconnect();
      setBanner({ kind: "success", text: "Desconectado de WiFi" });
      await loadWifiStatus();
    } catch (error) {
      console.error("Failed to disconnect WiFi:", error);
      const errorMsg =
        error instanceof ApiError
          ? `Error al desconectar: ${(error.body as { detail?: string })?.detail || error.status}`
          : "Error al desconectar de la red WiFi";
      setWifiConnectError(errorMsg);
      setBanner({ kind: "error", text: errorMsg });
    } finally {
      setWifiConnecting(false);
    }
  }, [loadWifiStatus]);

  // Load WiFi status on mount
  useEffect(() => {
    void loadWifiStatus();
  }, [loadWifiStatus]);

  const initialize = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    setBanner(null);
    setFieldErrors({});
    try {
      await getHealth();
      const schemaPayload = await getSchema();
      setSchema(schemaPayload ?? {});
      await refreshConfig();
      setStatus("ready");
    } catch (error) {
      console.error("[ConfigPage] Backend unreachable", error);
      setStatus("error");
      setErrorMessage(API_ERROR_MESSAGE);
      setBanner({ kind: "error", text: API_ERROR_MESSAGE });
    }
  }, [refreshConfig]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const updateForm = useCallback(<K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleBandChange = (index: number, patch: Partial<MapCinemaBand>) => {
    setForm((prev) => {
      const nextBands = prev.ui.map.cinema.bands.map((band, bandIndex) =>
        bandIndex === index ? { ...band, ...patch } : band,
      );
      return {
        ...prev,
        ui: {
          ...prev.ui,
          map: {
            ...prev.ui.map,
            cinema: {
              ...prev.ui.map.cinema,
              bands: nextBands,
            },
          },
        },
      };
    });
  };

  const handlePanelsChange = (selected: string[]) => {
    updateForm("ui", {
      ...form.ui,
      rotation: {
        ...form.ui.rotation,
        panels: selected,
      },
    });
    resetErrorsFor("ui.rotation.panels");
  };

  const addPanel = () => {
    const trimmed = newPanel.trim();
    if (!trimmed) {
      return;
    }
    if (!form.ui.rotation.panels.includes(trimmed)) {
      handlePanelsChange([...form.ui.rotation.panels, trimmed]);
    }
    setNewPanel("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isReady || saving) {
      return;
    }
    const validationErrors = validateConfig(form, supports);
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setBanner({ kind: "error", text: "Revisa los errores en la configuración" });
      return;
    }

    setSaving(true);
    setBanner(null);
    try {
      const saved = await saveConfig(form);
      setForm(withConfigDefaults(saved));
      setShowMaptilerKey(false);
      setFieldErrors({});
      setBanner({ kind: "success", text: "Guardado" });
    } catch (error) {
      console.error("[ConfigPage] Failed to save configuration", error);
      if (error instanceof ApiError) {
        const backendErrors = extractBackendErrors(error.body);
        setFieldErrors(backendErrors);
        const message = backendErrors.__root__ ?? "El backend rechazó la configuración";
        setBanner({ kind: "error", text: message });
      } else {
        setBanner({ kind: "error", text: "Error al guardar" });
      }
      try {
        await getHealth();
      } catch {
        setStatus("error");
        setErrorMessage(API_ERROR_MESSAGE);
      }
    } finally {
      setSaving(false);
    }
  };

  const renderFieldError = (path: string) => {
    const message = fieldErrors[path];
    if (!message) {
      return null;
    }
    return <span className="config-field__error">{message}</span>;
  };

  const renderHelp = (text: string) => {
    return <span className="config-field__hint">{text}</span>;
  };

  return (
    <div className="config-page">
      {banner && (
        <div className={`config-status config-status--${banner.kind}`} role="status">
          {banner.text}
        </div>
      )}

      {status === "error" && (
        <div className="config-status config-status--error config-error-callout">
          <p>{errorMessage ?? API_ERROR_MESSAGE}</p>
          <button type="button" onClick={() => void initialize()} className="config-button primary">
            Reintentar
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="config-form">
        {supports("display") && (
          <div className="config-card">
            <div>
              <h2>Reloj</h2>
              <p>Define la zona horaria y el ritmo del carrusel principal.</p>
            </div>
            <div className="config-grid">
              {supports("display.timezone") && (
                <div className="config-field">
                  <label htmlFor="timezone">Zona horaria</label>
                  <input
                    id="timezone"
                    type="text"
                    value={form.display.timezone}
                    disabled={disableInputs}
                    onChange={(event) => {
                      updateForm("display", {
                        ...form.display,
                        timezone: event.target.value,
                      });
                      resetErrorsFor("display.timezone");
                    }}
                  />
                  {renderHelp("Formato IANA, p. ej. Europe/Madrid")}
                  {renderFieldError("display.timezone")}
                </div>
              )}

              {supports("display.module_cycle_seconds") && (
                <div className="config-field">
                  <label htmlFor="module_cycle">Segundos por módulo</label>
                  <input
                    id="module_cycle"
                    type="number"
                    min={5}
                    max={600}
                    value={form.display.module_cycle_seconds}
                    disabled={disableInputs}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }
                      updateForm("display", {
                        ...form.display,
                        module_cycle_seconds: value,
                      });
                      resetErrorsFor("display.module_cycle_seconds");
                    }}
                  />
                  {renderHelp("Tiempo que cada módulo permanece en pantalla")}
                  {renderFieldError("display.module_cycle_seconds")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("map") && (
          <div className="config-card">
            <div>
              <h2>Mapas</h2>
              <p>Elige el proveedor y gestiona la API key que usa el kiosco.</p>
            </div>
            <div className="config-grid">
              {supports("map.provider") && (
                <div className="config-field">
                  <label htmlFor="map_provider_backend">Proveedor</label>
                  <select
                    id="map_provider_backend"
                    value={form.map.provider}
                    disabled={disableInputs}
                    onChange={(event) => {
                      const provider = event.target.value as AppConfig["map"]["provider"];
                      setForm((prev) => {
                        const nextKey = provider === "maptiler" ? prev.map.maptiler_api_key : null;
                        return {
                          ...prev,
                          map: {
                            provider,
                            maptiler_api_key: provider === "maptiler" ? nextKey : null,
                          },
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              provider: provider as AppConfig["ui"]["map"]["provider"],
                              maptiler: {
                                ...prev.ui.map.maptiler,
                                key: provider === "maptiler" ? (nextKey ?? prev.ui.map.maptiler.key ?? null) : null,
                              },
                            },
                          },
                        };
                      });
                      if (provider !== "maptiler") {
                        setShowMaptilerKey(false);
                        resetErrorsFor("map.maptiler_api_key");
                      }
                      resetErrorsFor("map.provider");
                      resetErrorsFor("ui.map.provider");
                    }}
                  >
                    {MAP_BACKEND_PROVIDERS.map((option) => (
                      <option key={option} value={option}>
                        {MAP_PROVIDER_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  {renderHelp("Proveedor del mapa base del kiosco")}
                  {renderFieldError("map.provider")}
                  {renderFieldError("ui.map.provider")}
                </div>
              )}

              {supports("map.maptiler_api_key") && form.map.provider === "maptiler" && (
                <div className="config-field">
                  <label htmlFor="maptiler_api_key">API key de MapTiler</label>
                  <div className="config-field__inline">
                    <input
                      id="maptiler_api_key"
                      type={showMaptilerKey ? "text" : "password"}
                      autoComplete="off"
                      value={form.map.maptiler_api_key ?? ""}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const value = event.target.value;
                        setForm((prev) => ({
                          ...prev,
                          map: {
                            ...prev.map,
                            maptiler_api_key: value,
                          },
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              maptiler: {
                                ...prev.ui.map.maptiler,
                                key: value || null,
                              },
                            },
                          },
                        }));
                        resetErrorsFor("map.maptiler_api_key");
                        resetErrorsFor("ui.map.maptiler.key");
                      }}
                    />
                    <button
                      type="button"
                      className="config-button"
                      onClick={() => setShowMaptilerKey((prev) => !prev)}
                      disabled={disableInputs}
                    >
                      {showMaptilerKey ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                  <span className="config-field__hint" title={MAPTILER_DOCS_TEXT}>
                    {MAPTILER_DOCS_TEXT}
                  </span>
                  {renderFieldError("map.maptiler_api_key")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("ui.map") && (
          <div className="config-card">
            <div>
              <h2>Mapa</h2>
              <p>Configura el estilo y el modo cine del mapa principal.</p>
            </div>
            <div className="config-grid">
              {supports("ui.map.style") && (
                <div className="config-field">
                  <label htmlFor="map_style">Estilo</label>
                  <select
                    id="map_style"
                    value={form.ui.map.style}
                    disabled={disableInputs}
                    onChange={(event) => {
                      updateForm("ui", {
                        ...form.ui,
                        map: { ...form.ui.map, style: event.target.value as AppConfig["ui"]["map"]["style"] },
                      });
                      resetErrorsFor("ui.map.style");
                    }}
                  >
                    {MAP_STYLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {renderHelp("Tema base del mapa (vector o raster)")}
                  {renderFieldError("ui.map.style")}
                </div>
              )}

              {supports("ui.map.cinema.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="cinema_enabled">
                    <input
                      id="cinema_enabled"
                      type="checkbox"
                      checked={form.ui.map.cinema.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              cinema: {
                                ...prev.ui.map.cinema,
                                enabled,
                              },
                            },
                          },
                        }));
                        resetErrorsFor("ui.map.cinema.enabled");
                      }}
                    />
                    Activar modo cine
                  </label>
                  {renderHelp(
                    "Habilita el desplazamiento horizontal automático del mapa (modo película)"
                  )}
                </div>
              )}

              {supports("ui.map.cinema.panLngDegPerSec") && (
                <div className="config-field">
                  <label htmlFor="cinema_pan">Velocidad panorámica</label>
                  <input
                    id="cinema_pan"
                    type="number"
                    step="0.01"
                    value={form.ui.map.cinema.panLngDegPerSec}
                    disabled={disableCinemaControls}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }
                      setForm((prev) => ({
                        ...prev,
                        ui: {
                          ...prev.ui,
                          map: {
                            ...prev.ui.map,
                            cinema: {
                              ...prev.ui.map.cinema,
                              panLngDegPerSec: value,
                            },
                          },
                        },
                      }));
                      resetErrorsFor("ui.map.cinema.panLngDegPerSec");
                    }}
                  />
                  {renderHelp("Grados de longitud por segundo")}
                  {renderFieldError("ui.map.cinema.panLngDegPerSec")}
                </div>
              )}

              {supports("ui.map.cinema.bandTransition_sec") && (
                <div className="config-field">
                  <label htmlFor="cinema_transition">Transición entre bandas</label>
                  <input
                    id="cinema_transition"
                    type="number"
                    min={1}
                    value={form.ui.map.cinema.bandTransition_sec}
                    disabled={disableCinemaControls}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }
                      setForm((prev) => ({
                        ...prev,
                        ui: {
                          ...prev.ui,
                          map: {
                            ...prev.ui.map,
                            cinema: {
                              ...prev.ui.map.cinema,
                              bandTransition_sec: value,
                            },
                          },
                        },
                      }));
                      resetErrorsFor("ui.map.cinema.bandTransition_sec");
                    }}
                  />
                  {renderHelp("Duración de la transición en segundos")}
                  {renderFieldError("ui.map.cinema.bandTransition_sec")}
                </div>
              )}

              {supports("ui.map.idlePan.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="idle_pan_enabled">
                    <input
                      id="idle_pan_enabled"
                      type="checkbox"
                      checked={form.ui.map.idlePan.enabled}
                      disabled={disableInputs || cinemaBlocked}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              idlePan: {
                                ...prev.ui.map.idlePan,
                                enabled,
                              },
                            },
                          },
                        }));
                        resetErrorsFor("ui.map.idlePan.enabled");
                      }}
                    />
                    Activar movimiento en reposo
                  </label>
                  {renderHelp("Realiza un pequeño desplazamiento periódico (sin rotación)")}
                </div>
              )}

              {supports("ui.map.idlePan.intervalSec") && (
                <div className="config-field">
                  <label htmlFor="idle_pan_interval">Intervalo entre desplazamientos</label>
                  <input
                    id="idle_pan_interval"
                    type="number"
                    min={10}
                    value={form.ui.map.idlePan.intervalSec}
                    disabled={disableIdlePanControls}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }
                      setForm((prev) => ({
                        ...prev,
                        ui: {
                          ...prev.ui,
                          map: {
                            ...prev.ui.map,
                            idlePan: {
                              ...prev.ui.map.idlePan,
                              intervalSec: value,
                            },
                          },
                        },
                      }));
                      resetErrorsFor("ui.map.idlePan.intervalSec");
                    }}
                  />
                  {renderHelp("Segundos entre cada desplazamiento automático")}
                  {renderFieldError("ui.map.idlePan.intervalSec")}
                </div>
              )}
            </div>

            {supports("ui.map.cinema.bands") && (
              <div className="config-field">
                <label>Bandas cinematográficas</label>
                {renderHelp("Seis posiciones predefinidas para el recorrido mundial")}
                {renderFieldError("ui.map.cinema.bands")}
                <div className="config-table">
                  <div className="config-table__header">
                    <span>Banda</span>
                    <span>Latitud</span>
                    <span>Zoom</span>
                    <span>Pitch</span>
                    <span>minZoom</span>
                    <span>Duración (s)</span>
                  </div>
                  {form.ui.map.cinema.bands.map((band, index) => (
                    <div key={index} className="config-table__row">
                      <span className="config-table__label">{index + 1}</span>
                      <div className="config-table__cell">
                        <input
                          type="number"
                          disabled={disableCinemaControls}
                          value={band.lat}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isNaN(value)) return;
                            handleBandChange(index, { lat: value });
                            resetErrorsFor(`ui.map.cinema.bands.${index}.lat`);
                          }}
                        />
                        {renderFieldError(`ui.map.cinema.bands.${index}.lat`)}
                      </div>
                      <div className="config-table__cell">
                        <input
                          type="number"
                          step="0.1"
                          disabled={disableCinemaControls}
                          value={band.zoom}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isNaN(value)) return;
                            handleBandChange(index, { zoom: value });
                            resetErrorsFor(`ui.map.cinema.bands.${index}.zoom`);
                          }}
                        />
                        {renderFieldError(`ui.map.cinema.bands.${index}.zoom`)}
                      </div>
                      <div className="config-table__cell">
                        <input
                          type="number"
                          step="0.1"
                          disabled={disableCinemaControls}
                          value={band.pitch}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isNaN(value)) return;
                            handleBandChange(index, { pitch: value });
                            resetErrorsFor(`ui.map.cinema.bands.${index}.pitch`);
                          }}
                        />
                        {renderFieldError(`ui.map.cinema.bands.${index}.pitch`)}
                      </div>
                      <div className="config-table__cell">
                        <input
                          type="number"
                          step="0.1"
                          disabled={disableCinemaControls}
                          value={band.minZoom}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isNaN(value)) return;
                            handleBandChange(index, { minZoom: value });
                            resetErrorsFor(`ui.map.cinema.bands.${index}.minZoom`);
                          }}
                        />
                        {renderFieldError(`ui.map.cinema.bands.${index}.minZoom`)}
                      </div>
                      <div className="config-table__cell">
                        <input
                          type="number"
                          min={1}
                          disabled={disableCinemaControls}
                          value={band.duration_sec}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isNaN(value)) return;
                            handleBandChange(index, { duration_sec: value });
                            resetErrorsFor(`ui.map.cinema.bands.${index}.duration_sec`);
                          }}
                        />
                        {renderFieldError(`ui.map.cinema.bands.${index}.duration_sec`)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {supports("ui.map.theme") && (
              <div className="config-grid">
                {supports("ui.map.theme.sea") && (
                  <div className="config-field">
                    <label htmlFor="theme_sea">Color mar</label>
                    <input
                      id="theme_sea"
                      type="text"
                      value={form.ui.map.theme.sea}
                      disabled={disableInputs}
                      onChange={(event) => {
                        setForm((prev) => ({
                          ...prev,
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              theme: { ...prev.ui.map.theme, sea: event.target.value },
                            },
                          },
                        }));
                      }}
                    />
                    {renderHelp("Color hexadecimal del agua")}
                  </div>
                )}

                {supports("ui.map.theme.land") && (
                  <div className="config-field">
                    <label htmlFor="theme_land">Color tierra</label>
                    <input
                      id="theme_land"
                      type="text"
                      value={form.ui.map.theme.land}
                      disabled={disableInputs}
                      onChange={(event) => {
                        setForm((prev) => ({
                          ...prev,
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              theme: { ...prev.ui.map.theme, land: event.target.value },
                            },
                          },
                        }));
                      }}
                    />
                    {renderHelp("Color base para continentes")}
                  </div>
                )}

                {supports("ui.map.theme.label") && (
                  <div className="config-field">
                    <label htmlFor="theme_label">Color etiquetas</label>
                    <input
                      id="theme_label"
                      type="text"
                      value={form.ui.map.theme.label}
                      disabled={disableInputs}
                      onChange={(event) => {
                        setForm((prev) => ({
                          ...prev,
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              theme: { ...prev.ui.map.theme, label: event.target.value },
                            },
                          },
                        }));
                      }}
                    />
                    {renderHelp("Color de texto en el mapa")}
                  </div>
                )}

                {supports("ui.map.theme.contrast") && (
                  <div className="config-field">
                    <label htmlFor="theme_contrast">Contraste</label>
                    <input
                      id="theme_contrast"
                      type="number"
                      step="0.01"
                      value={form.ui.map.theme.contrast}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isNaN(value)) return;
                        setForm((prev) => ({
                          ...prev,
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              theme: { ...prev.ui.map.theme, contrast: value },
                            },
                          },
                        }));
                        resetErrorsFor("ui.map.theme.contrast");
                      }}
                    />
                    {renderHelp("Intensidad del contraste adicional")}
                    {renderFieldError("ui.map.theme.contrast")}
                  </div>
                )}

                {supports("ui.map.theme.tint") && (
                  <div className="config-field">
                    <label htmlFor="theme_tint">Capa de tinte</label>
                    <input
                      id="theme_tint"
                      type="text"
                      value={form.ui.map.theme.tint}
                      disabled={disableInputs}
                      onChange={(event) => {
                        setForm((prev) => ({
                          ...prev,
                          ui: {
                            ...prev.ui,
                            map: {
                              ...prev.ui.map,
                              theme: { ...prev.ui.map.theme, tint: event.target.value },
                            },
                          },
                        }));
                      }}
                    />
                    {renderHelp("RGBA opcional para resaltar el mapa")}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {supports("ui.rotation") && (
          <div className="config-card">
            <div>
              <h2>Rotación de paneles</h2>
              <p>Controla la duración y las tarjetas presentes en la rotación.</p>
            </div>
            <div className="config-grid">
              {supports("ui.rotation.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="rotation_enabled">
                    <input
                      id="rotation_enabled"
                      type="checkbox"
                      checked={form.ui.rotation.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        updateForm("ui", {
                          ...form.ui,
                          rotation: { ...form.ui.rotation, enabled },
                        });
                        resetErrorsFor("ui.rotation.enabled");
                      }}
                    />
                    Activar rotación automática
                  </label>
                  {renderHelp("Permite alternar los módulos y habilita el modo cine del mapa")}
                </div>
              )}

              {supports("ui.rotation.duration_sec") && (
                <div className="config-field">
                  <label htmlFor="rotation_duration">Duración por panel</label>
                  <input
                    id="rotation_duration"
                    type="number"
                    min={3}
                    max={3600}
                    value={form.ui.rotation.duration_sec}
                    disabled={disableInputs}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) return;
                      updateForm("ui", {
                        ...form.ui,
                        rotation: { ...form.ui.rotation, duration_sec: value },
                      });
                      resetErrorsFor("ui.rotation.duration_sec");
                    }}
                  />
                  {renderHelp("Segundos que dura cada tarjeta en pantalla")}
                  {renderFieldError("ui.rotation.duration_sec")}
                </div>
              )}

              {supports("ui.rotation.panels") && (
                <div className="config-field">
                  <label htmlFor="rotation_panels">Paneles en rotación</label>
                  <select
                    id="rotation_panels"
                    multiple
                    value={form.ui.rotation.panels}
                    disabled={disableInputs}
                    onChange={(event) => {
                      const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                      handlePanelsChange(selected);
                      resetErrorsFor("ui.rotation.panels");
                    }}
                  >
                    {panelOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {renderHelp("Selecciona los paneles que deben rotar")}
                  {renderFieldError("ui.rotation.panels")}
                  <div className="config-field__inline">
                    <input
                      type="text"
                      value={newPanel}
                      disabled={disableInputs}
                      placeholder="Añadir panel personalizado"
                      onChange={(event) => setNewPanel(event.target.value)}
                    />
                    <button
                      type="button"
                      className="config-button"
                      disabled={disableInputs || !newPanel.trim()}
                      onClick={addPanel}
                    >
                      Añadir
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {supports("ai.enabled") && (
          <div className="config-card">
            <div>
              <h2>Módulos</h2>
              <p>Activa o desactiva contenido adicional.</p>
            </div>
            <div className="config-grid">
              {supports("ai.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="ai_enabled">
                    <input
                      id="ai_enabled"
                      type="checkbox"
                      checked={form.ai.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        updateForm("ai", { enabled: event.target.checked });
                      }}
                    />
                    Funciones experimentales de IA
                  </label>
                  {renderHelp("Reserva para experiencias asistidas por IA")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("storm") && (
          <div className="config-card">
            <div>
              <h2>Modo Tormenta</h2>
              <p>Configuración para el modo de visualización de tormentas locales con rayos.</p>
            </div>
            <div className="config-grid">
              {supports("storm.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="storm_enabled">
                    <input
                      id="storm_enabled"
                      type="checkbox"
                      checked={form.storm.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          storm: {
                            ...prev.storm,
                            enabled,
                          },
                        }));
                        resetErrorsFor("storm.enabled");
                      }}
                    />
                    Activar modo tormenta
                  </label>
                  {renderHelp("Activa el modo de visualización para tormentas locales (zoom Castellón/Vila-real)"}
                </div>
              )}

              {supports("storm.center_lat") && (
                <div className="config-field">
                  <label htmlFor="storm_center_lat">Latitud del centro</label>
                  <input
                    id="storm_center_lat"
                    type="number"
                    step="0.001"
                    min="-90"
                    max="90"
                    value={form.storm.center_lat}
                    disabled={disableInputs || !form.storm.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          storm: {
                            ...prev.storm,
                            center_lat: Math.max(-90, Math.min(90, value)),
                          },
                        }));
                        resetErrorsFor("storm.center_lat");
                      }
                    }}
                  />
                  {renderHelp("Latitud del punto central del modo tormenta (Castellón: 39.986)")}
                  {renderFieldError("storm.center_lat")}
                </div>
              )}

              {supports("storm.center_lng") && (
                <div className="config-field">
                  <label htmlFor="storm_center_lng">Longitud del centro</label>
                  <input
                    id="storm_center_lng"
                    type="number"
                    step="0.001"
                    min="-180"
                    max="180"
                    value={form.storm.center_lng}
                    disabled={disableInputs || !form.storm.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          storm: {
                            ...prev.storm,
                            center_lng: Math.max(-180, Math.min(180, value)),
                          },
                        }));
                        resetErrorsFor("storm.center_lng");
                      }
                    }}
                  />
                  {renderHelp("Longitud del punto central del modo tormenta (Vila-real: -0.051)")}
                  {renderFieldError("storm.center_lng")}
                </div>
              )}

              {supports("storm.zoom") && (
                <div className="config-field">
                  <label htmlFor="storm_zoom">Nivel de zoom</label>
                  <input
                    id="storm_zoom"
                    type="number"
                    step="0.1"
                    min="1"
                    max="20"
                    value={form.storm.zoom}
                    disabled={disableInputs || !form.storm.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          storm: {
                            ...prev.storm,
                            zoom: Math.max(1, Math.min(20, value)),
                          },
                        }));
                        resetErrorsFor("storm.zoom");
                      }
                    }}
                  />
                  {renderHelp("Nivel de zoom cuando se active el modo tormenta (9.0 = recomendado)")}
                  {renderFieldError("storm.zoom")}
                </div>
              )}

              {supports("storm.auto_enable") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="storm_auto_enable">
                    <input
                      id="storm_auto_enable"
                      type="checkbox"
                      checked={form.storm.auto_enable}
                      disabled={disableInputs || !form.storm.enabled}
                      onChange={(event) => {
                        const auto_enable = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          storm: {
                            ...prev.storm,
                            auto_enable,
                          },
                        }));
                        resetErrorsFor("storm.auto_enable");
                      }}
                    />
                    Activar automáticamente
                  </label>
                  {renderHelp("Activa el modo tormenta automáticamente cuando se detecten rayos (requiere Blitzortung)")}
                </div>
              )}

              {supports("storm.auto_disable_after_minutes") && (
                <div className="config-field">
                  <label htmlFor="storm_auto_disable">Auto-desactivar después de (minutos)</label>
                  <input
                    id="storm_auto_disable"
                    type="number"
                    min="5"
                    max="1440"
                    value={form.storm.auto_disable_after_minutes}
                    disabled={disableInputs || !form.storm.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          storm: {
                            ...prev.storm,
                            auto_disable_after_minutes: Math.max(5, Math.min(1440, Math.round(value))),
                          },
                        }));
                        resetErrorsFor("storm.auto_disable_after_minutes");
                      }
                    }}
                  />
                  {renderHelp("Minutos antes de desactivar automáticamente el modo tormenta (5-1440)")}
                  {renderFieldError("storm.auto_disable_after_minutes")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("news") && (
          <div className="config-card">
            <div>
              <h2>Noticias RSS</h2>
              <p>Configura los feeds RSS para obtener noticias del día.</p>
            </div>
            <div className="config-grid">
              {supports("news.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="news_enabled">
                    <input
                      id="news_enabled"
                      type="checkbox"
                      checked={form.news.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          news: {
                            ...prev.news,
                            enabled,
                          },
                        }));
                        resetErrorsFor("news.enabled");
                      }}
                    />
                    Activar noticias RSS
                  </label>
                  {renderHelp("Habilita la carga de noticias desde feeds RSS")}
                </div>
              )}

              {supports("news.rss_feeds") && (
                <div className="config-field">
                  <label htmlFor="news_rss_feeds">Feeds RSS (uno por línea)</label>
                  <textarea
                    id="news_rss_feeds"
                    rows={4}
                    value={form.news.rss_feeds.join("\n")}
                    disabled={disableInputs || !form.news.enabled}
                    onChange={(event) => {
                      const feeds = event.target.value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0);
                      setForm((prev) => ({
                        ...prev,
                        news: {
                          ...prev.news,
                          rss_feeds: feeds.length > 0 ? feeds : ["https://www.elperiodicomediterraneo.com/rss"],
                        },
                      }));
                      resetErrorsFor("news.rss_feeds");
                    }}
                    placeholder="https://www.elperiodicomediterraneo.com/rss&#10;https://www.xataka.com/feed"
                  />
                  {renderHelp("URLs de feeds RSS, una por línea (ej: Periódico Mediterráneo, Xataka)")}
                  {renderFieldError("news.rss_feeds")}
                </div>
              )}

              {supports("news.max_items_per_feed") && (
                <div className="config-field">
                  <label htmlFor="news_max_items">Máximo de artículos por feed</label>
                  <input
                    id="news_max_items"
                    type="number"
                    min="1"
                    max="50"
                    value={form.news.max_items_per_feed}
                    disabled={disableInputs || !form.news.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          news: {
                            ...prev.news,
                            max_items_per_feed: Math.max(1, Math.min(50, Math.round(value))),
                          },
                        }));
                        resetErrorsFor("news.max_items_per_feed");
                      }
                    }}
                  />
                  {renderHelp("Número máximo de artículos a mostrar por cada feed RSS (1-50)")}
                  {renderFieldError("news.max_items_per_feed")}
                </div>
              )}

              {supports("news.refresh_minutes") && (
                <div className="config-field">
                  <label htmlFor="news_refresh">Intervalo de actualización (minutos)</label>
                  <input
                    id="news_refresh"
                    type="number"
                    min="5"
                    max="1440"
                    value={form.news.refresh_minutes}
                    disabled={disableInputs || !form.news.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          news: {
                            ...prev.news,
                            refresh_minutes: Math.max(5, Math.min(1440, Math.round(value))),
                          },
                        }));
                        resetErrorsFor("news.refresh_minutes");
                      }
                    }}
                  />
                  {renderHelp("Cada cuántos minutos se actualizan las noticias (5-1440)")}
                  {renderFieldError("news.refresh_minutes")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("calendar") && (
          <div className="config-card">
            <div>
              <h2>Google Calendar</h2>
              <p>Configura la integración con Google Calendar para mostrar eventos.</p>
            </div>
            <div className="config-grid">
              {supports("calendar.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="calendar_enabled">
                    <input
                      id="calendar_enabled"
                      type="checkbox"
                      checked={form.calendar.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          calendar: {
                            ...prev.calendar,
                            enabled,
                          },
                        }));
                        resetErrorsFor("calendar.enabled");
                      }}
                    />
                    Activar Google Calendar
                  </label>
                  {renderHelp("Habilita la integración con Google Calendar")}
                </div>
              )}

              {supports("calendar.google_api_key") && (
                <div className="config-field">
                  <label htmlFor="calendar_api_key">API Key de Google Calendar</label>
                  <input
                    id="calendar_api_key"
                    type="text"
                    value={form.calendar.google_api_key || ""}
                    disabled={disableInputs || !form.calendar.enabled}
                    onChange={(event) => {
                      const api_key = event.target.value.trim() || null;
                      setForm((prev) => ({
                        ...prev,
                        calendar: {
                          ...prev.calendar,
                          google_api_key: api_key,
                        },
                      }));
                      resetErrorsFor("calendar.google_api_key");
                    }}
                    placeholder="AIza..."
                  />
                  {renderHelp("API key de Google Calendar (opcional, se puede obtener en Google Cloud Console)")}
                  {renderFieldError("calendar.google_api_key")}
                </div>
              )}

              {supports("calendar.google_calendar_id") && (
                <div className="config-field">
                  <label htmlFor="calendar_calendar_id">Calendar ID</label>
                  <input
                    id="calendar_calendar_id"
                    type="text"
                    value={form.calendar.google_calendar_id || ""}
                    disabled={disableInputs || !form.calendar.enabled}
                    onChange={(event) => {
                      const calendar_id = event.target.value.trim() || null;
                      setForm((prev) => ({
                        ...prev,
                        calendar: {
                          ...prev.calendar,
                          google_calendar_id: calendar_id,
                        },
                      }));
                      resetErrorsFor("calendar.google_calendar_id");
                    }}
                    placeholder="primary o example@gmail.com"
                  />
                  {renderHelp("ID del calendario de Google (ej: 'primary' o dirección de email)")}
                  {renderFieldError("calendar.google_calendar_id")}
                </div>
              )}

              {supports("calendar.days_ahead") && (
                <div className="config-field">
                  <label htmlFor="calendar_days_ahead">Días adelante</label>
                  <input
                    id="calendar_days_ahead"
                    type="number"
                    min="1"
                    max="90"
                    value={form.calendar.days_ahead}
                    disabled={disableInputs || !form.calendar.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          calendar: {
                            ...prev.calendar,
                            days_ahead: Math.max(1, Math.min(90, Math.round(value))),
                          },
                        }));
                        resetErrorsFor("calendar.days_ahead");
                      }
                    }}
                  />
                  {renderHelp("Número de días adelante para obtener eventos (1-90)")}
                  {renderFieldError("calendar.days_ahead")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("harvest") && (
          <div className="config-card">
            <div>
              <h2>Hortalizas y Cultivos</h2>
              <p>Configura los cultivos estacionales y personalizados a mostrar.</p>
            </div>
            <div className="config-grid">
              {supports("harvest.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="harvest_enabled">
                    <input
                      id="harvest_enabled"
                      type="checkbox"
                      checked={form.harvest.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          harvest: {
                            ...prev.harvest,
                            enabled,
                          },
                        }));
                        resetErrorsFor("harvest.enabled");
                      }}
                    />
                    Activar hortalizas estacionales
                  </label>
                  {renderHelp("Muestra las hortalizas y cultivos en temporada según el mes actual")}
                </div>
              )}

              {supports("harvest.custom_items") && (
                <div className="config-field">
                  <label>Items personalizados (JSON)</label>
                  <textarea
                    rows={6}
                    value={JSON.stringify(form.harvest.custom_items, null, 2)}
                    disabled={disableInputs || !form.harvest.enabled}
                    onChange={(event) => {
                      try {
                        const items = JSON.parse(event.target.value);
                        if (Array.isArray(items)) {
                          setForm((prev) => ({
                            ...prev,
                            harvest: {
                              ...prev.harvest,
                              custom_items: items,
                            },
                          }));
                          resetErrorsFor("harvest.custom_items");
                        }
                      } catch {
                        // Ignore invalid JSON
                      }
                    }}
                    placeholder='[{"name": "Tomates", "status": "Temporada"}, ...]'
                  />
                  {renderHelp("Items personalizados de cultivos en formato JSON (se combinan con los estacionales)")}
                  {renderFieldError("harvest.custom_items")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("saints") && (
          <div className="config-card">
            <div>
              <h2>Santoral</h2>
              <p>Configura el santoral y onomásticos del día.</p>
            </div>
            <div className="config-grid">
              {supports("saints.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="saints_enabled">
                    <input
                      id="saints_enabled"
                      type="checkbox"
                      checked={form.saints.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          saints: {
                            ...prev.saints,
                            enabled,
                          },
                        }));
                        resetErrorsFor("saints.enabled");
                      }}
                    />
                    Activar santoral
                  </label>
                  {renderHelp("Muestra los santos del día en el panel rotativo")}
                </div>
              )}

              {supports("saints.include_namedays") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="saints_namedays">
                    <input
                      id="saints_namedays"
                      type="checkbox"
                      checked={form.saints.include_namedays}
                      disabled={disableInputs || !form.saints.enabled}
                      onChange={(event) => {
                        const include_namedays = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          saints: {
                            ...prev.saints,
                            include_namedays,
                          },
                        }));
                        resetErrorsFor("saints.include_namedays");
                      }}
                    />
                    Incluir onomásticos
                  </label>
                  {renderHelp("Incluye los onomásticos junto con los santos del día")}
                </div>
              )}

              {supports("saints.locale") && (
                <div className="config-field">
                  <label htmlFor="saints_locale">Locale</label>
                  <input
                    id="saints_locale"
                    type="text"
                    maxLength={5}
                    value={form.saints.locale}
                    disabled={disableInputs || !form.saints.enabled}
                    onChange={(event) => {
                      const locale = event.target.value.substring(0, 5);
                      setForm((prev) => ({
                        ...prev,
                        saints: {
                          ...prev.saints,
                          locale,
                        },
                      }));
                      resetErrorsFor("saints.locale");
                    }}
                    placeholder="es"
                  />
                  {renderHelp("Código de locale para los nombres (ej: 'es' para español)")}
                  {renderFieldError("saints.locale")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("ephemerides") && (
          <div className="config-card">
            <div>
              <h2>Efemérides</h2>
              <p>Configura los cálculos astronómicos (salida/puesta de sol, fases lunares).</p>
            </div>
            <div className="config-grid">
              {supports("ephemerides.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="ephemerides_enabled">
                    <input
                      id="ephemerides_enabled"
                      type="checkbox"
                      checked={form.ephemerides.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          ephemerides: {
                            ...prev.ephemerides,
                            enabled,
                          },
                        }));
                        resetErrorsFor("ephemerides.enabled");
                      }}
                    />
                    Activar efemérides
                  </label>
                  {renderHelp("Habilita los cálculos astronómicos (sol, luna)")}
                </div>
              )}

              {supports("ephemerides.latitude") && (
                <div className="config-field">
                  <label htmlFor="ephemerides_lat">Latitud</label>
                  <input
                    id="ephemerides_lat"
                    type="number"
                    step="0.001"
                    min="-90"
                    max="90"
                    value={form.ephemerides.latitude}
                    disabled={disableInputs || !form.ephemerides.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          ephemerides: {
                            ...prev.ephemerides,
                            latitude: Math.max(-90, Math.min(90, value)),
                          },
                        }));
                        resetErrorsFor("ephemerides.latitude");
                      }
                    }}
                  />
                  {renderHelp("Latitud para cálculos astronómicos (Castellón: 39.986)")}
                  {renderFieldError("ephemerides.latitude")}
                </div>
              )}

              {supports("ephemerides.longitude") && (
                <div className="config-field">
                  <label htmlFor="ephemerides_lng">Longitud</label>
                  <input
                    id="ephemerides_lng"
                    type="number"
                    step="0.001"
                    min="-180"
                    max="180"
                    value={form.ephemerides.longitude}
                    disabled={disableInputs || !form.ephemerides.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          ephemerides: {
                            ...prev.ephemerides,
                            longitude: Math.max(-180, Math.min(180, value)),
                          },
                        }));
                        resetErrorsFor("ephemerides.longitude");
                      }
                    }}
                  />
                  {renderHelp("Longitud para cálculos astronómicos (Vila-real: -0.051)")}
                  {renderFieldError("ephemerides.longitude")}
                </div>
              )}

              {supports("ephemerides.timezone") && (
                <div className="config-field">
                  <label htmlFor="ephemerides_timezone">Zona horaria</label>
                  <input
                    id="ephemerides_timezone"
                    type="text"
                    value={form.ephemerides.timezone}
                    disabled={disableInputs || !form.ephemerides.enabled}
                    onChange={(event) => {
                      const timezone = event.target.value.trim();
                      setForm((prev) => ({
                        ...prev,
                        ephemerides: {
                          ...prev.ephemerides,
                          timezone,
                        },
                      }));
                      resetErrorsFor("ephemerides.timezone");
                    }}
                    placeholder="Europe/Madrid"
                  />
                  {renderHelp("Zona horaria para los cálculos (ej: 'Europe/Madrid')")}
                  {renderFieldError("ephemerides.timezone")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("layers") && (
          <div className="config-card">
            <div>
              <h2>Capas en Tiempo Real</h2>
              <p>Configura las capas de aviones (flights) y barcos (ships) en tiempo real.</p>
            </div>
            <div className="config-grid">
              {supports("layers.flights") && (
                <>
                  <div className="config-field config-field--checkbox">
                    <label htmlFor="flights_enabled">
                      <input
                        id="flights_enabled"
                        type="checkbox"
                        checked={form.layers.flights.enabled}
                        disabled={disableInputs}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              flights: {
                                ...prev.layers.flights,
                                enabled,
                              },
                            },
                          }));
                          resetErrorsFor("layers.flights.enabled");
                        }}
                      />
                      Activar capa de aviones
                    </label>
                    {renderHelp("Muestra aviones en tiempo real en el mapa")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="flights_opacity">Opacidad</label>
                    <input
                      id="flights_opacity"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={form.layers.flights.opacity}
                      disabled={disableInputs || !form.layers.flights.enabled}
                      onChange={(event) => {
                        const opacity = Number(event.target.value);
                        if (!Number.isNaN(opacity)) {
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              flights: {
                                ...prev.layers.flights,
                                opacity: Math.max(0, Math.min(1, opacity)),
                              },
                            },
                          }));
                          resetErrorsFor("layers.flights.opacity");
                        }
                      }}
                    />
                    <span>{Math.round(form.layers.flights.opacity * 100)}%</span>
                    {renderHelp("Opacidad de la capa de aviones (0.0 - 1.0)")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="flights_refresh">Intervalo de actualización (segundos)</label>
                    <input
                      id="flights_refresh"
                      type="number"
                      min="1"
                      max="300"
                      value={form.layers.flights.refresh_seconds}
                      disabled={disableInputs || !form.layers.flights.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              flights: {
                                ...prev.layers.flights,
                                refresh_seconds: Math.max(1, Math.min(300, Math.round(value))),
                              },
                            },
                          }));
                          resetErrorsFor("layers.flights.refresh_seconds");
                        }
                      }}
                    />
                    {renderHelp("Cada cuántos segundos se actualizan los datos de aviones (1-300)")}
                    {renderFieldError("layers.flights.refresh_seconds")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="flights_max_age">Máxima edad de datos (segundos)</label>
                    <input
                      id="flights_max_age"
                      type="number"
                      min="10"
                      max="600"
                      value={form.layers.flights.max_age_seconds}
                      disabled={disableInputs || !form.layers.flights.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              flights: {
                                ...prev.layers.flights,
                                max_age_seconds: Math.max(10, Math.min(600, Math.round(value))),
                              },
                            },
                          }));
                          resetErrorsFor("layers.flights.max_age_seconds");
                        }
                      }}
                    />
                    {renderHelp("Tiempo máximo antes de ocultar datos antiguos (10-600)")}
                    {renderFieldError("layers.flights.max_age_seconds")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="flights_provider">Proveedor</label>
                    <select
                      id="flights_provider"
                      value={form.layers.flights.provider}
                      disabled={disableInputs || !form.layers.flights.enabled}
                      onChange={(event) => {
                        const provider = event.target.value as "opensky" | "aviationstack" | "custom";
                        setForm((prev) => ({
                          ...prev,
                          layers: {
                            ...prev.layers,
                            flights: {
                              ...prev.layers.flights,
                              provider,
                            },
                          },
                        }));
                        resetErrorsFor("layers.flights.provider");
                      }}
                    >
                      <option value="opensky">OpenSky Network</option>
                      <option value="aviationstack">AviationStack</option>
                      <option value="custom">Custom</option>
                    </select>
                    {renderHelp("Selecciona el proveedor de datos de vuelos")}
                    {renderFieldError("layers.flights.provider")}
                  </div>

                  {form.layers.flights.provider === "opensky" && (
                    <>
                      <div className="config-field">
                        <label htmlFor="flights_opensky_username">Usuario OpenSky (opcional)</label>
                        <input
                          id="flights_opensky_username"
                          type="text"
                          maxLength={128}
                          value={form.layers.flights.opensky?.username || ""}
                          disabled={disableInputs || !form.layers.flights.enabled}
                          onChange={(event) => {
                            const username = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                flights: {
                                  ...prev.layers.flights,
                                  opensky: {
                                    ...prev.layers.flights.opensky,
                                    username,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.flights.opensky.username");
                          }}
                        />
                        {renderHelp("Usuario de OpenSky Network (opcional, mejora límites de tasa)")}
                      </div>

                      <div className="config-field">
                        <label htmlFor="flights_opensky_password">Contraseña OpenSky (opcional)</label>
                        <input
                          id="flights_opensky_password"
                          type="password"
                          maxLength={128}
                          value={form.layers.flights.opensky?.password || ""}
                          disabled={disableInputs || !form.layers.flights.enabled}
                          onChange={(event) => {
                            const password = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                flights: {
                                  ...prev.layers.flights,
                                  opensky: {
                                    ...prev.layers.flights.opensky,
                                    password,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.flights.opensky.password");
                          }}
                        />
                        {renderHelp("Contraseña de OpenSky Network (opcional)")}
                      </div>
                    </>
                  )}

                  {form.layers.flights.provider === "aviationstack" && (
                    <>
                      <div className="config-field">
                        <label htmlFor="flights_aviationstack_base_url">URL Base AviationStack</label>
                        <input
                          id="flights_aviationstack_base_url"
                          type="url"
                          maxLength={256}
                          value={form.layers.flights.aviationstack?.base_url || ""}
                          disabled={disableInputs || !form.layers.flights.enabled}
                          onChange={(event) => {
                            const base_url = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                flights: {
                                  ...prev.layers.flights,
                                  aviationstack: {
                                    ...prev.layers.flights.aviationstack,
                                    base_url,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.flights.aviationstack.base_url");
                          }}
                        />
                        {renderHelp("URL base de la API de AviationStack")}
                      </div>

                      <div className="config-field">
                        <label htmlFor="flights_aviationstack_api_key">API Key AviationStack</label>
                        <input
                          id="flights_aviationstack_api_key"
                          type="text"
                          maxLength={256}
                          value={form.layers.flights.aviationstack?.api_key || ""}
                          disabled={disableInputs || !form.layers.flights.enabled}
                          onChange={(event) => {
                            const api_key = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                flights: {
                                  ...prev.layers.flights,
                                  aviationstack: {
                                    ...prev.layers.flights.aviationstack,
                                    api_key,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.flights.aviationstack.api_key");
                          }}
                        />
                        {renderHelp("API key de AviationStack (requerida para usar este proveedor)")}
                      </div>
                    </>
                  )}
                </>
              )}

              {supports("layers.ships") && (
                <>
                  <div className="config-field config-field--checkbox">
                    <label htmlFor="ships_enabled">
                      <input
                        id="ships_enabled"
                        type="checkbox"
                        checked={form.layers.ships.enabled}
                        disabled={disableInputs}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              ships: {
                                ...prev.layers.ships,
                                enabled,
                              },
                            },
                          }));
                          resetErrorsFor("layers.ships.enabled");
                        }}
                      />
                      Activar capa de barcos
                    </label>
                    {renderHelp("Muestra barcos en tiempo real en el mapa (AIS)")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="ships_opacity">Opacidad</label>
                    <input
                      id="ships_opacity"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={form.layers.ships.opacity}
                      disabled={disableInputs || !form.layers.ships.enabled}
                      onChange={(event) => {
                        const opacity = Number(event.target.value);
                        if (!Number.isNaN(opacity)) {
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              ships: {
                                ...prev.layers.ships,
                                opacity: Math.max(0, Math.min(1, opacity)),
                              },
                            },
                          }));
                          resetErrorsFor("layers.ships.opacity");
                        }
                      }}
                    />
                    <span>{Math.round(form.layers.ships.opacity * 100)}%</span>
                    {renderHelp("Opacidad de la capa de barcos (0.0 - 1.0)")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="ships_refresh">Intervalo de actualización (segundos)</label>
                    <input
                      id="ships_refresh"
                      type="number"
                      min="1"
                      max="300"
                      value={form.layers.ships.refresh_seconds}
                      disabled={disableInputs || !form.layers.ships.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              ships: {
                                ...prev.layers.ships,
                                refresh_seconds: Math.max(1, Math.min(300, Math.round(value))),
                              },
                            },
                          }));
                          resetErrorsFor("layers.ships.refresh_seconds");
                        }
                      }}
                    />
                    {renderHelp("Cada cuántos segundos se actualizan los datos de barcos (1-300)")}
                    {renderFieldError("layers.ships.refresh_seconds")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="ships_max_age">Máxima edad de datos (segundos)</label>
                    <input
                      id="ships_max_age"
                      type="number"
                      min="10"
                      max="600"
                      value={form.layers.ships.max_age_seconds}
                      disabled={disableInputs || !form.layers.ships.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              ships: {
                                ...prev.layers.ships,
                                max_age_seconds: Math.max(10, Math.min(600, Math.round(value))),
                              },
                            },
                          }));
                          resetErrorsFor("layers.ships.max_age_seconds");
                        }
                      }}
                    />
                    {renderHelp("Tiempo máximo antes de ocultar datos antiguos (10-600)")}
                    {renderFieldError("layers.ships.max_age_seconds")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="ships_provider">Proveedor</label>
                    <select
                      id="ships_provider"
                      value={form.layers.ships.provider}
                      disabled={disableInputs || !form.layers.ships.enabled}
                      onChange={(event) => {
                        const provider = event.target.value as "ais_generic" | "aisstream" | "aishub" | "custom";
                        setForm((prev) => ({
                          ...prev,
                          layers: {
                            ...prev.layers,
                            ships: {
                              ...prev.layers.ships,
                              provider,
                            },
                          },
                        }));
                        resetErrorsFor("layers.ships.provider");
                      }}
                    >
                      <option value="ais_generic">Generic AIS (Demo)</option>
                      <option value="aisstream">AISStream</option>
                      <option value="aishub">AISHub</option>
                      <option value="custom">Custom</option>
                    </select>
                    {renderHelp("Selecciona el proveedor de datos de barcos")}
                    {renderFieldError("layers.ships.provider")}
                  </div>

                  {form.layers.ships.provider === "ais_generic" && (
                    <>
                      <div className="config-field">
                        <label htmlFor="ships_ais_generic_api_url">URL API AIS (opcional)</label>
                        <input
                          id="ships_ais_generic_api_url"
                          type="url"
                          maxLength={256}
                          value={form.layers.ships.ais_generic?.api_url || ""}
                          disabled={disableInputs || !form.layers.ships.enabled}
                          onChange={(event) => {
                            const api_url = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                ships: {
                                  ...prev.layers.ships,
                                  ais_generic: {
                                    ...prev.layers.ships.ais_generic,
                                    api_url,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.ships.ais_generic.api_url");
                          }}
                        />
                        {renderHelp("URL de la API AIS personalizada (opcional, usa demo si está vacío)")}
                      </div>

                      <div className="config-field">
                        <label htmlFor="ships_ais_generic_api_key">API Key AIS (opcional)</label>
                        <input
                          id="ships_ais_generic_api_key"
                          type="text"
                          maxLength={256}
                          value={form.layers.ships.ais_generic?.api_key || ""}
                          disabled={disableInputs || !form.layers.ships.enabled}
                          onChange={(event) => {
                            const api_key = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                ships: {
                                  ...prev.layers.ships,
                                  ais_generic: {
                                    ...prev.layers.ships.ais_generic,
                                    api_key,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.ships.ais_generic.api_key");
                          }}
                        />
                        {renderHelp("API key de la API AIS personalizada (opcional)")}
                      </div>
                    </>
                  )}

                  {form.layers.ships.provider === "aisstream" && (
                    <>
                      <div className="config-field">
                        <label htmlFor="ships_aisstream_ws_url">WebSocket/URL AISStream</label>
                        <input
                          id="ships_aisstream_ws_url"
                          type="url"
                          maxLength={256}
                          value={form.layers.ships.aisstream?.ws_url || ""}
                          disabled={disableInputs || !form.layers.ships.enabled}
                          onChange={(event) => {
                            const ws_url = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                ships: {
                                  ...prev.layers.ships,
                                  aisstream: {
                                    ...prev.layers.ships.aisstream,
                                    ws_url,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.ships.aisstream.ws_url");
                          }}
                        />
                        {renderHelp("URL WebSocket o REST de AISStream")}
                      </div>

                      <div className="config-field">
                        <label htmlFor="ships_aisstream_api_key">API Key AISStream (opcional)</label>
                        <input
                          id="ships_aisstream_api_key"
                          type="text"
                          maxLength={256}
                          value={form.layers.ships.aisstream?.api_key || ""}
                          disabled={disableInputs || !form.layers.ships.enabled}
                          onChange={(event) => {
                            const api_key = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                ships: {
                                  ...prev.layers.ships,
                                  aisstream: {
                                    ...prev.layers.ships.aisstream,
                                    api_key,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.ships.aisstream.api_key");
                          }}
                        />
                        {renderHelp("API key de AISStream (opcional)")}
                      </div>
                    </>
                  )}

                  {form.layers.ships.provider === "aishub" && (
                    <>
                      <div className="config-field">
                        <label htmlFor="ships_aishub_base_url">URL Base AISHub</label>
                        <input
                          id="ships_aishub_base_url"
                          type="url"
                          maxLength={256}
                          value={form.layers.ships.aishub?.base_url || ""}
                          disabled={disableInputs || !form.layers.ships.enabled}
                          onChange={(event) => {
                            const base_url = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                ships: {
                                  ...prev.layers.ships,
                                  aishub: {
                                    ...prev.layers.ships.aishub,
                                    base_url,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.ships.aishub.base_url");
                          }}
                        />
                        {renderHelp("URL base de la API de AISHub")}
                      </div>

                      <div className="config-field">
                        <label htmlFor="ships_aishub_api_key">API Key AISHub</label>
                        <input
                          id="ships_aishub_api_key"
                          type="text"
                          maxLength={256}
                          value={form.layers.ships.aishub?.api_key || ""}
                          disabled={disableInputs || !form.layers.ships.enabled}
                          onChange={(event) => {
                            const api_key = event.target.value.trim() || null;
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                ships: {
                                  ...prev.layers.ships,
                                  aishub: {
                                    ...prev.layers.ships.aishub,
                                    api_key,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.ships.aishub.api_key");
                          }}
                        />
                        {renderHelp("API key de AISHub (requerida para usar este proveedor)")}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="config-card">
          <div>
            <h2>WiFi</h2>
            <p>Gestiona las conexiones de red inalámbrica.</p>
          </div>
          <div className="config-grid">
            <div className="config-field">
              <div className="config-field-row">
                <label>Estado de conexión</label>
                {wifiStatusData && (
                  <div className="config-field-info">
                    {wifiStatusData.connected ? (
                      <>
                        <span className="config-field-status status-connected">
                          Conectado a {wifiStatusData.ssid || "red desconocida"}
                        </span>
                        {wifiStatusData.ip_address && (
                          <span className="config-field-detail">IP: {wifiStatusData.ip_address}</span>
                        )}
                        {wifiStatusData.signal !== null && (
                          <span className="config-field-detail">
                            Señal: {wifiStatusData.signal}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="config-field-status status-disconnected">Desconectado</span>
                    )}
                  </div>
                )}
              </div>
              <div className="config-field-actions">
                <button
                  type="button"
                  className="config-button"
                  disabled={wifiConnecting || disableInputs}
                  onClick={() => void loadWifiStatus()}
                >
                  Actualizar estado
                </button>
                {wifiStatusData?.connected && (
                  <button
                    type="button"
                    className="config-button"
                    disabled={wifiConnecting || disableInputs}
                    onClick={() => void handleWifiDisconnect()}
                  >
                    Desconectar
                  </button>
                )}
              </div>
            </div>

            <div className="config-field">
              <div className="config-field-row">
                <label>Redes disponibles</label>
                <button
                  type="button"
                  className="config-button"
                  disabled={wifiScanning || wifiConnecting || disableInputs}
                  onClick={() => void handleWifiScan()}
                >
                  {wifiScanning ? "Buscando…" : "Buscar redes"}
                </button>
              </div>
              {wifiConnectError && (
                <div className="config-field-error">{wifiConnectError}</div>
              )}
              {wifiNetworks.length > 0 ? (
                <div className="config-field-list">
                  {wifiNetworks.map((network) => (
                    <div key={network.ssid} className="config-field-item">
                      <div className="config-field-item-info">
                        <span className="config-field-item-name">{network.ssid}</span>
                        <span className="config-field-item-detail">
                          {network.security !== "none" && network.security !== "--"
                            ? `🔒 ${network.security}`
                            : "🔓 Abierta"}
                          {" · "}
                          Señal: {network.signal}%
                        </span>
                      </div>
                      {network.security !== "none" && network.security !== "--" && (
                        <div className="config-field-item-password">
                          <input
                            type="password"
                            placeholder="Contraseña"
                            value={wifiConnectPassword[network.ssid] || ""}
                            onChange={(e) => {
                              setWifiConnectPassword((prev) => ({
                                ...prev,
                                [network.ssid]: e.target.value,
                              }));
                            }}
                            disabled={wifiConnecting || disableInputs}
                            onKeyPress={(e) => {
                              if (e.key === "Enter") {
                                void handleWifiConnect(network.ssid);
                              }
                            }}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        className="config-button small"
                        disabled={
                          wifiConnecting ||
                          disableInputs ||
                          (network.security !== "none" &&
                            network.security !== "--" &&
                            !wifiConnectPassword[network.ssid])
                        }
                        onClick={() => void handleWifiConnect(network.ssid)}
                      >
                        {wifiConnecting ? "Conectando…" : "Conectar"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : wifiScanning ? null : (
                <div className="config-field-hint">
                  Haz clic en "Buscar redes" para ver las redes WiFi disponibles.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="config-actions">
          <button type="submit" className="config-button primary" disabled={disableInputs}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
};

export { ConfigPage };
