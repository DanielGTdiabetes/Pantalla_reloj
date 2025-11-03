import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_CONFIG, createDefaultGlobalLayers, withConfigDefaults } from "../config/defaults";
import {
  API_ORIGIN,
  ApiError,
  getConfig,
  getConfigV2,
  getHealth,
  getSchema,
  getOpenSkyStatus,
  saveConfig,
  saveConfigV2,
  reloadConfig,
  testAemetApiKey,
  testCalendarConnection,
  type CalendarTestResponse,
  uploadIcsFile,
  getCalendarEvents,
  type CalendarEvent,
  getCalendarStatus,
  type CalendarStatusResponse,
  updateAemetApiKey,
  updateAISStreamApiKey,
  updateOpenWeatherMapApiKey,
  getShipsLayer,
  wifiConnect,
  wifiDisconnect,
  wifiNetworks as fetchWifiNetworks,
  wifiScan,
  wifiStatus,
  type WiFiNetwork,
  type WiFiStatusResponse,
  type OpenSkyStatus,
  migrateConfig,
  type MigrateConfigResponse,
} from "../lib/api";
import type { AppConfig, GlobalLayersConfig, MapConfig, XyzConfig } from "../types/config";
import type { MapConfigV2 } from "../types/config_v2";

type GlobalLayers = NonNullable<AppConfig["layers"]["global"]>;

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
// Proveedores v2
const MAP_PROVIDER_V2_OPTIONS: MapConfigV2["provider"][] = ["local_raster_xyz", "maptiler_vector", "custom_xyz"];
const MAP_PROVIDER_V2_LABELS: Record<MapConfigV2["provider"], string> = {
  local_raster_xyz: "Local (OSM raster)",
  maptiler_vector: "MapTiler (vector)",
  custom_xyz: "XYZ personalizado",
};
const MAPTILER_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAPTILER_DOCS_TEXT = "Obtén la clave en docs.maptiler.com/cloud/api-keys";
const DEFAULT_PANELS = DEFAULT_CONFIG.ui.rotation.panels;

// Legacy v1 (para compatibilidad)
const MAP_STYLE_OPTIONS: AppConfig["ui"]["map"]["style"][] = [
  "vector-dark",
  "vector-light",
  "vector-bright",
  "raster-carto-dark",
  "raster-carto-light",
];
const MAP_PROVIDER_OPTIONS: AppConfig["ui"]["map"]["provider"][] = ["maptiler", "osm", "xyz"];
const MAP_BACKEND_PROVIDERS: AppConfig["map"]["provider"][] = ["maptiler", "osm", "xyz"];
const MAP_PROVIDER_LABELS: Record<AppConfig["map"]["provider"], string> = {
  maptiler: "MapTiler",
  osm: "OpenStreetMap",
  openstreetmap: "OpenStreetMap",
  xyz: "XYZ (Raster)",
};

const AEMET_REASON_MESSAGES: Record<string, string> = {
  unauthorized: "AEMET rechazó la clave (401)",
  network: "No hay conexión con los servicios de AEMET",
  upstream: "Servicio de AEMET temporalmente no disponible",
  missing_api_key: "Introduce una API key antes de probar",
};

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

const resolveApiErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: unknown } | undefined;
    const detail = body?.detail;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail;
    }
    if (detail && typeof detail === "object") {
      const detailRecord = detail as Record<string, unknown>;
      const explicitError = detailRecord.error;
      if (typeof explicitError === "string" && explicitError.trim().length > 0) {
        return explicitError;
      }
      const stderr = detailRecord.stderr;
      if (typeof stderr === "string" && stderr.trim().length > 0) {
        return `${fallback}: ${stderr}`;
      }
    }
    return `${fallback} (código ${error.status})`;
  }
  return fallback;
};

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

