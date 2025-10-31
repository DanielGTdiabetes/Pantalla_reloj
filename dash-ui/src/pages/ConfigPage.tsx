import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_CONFIG, createDefaultGlobalLayers, createDefaultMapCinema, withConfigDefaults } from "../config/defaults";
import {
  API_ORIGIN,
  ApiError,
  getConfig,
  getHealth,
  getSchema,
  getOpenSkyClientIdMeta,
  getOpenSkyClientSecretMeta,
  getOpenSkyStatus,
  saveConfig,
  testAemetApiKey,
  updateAemetApiKey,
  updateAISStreamApiKey,
  updateOpenSkyClientId,
  updateOpenSkyClientSecret,
  getShipsLayer,
  wifiConnect,
  wifiDisconnect,
  wifiNetworks as fetchWifiNetworks,
  wifiScan,
  wifiStatus,
  type WiFiNetwork,
  type WiFiStatusResponse,
  type OpenSkyStatus,
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
const CINEMA_SPEED_VALUES: Record<"slow" | "medium" | "fast", number> = {
  slow: 3,
  medium: 6,
  fast: 9,
};
const CINEMA_AMPLITUDE_RANGE = { min: 20, max: 160 };

const deriveSpeedPreset = (value: number): keyof typeof CINEMA_SPEED_VALUES => {
  if (!Number.isFinite(value)) {
    return "medium";
  }
  if (value <= (CINEMA_SPEED_VALUES.slow + CINEMA_SPEED_VALUES.medium) / 2) {
    return "slow";
  }
  if (value <= (CINEMA_SPEED_VALUES.medium + CINEMA_SPEED_VALUES.fast) / 2) {
    return "medium";
  }
  return "fast";
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

  if (supports("layers.ships.update_interval")) {
    const value = config.layers.ships.update_interval;
    if (!Number.isFinite(value) || value < 1 || value > 300) {
      errors["layers.ships.update_interval"] = "Debe estar entre 1 y 300";
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
  const [showAemetKey, setShowAemetKey] = useState(false);
  const [aemetKeyInput, setAemetKeyInput] = useState("");
  const [savingAemetKey, setSavingAemetKey] = useState(false);
  const [testingAemetKey, setTestingAemetKey] = useState(false);
  const [aemetTestResult, setAemetTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showAisstreamKey, setShowAisstreamKey] = useState(false);
  const [aisstreamKeyInput, setAisstreamKeyInput] = useState("");
  const [savingAisstreamKey, setSavingAisstreamKey] = useState(false);
  const [testingShips, setTestingShips] = useState(false);
  const [shipsTestResult, setShipsTestResult] = useState<{ ok: boolean; message: string; count?: number } | null>(null);
  const [openskyClientIdInput, setOpenSkyClientIdInput] = useState("");
  const [openskyClientSecretInput, setOpenSkyClientSecretInput] = useState("");
  const [openskyClientIdSet, setOpenSkyClientIdSet] = useState(false);
  const [openskyClientSecretSet, setOpenSkyClientSecretSet] = useState(false);
  const [savingOpenSkyClientId, setSavingOpenSkyClientId] = useState(false);
  const [savingOpenSkyClientSecret, setSavingOpenSkyClientSecret] = useState(false);
  const [testingOpenSky, setTestingOpenSky] = useState(false);
  const [openskyStatusData, setOpenSkyStatusData] = useState<OpenSkyStatus | null>(null);
  const [openskyStatusError, setOpenSkyStatusError] = useState<string | null>(null);
  
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

  // El modo cine horizontal ya no requiere rotation.enabled
  const cinemaBlocked = !form.ui.map.cinema.enabled;
  const disableCinemaControls = disableInputs || cinemaBlocked;
  const disableIdlePanControls =
    disableInputs || cinemaBlocked || !form.ui.map.idlePan.enabled;
  const openskyCredentialsConfigured = openskyClientIdSet && openskyClientSecretSet;
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

  const currentCinemaMotion = useMemo(
    () => ({
      ...createDefaultMapCinema().motion,
      ...(form.ui.map.cinema.motion ?? {}),
    }),
    [form.ui.map.cinema.motion]
  );

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

  const updateCinemaMotion = useCallback(
    (patch: Partial<AppConfig["ui"]["map"]["cinema"]["motion"]>) => {
      setForm((prev) => {
        const baseMotion = {
          ...createDefaultMapCinema().motion,
          ...(prev.ui.map.cinema.motion ?? {}),
        };
        return {
          ...prev,
          ui: {
            ...prev.ui,
            map: {
              ...prev.ui.map,
              cinema: {
                ...prev.ui.map.cinema,
                motion: {
                  ...baseMotion,
                  ...patch,
                },
              },
            },
          },
        };
      });
    },
    []
  );

  const handleCinemaSpeedPresetChange = useCallback(
    (preset: keyof typeof CINEMA_SPEED_VALUES) => {
      const speed = CINEMA_SPEED_VALUES[preset];
      setForm((prev) => {
        const baseMotion = {
          ...createDefaultMapCinema().motion,
          ...(prev.ui.map.cinema.motion ?? {}),
        };
        return {
          ...prev,
          ui: {
            ...prev.ui,
            map: {
              ...prev.ui.map,
              cinema: {
                ...prev.ui.map.cinema,
                panLngDegPerSec: speed,
                motion: {
                  ...baseMotion,
                  speedPreset: preset,
                },
              },
            },
          },
        };
      });
      resetErrorsFor("ui.map.cinema.panLngDegPerSec");
    },
    [resetErrorsFor]
  );

  const resetCinemaSettings = useCallback(() => {
    const defaults = createDefaultMapCinema();
    setForm((prev) => ({
      ...prev,
      ui: {
        ...prev.ui,
        map: {
          ...prev.ui.map,
          cinema: {
            ...prev.ui.map.cinema,
            enabled: defaults.enabled,
            panLngDegPerSec: defaults.panLngDegPerSec,
            bandTransition_sec: defaults.bandTransition_sec,
            motion: { ...defaults.motion },
          },
        },
      },
    }));
    resetErrorsFor("ui.map.cinema");
  }, [resetErrorsFor]);

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

  const loadOpenSkyMeta = useCallback(async () => {
    try {
      const [clientIdMeta, clientSecretMeta] = await Promise.all([
        getOpenSkyClientIdMeta(),
        getOpenSkyClientSecretMeta(),
      ]);
      setOpenSkyClientIdSet(Boolean(clientIdMeta?.set));
      setOpenSkyClientSecretSet(Boolean(clientSecretMeta?.set));
    } catch (error) {
      console.error("[ConfigPage] Failed to load OpenSky secret metadata", error);
    }
  }, []);

  const handleSaveOpenSkyClientId = useCallback(async () => {
    if (savingOpenSkyClientId) {
      return;
    }
    const trimmed = openskyClientIdInput.trim();
    setSavingOpenSkyClientId(true);
    try {
      await updateOpenSkyClientId(trimmed || null);
      await loadOpenSkyMeta();
      setOpenSkyClientIdInput("");
      setBanner({ kind: "success", text: trimmed ? "Client ID guardado" : "Client ID eliminado" });
    } catch (error) {
      console.error("[ConfigPage] Failed to update OpenSky client ID", error);
      const message = resolveApiErrorMessage(error, "No se pudo actualizar el client ID de OpenSky");
      setBanner({ kind: "error", text: message });
    } finally {
      setSavingOpenSkyClientId(false);
    }
  }, [openskyClientIdInput, savingOpenSkyClientId, loadOpenSkyMeta, setBanner]);

  const handleSaveOpenSkyClientSecret = useCallback(async () => {
    if (savingOpenSkyClientSecret) {
      return;
    }
    const trimmed = openskyClientSecretInput.trim();
    setSavingOpenSkyClientSecret(true);
    try {
      await updateOpenSkyClientSecret(trimmed || null);
      await loadOpenSkyMeta();
      setOpenSkyClientSecretInput("");
      setBanner({ kind: "success", text: trimmed ? "Client secret guardado" : "Client secret eliminado" });
    } catch (error) {
      console.error("[ConfigPage] Failed to update OpenSky client secret", error);
      const message = resolveApiErrorMessage(error, "No se pudo actualizar el client secret de OpenSky");
      setBanner({ kind: "error", text: message });
    } finally {
      setSavingOpenSkyClientSecret(false);
    }
  }, [openskyClientSecretInput, savingOpenSkyClientSecret, loadOpenSkyMeta, setBanner]);

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
    const cfg = await getConfig();
    setForm(withConfigDefaults(cfg ?? undefined));
    setShowMaptilerKey(false);
    setShowAemetKey(false);
    setAemetKeyInput("");
    setAemetTestResult(null);
    setShowAisstreamKey(false);
    setAisstreamKeyInput("");
    setShipsTestResult(null);
    setOpenSkyClientIdInput("");
    setOpenSkyClientSecretInput("");
    setOpenSkyStatusData(null);
    setOpenSkyStatusError(null);
    await loadOpenSkyMeta();
  }, [loadOpenSkyMeta]);

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
      const saved = await saveConfig(payload);
      setForm(withConfigDefaults(saved));
      setShowMaptilerKey(false);
      setShowAemetKey(false);
      setAemetKeyInput("");
      setAemetTestResult(null);
      setShowAisstreamKey(false);
      setAisstreamKeyInput("");
      setShipsTestResult(null);
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

              {supports("ui.map.cinema.motion") && (
                <div className="config-field">
                  <label htmlFor="cinema_speed">Velocidad</label>
                  <select
                    id="cinema_speed"
                    value={currentCinemaMotion.speedPreset ?? deriveSpeedPreset(form.ui.map.cinema.panLngDegPerSec)}
                    disabled={disableCinemaControls}
                    onChange={(event) => {
                      handleCinemaSpeedPresetChange(event.target.value as keyof typeof CINEMA_SPEED_VALUES);
                    }}
                  >
                    <option value="slow">Lenta</option>
                    <option value="medium">Media</option>
                    <option value="fast">Rápida</option>
                  </select>
                  {renderHelp("Controla la rapidez del barrido horizontal del mapa")}
                  {renderFieldError("ui.map.cinema.panLngDegPerSec")}
                </div>
              )}

              {supports("ui.map.cinema.motion.amplitudeDeg") && (
                <div className="config-field">
                  <label htmlFor="cinema_amplitude">Amplitud del movimiento</label>
                  <input
                    id="cinema_amplitude"
                    type="range"
                    min={CINEMA_AMPLITUDE_RANGE.min}
                    max={CINEMA_AMPLITUDE_RANGE.max}
                    step={5}
                    value={Math.round(currentCinemaMotion.amplitudeDeg)}
                    disabled={disableCinemaControls}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }
                      updateCinemaMotion({ amplitudeDeg: value });
                    }}
                  />
                  <div className="config-field__hint">
                    Cobertura horizontal ±{Math.round(currentCinemaMotion.amplitudeDeg)}° alrededor del centro.
                  </div>
                </div>
              )}

              {supports("ui.map.cinema.motion.easing") && (
                <div className="config-field">
                  <label htmlFor="cinema_easing">Suavizado del movimiento</label>
                  <select
                    id="cinema_easing"
                    value={currentCinemaMotion.easing}
                    disabled={disableCinemaControls}
                    onChange={(event) => {
                      updateCinemaMotion({ easing: event.target.value as AppConfig["ui"]["map"]["cinema"]["motion"]["easing"] });
                    }}
                  >
                    <option value="linear">Lineal</option>
                    <option value="ease-in-out">Suave (ease-in-out)</option>
                  </select>
                  {renderHelp("Elige cómo acelera y frena el desplazamiento al cambiar de sentido")}
                </div>
              )}

              {supports("ui.map.cinema.motion.pauseWithOverlay") && (
                <div className="config-field config-field--checkbox">
                  <label htmlFor="cinema_pause_overlay">
                    <input
                      id="cinema_pause_overlay"
                      type="checkbox"
                      checked={currentCinemaMotion.pauseWithOverlay}
                      disabled={disableCinemaControls}
                      onChange={(event) => {
                        updateCinemaMotion({ pauseWithOverlay: event.target.checked });
                      }}
                    />
                    Pausar cuando haya overlays informativos
                  </label>
                  {renderHelp("Detiene el movimiento si se muestra el modo tormenta u otros paneles prioritarios")}
                </div>
              )}

              {supports("ui.map.cinema.motion") && (
                <div className="config-field">
                  <button
                    type="button"
                    className="config-button"
                    onClick={resetCinemaSettings}
                    disabled={disableCinemaControls}
                  >
                    Restablecer valores del modo cine
                  </button>
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
                  <label htmlFor="aemet_api_key">API key de AEMET</label>
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

        {supports("opensky") && (
          <div className="config-card">
            <div>
              <h2>OpenSky</h2>
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
                <label htmlFor="opensky_client_id">Client ID OAuth2</label>
                <div className="config-field__secret">
                  <input
                    id="opensky_client_id"
                    type="text"
                    value={openskyClientIdInput}
                    disabled={disableInputs}
                    onChange={(event) => setOpenSkyClientIdInput(event.target.value)}
                    placeholder="Introduce el client_id proporcionado por OpenSky"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="config-button"
                    disabled={disableInputs || savingOpenSkyClientId}
                    onClick={handleSaveOpenSkyClientId}
                  >
                    Guardar
                  </button>
                </div>
                {renderHelp(openskyClientIdSet ? "Guardado ✓" : "No establecido ✗")}
              </div>

              <div className="config-field">
                <label htmlFor="opensky_client_secret">Client secret OAuth2</label>
                <div className="config-field__secret">
                  <input
                    id="opensky_client_secret"
                    type="password"
                    value={openskyClientSecretInput}
                    disabled={disableInputs}
                    onChange={(event) => setOpenSkyClientSecretInput(event.target.value)}
                    placeholder="Introduce el client_secret proporcionado por OpenSky"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="config-button"
                    disabled={disableInputs || savingOpenSkyClientSecret}
                    onClick={handleSaveOpenSkyClientSecret}
                  >
                    Guardar
                  </button>
                </div>
                {renderHelp(openskyClientSecretSet ? "Guardado ✓" : "No establecido ✗")}
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
                      Estado token: {openskyStatusData.token_valid ? "válido" : openskyStatusData.token_set ? "expirado" : "no configurado"}
                    </li>
                    <li>
                      Última respuesta: {openskyStatusData.last_fetch_iso ? new Date(openskyStatusData.last_fetch_iso).toLocaleString() : "sin datos"}
                    </li>
                    <li>
                      Aeronaves cacheadas: {openskyStatusData.items_count ?? 0}
                    </li>
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
            const defaultGlobal = DEFAULT_CONFIG.layers.global ?? createDefaultGlobalLayers();
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
                provider: "rainviewer" as const,
                refresh_minutes: currentGlobal?.radar?.refresh_minutes ?? defaultGlobal.radar.refresh_minutes,
                history_minutes: currentGlobal?.radar?.history_minutes ?? defaultGlobal.radar.history_minutes,
                frame_step: currentGlobal?.radar?.frame_step ?? defaultGlobal.radar.frame_step,
                opacity: currentGlobal?.radar?.opacity ?? defaultGlobal.radar.opacity,
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
                    {renderHelp("Muestra radar de precipitación global (RainViewer)")}
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
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
};

export { ConfigPage };
