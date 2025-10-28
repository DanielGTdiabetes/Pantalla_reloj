import React, { useCallback, useEffect, useMemo, useState } from "react";

import { DEFAULT_CONFIG, withConfigDefaults } from "../config/defaults";
import {
  API_ORIGIN,
  ApiError,
  getConfig,
  getHealth,
  getSchema,
  saveConfig,
} from "../lib/api";
import { applyConfigPayload } from "../state/configStore";
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
const MAP_PROVIDER_OPTIONS: AppConfig["ui"]["map"]["provider"][] = ["maptiler", "carto"];
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

  const schemaInspector = useMemo(() => createSchemaInspector(schema ?? undefined), [schema]);
  const supports = useCallback((path: string) => schemaInspector.has(path), [schemaInspector]);

  const panelOptions = useMemo(() => {
    const base = new Set<string>([...DEFAULT_PANELS, ...form.ui.rotation.panels]);
    return Array.from(base);
  }, [form.ui.rotation.panels]);

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
    if (cfg) {
      applyConfigPayload(cfg);
      setForm(withConfigDefaults(cfg));
    } else {
      setForm(withConfigDefaults(undefined));
    }
  }, []);

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

  const isReady = status === "ready";
  const disableInputs = !isReady || saving;

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
      applyConfigPayload(saved);
      setForm(withConfigDefaults(saved));
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

        {supports("ui.map") && (
          <div className="config-card">
            <div>
              <h2>Mapa</h2>
              <p>Configura el estilo, proveedor y modo cine del mapa principal.</p>
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

              {supports("ui.map.provider") && (
                <div className="config-field">
                  <label htmlFor="map_provider">Proveedor</label>
                  <select
                    id="map_provider"
                    value={form.ui.map.provider}
                    disabled={disableInputs}
                    onChange={(event) => {
                      updateForm("ui", {
                        ...form.ui,
                        map: { ...form.ui.map, provider: event.target.value as AppConfig["ui"]["map"]["provider"] },
                      });
                      resetErrorsFor("ui.map.provider");
                    }}
                  >
                    {MAP_PROVIDER_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {renderHelp("Proveedor de teselas para el mapa")}
                  {renderFieldError("ui.map.provider")}
                </div>
              )}

              {supports("ui.map.maptiler.key") && (
                <div className="config-field">
                  <label htmlFor="maptiler_key">Clave MapTiler</label>
                  <input
                    id="maptiler_key"
                    type="text"
                    value={form.ui.map.maptiler.key ?? ""}
                    disabled={disableInputs}
                    onChange={(event) => {
                      updateForm("ui", {
                        ...form.ui,
                        map: {
                          ...form.ui.map,
                          maptiler: {
                            ...form.ui.map.maptiler,
                            key: event.target.value || null,
                          },
                        },
                      });
                    }}
                  />
                  {renderHelp("Necesaria para MapTiler (vacío si usas Carto)")}
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
                    disabled={disableInputs}
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
                    disabled={disableInputs}
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
                          disabled={disableInputs}
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
                          disabled={disableInputs}
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
                          disabled={disableInputs}
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
                          disabled={disableInputs}
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
                          disabled={disableInputs}
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

        {(supports("news.enabled") || supports("ai.enabled")) && (
          <div className="config-card">
            <div>
              <h2>Módulos</h2>
              <p>Activa o desactiva contenido adicional.</p>
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
                        updateForm("news", { enabled: event.target.checked });
                      }}
                    />
                    Mostrar noticias
                  </label>
                  {renderHelp("Activa el módulo de titulares RSS")}
                </div>
              )}

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