const validateConfig = (config: AppConfig, supports: SchemaInspector["has"], configVersion?: number | null): FieldErrors => {
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

  // Validación v2 para ui_map
  if (configVersion === 2) {
    const v2Config = config as unknown as { ui_map?: MapConfigV2 };
    const ui_map = v2Config.ui_map;
    
    if (ui_map) {
      // Validar provider
      if (!MAP_PROVIDER_V2_OPTIONS.includes(ui_map.provider)) {
        errors["ui_map.provider"] = "Selecciona un proveedor soportado";
      }
      
      // Validar maptiler_vector
      if (ui_map.provider === "maptiler_vector") {
        const apiKey = ui_map.maptiler?.apiKey;
        const styleUrl = ui_map.maptiler?.styleUrl;
        
        if (!apiKey || !apiKey.trim()) {
          errors["ui_map.maptiler.apiKey"] = "Introduce la API key de MapTiler";
        } else if (!MAPTILER_KEY_PATTERN.test(apiKey.trim())) {
          errors["ui_map.maptiler.apiKey"] = "La API key solo puede incluir letras, números, punto, guion y guion bajo";
        }
        
        if (!styleUrl || !styleUrl.trim()) {
          errors["ui_map.maptiler.styleUrl"] = "Introduce la URL del estilo de MapTiler";
        }
      }
      
      // Validar custom_xyz
      if (ui_map.provider === "custom_xyz") {
        const tileUrl = ui_map.customXyz?.tileUrl;
        if (!tileUrl || !tileUrl.trim()) {
          errors["ui_map.customXyz.tileUrl"] = "Introduce la URL template de los tiles";
        }
      }
    }
  }
  
  // Validación legacy v1 (para compatibilidad)
  if (supports("map.provider")) {
    const legacyProviders: string[] = ["maptiler", "osm", "xyz"];
    if (!legacyProviders.includes(config.map.provider)) {
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

  if (supports("layers.ships.update_interval")) {
    const value = config.layers.ships.update_interval;
    if (!Number.isFinite(value) || value < 1 || value > 300) {
      errors["layers.ships.update_interval"] = "Debe estar entre 1 y 300";
    }
  }

  if (supports("layers.global.radar.provider")) {
    const provider = config.layers.global?.radar?.provider;
    if (provider !== "rainviewer" && provider !== "openweathermap") {
      errors["layers.global.radar.provider"] = "Selecciona un proveedor válido";
    }
  }

  return errors;
};

const ConfigPage: React.FC = () => {
  const [form, setForm] = useState<AppConfig>(withConfigDefaults());
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [banner, setBanner] = useState<Banner>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatusResponse | null>(null);
  const [calendarStatusLoading, setCalendarStatusLoading] = useState(false);
  const [newPanel, setNewPanel] = useState("");
  const [showMaptilerKey, setShowMaptilerKey] = useState(false);
  const [showAemetKey, setShowAemetKey] = useState(false);
  const [aemetKeyInput, setAemetKeyInput] = useState("");
  const [savingAemetKey, setSavingAemetKey] = useState(false);
  const [testingAemetKey, setTestingAemetKey] = useState(false);
  const [aemetTestResult, setAemetTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showAisstreamKey, setShowAisstreamKey] = useState(false);
  const [aisstreamKeyInput, setAisstreamKeyInput] = useState("");
  const [savingAisstreamKey, setSavingAisstreamKey] = useState(false);
  const [showOpenWeatherKey, setShowOpenWeatherKey] = useState(false);
  const [openWeatherKeyInput, setOpenWeatherKeyInput] = useState("");
  const [savingOpenWeatherKey, setSavingOpenWeatherKey] = useState(false);
  const [testingShips, setTestingShips] = useState(false);
  const [shipsTestResult, setShipsTestResult] = useState<{ ok: boolean; message: string; count?: number } | null>(null);
  const [testingOpenSky, setTestingOpenSky] = useState(false);
  const [openskyStatusData, setOpenSkyStatusData] = useState<OpenSkyStatus | null>(null);
  const [openskyStatusError, setOpenSkyStatusError] = useState<string | null>(null);
  const [testingCalendar, setTestingCalendar] = useState(false);
  const [calendarTestResult, setCalendarTestResult] = useState<{ ok: boolean; message: string; eventCount?: number } | null>(null);
  const [showGoogleCalendarKey, setShowGoogleCalendarKey] = useState(false);
  const [googleCalendarKeyInput, setGoogleCalendarKeyInput] = useState("");
  const [googleCalendarIdInput, setGoogleCalendarIdInput] = useState("");
  const [icsUrlInput, setIcsUrlInput] = useState("");
  const [icsPathInput, setIcsPathInput] = useState("");
  const [uploadingIcs, setUploadingIcs] = useState(false);
  const [icsUploadResult, setIcsUploadResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingIcs, setTestingIcs] = useState(false);
  const [icsTestResult, setIcsTestResult] = useState<{ ok: boolean; message: string; events?: CalendarEvent[] } | null>(null);
  
  // WiFi state
  const [wifiNetworkList, setWifiNetworkList] = useState<WiFiNetwork[]>([]);
  const [wifiNetworksCount, setWifiNetworksCount] = useState(0);
  const [wifiNetworksLoaded, setWifiNetworksLoaded] = useState(false);
  const [wifiScanning, setWifiScanning] = useState(false);
  const [wifiStatusData, setWifiStatusData] = useState<WiFiStatusResponse | null>(null);
  const [wifiConnecting, setWifiConnecting] = useState(false);
  const [wifiConnectPassword, setWifiConnectPassword] = useState<Record<string, string>>({});
  const [wifiConnectError, setWifiConnectError] = useState<string | null>(null);
  const [wifiScanNotice, setWifiScanNotice] = useState<string | null>(null);
  const [configVersion, setConfigVersion] = useState<number | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const schemaInspector = useMemo(() => createSchemaInspector(schema ?? undefined), [schema]);
  const supports = useCallback((path: string) => schemaInspector.has(path), [schemaInspector]);

  const panelOptions = useMemo(() => {
    const base = new Set<string>([...DEFAULT_PANELS, ...form.ui.rotation.panels]);
    return Array.from(base);
  }, [form.ui.rotation.panels]);

  const isReady = status === "ready";
  const disableInputs = !isReady || saving;
  const openskyAuthState = form.opensky.oauth2;
  const pendingOpenSkyClientId = openskyAuthState?.client_id ?? "";
  const pendingOpenSkyClientSecret = openskyAuthState?.client_secret ?? "";
  const storedOpenSkyCredentials = Boolean(openskyAuthState?.has_credentials);
  const pendingOpenSkyCredentials =
    pendingOpenSkyClientId.trim().length > 0 && pendingOpenSkyClientSecret.trim().length > 0;
  const openskyCredentialsConfigured = storedOpenSkyCredentials || pendingOpenSkyCredentials;
  const openskyMinPoll = openskyCredentialsConfigured ? 5 : 10;

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

  const maskedAemetKey = useMemo(() => {
    if (!form.aemet?.has_api_key) {
      return "";
    }
    const last4 = form.aemet.api_key_last4;
    if (typeof last4 === "string" && last4.trim().length > 0) {
      return `•••• ${last4}`;
    }
    return "••••";
  }, [form.aemet?.has_api_key, form.aemet?.api_key_last4]);

  const trimmedAemetKeyInput = aemetKeyInput.trim();
  const hasStoredAemetKey = Boolean(form.aemet?.has_api_key);
  const canTestAemetKey = showAemetKey ? trimmedAemetKeyInput.length > 0 : hasStoredAemetKey;
  const canPersistAemetKey =
    showAemetKey && !savingAemetKey && (trimmedAemetKeyInput.length > 0 || hasStoredAemetKey);

  const maskedAisstreamKey = useMemo(() => {
    const aisstream = form.layers.ships.aisstream;
    if (!aisstream?.has_api_key) {
      return "";
    }
    const last4 = aisstream.api_key_last4;
    if (typeof last4 === "string" && last4.trim().length > 0) {
      return `•••• ${last4}`;
    }
    return "••••";
  }, [form.layers.ships.aisstream]);

  const openskyCredentialHelp = useMemo(() => {
    if (openskyAuthState?.has_credentials) {
      return "Las credenciales están guardadas en el backend. Introduce nuevos valores para reemplazarlas.";
    }
    return "Introduce client_id y client_secret proporcionados por OpenSky Network y pulsa Guardar configuración.";
  }, [openskyAuthState?.has_credentials]);

  const openskyCredentialBadge = useMemo(() => {
    if (!isReady) {
      return null;
    }
    if (!openskyAuthState) {
      return <span className="config-badge config-badge--warning">Sin credenciales</span>;
    }
    if (openskyAuthState.has_credentials) {
      const last4 =
        typeof openskyAuthState.client_id_last4 === "string"
          ? openskyAuthState.client_id_last4.trim()
          : "";
      const masked = last4.length > 0 ? `•••• ${last4}` : "••••";
      return (
        <span className="config-badge config-badge--success" title="Credenciales guardadas en el backend">
          Guardado
          <span className="config-badge__code">{masked}</span>
        </span>
      );
    }
    return <span className="config-badge config-badge--warning">Sin credenciales</span>;
  }, [isReady, openskyAuthState]);

  const trimmedAisstreamKeyInput = aisstreamKeyInput.trim();
  const hasStoredAisstreamKey = Boolean(form.layers.ships.aisstream?.has_api_key);
  const canPersistAisstreamKey =
    showAisstreamKey && !savingAisstreamKey && (trimmedAisstreamKeyInput.length > 0 || hasStoredAisstreamKey);
  const canTestShips =
    form.layers.ships.enabled &&
    form.layers.ships.provider === "aisstream" &&
    !showAisstreamKey &&
    !savingAisstreamKey &&
    Boolean(form.layers.ships.aisstream?.has_api_key);

  const maskedOpenWeatherKey = useMemo(() => {
    const radar = form.layers.global?.radar;
    if (!radar?.has_api_key) {
      return "";
    }
    const last4 = radar.api_key_last4;
    if (typeof last4 === "string" && last4.trim().length > 0) {
      return `•••• ${last4}`;
    }
    return "••••";
  }, [form.layers.global?.radar]);

  const trimmedOpenWeatherKeyInput = openWeatherKeyInput.trim();
  const hasStoredOpenWeatherKey = Boolean(form.layers.global?.radar?.has_api_key);
  const canPersistOpenWeatherKey =
    showOpenWeatherKey &&
    !savingOpenWeatherKey &&
    (trimmedOpenWeatherKeyInput.length > 0 || hasStoredOpenWeatherKey);
  const openWeatherSelected = form.layers.global?.radar?.provider === "openweathermap";

  const handleToggleAemetKeyVisibility = useCallback(() => {
    setShowAemetKey((prev) => {
      const next = !prev;
      if (!next) {
        setAemetKeyInput("");
      }
      setAemetTestResult(null);
      return next;
    });
  }, []);

  const handleSaveAemetKey = useCallback(async () => {
    if (!isReady || savingAemetKey || !showAemetKey) {
      return;
    }
    const trimmed = aemetKeyInput.trim();
    setSavingAemetKey(true);
    try {
      await updateAemetApiKey(trimmed ? trimmed : null);
      setForm((prev) => ({
        ...prev,
        aemet: {
          ...prev.aemet,
          has_api_key: Boolean(trimmed),
          api_key_last4: trimmed ? trimmed.slice(-4) : null,
        },
      }));
      setBanner({
        kind: "success",
        text: trimmed ? "Clave de AEMET guardada" : "Clave de AEMET eliminada",
      });
      setShowAemetKey(false);
      setAemetKeyInput("");
      setAemetTestResult(null);
    } catch (error) {
      console.error("[ConfigPage] Failed to update AEMET API key", error);
      const message = resolveApiErrorMessage(error, "No se pudo actualizar la API key de AEMET");
      setBanner({ kind: "error", text: message });
    } finally {
      setSavingAemetKey(false);
    }
  }, [aemetKeyInput, isReady, savingAemetKey, setBanner, showAemetKey]);

  const handleTestAemetKey = useCallback(async () => {
    if (testingAemetKey || (!showAemetKey && !form.aemet.has_api_key)) {
      if (!showAemetKey && !form.aemet.has_api_key) {
        setAemetTestResult({ ok: false, message: AEMET_REASON_MESSAGES.missing_api_key });
      }
      return;
    }

    const candidate = showAemetKey ? aemetKeyInput.trim() : "";
    setTestingAemetKey(true);
    setAemetTestResult(null);
    try {
      const response = await testAemetApiKey(candidate ? candidate : undefined);
      if (response?.ok) {
        setAemetTestResult({ ok: true, message: "Clave válida: AEMET respondió correctamente" });
      } else {
        const reason = response?.reason ?? "";
        const message = AEMET_REASON_MESSAGES[reason] ?? "No se pudo comprobar la clave";
        setAemetTestResult({ ok: false, message });
      }
    } catch (error) {
      console.error("[ConfigPage] Failed to test AEMET API key", error);
      setAemetTestResult({ ok: false, message: "No se pudo comprobar la clave" });
    } finally {
      setTestingAemetKey(false);
    }
  }, [aemetKeyInput, form.aemet.has_api_key, showAemetKey, testingAemetKey]);

  const handleTestCalendar = useCallback(async () => {
    if (testingCalendar) {
      return;
    }

    let enabled = false;
    let apiKey = "";
    let calendarId = "";

    if (configVersion === 2) {
      const v2 = form as unknown as { panels?: { calendar?: { enabled?: boolean; provider?: string } }; secrets?: { google?: { api_key?: string; calendar_id?: string } } };
      enabled = v2.panels?.calendar?.enabled ?? false;
      apiKey = googleCalendarKeyInput.trim() || v2.secrets?.google?.api_key || "";
      calendarId = googleCalendarIdInput.trim() || v2.secrets?.google?.calendar_id || "";
    } else {
      enabled = form.calendar?.enabled ?? false;
      apiKey = form.calendar?.google_api_key?.trim() || "";
      calendarId = form.calendar?.google_calendar_id?.trim() || "";
    }

    if (!enabled) {
      setCalendarTestResult({ ok: false, message: "Activa el calendario primero" });
      return;
    }

    if (!apiKey && !calendarId) {
      setCalendarTestResult({ ok: false, message: "Introduce al menos la API Key o el Calendar ID" });
      return;
    }

    setTestingCalendar(true);
    setCalendarTestResult(null);
    try {
      const response = await testCalendarConnection(apiKey || undefined, calendarId || undefined);
      if (response?.ok) {
        const eventCount = typeof response.event_count === "number" ? response.event_count : undefined;
        const message = eventCount !== undefined
          ? `Conexión exitosa: Se encontraron ${eventCount} evento(s)`
          : response.message || "Conexión exitosa: Google Calendar responde correctamente";
        setCalendarTestResult({ ok: true, message, eventCount });
      } else {
        const reason = response?.reason ?? "";
        const message = response?.message || reason || "No se pudo conectar con Google Calendar";
        setCalendarTestResult({ ok: false, message });
      }
    } catch (error) {
      console.error("[ConfigPage] Failed to test Google Calendar connection", error);
      const errorMessage = error instanceof Error ? error.message : "No se pudo comprobar la conexión";
      setCalendarTestResult({ ok: false, message: errorMessage });
    } finally {
      setTestingCalendar(false);
    }
  }, [configVersion, form, googleCalendarKeyInput, googleCalendarIdInput, testingCalendar]);

  const handleUploadIcs = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".ics")) {
      setIcsUploadResult({ ok: false, message: "El archivo debe tener extensión .ics" });
      return;
    }

    setUploadingIcs(true);
    setIcsUploadResult(null);

    try {
      const result = await uploadIcsFile(file);
      setIcsPathInput(result.ics_path);
      resetErrorsFor("panels.calendar.ics_path");
      const detectedEvents =
        typeof result.events_detected === "number" && Number.isFinite(result.events_detected)
          ? result.events_detected
          : undefined;
      const successMessage =
        detectedEvents !== undefined
          ? `Archivo subido correctamente: ${result.ics_path} (${detectedEvents} eventos detectados)`
          : `Archivo subido correctamente: ${result.ics_path}`;
      setIcsUploadResult({ ok: Boolean(result.ok), message: successMessage });

      // Actualizar el formulario para establecer provider="ics" y ics_path
      setForm((prev) => {
        const v2 = prev as unknown as { panels?: { calendar?: { enabled?: boolean; provider?: string; ics_path?: string } } };
        return {
          ...prev,
          panels: {
            ...v2.panels,
            calendar: {
              ...v2.panels?.calendar,
              enabled: v2.panels?.calendar?.enabled ?? true,
              provider: "ics",
              ics_path: result.ics_path,
            },
          },
        } as unknown as AppConfig;
      });

      // Si el backend no persistió automáticamente (según la respuesta), guardar manualmente
      // El backend debería haberlo hecho en /api/config/upload/ics, pero por si acaso:
      if (configVersion === 2) {
        try {
          const current = await getConfigV2();
          if (current && current.version === 2) {
            const updatedConfig: import("../types/config_v2").AppConfigV2 = {
              ...current,
              panels: {
                ...current.panels,
                calendar: {
                  enabled: true,
                  provider: "ics",
                  ics_path: result.ics_path,
                },
              },
            };
            await saveConfigV2(updatedConfig);
          }
        } catch (saveError) {
          console.warn("[ConfigPage] Failed to save config after ICS upload", saveError);
        }
      }

      // Re-fetch config y rehidratar stores en caliente
      try {
        await refreshConfig();
        await reloadConfig();
        await loadCalendarStatus();
      } catch (refreshError) {
        console.warn("[ConfigPage] Failed to refresh config after ICS upload", refreshError);
      }
    } catch (error) {
      console.error("[ConfigPage] Failed to upload ICS file", error);
      let errorMessage = "No se pudo subir el archivo ICS";
      const fieldErrors: FieldErrors = {};
      
      if (error instanceof ApiError) {
        if (typeof error.body === "object" && error.body !== null) {
          const errorBody = error.body as Record<string, unknown>;
          
          // Extraer error específico
          if ("error" in errorBody && typeof errorBody.error === "string") {
            errorMessage = errorBody.error;
          }
          
          // Extraer errores de campo si existen
          const backendFieldErrors = extractBackendErrors(errorBody);
          Object.assign(fieldErrors, backendFieldErrors);
          
          // Extraer missing y field_paths
          const missing = "missing" in errorBody && Array.isArray(errorBody.missing) ? errorBody.missing : [];
          const fieldPaths = "field_paths" in errorBody && Array.isArray(errorBody.field_paths) ? errorBody.field_paths : [];
          
          // Añadir errores de campo para cada path faltante
          for (const path of [...missing, ...fieldPaths]) {
            if (typeof path === "string") {
              fieldErrors[path] = errorMessage || "Campo requerido o inválido";
            }
          }
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      // Establecer errores de campo
      if (Object.keys(fieldErrors).length > 0) {
        setFieldErrors((prev) => ({ ...prev, ...fieldErrors }));
      }
      
      setIcsUploadResult({ ok: false, message: errorMessage });
    } finally {
      setUploadingIcs(false);
      // Limpiar el input file para permitir subir el mismo archivo de nuevo
      event.target.value = "";
    }
  }, [refreshConfig, resetErrorsFor]);

  const handleTestIcs = useCallback(async () => {
    if (testingIcs) {
      return;
    }

    const v2 = form as unknown as { panels?: { calendar?: { enabled?: boolean; provider?: string; ics_path?: string } } };
    const enabled = v2.panels?.calendar?.enabled ?? false;
    const provider = v2.panels?.calendar?.provider;
    const icsPath = icsPathInput.trim() || v2.panels?.calendar?.ics_path;

    if (!enabled || provider !== "ics") {
      setIcsTestResult({ ok: false, message: "Activa el calendario con provider ICS primero" });
      return;
    }

    if (!icsPath) {
      setIcsTestResult({ ok: false, message: "No se ha especificado una ruta ICS" });
      return;
    }

    setTestingIcs(true);
    setIcsTestResult(null);
    
    try {
      // Obtener eventos del calendario
      const now = new Date();
      const from = now.toISOString();
      const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 días adelante
      
      const events = await getCalendarEvents(from, to);
      const upcomingEvents = events.slice(0, 3); // Primeros 3 eventos
      
      if (events.length === 0) {
        setIcsTestResult({ ok: true, message: "ICS válido pero sin eventos en los próximos 14 días", events: [] });
      } else {
        setIcsTestResult({
          ok: true,
          message: `ICS válido: ${events.length} evento(s) encontrado(s) en los próximos 14 días`,
          events: upcomingEvents,
        });
      }
    } catch (error) {
      console.error("[ConfigPage] Failed to test ICS calendar", error);
      const errorMessage = error instanceof ApiError && typeof error.body === "object" && error.body !== null && "error" in error.body
        ? String(error.body.error)
        : error instanceof Error
        ? error.message
        : "No se pudo probar el archivo ICS";
      setIcsTestResult({ ok: false, message: errorMessage });
    } finally {
      setTestingIcs(false);
    }
  }, [configVersion, form, icsPathInput, testingIcs]);

  const handleToggleAisstreamKeyVisibility = useCallback(() => {
    setShowAisstreamKey((prev) => {
      const next = !prev;
      if (!next) {
        setAisstreamKeyInput("");
      }
      setShipsTestResult(null);
      return next;
    });
  }, []);

  const handleSaveAisstreamKey = useCallback(async () => {
    if (!isReady || savingAisstreamKey || !showAisstreamKey) {
      return;
    }
    const trimmed = aisstreamKeyInput.trim();
    setSavingAisstreamKey(true);
    try {
      await updateAISStreamApiKey(trimmed ? trimmed : null);
      setForm((prev) => ({
        ...prev,
        layers: {
          ...prev.layers,
          ships: {
            ...prev.layers.ships,
            aisstream: {
              ...prev.layers.ships.aisstream,
              has_api_key: Boolean(trimmed),
              api_key_last4: trimmed ? trimmed.slice(-4) : null,
            },
          },
        },
      }));
      setBanner({
        kind: "success",
        text: trimmed ? "API key de AISStream guardada" : "API key de AISStream eliminada",
      });
      setShowAisstreamKey(false);
      setAisstreamKeyInput("");
      setShipsTestResult(null);
    } catch (error) {
      console.error("[ConfigPage] Failed to update AISStream API key", error);
      const message = resolveApiErrorMessage(error, "No se pudo actualizar la API key de AISStream");
      setBanner({ kind: "error", text: message });
    } finally {
      setSavingAisstreamKey(false);
    }
  }, [aisstreamKeyInput, isReady, savingAisstreamKey, setBanner, showAisstreamKey]);

  const handleToggleOpenWeatherKeyVisibility = useCallback(() => {
    setShowOpenWeatherKey((prev) => {
      const next = !prev;
      if (!next) {
        setOpenWeatherKeyInput("");
      }
      return next;
    });
  }, []);

  const handleSaveOpenWeatherKey = useCallback(async () => {
    if (!isReady || savingOpenWeatherKey || !showOpenWeatherKey) {
      return;
    }
    const trimmed = openWeatherKeyInput.trim();
    setSavingOpenWeatherKey(true);
    try {
      await updateOpenWeatherMapApiKey(trimmed ? trimmed : null);
      setForm((prev) => {
        const defaults = createDefaultGlobalLayers();
        const prevGlobal = prev.layers.global ?? defaults;
        const prevRadar = prevGlobal.radar ?? defaults.radar;
        return {
          ...prev,
          layers: {
            ...prev.layers,
            global: {
              ...prevGlobal,
              radar: {
                ...prevRadar,
                has_api_key: Boolean(trimmed),
                api_key_last4: trimmed ? trimmed.slice(-4) : null,
              },
            },
          },
        };
      });
      setBanner({
        kind: "success",
        text: trimmed
          ? "API key de OpenWeatherMap guardada"
          : "API key de OpenWeatherMap eliminada",
      });
      setShowOpenWeatherKey(false);
      setOpenWeatherKeyInput("");
    } catch (error) {
      console.error("[ConfigPage] Failed to update OpenWeatherMap API key", error);
      const message = resolveApiErrorMessage(
        error,
        "No se pudo actualizar la API key de OpenWeatherMap",
      );
      setBanner({ kind: "error", text: message });
    } finally {
      setSavingOpenWeatherKey(false);
    }
  }, [
    isReady,
    openWeatherKeyInput,
    savingOpenWeatherKey,
    setBanner,
    setForm,
    showOpenWeatherKey,
  ]);

  const handleTestShipsLayer = useCallback(async () => {
    if (testingShips) {
      return;
    }
    if (!form.layers.ships.enabled) {
      setShipsTestResult({ ok: false, message: "Activa la capa de barcos antes de probar" });
      return;
    }
    if (form.layers.ships.provider !== "aisstream") {
      setShipsTestResult({ ok: false, message: "Selecciona AISStream para poder probar" });
      return;
    }
    if (showAisstreamKey) {
      setShipsTestResult({ ok: false, message: "Guarda la API key de AISStream antes de probar" });
      return;
    }
    if (!form.layers.ships.aisstream?.has_api_key) {
      setShipsTestResult({ ok: false, message: "Configura la API key de AISStream antes de probar" });
      return;
    }

    setTestingShips(true);
    setShipsTestResult(null);
    try {
      const response = await getShipsLayer();
      const rawFeatures = Array.isArray((response as { features?: unknown[] }).features)
        ? ((response as { features: unknown[] }).features)
        : [];
      const meta = ((response as { meta?: Record<string, unknown> }).meta ?? {}) as Record<string, unknown>;
      const okFlag = typeof meta.ok === "boolean" ? meta.ok : rawFeatures.length > 0;
      const count = rawFeatures.length;
      if (okFlag && count > 0) {
        setShipsTestResult({ ok: true, message: `Recibidos ${count} barcos de AISStream`, count });
      } else {
        const reason = typeof meta.reason === "string" ? meta.reason : "";
        const reasonMessage: Record<string, string> = {
          disabled: "La capa está desactivada en el backend",
          rate_limited: "El backend alcanzó el límite de peticiones para barcos",
          stream_inactive: "Sin datos de AISStream (revisa la API key o la conexión)",
        };
        const message = reasonMessage[reason] ?? "No se recibieron barcos (verifica la API key)";
        setShipsTestResult({ ok: false, message, count });
      }
    } catch (error) {
      console.error("[ConfigPage] Failed to test AISStream ships", error);
      const message = resolveApiErrorMessage(error, "No se pudo consultar AISStream");
      setShipsTestResult({ ok: false, message });
    } finally {
      setTestingShips(false);
    }
  }, [
    form.layers.ships.aisstream?.has_api_key,
    form.layers.ships.enabled,
    form.layers.ships.provider,
    showAisstreamKey,
    testingShips,
  ]);

  const handleTestOpenSky = useCallback(async () => {
    if (testingOpenSky) {
      return;
    }
    setTestingOpenSky(true);
    setOpenSkyStatusError(null);
    try {
      const statusResponse = await getOpenSkyStatus();
      setOpenSkyStatusData(statusResponse ?? null);
      if (!statusResponse) {
        setOpenSkyStatusError("Sin respuesta del backend");
      }
    } catch (error) {
      console.error("[ConfigPage] Failed to get OpenSky status", error);
      const message = resolveApiErrorMessage(error, "No se pudo obtener el estado de OpenSky");
      setOpenSkyStatusError(message);
      setOpenSkyStatusData(null);
    } finally {
      setTestingOpenSky(false);
    }
  }, [testingOpenSky]);

  const refreshConfig = useCallback(async () => {
    // Intentar cargar v2 primero
    let cfg: AppConfig | undefined;
    try {
      const v2Cfg = await getConfigV2();
      if (v2Cfg && v2Cfg.version === 2 && v2Cfg.ui_map) {
        // Convertir v2 a formato interno compatible (mantener ui_map como está)
        cfg = {
          ...(v2Cfg as unknown as AppConfig),
          ui_map: v2Cfg.ui_map,
        } as unknown as AppConfig;
        setConfigVersion(2);
      } else {
        cfg = await getConfig();
        const version = (cfg as { version?: number })?.version;
        setConfigVersion(version ?? null);
      }
    } catch (e) {
      // Si falla v2, intentar v1
      cfg = await getConfig();
      const version = (cfg as { version?: number })?.version;
      setConfigVersion(version ?? null);
    }
    
    // Si es v2, mantener ui_map directamente en form
    const mergedCfg = withConfigDefaults(cfg ?? undefined);
    const detectedVersion = (cfg as { version?: number })?.version ?? null;
    if (detectedVersion === 2 && cfg && (cfg as unknown as { ui_map?: MapConfigV2 }).ui_map) {
      setForm({
        ...mergedCfg,
        ui_map: (cfg as unknown as { ui_map?: MapConfigV2 }).ui_map,
      } as unknown as AppConfig);
    } else {
      setForm(mergedCfg);
    }
    setShowMaptilerKey(false);
    setShowAemetKey(false);
    setAemetKeyInput("");
    setAemetTestResult(null);
    setShowAisstreamKey(false);
    setAisstreamKeyInput("");
    setShipsTestResult(null);
    setShowOpenWeatherKey(false);
    setOpenWeatherKeyInput("");
    setOpenSkyStatusData(null);
    setOpenSkyStatusError(null);
    setShowGoogleCalendarKey(false);
    setGoogleCalendarKeyInput("");
    setGoogleCalendarIdInput("");
    setIcsUrlInput("");
    
    // Cargar ics_path desde la configuración v2 si existe
    if (detectedVersion === 2 && cfg) {
      const v2Cfg = cfg as unknown as { panels?: { calendar?: { ics_path?: string } }; calendar?: { ics_path?: string } };
      const icsPath = v2Cfg.panels?.calendar?.ics_path || v2Cfg.calendar?.ics_path;
      if (icsPath && typeof icsPath === "string") {
        setIcsPathInput(icsPath);
      } else {
        setIcsPathInput("");
      }
    } else {
      setIcsPathInput("");
    }
    
    setCalendarTestResult(null);
    
    // Nota: Los secrets no se devuelven en GET /api/config por seguridad.
    // El usuario debe introducirlos desde la UI.
  }, []);

  // Esta función se define después para evitar dependencias circulares
  const loadCalendarStatus = useCallback(async () => {
    setCalendarStatusLoading(true);
    try {
      const status = await getCalendarStatus();
      if (isMountedRef.current) {
        setCalendarStatus(status);
      }
    } catch (error) {
      console.error("[ConfigPage] Failed to load calendar status", error);
      if (isMountedRef.current) {
        setCalendarStatus(null);
      }
    } finally {
      if (isMountedRef.current) {
        setCalendarStatusLoading(false);
      }
    }
  }, []);

  const loadCalendarStatus = useCallback(async () => {
    setCalendarStatusLoading(true);
    try {
      const status = await getCalendarStatus();
      if (isMountedRef.current) {
        setCalendarStatus(status);
      }
    } catch (error) {
      console.error("[ConfigPage] Failed to load calendar status", error);
      if (isMountedRef.current) {
        setCalendarStatus(null);
      }
    } finally {
      if (isMountedRef.current) {
        setCalendarStatusLoading(false);
      }
    }
  }, []);

  // Cargar calendar status al montar y después de cambios
  useEffect(() => {
    if (isReady) {
      void loadCalendarStatus();
    }
  }, [isReady, loadCalendarStatus]);

  const handleRestoreDefaultsV23 = useCallback(async () => {
    if (!window.confirm("¿Restaurar valores por defecto de v23? Esto activará radar, aviones y barcos, y restaurará el calendario ICS si existe. Los secrets no se modificarán.")) {
      return;
    }
    
    setSaving(true);
    setBanner(null);
    try {
      // Obtener config actual para preservar secrets y ui_map
      const current = await getConfigV2();
      if (!current || current.version !== 2) {
        setBanner({ kind: "error", text: "La configuración actual no es v2" });
        return;
      }
      
      // Restaurar valores por defecto de v23
      const v23Defaults: import("../types/config_v2").AppConfigV2 = {
        ...current,
        ui_global: {
          ...current.ui_global,
          radar: {
            enabled: true,
            provider: "aemet",
          },
        },
        layers: {
          ...current.layers,
          flights: current.layers?.flights ? {
            ...current.layers.flights,
            enabled: true,
            provider: current.layers.flights.provider || "opensky",
          } : {
            enabled: true,
            provider: "opensky",
            refresh_seconds: 10,
            max_age_seconds: 300,
            max_items_global: 1000,
            max_items_view: 100,
            rate_limit_per_min: 60,
            decimate: "none",
            grid_px: 50,
            styleScale: 1.0,
            render_mode: "auto",
          },
          ships: current.layers?.ships ? {
            ...current.layers.ships,
            enabled: true,
            provider: current.layers.ships.provider || "aisstream",
          } : {
            enabled: true,
            provider: "aisstream",
            refresh_seconds: 30,
            max_age_seconds: 600,
            max_items_global: 5000,
            max_items_view: 500,
            decimate: "grid",
            grid_px: 50,
            styleScale: 1.0,
          },
        },
        panels: {
          ...current.panels,
          calendar: current.panels?.calendar?.ics_path
            ? {
                enabled: true,
                provider: "ics",
                ics_path: current.panels.calendar.ics_path,
              }
            : current.panels?.calendar,
        },
        // Preservar secrets (no se tocan)
        secrets: current.secrets,
        // Preservar ui_map completo (especialmente fixed.zoom)
        ui_map: current.ui_map,
      };
      
      await saveConfigV2(v23Defaults);
      await refreshConfig();
      setBanner({ kind: "success", text: "Valores por defecto de v23 restaurados" });
      window.dispatchEvent(new CustomEvent("pantalla:config:saved", { detail: { version: 2 } }));
    } catch (error) {
      console.error("[ConfigPage] Failed to restore defaults", error);
      const message = resolveApiErrorMessage(error, "Error al restaurar valores por defecto");
      setBanner({ kind: "error", text: message });
    } finally {
      setSaving(false);
    }
  }, [refreshConfig]);

  // WiFi functions
  const loadWifiStatus = useCallback(async () => {
    try {
      const status = await wifiStatus();
      if (!isMountedRef.current) {
        return;
      }
      setWifiStatusData(status);
    } catch (error) {
      console.error("Failed to load WiFi status:", error);
    }
  }, []);

  const sanitizeWifiNetworks = useCallback((value: unknown): WiFiNetwork[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => {
        const record = item as Record<string, unknown>;
        const ssidValue = typeof record.ssid === "string" ? record.ssid.trim() : "";
        const rawSignal = record.signal;

        let signal = 0;
        if (typeof rawSignal === "number" && Number.isFinite(rawSignal)) {
          signal = rawSignal;
        } else if (typeof rawSignal === "string") {
          const parsed = Number.parseInt(rawSignal, 10);
          if (!Number.isNaN(parsed)) {
            signal = parsed;
          }
        }

        const security = typeof record.security === "string" ? record.security : "";
        const mode = typeof record.mode === "string" ? record.mode : undefined;
        const bars = typeof record.bars === "string" ? record.bars : undefined;

        return {
          ssid: ssidValue,
          signal,
          security,
          mode,
          bars,
        } satisfies WiFiNetwork;
      })
      .filter((network) => network.ssid.length > 0);
  }, []);

  const refreshWifiNetworks = useCallback(async () => {
    try {
      const response = await fetchWifiNetworks();
      if (!isMountedRef.current) {
        return;
      }
      const list = sanitizeWifiNetworks(response?.networks);
      const count =
        typeof response?.count === "number" && Number.isFinite(response.count)
          ? response.count
          : list.length;
      setWifiNetworkList(list);
      setWifiNetworksCount(count);
      setWifiNetworksLoaded(true);
    } catch (error) {
      console.error("Failed to load WiFi networks:", error);
      if (!isMountedRef.current) {
        return;
      }
      setWifiNetworkList([]);
      setWifiNetworksCount(0);
      setWifiNetworksLoaded(true);
      setWifiScanNotice((previous) => previous ?? "No se pudo cargar la lista de redes WiFi");
    }
  }, [fetchWifiNetworks, sanitizeWifiNetworks]);

  const handleWifiScan = useCallback(async () => {
    setWifiScanning(true);
    setWifiConnectError(null);
    setWifiScanNotice(null);
    try {
      const result = await wifiScan();
      if (isMountedRef.current) {
        const hasReason = typeof result?.meta?.reason === "string";
        if (!result?.ok || hasReason) {
          const reason = hasReason ? String(result.meta?.reason) : "scan_failed";
          const message =
            reason === "scan_failed"
              ? "No se pudo completar el escaneo de redes WiFi. Inténtalo de nuevo."
              : `No se pudo escanear redes WiFi (${reason}).`;
          setWifiScanNotice(message);
          setBanner({ kind: "error", text: message });
        }
      }
    } catch (error) {
      console.error("Failed to scan WiFi:", error);
      if (isMountedRef.current) {
        const message = resolveApiErrorMessage(error, "Error al buscar redes WiFi");
        setWifiScanNotice(message);
        setBanner({ kind: "error", text: message });
      }
    } finally {
      if (isMountedRef.current) {
        await refreshWifiNetworks();
        await loadWifiStatus();
        setWifiScanning(false);
      }
    }
  }, [loadWifiStatus, refreshWifiNetworks, setBanner]);

  const handleWifiConnect = useCallback(
    async (ssid: string) => {
      setWifiConnecting(true);
      setWifiConnectError(null);
      try {
        const password = wifiConnectPassword[ssid] || undefined;
        await wifiConnect({ ssid, password });
        if (!isMountedRef.current) {
          return;
        }
        setBanner({ kind: "success", text: `Conectado a ${ssid}` });
        await loadWifiStatus();
        if (!isMountedRef.current) {
          return;
        }
        // Clear password from state after connection
        setWifiConnectPassword((prev) => {
          const next = { ...prev };
          delete next[ssid];
          return next;
        });
      } catch (error) {
        console.error("Failed to connect to WiFi:", error);
        if (isMountedRef.current) {
          const errorMsg = resolveApiErrorMessage(error, "Error al conectar a la red WiFi");
          setWifiConnectError(errorMsg);
          setBanner({ kind: "error", text: errorMsg });
        }
      } finally {
        if (isMountedRef.current) {
          setWifiConnecting(false);
        }
      }
    },
    [wifiConnectPassword, loadWifiStatus]
  );

  const handleWifiDisconnect = useCallback(async () => {
    setWifiConnecting(true);
    setWifiConnectError(null);
    try {
      await wifiDisconnect();
      if (!isMountedRef.current) {
        return;
      }
      setBanner({ kind: "success", text: "Desconectado de WiFi" });
      await loadWifiStatus();
    } catch (error) {
      console.error("Failed to disconnect WiFi:", error);
      if (isMountedRef.current) {
        const errorMsg = resolveApiErrorMessage(error, "Error al desconectar de la red WiFi");
        setWifiConnectError(errorMsg);
        setBanner({ kind: "error", text: errorMsg });
      }
    } finally {
      if (isMountedRef.current) {
        setWifiConnecting(false);
      }
    }
  }, [loadWifiStatus]);

  // Load WiFi status on mount
  useEffect(() => {
    void loadWifiStatus();
  }, [loadWifiStatus]);

  const handleMigrateToV2 = useCallback(async () => {
    if (migrating) {
      return;
    }
    
    setMigrating(true);
    setMigrationResult(null);
    setBanner(null);
    
    try {
      const result = await migrateConfig(2, true);
      if (result?.ok) {
        setMigrationResult({ ok: true, message: result.message || "Migración completada exitosamente" });
        setBanner({ kind: "success", text: "Configuración migrada a v2" });
        setConfigVersion(2);
        // Recargar configuración
        await refreshConfig();
      } else {
        setMigrationResult({ ok: false, message: result?.message || "Error en la migración" });
        setBanner({ kind: "error", text: "Error al migrar configuración" });
      }
    } catch (error) {
      console.error("[ConfigPage] Error migrando configuración:", error);
      const message = resolveApiErrorMessage(error, "Error al migrar configuración");
      setMigrationResult({ ok: false, message });
      setBanner({ kind: "error", text: message });
    } finally {
      setMigrating(false);
    }
  }, [migrating, refreshConfig]);

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
    const validationErrors = validateConfig(form, supports, configVersion);
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setBanner({ kind: "error", text: "Revisa los errores en la configuración" });
      return;
    }

    setSaving(true);
    setBanner(null);
    try {
      const payload = JSON.parse(JSON.stringify(form)) as AppConfig;
      if (payload.aemet) {
        delete payload.aemet.api_key;
        delete (payload.aemet as { has_api_key?: boolean }).has_api_key;
        delete (payload.aemet as { api_key_last4?: string | null }).api_key_last4;
      }
      if (payload.layers?.ships) {
        payload.layers.ships.update_interval = Math.max(1, Math.min(300, Math.round(payload.layers.ships.update_interval)));
        payload.layers.ships.refresh_seconds = payload.layers.ships.update_interval;
        if (payload.layers.ships.aisstream) {
          delete payload.layers.ships.aisstream.api_key;
          delete (payload.layers.ships.aisstream as { has_api_key?: boolean }).has_api_key;
          delete (payload.layers.ships.aisstream as { api_key_last4?: string | null }).api_key_last4;
        }
      }
      if (payload.layers?.global?.radar) {
        delete (payload.layers.global.radar as { has_api_key?: boolean }).has_api_key;
        delete (payload.layers.global.radar as { api_key_last4?: string | null }).api_key_last4;
      }
      if (payload.opensky?.oauth2) {
        const oauthPayload = payload.opensky.oauth2 as {
          token_url?: string | null;
          client_id?: string | null;
          client_secret?: string | null;
          scope?: string | null;
          has_credentials?: boolean;
          client_id_last4?: string | null;
        };
        if (typeof oauthPayload.token_url === "string") {
          oauthPayload.token_url = oauthPayload.token_url.trim();
        }
        if (typeof oauthPayload.client_id === "string") {
          const trimmedId = oauthPayload.client_id.trim();
          if (trimmedId.length > 0) {
            oauthPayload.client_id = trimmedId;
          } else {
            delete oauthPayload.client_id;
          }
        } else if (oauthPayload.client_id === null) {
          delete oauthPayload.client_id;
        }
        if (typeof oauthPayload.client_secret === "string") {
          const trimmedSecret = oauthPayload.client_secret.trim();
          if (trimmedSecret.length > 0) {
            oauthPayload.client_secret = trimmedSecret;
          } else {
            delete oauthPayload.client_secret;
          }
        } else if (oauthPayload.client_secret === null) {
          delete oauthPayload.client_secret;
        }
        if (typeof oauthPayload.scope === "string") {
          const trimmedScope = oauthPayload.scope.trim();
          oauthPayload.scope = trimmedScope.length > 0 ? trimmedScope : null;
        }
        delete oauthPayload.has_credentials;
        delete oauthPayload.client_id_last4;
      }
      // Usar saveConfigV2 si la versión es 2
      if (configVersion === 2) {
        // Construir objeto v2 completo con secrets
        // Extraer secrets desde inputs locales o del payload
        const v2Form = form as unknown as { 
          panels?: { calendar?: { enabled?: boolean; provider?: string } }; 
          secrets?: { 
            google?: { api_key?: string; calendar_id?: string }; 
            calendar_ics?: { url?: string; path?: string };
            opensky?: Record<string, unknown>;
            aemet?: Record<string, unknown>;
          } 
        };
        
        const secrets: import("../types/config_v2").SecretsConfig = {
          opensky: v2Form.secrets?.opensky || {},
          aemet: v2Form.secrets?.aemet || {},
          google: {
            api_key: (showGoogleCalendarKey && googleCalendarKeyInput.trim()) 
              ? googleCalendarKeyInput.trim() 
              : undefined,
            calendar_id: googleCalendarIdInput.trim() 
              ? googleCalendarIdInput.trim() 
              : undefined,
          },
          calendar_ics: {
            url: icsUrlInput.trim() ? icsUrlInput.trim() : undefined,
            path: icsPathInput.trim() ? icsPathInput.trim() : undefined,
          },
        };
        
        // Asegurar que panels.calendar esté presente si se está editando
        const existingCalendar = v2Form.panels?.calendar as import("../types/config_v2").PanelCalendarConfig | undefined;
        const calendarProvider = (existingCalendar?.provider === "ics" ? "ics" : existingCalendar?.provider === "disabled" ? "disabled" : "google") as "google" | "ics" | "disabled";
        const calendarIcsPath = icsPathInput.trim() || existingCalendar?.ics_path;
        const panels: import("../types/config_v2").PanelsConfigV2 = {
          ...(v2Form.panels as import("../types/config_v2").PanelsConfigV2 || {}),
          calendar: existingCalendar && typeof existingCalendar.enabled === "boolean"
            ? {
                enabled: existingCalendar.enabled,
                provider: calendarProvider,
                ...(calendarProvider === "ics" && calendarIcsPath ? { ics_path: calendarIcsPath } : {}),
              }
            : { enabled: false, provider: "google" as const },
        };
        
        // También añadir calendar top-level si es ICS
        const calendar = calendarProvider === "ics" && calendarIcsPath
          ? {
              enabled: existingCalendar?.enabled ?? false,
              provider: "ics" as const,
              ics_path: calendarIcsPath,
            }
          : existingCalendar && typeof existingCalendar.enabled === "boolean"
          ? {
              enabled: existingCalendar.enabled,
              provider: calendarProvider,
              ...(calendarProvider === "ics" && calendarIcsPath ? { ics_path: calendarIcsPath } : {}),
            }
          : undefined;
        
        // Construir ui_map desde form.ui_map si existe
        const v2FormWithMap = form as unknown as { ui_map?: MapConfigV2 };
        const ui_map = v2FormWithMap.ui_map || {
          engine: "maplibre" as const,
          provider: "local_raster_xyz" as const,
          renderWorldCopies: true,
          interactive: false,
          controls: false,
          local: { tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", minzoom: 0, maxzoom: 19 },
          maptiler: { apiKey: null, styleUrl: null },
          customXyz: { tileUrl: null, minzoom: 0, maxzoom: 19 },
          viewMode: "fixed" as const,
          fixed: { center: { lat: 39.98, lon: 0.20 }, zoom: 7.8, bearing: 0, pitch: 0 },
          region: { postalCode: "12001" },
        };
        
        // Extraer layers y ui_global desde el formulario preservando todos los valores
        const v2FormWithLayers = form as unknown as { 
          layers?: { 
            flights?: { enabled?: boolean; [key: string]: unknown }; 
            ships?: { enabled?: boolean; [key: string]: unknown };
            global?: { [key: string]: unknown };
          };
          ui_global?: { 
            radar?: { enabled?: boolean; provider?: string; [key: string]: unknown }; 
            satellite?: { enabled?: boolean; provider?: string; opacity?: number; [key: string]: unknown };
          };
        };
        
        // Preservar toda la estructura de layers y ui_global del formulario
        const layers = v2FormWithLayers.layers ? {
          ...v2FormWithLayers.layers,
          flights: v2FormWithLayers.layers.flights ? {
            ...v2FormWithLayers.layers.flights,
            enabled: v2FormWithLayers.layers.flights.enabled ?? false,
          } : undefined,
          ships: v2FormWithLayers.layers.ships ? {
            ...v2FormWithLayers.layers.ships,
            enabled: v2FormWithLayers.layers.ships.enabled ?? false,
          } : undefined,
        } : undefined;
        
        const ui_global = v2FormWithLayers.ui_global ? {
          ...v2FormWithLayers.ui_global,
          radar: v2FormWithLayers.ui_global.radar ? {
            ...v2FormWithLayers.ui_global.radar,
            enabled: v2FormWithLayers.ui_global.radar.enabled ?? false,
          } : undefined,
        } : undefined;
        
        const v2Payload: import("../types/config_v2").AppConfigV2 = {
          ...payload,
          version: 2,
          ui_map,
          panels,
          secrets,
          layers,
          ui_global,
          calendar,
        } as unknown as import("../types/config_v2").AppConfigV2;
        
        await saveConfigV2(v2Payload);
        let reloadOk = false;
        try {
          // Re-fetch config y rehidratar stores en caliente
          await refreshConfig();
          await reloadConfig();
          reloadOk = true;
        } catch (reloadError) {
          console.warn("[ConfigPage] Failed to reload config after save:", reloadError);
        }
        setSaveStatus("saved");
        setBanner({ kind: "success", text: reloadOk ? "Config guardada y recargada ✅" : "Config guardada ✅" });
        
        // Cargar estado del calendario actualizado
        void loadCalendarStatus();
        
        // Disparar evento personalizado para que useConfig() haga re-fetch inmediato
        // Esto permite que el mapa y otros componentes se actualicen sin esperar al polling
        window.dispatchEvent(new CustomEvent("pantalla:config:saved", { detail: { version: 2 } }));
        
        // Resetear estado "saved" después de 3 segundos
        setTimeout(() => {
          if (isMountedRef.current) {
            setSaveStatus("idle");
          }
        }, 3000);
      } else {
        await saveConfig(payload);
        // Re-fetch config y rehidratar stores en caliente
        try {
          await refreshConfig();
          await reloadConfig();
        } catch (refreshError) {
          console.warn("[ConfigPage] Failed to refresh config after save", refreshError);
        }
        setSaveStatus("saved");
        setBanner({ kind: "success", text: "Guardado ✅" });
        
        // Disparar evento personalizado para que useConfig() haga re-fetch inmediato
        window.dispatchEvent(new CustomEvent("pantalla:config:saved", { detail: { version: 1 } }));
        
        // Resetear estado "saved" después de 3 segundos
        setTimeout(() => {
          if (isMountedRef.current) {
            setSaveStatus("idle");
          }
        }, 3000);
      }
      setShowMaptilerKey(false);
      setShowAemetKey(false);
      setAemetKeyInput("");
      setAemetTestResult(null);
      setShowAisstreamKey(false);
      setAisstreamKeyInput("");
      setShipsTestResult(null);
      setShowOpenWeatherKey(false);
      setOpenWeatherKeyInput("");
      setFieldErrors({});
    } catch (error) {
      console.error("[ConfigPage] Failed to save configuration", error);
      if (error instanceof ApiError) {
        const backendErrors = extractBackendErrors(error.body);
        const fieldErrors: FieldErrors = { ...backendErrors };
        let errorMessage = "";
        
        if (typeof error.body === "object" && error.body !== null) {
          const errorBody = error.body as Record<string, unknown>;
          
          // Extraer mensaje de error específico del backend
          if ("error" in errorBody && typeof errorBody.error === "string") {
            errorMessage = errorBody.error;
          } else if (backendErrors.__root__) {
            errorMessage = backendErrors.__root__;
          }
          
          // Extraer missing y field_paths
          const missing = "missing" in errorBody && Array.isArray(errorBody.missing) ? errorBody.missing : [];
          const fieldPaths = "field_paths" in errorBody && Array.isArray(errorBody.field_paths) ? errorBody.field_paths : [];
          
          // Añadir errores de campo para cada path faltante o inválido
          const allPaths = [...missing, ...fieldPaths];
          for (const path of allPaths) {
            if (typeof path === "string") {
              // Usar el mensaje de error específico si está disponible, o uno genérico
              fieldErrors[path] = errorMessage || "Campo requerido o inválido";
            }
          }
        }
        
        // Si no hay mensaje de error pero hay errores de campo, crear uno genérico
        if (!errorMessage && Object.keys(fieldErrors).length > 0) {
          const errorKeys = Object.keys(fieldErrors).filter(key => key !== "__root__");
          if (errorKeys.length > 0) {
            errorMessage = `Errores en: ${errorKeys.join(", ")}`;
          }
        }
        
        if (!errorMessage && backendErrors.__root__) {
          errorMessage = backendErrors.__root__;
        }
        
        if (!errorMessage) {
          errorMessage = "Error al guardar la configuración";
        }
        
        setFieldErrors(fieldErrors);
        setSaveStatus("error");
        setBanner({ kind: "error", text: errorMessage });
      } else {
        setSaveStatus("error");
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
      // Resetear estado de error después de 5 segundos
      setTimeout(() => {
        if (isMountedRef.current && saveStatus === "error") {
          setSaveStatus("idle");
        }
      }, 5000);
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

  const SHOW_FLIGHTS_CONTROLS = false; // Unificar en sección única “Aviones (OpenSky)”

  return (
    <div className="config-page">
      {banner && (
        <div className={`config-status config-status--${banner.kind}`} role="status">
          {banner.text}
        </div>
      )}

      {configVersion !== null && configVersion !== 2 && (
        <div className="config-status config-status--warning" role="alert">
          <p>
            <strong>Configuración v{configVersion} detectada.</strong> Se recomienda migrar a v2 para acceder a todas las nuevas funcionalidades.
          </p>
          <button
            type="button"
            onClick={() => void handleMigrateToV2()}
            disabled={migrating || !isReady}
            className="config-button primary"
          >
            {migrating ? "Migrando..." : "Migrar a v2"}
          </button>
          {migrationResult && (
            <div className={`config-status config-status--${migrationResult.ok ? "success" : "error"}`} style={{ marginTop: "8px" }}>
              {migrationResult.message}
            </div>
          )}
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

        {/* Sección de Mapas v2 */}
        {configVersion === 2 && (
          <div className="config-card">
            <div>
              <h2>Mapa</h2>
              <p>Configura el proveedor del mapa base.</p>
            </div>
            <div className="config-grid">
              {/* Selector de proveedor */}
              <div className="config-field">
                <label htmlFor="map_provider_v2">Proveedor</label>
                <select
                  id="map_provider_v2"
                  value={(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.provider || "local_raster_xyz"}
                  disabled={disableInputs}
                  onChange={(event) => {
                    const provider = event.target.value as MapConfigV2["provider"];
                    setForm((prev) => {
                      const v2Form = prev as unknown as { ui_map?: MapConfigV2 };
                      const currentUiMap = v2Form.ui_map || {
                        engine: "maplibre" as const,
                        provider: "local_raster_xyz" as const,
                        renderWorldCopies: true,
                        interactive: false,
                        controls: false,
                        local: { tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", minzoom: 0, maxzoom: 19 },
                        maptiler: { apiKey: null, styleUrl: null },
                        customXyz: { tileUrl: null, minzoom: 0, maxzoom: 19 },
                        viewMode: "fixed" as const,
                        fixed: { center: { lat: 39.98, lon: 0.20 }, zoom: 7.8, bearing: 0, pitch: 0 },
                      };
                      
                      return {
                        ...prev,
                        ui_map: {
                          ...currentUiMap,
                          provider,
                          // Asegurar que los bloques existen
                          local: currentUiMap.local || {
                            tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                            minzoom: 0,
                            maxzoom: 19,
                          },
                          maptiler: currentUiMap.maptiler || { apiKey: null, styleUrl: null },
                          customXyz: currentUiMap.customXyz || { tileUrl: null, minzoom: 0, maxzoom: 19 },
                        },
                      } as unknown as AppConfig;
                    });
                    if (provider !== "maptiler_vector") {
                      setShowMaptilerKey(false);
                    }
                    resetErrorsFor("ui_map.provider");
                  }}
                >
                  {MAP_PROVIDER_V2_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {MAP_PROVIDER_V2_LABELS[option]}
                    </option>
                  ))}
                </select>
                {renderHelp("Proveedor del mapa base")}
                {renderFieldError("ui_map.provider")}
              </div>

              {/* Campos para local_raster_xyz */}
              {(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.provider === "local_raster_xyz" && (
                <div className="config-field">
                  <label htmlFor="local_tile_url">URL de tiles OSM</label>
                  <input
                    id="local_tile_url"
                    type="text"
                    value={(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.local?.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
                    disabled={disableInputs}
                    readOnly
                  />
                  {renderHelp("URL de tiles OpenStreetMap (readonly, editable en modo avanzado)")}
                </div>
              )}

              {/* Campos para maptiler_vector */}
              {(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.provider === "maptiler_vector" && (
                <>
                  <div className="config-field">
                    <label htmlFor="maptiler_api_key_v2">API Key de MapTiler</label>
                    <div className="config-field__inline">
                      <input
                        id="maptiler_api_key_v2"
                        type={showMaptilerKey ? "text" : "password"}
                        autoComplete="off"
                        value={
                          showMaptilerKey
                            ? ((form as unknown as { ui_map?: MapConfigV2 }).ui_map?.maptiler?.apiKey || "")
                            : ((form as unknown as { ui_map?: MapConfigV2 }).ui_map?.maptiler?.apiKey ? "••••••••" : "")
                        }
                        disabled={disableInputs}
                        onChange={(event) => {
                          const value = event.target.value;
                          setForm((prev) => {
                            const v2Form = prev as unknown as { ui_map?: MapConfigV2 };
                            const currentUiMap = v2Form.ui_map || {
                              engine: "maplibre" as const,
                              provider: "maptiler_vector" as const,
                              renderWorldCopies: true,
                              interactive: false,
                              controls: false,
                              local: { tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", minzoom: 0, maxzoom: 19 },
                              maptiler: { apiKey: null, styleUrl: null },
                              customXyz: { tileUrl: null, minzoom: 0, maxzoom: 19 },
                              viewMode: "fixed" as const,
                              fixed: { center: { lat: 39.98, lon: 0.20 }, zoom: 7.8, bearing: 0, pitch: 0 },
                            };
                            
                            return {
                              ...prev,
                              ui_map: {
                                ...currentUiMap,
                                maptiler: {
                                  ...currentUiMap.maptiler,
                                  apiKey: value || null,
                                },
                              },
                            } as unknown as AppConfig;
                          });
                          resetErrorsFor("ui_map.maptiler.apiKey");
                        }}
                      />
                      <button
                        type="button"
                        className="config-button"
                        onClick={() => {
                          setShowMaptilerKey((prev) => !prev);
                          if (!showMaptilerKey) {
                            const v2Form = form as unknown as { ui_map?: MapConfigV2 };
                            if (v2Form.ui_map?.maptiler?.apiKey && !googleCalendarKeyInput) {
                              // No podemos cargar la key real desde el backend por seguridad
                              // Solo mostramos el placeholder
                            }
                          }
                        }}
                        disabled={disableInputs}
                      >
                        {showMaptilerKey ? "Ocultar" : "Mostrar/Añadir"}
                      </button>
                    </div>
                    <span className="config-field__hint" title={MAPTILER_DOCS_TEXT}>
                      {MAPTILER_DOCS_TEXT}
                    </span>
                    {renderFieldError("ui_map.maptiler.apiKey")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="maptiler_style_url">URL del estilo</label>
                    <input
                      id="maptiler_style_url"
                      type="text"
                      value={(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.maptiler?.styleUrl || ""}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const value = event.target.value.trim();
                        setForm((prev) => {
                          const v2Form = prev as unknown as { ui_map?: MapConfigV2 };
                          const currentUiMap = v2Form.ui_map || {
                            engine: "maplibre" as const,
                            provider: "maptiler_vector" as const,
                            renderWorldCopies: true,
                            interactive: false,
                            controls: false,
                            local: { tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", minzoom: 0, maxzoom: 19 },
                            maptiler: { apiKey: null, styleUrl: null },
                            customXyz: { tileUrl: null, minzoom: 0, maxzoom: 19 },
                            viewMode: "fixed" as const,
                            fixed: { center: { lat: 39.98, lon: 0.20 }, zoom: 7.8, bearing: 0, pitch: 0 },
                          };
                          
                          return {
                            ...prev,
                            ui_map: {
                              ...currentUiMap,
                              maptiler: {
                                ...currentUiMap.maptiler,
                                styleUrl: value || null,
                              },
                            },
                          } as unknown as AppConfig;
                        });
                        resetErrorsFor("ui_map.maptiler.styleUrl");
                      }}
                      placeholder="https://api.maptiler.com/maps/dark/style.json"
                    />
                    {renderHelp("URL del estilo de MapTiler (ej: dark, streets, bright)")}
                    {renderFieldError("ui_map.maptiler.styleUrl")}
                  </div>
                </>
              )}

              {/* Campos para custom_xyz */}
              {(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.provider === "custom_xyz" && (
                <>
                  <div className="config-field">
                    <label htmlFor="custom_xyz_tile_url">URL Template</label>
                    <input
                      id="custom_xyz_tile_url"
                      type="text"
                      value={(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.customXyz?.tileUrl || ""}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const value = event.target.value.trim();
                        setForm((prev) => {
                          const v2Form = prev as unknown as { ui_map?: MapConfigV2 };
                          const currentUiMap = v2Form.ui_map || {
                            engine: "maplibre" as const,
                            provider: "custom_xyz" as const,
                            renderWorldCopies: true,
                            interactive: false,
                            controls: false,
                            local: { tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", minzoom: 0, maxzoom: 19 },
                            maptiler: { apiKey: null, styleUrl: null },
                            customXyz: { tileUrl: null, minzoom: 0, maxzoom: 19 },
                            viewMode: "fixed" as const,
                            fixed: { center: { lat: 39.98, lon: 0.20 }, zoom: 7.8, bearing: 0, pitch: 0 },
                          };
                          
                          return {
                            ...prev,
                            ui_map: {
                              ...currentUiMap,
                              customXyz: {
                                ...currentUiMap.customXyz,
                                tileUrl: value || null,
                              },
                            },
                          } as unknown as AppConfig;
                        });
                        resetErrorsFor("ui_map.customXyz.tileUrl");
                      }}
                      placeholder="https://example.com/tiles/{z}/{x}/{y}.png"
                    />
                    {renderHelp("Plantilla de URL para los tiles (usa {z}, {x}, {y})")}
                    {renderFieldError("ui_map.customXyz.tileUrl")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="custom_xyz_minzoom">Zoom mínimo</label>
                    <input
                      id="custom_xyz_minzoom"
                      type="number"
                      min="0"
                      max="24"
                      value={(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.customXyz?.minzoom ?? 0}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => {
                            const v2Form = prev as unknown as { ui_map?: MapConfigV2 };
                            const currentUiMap = v2Form.ui_map || {
                              engine: "maplibre" as const,
                              provider: "custom_xyz" as const,
                              renderWorldCopies: true,
                              interactive: false,
                              controls: false,
                              local: { tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", minzoom: 0, maxzoom: 19 },
                              maptiler: { apiKey: null, styleUrl: null },
                              customXyz: { tileUrl: null, minzoom: 0, maxzoom: 19 },
                              viewMode: "fixed" as const,
                              fixed: { center: { lat: 39.98, lon: 0.20 }, zoom: 7.8, bearing: 0, pitch: 0 },
                            };
                            
                            return {
                              ...prev,
                              ui_map: {
                                ...currentUiMap,
                                customXyz: {
                                  ...currentUiMap.customXyz,
                                  minzoom: value,
                                },
                              },
                            } as unknown as AppConfig;
                          });
                          resetErrorsFor("ui_map.customXyz.minzoom");
                        }
                      }}
                    />
                    {renderHelp("Nivel de zoom mínimo (0-24)")}
                    {renderFieldError("ui_map.customXyz.minzoom")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="custom_xyz_maxzoom">Zoom máximo</label>
                    <input
                      id="custom_xyz_maxzoom"
                      type="number"
                      min="0"
                      max="24"
                      value={(form as unknown as { ui_map?: MapConfigV2 }).ui_map?.customXyz?.maxzoom ?? 19}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => {
                            const v2Form = prev as unknown as { ui_map?: MapConfigV2 };
                            const currentUiMap = v2Form.ui_map || {
                              engine: "maplibre" as const,
                              provider: "custom_xyz" as const,
                              renderWorldCopies: true,
                              interactive: false,
                              controls: false,
                              local: { tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", minzoom: 0, maxzoom: 19 },
                              maptiler: { apiKey: null, styleUrl: null },
                              customXyz: { tileUrl: null, minzoom: 0, maxzoom: 19 },
                              viewMode: "fixed" as const,
                              fixed: { center: { lat: 39.98, lon: 0.20 }, zoom: 7.8, bearing: 0, pitch: 0 },
                            };
                            
                            return {
                              ...prev,
                              ui_map: {
                                ...currentUiMap,
                                customXyz: {
                                  ...currentUiMap.customXyz,
                                  maxzoom: value,
                                },
                              },
                            } as unknown as AppConfig;
                          });
                          resetErrorsFor("ui_map.customXyz.maxzoom");
                        }
                      }}
                    />
                    {renderHelp("Nivel de zoom máximo (0-24)")}
                    {renderFieldError("ui_map.customXyz.maxzoom")}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Sección de Mapas legacy v1 (solo si no es v2) */}
        {configVersion !== 2 && supports("map") && (
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
                        const uiProvider = provider as AppConfig["ui"]["map"]["provider"];
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
                              provider: uiProvider,
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

              {/* Configuración XYZ legacy */}
              {supports("ui.map.xyz") && form.ui.map.provider === "xyz" && (
                <>
                  {supports("ui.map.xyz.urlTemplate") && (
                    <div className="config-field">
                      <label htmlFor="xyz_url_template">URL Template</label>
                      <input
                        id="xyz_url_template"
                        type="text"
                        value={form.ui.map.xyz?.urlTemplate || ""}
                        disabled={disableInputs}
                        onChange={(event) => {
                          const urlTemplate = event.target.value.trim();
                          setForm((prev) => {
                            const mapWithXyz = prev.ui.map as MapConfig & { xyz?: XyzConfig };
                            const existingXyz = mapWithXyz.xyz;
                            const currentXyz: XyzConfig = existingXyz ?? {
                              urlTemplate: "",
                              attribution: "",
                              minzoom: 0,
                              maxzoom: 19,
                              tileSize: 256,
                              labelsOverlay: false,
                            };
                            return {
                              ...prev,
                              ui: {
                                ...prev.ui,
                                map: {
                                  ...prev.ui.map,
                                  xyz: {
                                    urlTemplate,
                                    attribution: currentXyz.attribution,
                                    minzoom: currentXyz.minzoom,
                                    maxzoom: currentXyz.maxzoom,
                                    tileSize: currentXyz.tileSize,
                                    labelsOverlay: currentXyz.labelsOverlay,
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("ui.map.xyz.urlTemplate");
                        }}
                        placeholder="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                      />
                      {renderHelp("Plantilla de URL para los tiles (usa {z}, {x}, {y})")}
                      {renderFieldError("ui.map.xyz.urlTemplate")}
                    </div>
                  )}

                  {supports("ui.map.xyz.attribution") && (
                    <div className="config-field">
                      <label htmlFor="xyz_attribution">Atribución</label>
                      <input
                        id="xyz_attribution"
                        type="text"
                        value={form.ui.map.xyz?.attribution || ""}
                        disabled={disableInputs}
                        onChange={(event) => {
                          const attribution = event.target.value.trim();
                          setForm((prev) => {
                            const mapWithXyz = prev.ui.map as MapConfig & { xyz?: XyzConfig };
                            const existingXyz = mapWithXyz.xyz;
                            const currentXyz: XyzConfig = existingXyz ?? {
                              urlTemplate: mapWithXyz.xyz?.urlTemplate || "",
                              attribution: "",
                              minzoom: 0,
                              maxzoom: 19,
                              tileSize: 256,
                              labelsOverlay: false,
                            };
                            return {
                              ...prev,
                              ui: {
                                ...prev.ui,
                                map: {
                                  ...prev.ui.map,
                                  xyz: {
                                    urlTemplate: currentXyz.urlTemplate,
                                    attribution,
                                    minzoom: currentXyz.minzoom,
                                    maxzoom: currentXyz.maxzoom,
                                    tileSize: currentXyz.tileSize,
                                    labelsOverlay: currentXyz.labelsOverlay,
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("ui.map.xyz.attribution");
                        }}
                        placeholder="© Esri, Maxar, GeoEye..."
                      />
                      {renderHelp("Texto de atribución para mostrar en el mapa")}
                      {renderFieldError("ui.map.xyz.attribution")}
                    </div>
                  )}

                  {supports("ui.map.xyz.minzoom") && (
                    <div className="config-field">
                      <label htmlFor="xyz_minzoom">Zoom mínimo</label>
                      <input
                        id="xyz_minzoom"
                        type="number"
                        min="0"
                        max="24"
                        value={form.ui.map.xyz?.minzoom ?? 0}
                        disabled={disableInputs}
                        onChange={(event) => {
                          const minzoom = Number(event.target.value);
                          if (!Number.isNaN(minzoom)) {
                            setForm((prev) => {
                              const mapWithXyz = prev.ui.map as MapConfig & { xyz?: XyzConfig };
                              const existingXyz = mapWithXyz.xyz;
                              const currentXyz: XyzConfig = existingXyz ?? {
                                urlTemplate: mapWithXyz.xyz?.urlTemplate || "",
                                attribution: mapWithXyz.xyz?.attribution || "",
                                minzoom: 0,
                                maxzoom: 19,
                                tileSize: 256,
                                labelsOverlay: false,
                              };
                              return {
                                ...prev,
                                ui: {
                                  ...prev.ui,
                                  map: {
                                    ...prev.ui.map,
                                    xyz: {
                                      urlTemplate: currentXyz.urlTemplate,
                                      attribution: currentXyz.attribution,
                                      minzoom,
                                      maxzoom: currentXyz.maxzoom,
                                      tileSize: currentXyz.tileSize,
                                      labelsOverlay: currentXyz.labelsOverlay,
                                    },
                                  },
                                },
                              };
                            });
                            resetErrorsFor("ui.map.xyz.minzoom");
                          }
                        }}
                      />
                      {renderHelp("Nivel de zoom mínimo (0-24)")}
                      {renderFieldError("ui.map.xyz.minzoom")}
                    </div>
                  )}

                  {supports("ui.map.xyz.maxzoom") && (
                    <div className="config-field">
                      <label htmlFor="xyz_maxzoom">Zoom máximo</label>
                      <input
                        id="xyz_maxzoom"
                        type="number"
                        min="0"
                        max="24"
                        value={form.ui.map.xyz?.maxzoom ?? 19}
                        disabled={disableInputs}
                        onChange={(event) => {
                          const maxzoom = Number(event.target.value);
                          if (!Number.isNaN(maxzoom)) {
                            setForm((prev) => {
                              const mapWithXyz = prev.ui.map as MapConfig & { xyz?: XyzConfig };
                              const existingXyz = mapWithXyz.xyz;
                              const currentXyz: XyzConfig = existingXyz ?? {
                                urlTemplate: mapWithXyz.xyz?.urlTemplate || "",
                                attribution: mapWithXyz.xyz?.attribution || "",
                                minzoom: mapWithXyz.xyz?.minzoom ?? 0,
                                maxzoom: 19,
                                tileSize: 256,
                                labelsOverlay: false,
                              };
                              return {
                                ...prev,
                                ui: {
                                  ...prev.ui,
                                  map: {
                                    ...prev.ui.map,
                                    xyz: {
                                      urlTemplate: currentXyz.urlTemplate,
                                      attribution: currentXyz.attribution,
                                      minzoom: currentXyz.minzoom,
                                      maxzoom,
                                      tileSize: currentXyz.tileSize,
                                      labelsOverlay: currentXyz.labelsOverlay,
                                    },
                                  },
                                },
                              };
                            });
                            resetErrorsFor("ui.map.xyz.maxzoom");
                          }
                        }}
                      />
                      {renderHelp("Nivel de zoom máximo (0-24)")}
                      {renderFieldError("ui.map.xyz.maxzoom")}
                    </div>
                  )}

                  {supports("ui.map.xyz.tileSize") && (
                    <div className="config-field">
                      <label htmlFor="xyz_tile_size">Tamaño de tile</label>
                      <input
                        id="xyz_tile_size"
                        type="number"
                        min="64"
                        max="512"
                        step="64"
                        value={form.ui.map.xyz?.tileSize ?? 256}
                        disabled={disableInputs}
                        onChange={(event) => {
                          const tileSize = Number(event.target.value);
                          if (!Number.isNaN(tileSize)) {
                            setForm((prev) => {
                              const mapWithXyz = prev.ui.map as MapConfig & { xyz?: XyzConfig };
                              const existingXyz = mapWithXyz.xyz;
                              const currentXyz: XyzConfig = existingXyz ?? {
                                urlTemplate: mapWithXyz.xyz?.urlTemplate || "",
                                attribution: mapWithXyz.xyz?.attribution || "",
                                minzoom: mapWithXyz.xyz?.minzoom ?? 0,
                                maxzoom: mapWithXyz.xyz?.maxzoom ?? 19,
                                tileSize: 256,
                                labelsOverlay: false,
                              };
                              return {
                                ...prev,
                                ui: {
                                  ...prev.ui,
                                  map: {
                                    ...prev.ui.map,
                                    xyz: {
                                      urlTemplate: currentXyz.urlTemplate,
                                      attribution: currentXyz.attribution,
                                      minzoom: currentXyz.minzoom,
                                      maxzoom: currentXyz.maxzoom,
                                      tileSize,
                                      labelsOverlay: currentXyz.labelsOverlay,
                                    },
                                  },
                                },
                              };
                            });
                            resetErrorsFor("ui.map.xyz.tileSize");
                          }
                        }}
                      />
                      {renderHelp("Tamaño de los tiles en píxeles (64-512)")}
                      {renderFieldError("ui.map.xyz.tileSize")}
                    </div>
                  )}

                  {supports("ui.map.xyz.labelsOverlay") && (
                    <div className="config-field config-field--checkbox">
                      <label htmlFor="xyz_labels_overlay">
                        <input
                          id="xyz_labels_overlay"
                          type="checkbox"
                          checked={form.ui.map.xyz?.labelsOverlay ?? false}
                          disabled={disableInputs}
                          onChange={(event) => {
                            const labelsOverlay = event.target.checked;
                            setForm((prev) => {
                              const mapWithXyz = prev.ui.map as MapConfig & { xyz?: XyzConfig };
                              const existingXyz = mapWithXyz.xyz;
                              const currentXyz: XyzConfig = existingXyz ?? {
                                urlTemplate: mapWithXyz.xyz?.urlTemplate || "",
                                attribution: mapWithXyz.xyz?.attribution || "",
                                minzoom: mapWithXyz.xyz?.minzoom ?? 0,
                                maxzoom: mapWithXyz.xyz?.maxzoom ?? 19,
                                tileSize: mapWithXyz.xyz?.tileSize ?? 256,
                                labelsOverlay: false,
                              };
                              return {
                                ...prev,
                                ui: {
                                  ...prev.ui,
                                  map: {
                                    ...prev.ui.map,
                                    xyz: {
                                      urlTemplate: currentXyz.urlTemplate,
                                      attribution: currentXyz.attribution,
                                      minzoom: currentXyz.minzoom,
                                      maxzoom: currentXyz.maxzoom,
                                      tileSize: currentXyz.tileSize,
                                      labelsOverlay,
                                    },
                                  },
                                },
                              };
                            });
                            resetErrorsFor("ui.map.xyz.labelsOverlay");
                          }}
                        />
                        Overlay de etiquetas OSM
                      </label>
                      {renderHelp("Añade etiquetas de OpenStreetMap encima del mapa raster para toponimia")}
                      {renderFieldError("ui.map.xyz.labelsOverlay")}
                    </div>
                  )}
                </>
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
            </div>
          </div>
        )}

        {supports("ui.map.theme") && (
          <div className="config-card">
            <div>
              <h2>Tema del mapa</h2>
              <p>Personaliza los colores del mapa.</p>
            </div>
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
                  {renderHelp("Permite alternar los módulos en orden secuencial")}
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
                  {renderHelp("Activa el modo de visualización para tormentas locales (zoom Castellón/Vila-real)")}
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

        {supports("aemet") && (
          <div className="config-card">
            <div>
              <h2>AEMET</h2>
              <p>Gestiona la integración de datos oficiales de AEMET y su clave privada.</p>
            </div>
            <div className="config-grid">
              {supports("aemet.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="aemet_enabled">
                    <input
                      id="aemet_enabled"
                      type="checkbox"
                      checked={form.aemet.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          aemet: {
                            ...prev.aemet,
                            enabled,
                          },
                        }));
                        resetErrorsFor("aemet.enabled");
                      }}
                    />
                    Activar datos oficiales de AEMET
                  </label>
                  {renderHelp("Incluye avisos CAP, radar y satélite si la clave es válida")}
                  {renderFieldError("aemet.enabled")}
                </div>
              )}

              {supports("aemet.cap_enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="aemet_cap_enabled">
                    <input
                      id="aemet_cap_enabled"
                      type="checkbox"
                      checked={form.aemet.cap_enabled}
                      disabled={disableInputs || !form.aemet.enabled}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          aemet: {
                            ...prev.aemet,
                            cap_enabled: enabled,
                          },
                        }));
                      }}
                    />
                    Alertas CAP (avisos oficiales)
                  </label>
                  {renderHelp("Descarga avisos meteorológicos oficiales (CAP)")}
                  {renderFieldError("aemet.cap_enabled")}
                </div>
              )}

              {supports("aemet.radar_enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="aemet_radar_enabled">
                    <input
                      id="aemet_radar_enabled"
                      type="checkbox"
                      checked={form.aemet.radar_enabled}
                      disabled={disableInputs || !form.aemet.enabled}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          aemet: {
                            ...prev.aemet,
                            radar_enabled: enabled,
                          },
                        }));
                      }}
                    />
                    Radar de precipitación
                  </label>
                  {renderHelp("Superpone el radar nacional de lluvia en el mapa")}
                  {renderFieldError("aemet.radar_enabled")}
                </div>
              )}

              {supports("aemet.satellite_enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="aemet_satellite_enabled">
                    <input
                      id="aemet_satellite_enabled"
                      type="checkbox"
                      checked={form.aemet.satellite_enabled}
                      disabled={disableInputs || !form.aemet.enabled}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          aemet: {
                            ...prev.aemet,
                            satellite_enabled: enabled,
                          },
                        }));
                      }}
                    />
                    Imágenes satelitales
                  </label>
                  {renderHelp("Activa la capa de satélite visible de AEMET")}
                  {renderFieldError("aemet.satellite_enabled")}
                </div>
              )}

              {supports("aemet.cache_minutes") && (
                <div className="config-field">
                  <label htmlFor="aemet_cache_minutes">Frecuencia de actualización (min)</label>
                  <input
                    id="aemet_cache_minutes"
                    type="number"
                    min={1}
                    max={60}
                    value={form.aemet.cache_minutes}
                    disabled={disableInputs || !form.aemet.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }
                      setForm((prev) => ({
                        ...prev,
                        aemet: {
                          ...prev.aemet,
                          cache_minutes: Math.max(1, Math.min(60, Math.round(value))),
                        },
                      }));
                    }}
                  />
                  {renderHelp("Tiempo mínimo entre descargas desde la API")}
                  {renderFieldError("aemet.cache_minutes")}
                </div>
              )}

              {supports("aemet.api_key") && (
                <div className="config-field">
                  <label htmlFor="aemet_api_key">AEMET API key (oculta)</label>
                  <div className="config-field__secret">
                    {showAemetKey ? (
                      <input
                        id="aemet_api_key"
                        type="text"
                        value={aemetKeyInput}
                        disabled={disableInputs}
                        onChange={(event) => {
                          setAemetKeyInput(event.target.value);
                          setAemetTestResult(null);
                        }}
                        placeholder="Introduce la clave completa de AEMET"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    ) : (
                      <input
                        id="aemet_api_key_masked"
                        type="text"
                        value={maskedAemetKey}
                        readOnly
                        disabled
                        placeholder="Sin clave guardada"
                      />
                    )}
                    <button
                      type="button"
                      className="config-button"
                      onClick={handleToggleAemetKeyVisibility}
                      disabled={disableInputs}
                    >
                      {showAemetKey ? "Ocultar" : hasStoredAemetKey ? "Mostrar" : "Añadir"}
                    </button>
                  </div>
                  <div className="config-field__hint">
                    La clave se guarda en el backend y nunca se muestra completa en pantalla.
                  </div>
                  <div className="config-field__actions">
                    {showAemetKey && (
                      <button
                        type="button"
                        className="config-button primary"
                        onClick={() => void handleSaveAemetKey()}
                        disabled={disableInputs || !canPersistAemetKey}
                      >
                        Guardar clave
                      </button>
                    )}
                    <button
                      type="button"
                      className="config-button"
                      onClick={() => void handleTestAemetKey()}
                      disabled={disableInputs || testingAemetKey || !canTestAemetKey}
                    >
                      {testingAemetKey ? "Comprobando…" : "Probar clave"}
                    </button>
                  </div>
                  {aemetTestResult && (
                    <div
                      className={`config-field__hint ${
                        aemetTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                      }`}
                    >
                      {aemetTestResult.message}
                    </div>
                  )}
                  {renderFieldError("aemet.api_key")}
                </div>
              )}
            </div>
          </div>
        )}

        {supports("blitzortung") && (
          <div className="config-card">
            <div>
              <h2>Blitzortung (Rayos)</h2>
              <p>Configura la conexión a Blitzortung para recibir datos de rayos en tiempo real.</p>
            </div>
            <div className="config-grid">
              {supports("blitzortung.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="blitzortung_enabled">
                    <input
                      id="blitzortung_enabled"
                      type="checkbox"
                      checked={form.blitzortung?.enabled ?? false}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          blitzortung: {
                            ...prev.blitzortung,
                            enabled,
                          },
                        }));
                        resetErrorsFor("blitzortung.enabled");
                      }}
                    />
                    Activar detección de rayos en tiempo real
                  </label>
                  {renderHelp("Conecta a Blitzortung vía MQTT o WebSocket para recibir datos de rayos")}
                  {renderFieldError("blitzortung.enabled")}
                </div>
              )}

              {supports("blitzortung.ws_enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="blitzortung_ws_enabled">
                    <input
                      id="blitzortung_ws_enabled"
                      type="checkbox"
                      checked={form.blitzortung?.ws_enabled ?? false}
                      disabled={disableInputs || !form.blitzortung?.enabled}
                      onChange={(event) => {
                        const ws_enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          blitzortung: {
                            ...prev.blitzortung,
                            ws_enabled,
                          },
                        }));
                        resetErrorsFor("blitzortung.ws_enabled");
                      }}
                    />
                    Usar WebSocket en lugar de MQTT
                  </label>
                  {renderHelp("Si está activado, usa WebSocket en lugar de MQTT para conectar con Blitzortung")}
                  {renderFieldError("blitzortung.ws_enabled")}
                </div>
              )}

              {supports("blitzortung.mqtt_host") && !form.blitzortung?.ws_enabled && (
                <div className="config-field">
                  <label htmlFor="blitzortung_mqtt_host">Host MQTT</label>
                  <input
                    id="blitzortung_mqtt_host"
                    type="text"
                    maxLength={256}
                    value={form.blitzortung?.mqtt_host ?? "127.0.0.1"}
                    disabled={disableInputs || !form.blitzortung?.enabled || form.blitzortung?.ws_enabled}
                    onChange={(event) => {
                      const mqtt_host = event.target.value.trim();
                      setForm((prev) => ({
                        ...prev,
                        blitzortung: {
                          ...prev.blitzortung,
                          mqtt_host: mqtt_host || "127.0.0.1",
                        },
                      }));
                      resetErrorsFor("blitzortung.mqtt_host");
                    }}
                  />
                  {renderHelp("Dirección del servidor MQTT (ej: 127.0.0.1 o mqtt.blitzortung.org)")}
                  {renderFieldError("blitzortung.mqtt_host")}
                </div>
              )}

              {supports("blitzortung.mqtt_port") && !form.blitzortung?.ws_enabled && (
                <div className="config-field">
                  <label htmlFor="blitzortung_mqtt_port">Puerto MQTT</label>
                  <input
                    id="blitzortung_mqtt_port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.blitzortung?.mqtt_port ?? 1883}
                    disabled={disableInputs || !form.blitzortung?.enabled || form.blitzortung?.ws_enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isNaN(value)) {
                        setForm((prev) => ({
                          ...prev,
                          blitzortung: {
                            ...prev.blitzortung,
                            mqtt_port: Math.max(1, Math.min(65535, Math.round(value))),
                          },
                        }));
                        resetErrorsFor("blitzortung.mqtt_port");
                      }
                    }}
                  />
                  {renderHelp("Puerto del servidor MQTT (por defecto: 1883)")}
                  {renderFieldError("blitzortung.mqtt_port")}
                </div>
              )}

              {supports("blitzortung.mqtt_topic") && !form.blitzortung?.ws_enabled && (
                <div className="config-field">
                  <label htmlFor="blitzortung_mqtt_topic">Tópico MQTT</label>
                  <input
                    id="blitzortung_mqtt_topic"
                    type="text"
                    maxLength={256}
                    value={form.blitzortung?.mqtt_topic ?? "blitzortung/1"}
                    disabled={disableInputs || !form.blitzortung?.enabled || form.blitzortung?.ws_enabled}
                    onChange={(event) => {
                      const mqtt_topic = event.target.value.trim();
                      setForm((prev) => ({
                        ...prev,
                        blitzortung: {
                          ...prev.blitzortung,
                          mqtt_topic: mqtt_topic || "blitzortung/1",
                        },
                      }));
                      resetErrorsFor("blitzortung.mqtt_topic");
                    }}
                  />
                  {renderHelp("Tópico MQTT para suscribirse (por defecto: blitzortung/1)")}
                  {renderFieldError("blitzortung.mqtt_topic")}
                </div>
              )}

              {supports("blitzortung.ws_url") && form.blitzortung?.ws_enabled && (
                <div className="config-field">
                  <label htmlFor="blitzortung_ws_url">URL WebSocket</label>
                  <input
                    id="blitzortung_ws_url"
                    type="url"
                    maxLength={512}
                    value={form.blitzortung?.ws_url ?? ""}
                    disabled={disableInputs || !form.blitzortung?.enabled || !form.blitzortung?.ws_enabled}
                    onChange={(event) => {
                      const ws_url = event.target.value.trim() || null;
                      setForm((prev) => ({
                        ...prev,
                        blitzortung: {
                          ...prev.blitzortung,
                          ws_url,
                        },
                      }));
                      resetErrorsFor("blitzortung.ws_url");
                    }}
                  />
                  {renderHelp("URL del endpoint WebSocket de Blitzortung (ej: wss://ws.blitzortung.org)")}
                  {renderFieldError("blitzortung.ws_url")}
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

        {(supports("calendar") || configVersion === 2) && (
          <div className="config-card">
            <div>
              <h2>Calendario</h2>
              <p>Configura la integración con Google Calendar o un archivo ICS para mostrar eventos.</p>
            </div>
            <div className="config-grid">
              {/* Toggle enabled */}
              <div className="config-field config-field--checkbox">
                <label htmlFor="calendar_enabled">
                  <input
                    id="calendar_enabled"
                    type="checkbox"
                    checked={
                      configVersion === 2
                        ? (form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled ?? false
                        : form.calendar?.enabled ?? false
                    }
                    disabled={disableInputs}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      if (configVersion === 2) {
                        setForm((prev) => {
                          const v2 = prev as unknown as { panels?: { calendar?: { enabled?: boolean; provider?: string } } };
                          return {
                            ...prev,
                            panels: {
                              ...v2.panels,
                              calendar: {
                                ...v2.panels?.calendar,
                                enabled,
                                provider: v2.panels?.calendar?.provider || "google",
                              },
                            },
                          } as unknown as AppConfig;
                        });
                      } else {
                        setForm((prev) => ({
                          ...prev,
                          calendar: {
                            ...prev.calendar,
                            enabled,
                          },
                        }));
                      }
                    }}
                  />
                  Activar Calendario
                </label>
                {renderHelp("Habilita la integración con calendario")}
              </div>

              {/* Provider selector (solo v2) */}
              {configVersion === 2 && (
                <div className="config-field">
                  <label htmlFor="calendar_provider">Proveedor</label>
                  <select
                    id="calendar_provider"
                    value={(form as unknown as { panels?: { calendar?: { provider?: string } } }).panels?.calendar?.provider || "google"}
                    disabled={disableInputs || !((form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled)}
                    onChange={(event) => {
                      const provider = event.target.value as "google" | "ics" | "disabled";
                      const newEnabled = provider === "disabled" ? false : (form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled ?? false;
                      setForm((prev) => {
                        const v2 = prev as unknown as { panels?: { calendar?: { enabled?: boolean; provider?: string } } };
                        return {
                          ...prev,
                          panels: {
                            ...v2.panels,
                            calendar: {
                              ...v2.panels?.calendar,
                              enabled: newEnabled,
                              provider,
                            },
                          },
                        } as unknown as AppConfig;
                      });
                      void loadCalendarStatus();
                    }}
                  >
                    <option value="google">Google Calendar</option>
                    <option value="ics">ICS (iCalendar)</option>
                    <option value="disabled">Deshabilitado</option>
                  </select>
                  {renderHelp("Selecciona el proveedor de calendario")}
                  
                  {/* Estado del calendario */}
                  {calendarStatus && !calendarStatusLoading && (form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled && (
                    <div className={`config-field__hint ${
                      calendarStatus.status === "ok" ? "config-field__hint--success" :
                      calendarStatus.status === "error" || calendarStatus.status === "empty" ? "config-field__hint--error" :
                      "config-field__hint--warning"
                    }`} style={{ marginTop: "0.5rem" }}>
                      <strong>Estado:</strong> {calendarStatus.status === "ok" ? "✅ OK" : calendarStatus.status === "error" ? "❌ Error" : calendarStatus.status === "empty" ? "⚠️ Sin archivo" : "⏳ Stale"}
                      {calendarStatus.note && calendarStatus.note !== "OK" && (
                        <span style={{ display: "block", marginTop: "0.25rem", fontSize: "0.9em" }}>
                          {calendarStatus.note}
                        </span>
                      )}
                      {calendarStatus.provider === "google" && !calendarStatus.credentials_present && (
                        <span style={{ display: "block", marginTop: "0.25rem", fontSize: "0.9em", fontWeight: "bold" }}>
                          ⚠️ Faltan credenciales: introduce API key y Calendar ID
                        </span>
                      )}
                      {calendarStatus.provider === "ics" && calendarStatus.status === "empty" && (
                        <span style={{ display: "block", marginTop: "0.25rem", fontSize: "0.9em", fontWeight: "bold" }}>
                          ⚠️ Sube un archivo ICS para continuar
                        </span>
                      )}
                      {calendarStatus.provider === "ics" && calendarStatus.status === "error" && !icsPathInput.trim() && (
                        <span style={{ display: "block", marginTop: "0.25rem", fontSize: "0.9em", fontWeight: "bold" }}>
                          ⚠️ El archivo ICS no existe o no es accesible
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Google Calendar fields */}
              {configVersion === 2 && (form as unknown as { panels?: { calendar?: { provider?: string } } }).panels?.calendar?.provider === "google" && (
                <>
                  <div className="config-field">
                    <label htmlFor="calendar_api_key">API Key de Google Calendar</label>
                    <div className="config-field__input-group">
                      {showGoogleCalendarKey ? (
                        <input
                          id="calendar_api_key"
                          type="text"
                          value={googleCalendarKeyInput}
                          disabled={disableInputs || (configVersion === 2 && !((form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled))}
                          onChange={(event) => {
                            setGoogleCalendarKeyInput(event.target.value);
                          }}
                          placeholder="AIza..."
                        />
                      ) : (
                        <input
                          id="calendar_api_key_masked"
                          type="text"
                          value={googleCalendarKeyInput ? "••••••••" : ""}
                          readOnly
                          disabled
                          placeholder="Sin clave guardada"
                        />
                      )}
                      <button
                        type="button"
                        className="config-button"
                        onClick={() => {
                          setShowGoogleCalendarKey((prev) => !prev);
                          if (!showGoogleCalendarKey && !googleCalendarKeyInput) {
                            // Cargar desde config si existe
                            const v2 = form as unknown as { secrets?: { google?: { api_key?: string } } };
                            if (v2.secrets?.google?.api_key) {
                              setGoogleCalendarKeyInput(v2.secrets.google.api_key);
                            }
                          }
                        }}
                        disabled={disableInputs || (configVersion === 2 && !((form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled))}
                      >
                        {showGoogleCalendarKey ? "Ocultar" : "Mostrar/Añadir"}
                      </button>
                    </div>
                    {renderHelp("API key de Google Calendar (opcional, se puede obtener en Google Cloud Console)")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="calendar_calendar_id">Calendar ID</label>
                    <input
                      id="calendar_calendar_id"
                      type="text"
                      value={googleCalendarIdInput}
                      disabled={disableInputs || (configVersion === 2 && !((form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled))}
                      onChange={(event) => {
                        setGoogleCalendarIdInput(event.target.value);
                      }}
                      placeholder="primary o example@gmail.com"
                    />
                    {renderHelp("ID del calendario de Google (ej: 'primary' o dirección de email)")}
                  </div>

                  {/* Botón de prueba para Google Calendar */}
                  <div className="config-field">
                    <div className="config-field__actions">
                      <button
                        type="button"
                        className="config-button"
                        onClick={() => void handleTestCalendar()}
                        disabled={
                          disableInputs ||
                          testingCalendar ||
                          (configVersion === 2 && !((form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled))
                        }
                      >
                        {testingCalendar ? "Comprobando…" : "Probar conexión"}
                      </button>
                    </div>
                    {calendarTestResult && (
                      <div
                        className={`config-field__hint ${
                          calendarTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                        }`}
                      >
                        {calendarTestResult.message}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ICS fields (solo v2) */}
              {configVersion === 2 && (form as unknown as { panels?: { calendar?: { provider?: string } } }).panels?.calendar?.provider === "ics" && (
                <>
                  {/* FAQ/Help sobre ICS */}
                  <div className="config-field" style={{ gridColumn: "1 / -1", padding: "1rem", backgroundColor: "#f5f5f5", borderRadius: "4px", marginBottom: "1rem" }}>
                    <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem", fontWeight: "bold" }}>ℹ️ Ayuda: Calendario ICS</h3>
                    <ul style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.9em", lineHeight: "1.6" }}>
                      <li><strong>¿Cómo subir un ICS?</strong> Haz clic en "Subir ICS…" y selecciona un archivo .ics desde tu PC. El sistema lo guardará automáticamente.</li>
                      <li><strong>¿Qué valida el sistema?</strong> El archivo debe tener extensión .ics y formato iCalendar válido. Máximo 2MB.</li>
                      <li><strong>¿Qué pasa después de subir?</strong> El sistema automáticamente establecerá el provider a "ics", guardará la ruta y activará el calendario.</li>
                      <li><strong>¿Puedo usar una ruta manual?</strong> Sí, pero asegúrate de que el archivo existe y es accesible en esa ruta del servidor.</li>
                    </ul>
                  </div>

                  <div className="config-field">
                    <label htmlFor="ics_path">Ruta local del archivo ICS</label>
                    <div className="config-field__input-group">
                      <input
                        id="ics_path"
                        type="text"
                        value={icsPathInput}
                        readOnly
                        disabled={disableInputs || !((form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled)}
                        placeholder="/var/lib/pantalla-reloj/ics/personal.ics"
                      />
                      <label htmlFor="ics_file_upload" className="config-button">
                        {uploadingIcs ? "Subiendo…" : "Subir ICS…"}
                        <input
                          id="ics_file_upload"
                          type="file"
                          accept=".ics,text/calendar"
                          style={{ display: "none" }}
                          disabled={disableInputs || uploadingIcs || !((form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled)}
                          onChange={handleUploadIcs}
                        />
                      </label>
                    </div>
                    {renderFieldError("panels.calendar.ics_path")}
                    {renderHelp("Sube un archivo ICS desde tu PC (se guardará automáticamente)")}
                    {icsUploadResult && (
                      <div
                        className={`config-field__hint ${
                          icsUploadResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                        }`}
                      >
                        {icsUploadResult.message}
                      </div>
                    )}
                  </div>

                  {/* Botón de prueba ICS */}
                  <div className="config-field">
                    <div className="config-field__actions">
                      <button
                        type="button"
                        className="config-button"
                        onClick={() => void handleTestIcs()}
                        disabled={
                          disableInputs ||
                          testingIcs ||
                          !((form as unknown as { panels?: { calendar?: { enabled?: boolean } } }).panels?.calendar?.enabled) ||
                          !icsPathInput.trim()
                        }
                      >
                        {testingIcs ? "Comprobando…" : "Probar ICS"}
                      </button>
                    </div>
                    {icsTestResult && (
                      <div
                        className={`config-field__hint ${
                          icsTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                        }`}
                      >
                        {icsTestResult.message}
                        {icsTestResult.events && icsTestResult.events.length > 0 && (
                          <div style={{ marginTop: "0.5rem", fontSize: "0.9em" }}>
                            <strong>Próximos eventos:</strong>
                            <ul style={{ marginTop: "0.25rem", marginLeft: "1rem" }}>
                              {icsTestResult.events.map((event, idx) => (
                                <li key={idx}>
                                  <strong>{event.title}</strong> - {new Date(event.start).toLocaleDateString()} {new Date(event.start).toLocaleTimeString()}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Sección de Capas para v2 */}
        {configVersion === 2 && (
          <div className="config-card">
            <div>
              <h2>Capas del Mapa</h2>
              <p>Activa o desactiva las capas en tiempo real del mapa: vuelos, barcos, radar y satélite.</p>
            </div>
            <div className="config-grid">
              {/* Flights Layer */}
              <div className="config-field config-field--checkbox">
                <label htmlFor="v2_layers_flights_enabled">
                  <input
                    id="v2_layers_flights_enabled"
                    type="checkbox"
                    checked={
                      (form as unknown as { layers?: { flights?: { enabled?: boolean } } }).layers?.flights?.enabled ?? false
                    }
                    disabled={disableInputs}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setForm((prev) => {
                        const v2 = prev as unknown as { layers?: { flights?: { enabled?: boolean } } };
                        return {
                          ...prev,
                          layers: {
                            ...v2.layers,
                            flights: {
                              ...v2.layers?.flights,
                              enabled,
                            },
                          },
                        } as unknown as AppConfig;
                      });
                      resetErrorsFor("layers.flights.enabled");
                    }}
                  />
                  Aviones (OpenSky)
                </label>
                {renderHelp("Muestra aviones en tiempo real desde OpenSky Network")}
              </div>

              {/* Ships Layer */}
              <div className="config-field config-field--checkbox">
                <label htmlFor="v2_layers_ships_enabled">
                  <input
                    id="v2_layers_ships_enabled"
                    type="checkbox"
                    checked={
                      (form as unknown as { layers?: { ships?: { enabled?: boolean } } }).layers?.ships?.enabled ?? false
                    }
                    disabled={disableInputs}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setForm((prev) => {
                        const v2 = prev as unknown as { layers?: { ships?: { enabled?: boolean } } };
                        return {
                          ...prev,
                          layers: {
                            ...v2.layers,
                            ships: {
                              ...v2.layers?.ships,
                              enabled,
                            },
                          },
                        } as unknown as AppConfig;
                      });
                      resetErrorsFor("layers.ships.enabled");
                    }}
                  />
                  Barcos
                </label>
                {renderHelp("Muestra barcos en tiempo real (AIS)")}
              </div>

              {/* Radar (AEMET) */}
              <div className="config-field config-field--checkbox">
                <label htmlFor="v2_ui_global_radar_enabled">
                  <input
                    id="v2_ui_global_radar_enabled"
                    type="checkbox"
                    checked={
                      (form as unknown as { ui_global?: { radar?: { enabled?: boolean } } }).ui_global?.radar?.enabled ?? false
                    }
                    disabled={disableInputs}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setForm((prev) => {
                        const v2 = prev as unknown as { ui_global?: { radar?: { enabled?: boolean; provider?: string } } };
                        return {
                          ...prev,
                          ui_global: {
                            ...v2.ui_global,
                            radar: {
                              ...v2.ui_global?.radar,
                              enabled,
                              provider: v2.ui_global?.radar?.provider || "aemet",
                            },
                          },
                        } as unknown as AppConfig;
                      });
                      resetErrorsFor("ui_global.radar.enabled");
                    }}
                  />
                  Radar (AEMET)
                </label>
                {renderHelp("Muestra radar meteorológico de AEMET")}
              </div>

              {/* Satellite (GIBS) */}
              <div className="config-field config-field--checkbox">
                <label htmlFor="v2_ui_global_satellite_enabled">
                  <input
                    id="v2_ui_global_satellite_enabled"
                    type="checkbox"
                    checked={
                      (form as unknown as { ui_global?: { satellite?: { enabled?: boolean } } }).ui_global?.satellite?.enabled ?? false
                    }
                    disabled={disableInputs}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setForm((prev) => {
                        const v2 = prev as unknown as { ui_global?: { satellite?: { enabled?: boolean; provider?: string; opacity?: number } } };
                        return {
                          ...prev,
                          ui_global: {
                            ...v2.ui_global,
                            satellite: {
                              ...v2.ui_global?.satellite,
                              enabled,
                              provider: v2.ui_global?.satellite?.provider || "gibs",
                              opacity: v2.ui_global?.satellite?.opacity ?? 1.0,
                            },
                          },
                        } as unknown as AppConfig;
                      });
                      resetErrorsFor("ui_global.satellite.enabled");
                    }}
                  />
                  Satélite (GIBS)
                </label>
                {renderHelp("Muestra imágenes satelitales de GIBS/NASA")}
              </div>
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

        {supports("opensky") && (
          <div className="config-card">
            <div>
              <h2>Aviones (OpenSky)</h2>
              <p>Configura las credenciales y el área de la integración con OpenSky Network.</p>
            </div>
            <div className="config-grid">
              {supports("opensky.enabled") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="opensky_enabled">
                    <input
                      id="opensky_enabled"
                      type="checkbox"
                      checked={form.opensky.enabled}
                      disabled={disableInputs}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          opensky: {
                            ...prev.opensky,
                            enabled,
                          },
                        }));
                        resetErrorsFor("opensky.enabled");
                      }}
                    />
                    Activar OpenSky
                  </label>
                  {renderHelp("Habilita la capa de vuelos en tiempo real con datos de OpenSky")}
                </div>
              )}

              {supports("opensky.poll_seconds") && (
                <div className="config-field">
                  <label htmlFor="opensky_poll_seconds">Intervalo de sondeo (segundos)</label>
                  <input
                    id="opensky_poll_seconds"
                    type="number"
                    min={openskyMinPoll}
                    max={3600}
                    value={form.opensky.poll_seconds}
                    disabled={disableInputs || !form.opensky.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }
                      const clamped = Math.max(openskyMinPoll, Math.min(3600, Math.round(value)));
                      setForm((prev) => ({
                        ...prev,
                        opensky: {
                          ...prev.opensky,
                          poll_seconds: clamped,
                        },
                      }));
                      resetErrorsFor("opensky.poll_seconds");
                    }}
                  />
                  {renderHelp(
                    openskyCredentialsConfigured
                      ? "Mínimo 5s con credenciales OAuth válidas"
                      : "Mínimo 10s en modo anónimo"
                  )}
                  {renderFieldError("opensky.poll_seconds")}
                </div>
              )}

              {supports("opensky.mode") && (
                <div className="config-field">
                  <label htmlFor="opensky_mode">Modo de cobertura</label>
                  <select
                    id="opensky_mode"
                    value={form.opensky.mode}
                    disabled={disableInputs || !form.opensky.enabled}
                    onChange={(event) => {
                      const mode = event.target.value === "global" ? "global" : "bbox";
                      setForm((prev) => ({
                        ...prev,
                        opensky: {
                          ...prev.opensky,
                          mode,
                        },
                      }));
                      resetErrorsFor("opensky.mode");
                    }}
                  >
                    <option value="bbox">Área limitada (bbox)</option>
                    <option value="global">Global</option>
                  </select>
                  {renderHelp("Limita la consulta a un rectángulo geográfico o consulta global")}
                  {renderFieldError("opensky.mode")}
                </div>
              )}

              {form.opensky.mode === "bbox" && (
                <>
                  {supports("opensky.bbox.lamin") && (
                    <div className="config-field">
                      <label htmlFor="opensky_lamin">Latitud mínima</label>
                      <input
                        id="opensky_lamin"
                        type="number"
                        step={0.1}
                        min={-90}
                        max={90}
                        value={form.opensky.bbox.lamin}
                        disabled={disableInputs || !form.opensky.enabled}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isNaN(value)) {
                            return;
                          }
                          setForm((prev) => ({
                            ...prev,
                            opensky: {
                              ...prev.opensky,
                              bbox: {
                                ...prev.opensky.bbox,
                                lamin: Math.max(-90, Math.min(90, value)),
                              },
                            },
                          }));
                          resetErrorsFor("opensky.bbox.lamin");
                        }}
                      />
                      {renderFieldError("opensky.bbox.lamin")}
                    </div>
                  )}

                  {supports("opensky.bbox.lamax") && (
                    <div className="config-field">
                      <label htmlFor="opensky_lamax">Latitud máxima</label>
                      <input
                        id="opensky_lamax"
                        type="number"
                        step={0.1}
                        min={-90}
                        max={90}
                        value={form.opensky.bbox.lamax}
                        disabled={disableInputs || !form.opensky.enabled}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isNaN(value)) {
                            return;
                          }
                          setForm((prev) => ({
                            ...prev,
                            opensky: {
                              ...prev.opensky,
                              bbox: {
                                ...prev.opensky.bbox,
                                lamax: Math.max(-90, Math.min(90, value)),
                              },
                            },
                          }));
                          resetErrorsFor("opensky.bbox.lamax");
                        }}
                      />
                      {renderFieldError("opensky.bbox.lamax")}
                    </div>
                  )}

                  {supports("opensky.bbox.lomin") && (
                    <div className="config-field">
                      <label htmlFor="opensky_lomin">Longitud mínima</label>
                      <input
                        id="opensky_lomin"
                        type="number"
                        step={0.1}
                        min={-180}
                        max={180}
                        value={form.opensky.bbox.lomin}
                        disabled={disableInputs || !form.opensky.enabled}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isNaN(value)) {
                            return;
                          }
                          setForm((prev) => ({
                            ...prev,
                            opensky: {
                              ...prev.opensky,
                              bbox: {
                                ...prev.opensky.bbox,
                                lomin: Math.max(-180, Math.min(180, value)),
                              },
                            },
                          }));
                          resetErrorsFor("opensky.bbox.lomin");
                        }}
                      />
                      {renderFieldError("opensky.bbox.lomin")}
                    </div>
                  )}

                  {supports("opensky.bbox.lomax") && (
                    <div className="config-field">
                      <label htmlFor="opensky_lomax">Longitud máxima</label>
                      <input
                        id="opensky_lomax"
                        type="number"
                        step={0.1}
                        min={-180}
                        max={180}
                        value={form.opensky.bbox.lomax}
                        disabled={disableInputs || !form.opensky.enabled}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isNaN(value)) {
                            return;
                          }
                          setForm((prev) => ({
                            ...prev,
                            opensky: {
                              ...prev.opensky,
                              bbox: {
                                ...prev.opensky.bbox,
                                lomax: Math.max(-180, Math.min(180, value)),
                              },
                            },
                          }));
                          resetErrorsFor("opensky.bbox.lomax");
                        }}
                      />
                      {renderFieldError("opensky.bbox.lomax")}
                    </div>
                  )}
                </>
              )}

              {supports("opensky.max_aircraft") && (
                <div className="config-field">
                  <label htmlFor="opensky_max_aircraft">Máximo de aeronaves</label>
                  <input
                    id="opensky_max_aircraft"
                    type="number"
                    min={100}
                    max={1000}
                    value={form.opensky.max_aircraft}
                    disabled={disableInputs || !form.opensky.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }
                      const clamped = Math.max(100, Math.min(1000, Math.round(value)));
                      setForm((prev) => ({
                        ...prev,
                        opensky: {
                          ...prev.opensky,
                          max_aircraft: clamped,
                        },
                      }));
                      resetErrorsFor("opensky.max_aircraft");
                    }}
                  />
                  {renderHelp("Número máximo de aeronaves a mostrar en simultáneo (100-1000)")}
                  {renderFieldError("opensky.max_aircraft")}
                </div>
              )}

              {supports("opensky.cluster") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="opensky_cluster">
                    <input
                      id="opensky_cluster"
                      type="checkbox"
                      checked={form.opensky.cluster}
                      disabled={disableInputs || !form.opensky.enabled}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          opensky: {
                            ...prev.opensky,
                            cluster: enabled,
                          },
                        }));
                        resetErrorsFor("opensky.cluster");
                      }}
                    />
                    Activar clustering en el mapa
                  </label>
                  {renderHelp("Agrupa aeronaves cercanas para mejorar la legibilidad")}
                </div>
              )}

              {supports("opensky.extended") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="opensky_extended">
                    <input
                      id="opensky_extended"
                      type="checkbox"
                      checked={form.opensky.extended === 1}
                      disabled={disableInputs || !form.opensky.enabled}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setForm((prev) => ({
                          ...prev,
                          opensky: {
                            ...prev.opensky,
                            extended: enabled ? 1 : 0,
                          },
                        }));
                        resetErrorsFor("opensky.extended");
                      }}
                    />
                    Solicitar datos extendidos
                  </label>
                  {renderHelp("Incluye información adicional como categoría y origen")}
                </div>
              )}

              <div className="config-field">
                <label htmlFor="opensky_client_id">
                  Client ID OAuth2
                  {openskyCredentialBadge}
                </label>
                <input
                  id="opensky_client_id"
                  type="password"
                  value={form.opensky.oauth2.client_id ?? ""}
                  disabled={disableInputs}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((prev) => ({
                      ...prev,
                      opensky: {
                        ...prev.opensky,
                        oauth2: {
                          ...prev.opensky.oauth2,
                          client_id: value,
                        },
                      },
                    }));
                    resetErrorsFor("opensky.oauth2.client_id");
                  }}
                  placeholder="Introduce el client_id proporcionado por OpenSky"
                  autoComplete="off"
                  spellCheck={false}
                />
                {renderHelp(openskyCredentialHelp)}
              </div>

              <div className="config-field">
                <label htmlFor="opensky_client_secret">Client secret OAuth2</label>
                <input
                  id="opensky_client_secret"
                  type="password"
                  value={form.opensky.oauth2.client_secret ?? ""}
                  disabled={disableInputs}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((prev) => ({
                      ...prev,
                      opensky: {
                        ...prev.opensky,
                        oauth2: {
                          ...prev.opensky.oauth2,
                          client_secret: value,
                        },
                      },
                    }));
                    resetErrorsFor("opensky.oauth2.client_secret");
                  }}
                  placeholder="Introduce el client_secret proporcionado por OpenSky"
                  autoComplete="off"
                  spellCheck={false}
                />
                {renderHelp(
                  "Introduce el client_secret proporcionado por OpenSky Network y pulsa Guardar configuración para actualizarlo."
                )}
              </div>

              <div className="config-field">
                <label>Diagnóstico</label>
                <div className="config-field__actions">
                  <button
                    type="button"
                    className="config-button"
                    onClick={handleTestOpenSky}
                    disabled={disableInputs || testingOpenSky}
                  >
                    {testingOpenSky ? "Comprobando..." : "Probar conexión"}
                  </button>
                </div>
                {openskyStatusError && <p className="config-error">{openskyStatusError}</p>}
                {openskyStatusData && (
                  <ul className="config-status-list">
                    <li>
                      Estado proveedor: {openskyStatusData.status ?? (openskyStatusData.has_credentials ? "stale" : "sin credenciales")}
                    </li>
                    <li>
                      Token en caché: {(() => {
                        const auth = openskyStatusData.auth;
                        const cached = auth?.token_cached ?? openskyStatusData.token_cached ?? false;
                        const expires = auth?.expires_in_sec ?? openskyStatusData.expires_in_sec ?? openskyStatusData.expires_in;
                        return `${cached ? "sí" : "no"}${typeof expires === "number" && expires > 0 ? ` (expira en ${expires} s)` : ""}`;
                      })()}
                    </li>
                    <li>
                      Última respuesta: {openskyStatusData.last_fetch_iso ? new Date(openskyStatusData.last_fetch_iso).toLocaleString() : "sin datos"}
                    </li>
                    <li>
                      Aeronaves cacheadas: {openskyStatusData.items ?? openskyStatusData.items_count ?? 0}
                    </li>
                    {openskyStatusData.rate_limit_hint && (
                      <li>Rate limit restante (pista): {openskyStatusData.rate_limit_hint}</li>
                    )}
                    {openskyStatusData.last_error && <li>Error reciente: {openskyStatusData.last_error}</li>}
                    <li>
                      Área configurada: {openskyStatusData.bbox.lamin.toFixed(2)} / {openskyStatusData.bbox.lamax.toFixed(2)} lat,
                      {" "}
                      {openskyStatusData.bbox.lomin.toFixed(2)} / {openskyStatusData.bbox.lomax.toFixed(2)} lon
                    </li>
                  </ul>
                )}
              </div>
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
              {SHOW_FLIGHTS_CONTROLS && supports("layers.flights") && (
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

                  {supports("layers.flights.render_mode") && (
                    <div className="config-field">
                      <label htmlFor="flights_render_mode">Modo de renderizado</label>
                      <select
                        id="flights_render_mode"
                        value={form.layers.flights.render_mode ?? "auto"}
                        disabled={disableInputs || !form.layers.flights.enabled}
                        onChange={(event) => {
                          const render_mode = event.target.value as "auto" | "symbol" | "circle";
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              flights: {
                                ...prev.layers.flights,
                                render_mode,
                              },
                            },
                          }));
                          resetErrorsFor("layers.flights.render_mode");
                        }}
                      >
                        <option value="auto">Automático</option>
                        <option value="symbol">Icono</option>
                        <option value="circle">Círculo</option>
                      </select>
                      {renderHelp("Selecciona cómo se dibujan los vuelos sobre el mapa")}
                      {renderFieldError("layers.flights.render_mode")}
                    </div>
                  )}

                  {supports("layers.flights.circle.radius_vh") && (
                    <div className="config-field">
                      <label htmlFor="flights_circle_radius_vh">Radio en viewport height (%)</label>
                      <input
                        id="flights_circle_radius_vh"
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={form.layers.flights.circle?.radius_vh ?? 0.9}
                        disabled={disableInputs || !form.layers.flights.enabled}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isNaN(value)) {
                            const radius_vh = Math.max(0.1, Math.min(10, value));
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                flights: {
                                  ...prev.layers.flights,
                                  circle: {
                                    ...(prev.layers.flights.circle ?? {}),
                                    radius_vh,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.flights.circle.radius_vh");
                          }
                        }}
                      />
                      {renderHelp("Radio del círculo en porcentaje del viewport height (0.1 - 10)")}
                      {renderFieldError("layers.flights.circle.radius_vh")}
                    </div>
                  )}

                  {supports("layers.flights.circle.opacity") && (
                    <div className="config-field">
                      <label htmlFor="flights_circle_opacity">Opacidad base del círculo</label>
                      <input
                        id="flights_circle_opacity"
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={form.layers.flights.circle?.opacity ?? 1}
                        disabled={disableInputs || !form.layers.flights.enabled}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isNaN(value)) {
                            const opacity = Math.max(0, Math.min(1, value));
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                flights: {
                                  ...prev.layers.flights,
                                  circle: {
                                    ...(prev.layers.flights.circle ?? {}),
                                    opacity,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.flights.circle.opacity");
                          }
                        }}
                      />
                      {renderHelp("Multiplicador adicional de opacidad para círculos (0.0 - 1.0)")}
                      {renderFieldError("layers.flights.circle.opacity")}
                    </div>
                  )}

                  {supports("layers.flights.circle.color") && (
                    <div className="config-field">
                      <label htmlFor="flights_circle_color">Color del círculo</label>
                      <input
                        id="flights_circle_color"
                        type="text"
                        maxLength={32}
                        value={form.layers.flights.circle?.color ?? "#00D1FF"}
                        disabled={disableInputs || !form.layers.flights.enabled}
                        onChange={(event) => {
                          const color = event.target.value;
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              flights: {
                                ...prev.layers.flights,
                                circle: {
                                  ...(prev.layers.flights.circle ?? {}),
                                  color,
                                },
                              },
                            },
                          }));
                          resetErrorsFor("layers.flights.circle.color");
                        }}
                      />
                      {renderHelp("Color de relleno del círculo (hex o valor CSS válido)")}
                      {renderFieldError("layers.flights.circle.color")}
                    </div>
                  )}

                  {supports("layers.flights.circle.stroke_color") && (
                    <div className="config-field">
                      <label htmlFor="flights_circle_stroke_color">Color del borde</label>
                      <input
                        id="flights_circle_stroke_color"
                        type="text"
                        maxLength={32}
                        value={form.layers.flights.circle?.stroke_color ?? "#002A33"}
                        disabled={disableInputs || !form.layers.flights.enabled}
                        onChange={(event) => {
                          const stroke_color = event.target.value;
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              flights: {
                                ...prev.layers.flights,
                                circle: {
                                  ...(prev.layers.flights.circle ?? {}),
                                  stroke_color,
                                },
                              },
                            },
                          }));
                          resetErrorsFor("layers.flights.circle.stroke_color");
                        }}
                      />
                      {renderHelp("Color del borde del círculo")}
                      {renderFieldError("layers.flights.circle.stroke_color")}
                    </div>
                  )}

                  {supports("layers.flights.circle.stroke_width") && (
                    <div className="config-field">
                      <label htmlFor="flights_circle_stroke_width">Ancho del borde</label>
                      <input
                        id="flights_circle_stroke_width"
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={form.layers.flights.circle?.stroke_width ?? 1}
                        disabled={disableInputs || !form.layers.flights.enabled}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isNaN(value)) {
                            const stroke_width = Math.max(0, Math.min(10, value));
                            setForm((prev) => ({
                              ...prev,
                              layers: {
                                ...prev.layers,
                                flights: {
                                  ...prev.layers.flights,
                                  circle: {
                                    ...(prev.layers.flights.circle ?? {}),
                                    stroke_width,
                                  },
                                },
                              },
                            }));
                            resetErrorsFor("layers.flights.circle.stroke_width");
                          }
                        }}
                      />
                      {renderHelp("Grosor del borde del círculo (0.0 - 10.0)")}
                      {renderFieldError("layers.flights.circle.stroke_width")}
                    </div>
                  )}

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

                  {form.layers.flights.provider === "custom" && (
                    <div className="config-grid">
                      {supports("layers.flights.custom.api_url") && (
                        <div className="config-field">
                          <label htmlFor="flights_custom_url">URL de API</label>
                          <input
                            id="flights_custom_url"
                            type="url"
                            value={form.layers.flights.custom?.api_url ?? ""}
                            disabled={disableInputs || !form.layers.flights.enabled}
                            onChange={(event) => {
                              setForm((prev) => ({
                                ...prev,
                                layers: {
                                  ...prev.layers,
                                  flights: {
                                    ...prev.layers.flights,
                                    custom: {
                                      ...prev.layers.flights.custom,
                                      api_url: event.target.value || null,
                                    },
                                  },
                                },
                              }));
                              resetErrorsFor("layers.flights.custom.api_url");
                            }}
                            placeholder="https://api.example.com/flights"
                          />
                          {renderHelp("URL del endpoint que devuelve GeoJSON FeatureCollection")}
                          {renderFieldError("layers.flights.custom.api_url")}
                        </div>
                      )}
                      {supports("layers.flights.custom.api_key") && (
                        <div className="config-field">
                          <label htmlFor="flights_custom_key">API Key (opcional)</label>
                          <input
                            id="flights_custom_key"
                            type="password"
                            value={form.layers.flights.custom?.api_key ?? ""}
                            disabled={disableInputs || !form.layers.flights.enabled}
                            onChange={(event) => {
                              setForm((prev) => ({
                                ...prev,
                                layers: {
                                  ...prev.layers,
                                  flights: {
                                    ...prev.layers.flights,
                                    custom: {
                                      ...prev.layers.flights.custom,
                                      api_key: event.target.value || null,
                                    },
                                  },
                                },
                              }));
                              resetErrorsFor("layers.flights.custom.api_key");
                            }}
                            placeholder="API Key para autenticación"
                          />
                          {renderHelp("API Key opcional para autenticación Bearer")}
                          {renderFieldError("layers.flights.custom.api_key")}
                        </div>
                      )}
                    </div>
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
                    <label htmlFor="ships_update_interval">Intervalo de actualización (segundos)</label>
                    <input
                      id="ships_update_interval"
                      type="number"
                      min="1"
                      max="300"
                      value={form.layers.ships.update_interval}
                      disabled={disableInputs || !form.layers.ships.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          const next = Math.max(1, Math.min(300, Math.round(value)));
                          setForm((prev) => ({
                            ...prev,
                            layers: {
                              ...prev.layers,
                              ships: {
                                ...prev.layers.ships,
                                update_interval: next,
                                refresh_seconds: next,
                              },
                            },
                          }));
                          resetErrorsFor("layers.ships.update_interval");
                        }
                      }}
                    />
                    {renderHelp("Cada cuántos segundos se sincroniza el buffer de barcos (1-300)")}
                    {renderFieldError("layers.ships.update_interval")}
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
                        <label htmlFor="ships_aisstream_api_key">API key de AISStream</label>
                        <div className="config-field__secret">
                          {showAisstreamKey ? (
                            <input
                              id="ships_aisstream_api_key"
                              type="text"
                              value={aisstreamKeyInput}
                              disabled={disableInputs || !form.layers.ships.enabled}
                              onChange={(event) => {
                                setAisstreamKeyInput(event.target.value);
                                setShipsTestResult(null);
                              }}
                              placeholder="Introduce la API key de AISStream"
                              autoComplete="off"
                              spellCheck={false}
                            />
                          ) : (
                            <input
                              id="ships_aisstream_api_key_masked"
                              type="text"
                              value={maskedAisstreamKey}
                              readOnly
                              disabled
                              placeholder="Sin clave guardada"
                            />
                          )}
                          <button
                            type="button"
                            className="config-button"
                            onClick={handleToggleAisstreamKeyVisibility}
                            disabled={disableInputs || !form.layers.ships.enabled}
                          >
                            {showAisstreamKey ? "Ocultar" : hasStoredAisstreamKey ? "Mostrar" : "Añadir"}
                          </button>
                        </div>
                        <div className="config-field__hint">
                          La clave se guarda cifrada en el backend y no se muestra completa.
                        </div>
                        <div className="config-field__actions">
                          {showAisstreamKey && (
                            <button
                              type="button"
                              className="config-button primary"
                              onClick={() => void handleSaveAisstreamKey()}
                              disabled={
                                disableInputs ||
                                !form.layers.ships.enabled ||
                                !canPersistAisstreamKey ||
                                savingAisstreamKey
                              }
                            >
                              Guardar clave
                            </button>
                          )}
                          <button
                            type="button"
                            className="config-button"
                            onClick={() => void handleTestShipsLayer()}
                            disabled={
                              disableInputs ||
                              !form.layers.ships.enabled ||
                              !canTestShips ||
                              testingShips
                            }
                          >
                            {testingShips ? "Comprobando…" : "Probar"}
                          </button>
                        </div>
                        {shipsTestResult && (
                          <div
                            className={`config-field__hint ${
                              shipsTestResult.ok
                                ? "config-field__hint--success"
                                : "config-field__hint--error"
                            }`}
                          >
                            {shipsTestResult.message}
                          </div>
                        )}
                        {renderFieldError("layers.ships.aisstream.api_key")}
                      </div>
                    </>
                  )}

                  {form.layers.ships.provider === "custom" && (
                    <div className="config-grid">
                      {supports("layers.ships.custom.api_url") && (
                        <div className="config-field">
                          <label htmlFor="ships_custom_url">URL de API</label>
                          <input
                            id="ships_custom_url"
                            type="url"
                            value={form.layers.ships.custom?.api_url ?? ""}
                            disabled={disableInputs || !form.layers.ships.enabled}
                            onChange={(event) => {
                              setForm((prev) => ({
                                ...prev,
                                layers: {
                                  ...prev.layers,
                                  ships: {
                                    ...prev.layers.ships,
                                    custom: {
                                      ...prev.layers.ships.custom,
                                      api_url: event.target.value || null,
                                    },
                                  },
                                },
                              }));
                              resetErrorsFor("layers.ships.custom.api_url");
                            }}
                            placeholder="https://api.example.com/ships"
                          />
                          {renderHelp("URL del endpoint que devuelve GeoJSON FeatureCollection")}
                          {renderFieldError("layers.ships.custom.api_url")}
                        </div>
                      )}
                      {supports("layers.ships.custom.api_key") && (
                        <div className="config-field">
                          <label htmlFor="ships_custom_key">API Key (opcional)</label>
                          <input
                            id="ships_custom_key"
                            type="password"
                            value={form.layers.ships.custom?.api_key ?? ""}
                            disabled={disableInputs || !form.layers.ships.enabled}
                            onChange={(event) => {
                              setForm((prev) => ({
                                ...prev,
                                layers: {
                                  ...prev.layers,
                                  ships: {
                                    ...prev.layers.ships,
                                    custom: {
                                      ...prev.layers.ships.custom,
                                      api_key: event.target.value || null,
                                    },
                                  },
                                },
                              }));
                              resetErrorsFor("layers.ships.custom.api_key");
                            }}
                            placeholder="API Key para autenticación"
                          />
                          {renderHelp("API Key opcional para autenticación Bearer")}
                          {renderFieldError("layers.ships.custom.api_key")}
                        </div>
                      )}
                    </div>
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

        {supports("layers.global") && (() => {
          // Helper para obtener valores de global con defaults completos
          const getGlobalWithDefaults = (prev: AppConfig) => {
            const defaultGlobal: GlobalLayersConfig =
              DEFAULT_CONFIG.layers.global ?? createDefaultGlobalLayers();
            const currentGlobal = prev.layers.global;
            
            return {
              satellite: {
                enabled: currentGlobal?.satellite?.enabled ?? defaultGlobal.satellite.enabled,
                provider: "gibs" as const,
                refresh_minutes: currentGlobal?.satellite?.refresh_minutes ?? defaultGlobal.satellite.refresh_minutes,
                history_minutes: currentGlobal?.satellite?.history_minutes ?? defaultGlobal.satellite.history_minutes,
                frame_step: currentGlobal?.satellite?.frame_step ?? defaultGlobal.satellite.frame_step,
                opacity: currentGlobal?.satellite?.opacity ?? defaultGlobal.satellite.opacity,
              },
              radar: {
                enabled: currentGlobal?.radar?.enabled ?? defaultGlobal.radar.enabled,
                provider:
                  (currentGlobal?.radar?.provider ?? defaultGlobal.radar.provider ?? "rainviewer") as GlobalLayers["radar"]["provider"],
                refresh_minutes: currentGlobal?.radar?.refresh_minutes ?? defaultGlobal.radar.refresh_minutes,
                history_minutes: currentGlobal?.radar?.history_minutes ?? defaultGlobal.radar.history_minutes,
                frame_step: currentGlobal?.radar?.frame_step ?? defaultGlobal.radar.frame_step,
                opacity: currentGlobal?.radar?.opacity ?? defaultGlobal.radar.opacity,
                has_api_key: currentGlobal?.radar?.has_api_key ?? defaultGlobal.radar.has_api_key ?? false,
                api_key_last4: currentGlobal?.radar?.api_key_last4 ?? defaultGlobal.radar.api_key_last4 ?? null,
              },
            };
          };

          return (
            <div className="config-card">
              <div>
                <h2>Capas Globales</h2>
                <p>Configura las capas globales de satélite y radar (cobertura mundial).</p>
              </div>
              <div className="config-grid">
                {supports("layers.global.satellite") && (
                  <>
                    <div className="config-field config-field--checkbox">
                      <label htmlFor="global_satellite_enabled">
                        <input
                          id="global_satellite_enabled"
                          type="checkbox"
                          checked={form.layers.global?.satellite.enabled ?? false}
                          disabled={disableInputs}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            setForm((prev) => {
                              const globalWithDefaults = getGlobalWithDefaults(prev);
                              return {
                                ...prev,
                                layers: {
                                  ...prev.layers,
                                  global: {
                                    ...globalWithDefaults,
                                    satellite: {
                                      ...globalWithDefaults.satellite,
                                      enabled,
                                    },
                                  },
                                },
                              };
                            });
                            resetErrorsFor("layers.global.satellite.enabled");
                          }}
                        />
                        Activar capa de satélite global
                      </label>
                      {renderHelp("Muestra imágenes de satélite globales (GIBS)")}
                    </div>

                  <div className="config-field">
                    <label htmlFor="global_satellite_opacity">Opacidad</label>
                    <input
                      id="global_satellite_opacity"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={form.layers.global?.satellite.opacity ?? 0.7}
                      disabled={disableInputs || !form.layers.global?.satellite.enabled}
                      onChange={(event) => {
                        const opacity = Number(event.target.value);
                        if (!Number.isNaN(opacity)) {
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  satellite: {
                                    ...globalWithDefaults.satellite,
                                    opacity: Math.max(0, Math.min(1, opacity)),
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.satellite.opacity");
                        }
                      }}
                    />
                    <span>{Math.round((form.layers.global?.satellite.opacity ?? 0.7) * 100)}%</span>
                    {renderHelp("Opacidad de la capa de satélite (0.0 - 1.0)")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_satellite_refresh">Intervalo de actualización (minutos)</label>
                    <input
                      id="global_satellite_refresh"
                      type="number"
                      min="1"
                      max="1440"
                      value={form.layers.global?.satellite.refresh_minutes ?? 10}
                      disabled={disableInputs || !form.layers.global?.satellite.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  satellite: {
                                    ...globalWithDefaults.satellite,
                                    refresh_minutes: Math.max(1, Math.min(1440, Math.round(value))),
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.satellite.refresh_minutes");
                        }
                      }}
                    />
                    {renderHelp("Cada cuántos minutos se actualizan los frames (1-1440)")}
                    {renderFieldError("layers.global.satellite.refresh_minutes")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_satellite_history">Historia (minutos)</label>
                    <input
                      id="global_satellite_history"
                      type="number"
                      min="1"
                      max="1440"
                      value={form.layers.global?.satellite.history_minutes ?? 90}
                      disabled={disableInputs || !form.layers.global?.satellite.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  satellite: {
                                    ...globalWithDefaults.satellite,
                                    history_minutes: Math.max(1, Math.min(1440, Math.round(value))),
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.satellite.history_minutes");
                        }
                      }}
                    />
                    {renderHelp("Cuántos minutos de historia mantener (1-1440)")}
                    {renderFieldError("layers.global.satellite.history_minutes")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_satellite_frame_step">Salto entre frames (minutos)</label>
                    <input
                      id="global_satellite_frame_step"
                      type="number"
                      min="1"
                      max="1440"
                      value={form.layers.global?.satellite.frame_step ?? 10}
                      disabled={disableInputs || !form.layers.global?.satellite.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  satellite: {
                                    ...globalWithDefaults.satellite,
                                    frame_step: Math.max(1, Math.min(1440, Math.round(value))),
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.satellite.frame_step");
                        }
                      }}
                    />
                    {renderHelp("Intervalo entre frames en la animación (1-1440)")}
                    {renderFieldError("layers.global.satellite.frame_step")}
                  </div>
                </>
              )}

              {supports("layers.global.radar") && (
                <>
                  <div className="config-field config-field--checkbox">
                    <label htmlFor="global_radar_enabled">
                      <input
                        id="global_radar_enabled"
                        type="checkbox"
                        checked={form.layers.global?.radar.enabled ?? false}
                        disabled={disableInputs}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  radar: {
                                    ...globalWithDefaults.radar,
                                    enabled,
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.radar.enabled");
                        }}
                      />
                      Activar capa de radar global
                    </label>
                    {renderHelp("Muestra radar de precipitación global (RainViewer u OpenWeatherMap)")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_radar_provider">Proveedor</label>
                    <select
                      id="global_radar_provider"
                      value={form.layers.global?.radar.provider ?? "rainviewer"}
                      disabled={disableInputs || !form.layers.global?.radar.enabled}
                      onChange={(event) => {
                        const provider = event.target.value as GlobalLayers["radar"]["provider"];
                        setForm((prev) => {
                          const globalWithDefaults = getGlobalWithDefaults(prev);
                          return {
                            ...prev,
                            layers: {
                              ...prev.layers,
                              global: {
                                ...globalWithDefaults,
                                radar: {
                                  ...globalWithDefaults.radar,
                                  provider,
                                },
                              },
                            },
                          };
                        });
                        setShowOpenWeatherKey(false);
                        setOpenWeatherKeyInput("");
                        resetErrorsFor("layers.global.radar.provider");
                      }}
                    >
                      <option value="rainviewer">RainViewer (sin clave)</option>
                      <option value="openweathermap">OpenWeatherMap</option>
                    </select>
                    {renderHelp("Elige la fuente del radar global. OpenWeatherMap requiere API key y ofrece 1000 llamadas/día gratis.")}
                    {renderFieldError("layers.global.radar.provider")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_radar_openweathermap_key">OpenWeatherMap API key</label>
                    <div className="config-field__secret">
                      {showOpenWeatherKey ? (
                        <input
                          id="global_radar_openweathermap_key"
                          type="text"
                          value={openWeatherKeyInput}
                          disabled={disableInputs || !openWeatherSelected}
                          onChange={(event) => setOpenWeatherKeyInput(event.target.value)}
                          placeholder="Introduce la clave de OpenWeatherMap"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      ) : (
                        <input
                          id="global_radar_openweathermap_key_masked"
                          type="text"
                          value={maskedOpenWeatherKey}
                          readOnly
                          disabled
                          placeholder="Sin clave guardada"
                        />
                      )}
                      <button
                        type="button"
                        className="config-button"
                        onClick={handleToggleOpenWeatherKeyVisibility}
                        disabled={disableInputs || !openWeatherSelected}
                      >
                        {showOpenWeatherKey
                          ? "Ocultar"
                          : hasStoredOpenWeatherKey
                          ? "Mostrar"
                          : "Añadir"}
                      </button>
                    </div>
                    <div className="config-field__hint">
                      OpenWeatherMap incluye 1000 peticiones de tiles al día en su plan gratuito.
                    </div>
                    <div className="config-field__actions">
                      {showOpenWeatherKey && (
                        <button
                          type="button"
                          className="config-button primary"
                          onClick={() => void handleSaveOpenWeatherKey()}
                          disabled={disableInputs || !openWeatherSelected || !canPersistOpenWeatherKey}
                        >
                          Guardar clave
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_radar_opacity">Opacidad</label>
                    <input
                      id="global_radar_opacity"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={form.layers.global?.radar.opacity ?? 0.7}
                      disabled={disableInputs || !form.layers.global?.radar.enabled}
                      onChange={(event) => {
                        const opacity = Number(event.target.value);
                        if (!Number.isNaN(opacity)) {
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  radar: {
                                    ...globalWithDefaults.radar,
                                    opacity: Math.max(0, Math.min(1, opacity)),
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.radar.opacity");
                        }
                      }}
                    />
                    <span>{Math.round((form.layers.global?.radar.opacity ?? 0.7) * 100)}%</span>
                    {renderHelp("Opacidad de la capa de radar (0.0 - 1.0)")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_radar_refresh">Intervalo de actualización (minutos)</label>
                    <input
                      id="global_radar_refresh"
                      type="number"
                      min="1"
                      max="1440"
                      value={form.layers.global?.radar.refresh_minutes ?? 5}
                      disabled={disableInputs || !form.layers.global?.radar.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  radar: {
                                    ...globalWithDefaults.radar,
                                    refresh_minutes: Math.max(1, Math.min(1440, Math.round(value))),
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.radar.refresh_minutes");
                        }
                      }}
                    />
                    {renderHelp("Cada cuántos minutos se actualizan los frames (1-1440)")}
                    {renderFieldError("layers.global.radar.refresh_minutes")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_radar_history">Historia (minutos)</label>
                    <input
                      id="global_radar_history"
                      type="number"
                      min="1"
                      max="1440"
                      value={form.layers.global?.radar.history_minutes ?? 90}
                      disabled={disableInputs || !form.layers.global?.radar.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  radar: {
                                    ...globalWithDefaults.radar,
                                    history_minutes: Math.max(1, Math.min(1440, Math.round(value))),
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.radar.history_minutes");
                        }
                      }}
                    />
                    {renderHelp("Cuántos minutos de historia mantener (1-1440)")}
                    {renderFieldError("layers.global.radar.history_minutes")}
                  </div>

                  <div className="config-field">
                    <label htmlFor="global_radar_frame_step">Salto entre frames (minutos)</label>
                    <input
                      id="global_radar_frame_step"
                      type="number"
                      min="1"
                      max="1440"
                      value={form.layers.global?.radar.frame_step ?? 5}
                      disabled={disableInputs || !form.layers.global?.radar.enabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          setForm((prev) => {
                            const globalWithDefaults = getGlobalWithDefaults(prev);
                            return {
                              ...prev,
                              layers: {
                                ...prev.layers,
                                global: {
                                  ...globalWithDefaults,
                                  radar: {
                                    ...globalWithDefaults.radar,
                                    frame_step: Math.max(1, Math.min(1440, Math.round(value))),
                                  },
                                },
                              },
                            };
                          });
                          resetErrorsFor("layers.global.radar.frame_step");
                        }
                      }}
                    />
                    {renderHelp("Intervalo entre frames en la animación (1-1440)")}
                    {renderFieldError("layers.global.radar.frame_step")}
                  </div>
                </>
              )}
              </div>
            </div>
          );
        })()}

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
                <label>
                  Redes disponibles
                  {wifiNetworksLoaded ? (
                    <span className="config-field-detail"> ({wifiNetworksCount})</span>
                  ) : null}
                </label>
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
              {wifiScanNotice && (
                <div className="config-field-error">{wifiScanNotice}</div>
              )}
              {wifiScanning && (
                <div className="config-field-hint">Buscando redes…</div>
              )}
              {wifiNetworkList.length > 0 ? (
                <div className="config-field-list">
                  {wifiNetworkList.map((network) => {
                    const securityValue = (network.security ?? "").toLowerCase();
                    const isSecure = securityValue.length > 0 && securityValue !== "none" && securityValue !== "--";
                    const securityLabel = isSecure ? `🔒 ${network.security}` : "🔓 Abierta";
                    const disableConnect =
                      wifiConnecting ||
                      disableInputs ||
                      (isSecure && !wifiConnectPassword[network.ssid]);

                    return (
                      <div key={network.ssid} className="config-field-item">
                        <div className="config-field-item-info">
                          <span className="config-field-item-name">{network.ssid}</span>
                          <span className="config-field-item-detail">
                            {securityLabel}
                            {" · "}
                            Señal: {Number.isFinite(network.signal) ? network.signal : 0}%
                          </span>
                        </div>
                      {isSecure && (
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
                        disabled={disableConnect}
                        onClick={() => void handleWifiConnect(network.ssid)}
                      >
                        {wifiConnecting ? "Conectando…" : "Conectar"}
                      </button>
                    </div>
                    );
                  })}
                </div>

              ) : wifiScanning ? null : wifiNetworksLoaded ? (
                <div className="config-field-hint">
                  <p>No se han encontrado redes. Reintenta o acerca el equipo al AP.</p>
                  <button
                    type="button"
                    className="config-button small"
                    disabled={wifiScanning || wifiConnecting || disableInputs}
                    onClick={() => void handleWifiScan()}
                  >
                    Reintentar
                  </button>
                </div>
              ) : (
                <div className="config-field-hint">
                  Haz clic en "Buscar redes" para ver las redes WiFi disponibles.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="config-actions">
          <button type="submit" className="config-button primary" disabled={disableInputs}>
            {saveStatus === "saving" || saving ? "Guardando…" : saveStatus === "saved" ? "Guardado ✅" : "Guardar"}
          </button>
          {configVersion === 2 && (
            <button
              type="button"
              className="config-button secondary"
              onClick={() => void handleRestoreDefaultsV23()}
              disabled={disableInputs}
            >
              Restaurar valores por defecto de v23
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export { ConfigPage };
