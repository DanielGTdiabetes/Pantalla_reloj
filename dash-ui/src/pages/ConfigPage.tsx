import React, { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_LOCAL_RASTER_CONFIG,
  DEFAULT_MAP_CONFIG,
  DEFAULT_OPENSKY_CONFIG,
  DEFAULT_CONFIG_V2,
  DEFAULT_UI_ROTATION_CONFIG,
  ROTATION_PANEL_IDS,
  withConfigDefaultsV2,
} from "../config/defaults_v2";
import {
  getCalendarPreview,
  getConfigV2,
  getLightningStatus,
  getLightningSample,
  getOpenSkyStatus,
  getRainViewerFrames,
  getRainViewerTileUrl,
  saveCalendarConfig,
  saveConfigV2,
  saveConfigGroup,
  setCalendarICSUrl,
  testAemetApiKey,
  testCalendarConnection,
  testFlights,
  testGIBS,
  testLightningMqtt,
  testLightningWs,
  testMapTiler,
  testNewsFeeds,
  testRainViewer,
  testShips,
  testXyz,
  updateAemetApiKey,
  updateSecrets,
  uploadCalendarICS,
  reloadConfig,
  type CalendarPreviewItem,
  type NewsFeedTestResult,
  type RainViewerTestResponse,
  type WiFiNetwork,
  wifiConnect,
  wifiDisconnect,
  wifiNetworks,
  wifiScan,
  wifiStatus,
} from "../lib/api";
import type {
  AppConfigV2,
  CalendarConfig,
  FlightsLayerConfigV2,
  OpenSkyConfigV2,
  PanelsConfigV2,
  ShipsLayerConfigV2,
  UIRotationConfigV2,
} from "../types/config_v2";

const DEFAULT_AISSTREAM_WS_URL = "wss://stream.aisstream.io/v0/stream";
const DEFAULT_STREETS_STYLE_URL = "https://api.maptiler.com/maps/streets-v4/style.json?key=fBZDqPrUD4EwoZLV4L6A";

const ROTATION_PANEL_LABELS: Record<string, string> = {
  clock: "Reloj",
  weather: "Tiempo",
  astronomy: "Astronomía",
  santoral: "Santoral",
  calendar: "Calendario",
  harvest: "Cosechas",
  news: "Noticias",
  historicalEvents: "Efemérides históricas",
};

const ROTATION_PANEL_NORMALIZE_MAP: Record<string, string> = {
  time: "clock",
  clock: "clock",
  weather: "weather",
  forecast: "weather",
  astronomy: "astronomy",
  ephemerides: "astronomy",
  moon: "astronomy",
  saints: "santoral",
  santoral: "santoral",
  calendar: "calendar",
  news: "news",
  historicalevents: "historicalEvents",
  historicalEvents: "historicalEvents",
};

const ROTATION_DEFAULT_ORDER = [...ROTATION_PANEL_IDS];

const ROTATION_PANEL_OPTIONS = ROTATION_PANEL_IDS.map((id) => ({
  id,
  label: ROTATION_PANEL_LABELS[id] ?? id,
}));

const normalizeRotationPanelId = (panelId: string): string | null => {
  if (typeof panelId !== "string") {
    return null;
  }
  const trimmed = panelId.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const mapped = ROTATION_PANEL_NORMALIZE_MAP[lower as keyof typeof ROTATION_PANEL_NORMALIZE_MAP] ?? trimmed;
  return ROTATION_PANEL_IDS.includes(mapped as (typeof ROTATION_PANEL_IDS)[number]) ? mapped : null;
};

const sanitizeRotationPanels = (panels: string[]): string[] => {
  const normalized: string[] = [];
  for (const panel of panels) {
    const mapped = normalizeRotationPanelId(panel);
    if (mapped && !normalized.includes(mapped)) {
      normalized.push(mapped);
    }
  }
  return normalized.length > 0 ? normalized : [...ROTATION_DEFAULT_ORDER];
};

export const ConfigPage: React.FC = () => {
  // Estado general
  const [config, setConfig] = useState<AppConfigV2 | null>(null);
  const [loading, setLoading] = useState(true);

  // Grupo 1: WiFi
  const [wifiNetworksList, setWifiNetworksList] = useState<WiFiNetwork[]>([]);
  const [wifiNetworksCount, setWifiNetworksCount] = useState(0);
  const [wifiScanning, setWifiScanning] = useState(false);
  const [wifiScanError, setWifiScanError] = useState<string | null>(null);
  const [wifiStatusData, setWifiStatusData] = useState<{
    interface: string;
    connected: boolean;
    ssid: string | null;
    ip_address: string | null;
    signal: number | null;
  } | null>(null);
  const [wifiSaving, setWifiSaving] = useState(false);

  // Grupo 2: Mapas y Capas
  const [mapSaving, setMapSaving] = useState(false);
  const [maptilerTestResult, setMaptilerTestResult] = useState<{ ok: boolean; bytes?: number; error?: string } | null>(null);
  const [maptilerTesting, setMaptilerTesting] = useState(false);
  const [xyzTestResult, setXyzTestResult] = useState<{ ok: boolean; bytes?: number; contentType?: string; error?: string } | null>(null);
  const [xyzTesting, setXyzTesting] = useState(false);
  const [aemetTestResult, setAemetTestResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [aemetTesting, setAemetTesting] = useState(false);
  const [aemetApiKey, setAemetApiKey] = useState<string>("");
  const [openskyStatus, setOpenskyStatus] = useState<any>(null);
  
  // Flights test
  const [flightsTestResult, setFlightsTestResult] = useState<{ ok: boolean; provider?: string; auth?: string; token_last4?: string; expires_in?: number; reason?: string; tip?: string } | null>(null);
  const [flightsTesting, setFlightsTesting] = useState(false);
  const [flightsSaving, setFlightsSaving] = useState(false);
  
  // Ships test
  const [shipsTestResult, setShipsTestResult] = useState<{ ok: boolean; provider?: string; reason?: string; tip?: string } | null>(null);
  const [shipsTesting, setShipsTesting] = useState(false);
  const [shipsSaving, setShipsSaving] = useState(false);
  
  // Secrets (local state for editing)
  const [openskyOAuth2ClientId, setOpenskyOAuth2ClientId] = useState<string>("");
  const [openskyOAuth2ClientSecret, setOpenskyOAuth2ClientSecret] = useState<string>("");
  const [openskyBasicUsername, setOpenskyBasicUsername] = useState<string>("");
  const [openskyBasicPassword, setOpenskyBasicPassword] = useState<string>("");
  const [aviationstackApiKey, setAviationstackApiKey] = useState<string>("");
  const [aisstreamApiKey, setAisstreamApiKey] = useState<string>("");
  const [aishubApiKey, setAishubApiKey] = useState<string>("");
  
  // RainViewer
  const [rainviewerTestResult, setRainviewerTestResult] = useState<RainViewerTestResponse | null>(null);
  const [rainviewerTesting, setRainviewerTesting] = useState(false);
  const [rainviewerTilePreview, setRainviewerTilePreview] = useState<string | null>(null);
  const [rainviewerLoadingTile, setRainviewerLoadingTile] = useState(false);
  
  // GIBS
  const [gibsTestResult, setGibsTestResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [gibsTesting, setGibsTesting] = useState(false);
  const [gibsTilePreview, setGibsTilePreview] = useState<string | null>(null);
  const [gibsLoadingTile, setGibsLoadingTile] = useState(false);
  const [globalSaving, setGlobalSaving] = useState(false);

  // Grupo 2.5: Rayos (Blitzortung)
  const [lightningSaving, setLightningSaving] = useState(false);
  const [lightningMqttTestResult, setLightningMqttTestResult] = useState<{ ok: boolean; connected: boolean; received?: number; latency_ms?: number; error?: string } | null>(null);
  const [lightningMqttTesting, setLightningMqttTesting] = useState(false);
  const [lightningWsTestResult, setLightningWsTestResult] = useState<{ ok: boolean; connected: boolean; error?: string } | null>(null);
  const [lightningWsTesting, setLightningWsTesting] = useState(false);
  const [lightningStatusData, setLightningStatusData] = useState<any>(null);
  const [lightningStatusLoading, setLightningStatusLoading] = useState(false);
  const [openskySaving, setOpenskySaving] = useState(false);

  // Grupo 3: Panel Rotativo
  const [panelRotatorSaving, setPanelRotatorSaving] = useState(false);
  const [calendarTestResult, setCalendarTestResult] = useState<{ ok: boolean; message?: string; reason?: string; source?: string; count?: number; range_days?: number } | null>(null);
  const [calendarTesting, setCalendarTesting] = useState(false);
  const [calendarPreview, setCalendarPreview] = useState<CalendarPreviewItem[] | null>(null);
  const [calendarPreviewLoading, setCalendarPreviewLoading] = useState(false);
  const [calendarUploading, setCalendarUploading] = useState(false);
  const [calendarUploadProgress, setCalendarUploadProgress] = useState<number>(0);
  const [calendarUrlLoading, setCalendarUrlLoading] = useState(false);
  const [newsFeedsTestResult, setNewsFeedsTestResult] = useState<NewsFeedTestResult[] | null>(null);
  const [newsFeedsTesting, setNewsFeedsTesting] = useState(false);

  const dispatchConfigSaved = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pantalla:config:saved"));
    }
  };

  const dispatchRotationRestart = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pantalla:rotation:restart"));
    }
  };

  const sanitizeFlightsPayload = (): Partial<FlightsLayerConfigV2> | undefined => {
    const flights = config?.layers?.flights;
    if (!flights) {
      return undefined;
    }

    if (!flights.enabled) {
      return {
        enabled: false,
        provider: "opensky",
      };
    }

    const provider = flights.provider ?? "opensky";

    const payload: Partial<FlightsLayerConfigV2> = {
      enabled: true,
      provider,
      refresh_seconds: flights.refresh_seconds ?? 12,
      max_age_seconds: flights.max_age_seconds ?? 120,
      max_items_global: flights.max_items_global ?? 2000,
      max_items_view: flights.max_items_view ?? 1500,
      rate_limit_per_min: flights.rate_limit_per_min ?? 6,
      decimate: flights.decimate ?? "none",
      grid_px: flights.grid_px ?? 24,
      styleScale: flights.styleScale ?? 3.2,
    render_mode: flights.render_mode ?? "symbol_custom",
    };

    if (flights.circle) {
      payload.circle = flights.circle;
    }

    if (provider === "opensky" && flights.opensky) {
      payload.opensky = flights.opensky;
    } else if (provider === "aviationstack" && flights.aviationstack) {
      payload.aviationstack = flights.aviationstack;
    } else if (provider === "custom" && flights.custom) {
      payload.custom = flights.custom;
    }

    return payload;
  };

  const sanitizeShipsPayload = (): Partial<ShipsLayerConfigV2> | undefined => {
    const ships = config?.layers?.ships;
    if (!ships) {
      return undefined;
    }

    if (!ships.enabled) {
      return { enabled: false };
    }

    const provider = ships.provider ?? "aisstream";
    const payload: Partial<ShipsLayerConfigV2> = {
      enabled: true,
      provider,
      refresh_seconds: ships.refresh_seconds ?? 10,
      max_age_seconds: ships.max_age_seconds ?? 180,
      max_items_global: ships.max_items_global ?? 1500,
      max_items_view: ships.max_items_view ?? 420,
      rate_limit_per_min: ships.rate_limit_per_min ?? 4,
      decimate: ships.decimate ?? "grid",
      grid_px: ships.grid_px ?? 24,
      styleScale: ships.styleScale ?? 1.4,
    };

    if (provider === "aisstream") {
      const wsUrl = typeof ships.aisstream?.ws_url === "string"
        ? ships.aisstream.ws_url.trim() || DEFAULT_AISSTREAM_WS_URL
        : DEFAULT_AISSTREAM_WS_URL;
      payload.aisstream = { ws_url: wsUrl };
    } else if (provider === "aishub") {
      const baseUrl = typeof ships.aishub?.base_url === "string"
        ? ships.aishub.base_url.trim() || "https://www.aishub.net/api"
        : "https://www.aishub.net/api";
      payload.aishub = { base_url: baseUrl };
    } else if (provider === "ais_generic") {
      payload.ais_generic = {
        api_url: ships.ais_generic?.api_url?.trim() || null,
      };
    } else if (provider === "custom") {
      payload.custom = {
        api_url: ships.custom?.api_url?.trim() || null,
        api_key: ships.custom?.api_key?.trim() || null,
      };
    }

    return payload;
  };

  const sanitizePanelsPayload = (): PanelsConfigV2 | undefined => {
    const panels = config?.panels;
    if (!panels) {
      return undefined;
    }

    const payload: Record<string, unknown> = {};

    if (panels.news) {
      if (panels.news.enabled) {
        const feeds = Array.isArray(panels.news.feeds)
          ? panels.news.feeds.map((feed) => feed.trim()).filter((feed) => feed.length > 0)
          : [];
        payload.news = {
          enabled: true,
          feeds,
        };
      } else {
        payload.news = { enabled: false };
      }
    }

    if (panels.calendar) {
      if (panels.calendar.enabled) {
        const provider = panels.calendar.provider === "ics" ? "ics" : "google";
        const calendarPayload: Record<string, unknown> = {
          enabled: true,
          provider,
        };
        const pathValue = typeof panels.calendar.ics_path === "string" ? panels.calendar.ics_path.trim() : "";
        if (provider === "ics" && pathValue) {
          calendarPayload.ics_path = pathValue;
        }
        payload.calendar = calendarPayload;
      } else {
        payload.calendar = { enabled: false };
      }
    }

    if (panels.ephemerides) {
      payload.ephemerides = {
        enabled: panels.ephemerides.enabled ?? false,
      };
    }

    if (panels.harvest) {
      payload.harvest = {
        enabled: panels.harvest.enabled ?? false,
      };
    }

    if (panels.weatherWeekly) {
      payload.weatherWeekly = {
        enabled: panels.weatherWeekly.enabled ?? false,
      };
    }

    return Object.keys(payload).length > 0 ? (payload as PanelsConfigV2) : undefined;
  };

  const sanitizeRotationPayload = (): UIRotationConfigV2 => {
    const rotation = config?.ui?.rotation ?? DEFAULT_UI_ROTATION_CONFIG;
    const panels = sanitizeRotationPanels(rotation.panels ?? []);
    const durationCandidate = Number(rotation.duration_sec);
    const duration = Number.isFinite(durationCandidate)
      ? Math.min(3600, Math.max(3, Math.round(durationCandidate)))
      : DEFAULT_UI_ROTATION_CONFIG.duration_sec;

    return {
      enabled: Boolean(rotation.enabled),
      duration_sec: duration,
      panels,
    };
  };

  const updateRotationState = (updater: (current: UIRotationConfigV2) => UIRotationConfigV2) => {
    setConfig((prevConfig) => {
      if (!prevConfig) {
        return prevConfig;
      }
      const currentRotation: UIRotationConfigV2 = {
        ...DEFAULT_UI_ROTATION_CONFIG,
        ...prevConfig.ui?.rotation,
        panels: sanitizeRotationPanels(prevConfig.ui?.rotation?.panels ?? DEFAULT_UI_ROTATION_CONFIG.panels),
      };
      const nextRotation = updater(currentRotation);
      return {
        ...prevConfig,
        ui: {
          ...prevConfig.ui,
          rotation: nextRotation,
        },
      };
    });
  };

  const handleRotationToggle = (enabled: boolean) => {
    updateRotationState((current) => ({
      ...current,
      enabled,
    }));
  };

  const handleRotationDurationChange = (value: number) => {
    const normalized = Math.min(3600, Math.max(3, Math.round(value)));
    updateRotationState((current) => ({
      ...current,
      duration_sec: normalized,
    }));
  };

  const handleAddRotationPanel = (panelId: string) => {
    const normalized = normalizeRotationPanelId(panelId);
    if (!normalized) {
      return;
    }
    updateRotationState((current) => {
      if (current.panels.includes(normalized)) {
        return current;
      }
      return {
        ...current,
        panels: sanitizeRotationPanels([...current.panels, normalized]),
      };
    });
  };

  const handleRemoveRotationPanel = (panelId: string) => {
    updateRotationState((current) => {
      const nextPanels = sanitizeRotationPanels(current.panels.filter((id) => id !== panelId));
      return {
        ...current,
        panels: nextPanels,
      };
    });
  };

  const handleMoveRotationPanel = (panelId: string, direction: "up" | "down") => {
    updateRotationState((current) => {
      const index = current.panels.indexOf(panelId);
      if (index === -1) {
        return current;
      }
      const nextPanels = [...current.panels];
      if (direction === "up" && index > 0) {
        [nextPanels[index - 1], nextPanels[index]] = [nextPanels[index], nextPanels[index - 1]];
      } else if (direction === "down" && index < nextPanels.length - 1) {
        [nextPanels[index], nextPanels[index + 1]] = [nextPanels[index + 1], nextPanels[index]];
      }
      return {
        ...current,
        panels: nextPanels,
      };
    });
  };

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        const loadedConfig = await getConfigV2();
        const configWithDefaults = withConfigDefaultsV2(loadedConfig);
        setConfig(configWithDefaults);

        // Cargar API key de AEMET desde secrets (no se expone en config, pero podemos intentar leerla)
        // La API key se guarda en secrets, no en config pública, así que no la podemos leer directamente
        // El usuario tendrá que escribirla de nuevo o usar el botón de test que usa GET /api/aemet/test
        
        // Cargar estado WiFi
        const status = await wifiStatus();
        setWifiStatusData(status);

        // Cargar redes WiFi guardadas
        const networksResponse = await wifiNetworks();
        setWifiNetworksList(networksResponse.networks);
        setWifiNetworksCount(networksResponse.count);

        // Cargar estado OpenSky
        try {
          const opensky = await getOpenSkyStatus();
          setOpenskyStatus(opensky);
        } catch (error) {
          console.error("Error loading OpenSky status:", error);
        }
      } catch (error) {
        console.error("Error loading initial data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // ===== GRUPO 1: WiFi =====
  const handleWifiScan = async () => {
    setWifiScanning(true);
    setWifiScanError(null);

    try {
      const scanResponse = await wifiScan();
      
      if (scanResponse.ok) {
        const networksResponse = await wifiNetworks();
        setWifiNetworksList(networksResponse.networks);
        setWifiNetworksCount(networksResponse.count);
        
        if (networksResponse.count === 0) {
          setWifiScanError("No se han encontrado redes. Reintenta o acerca el equipo al AP.");
        }
      } else {
        setWifiScanError("No se pudo completar el escaneo de redes WiFi. Inténtalo de nuevo.");
        const networksResponse = await wifiNetworks();
        setWifiNetworksList(networksResponse.networks);
        setWifiNetworksCount(networksResponse.count);
      }
    } catch (error) {
      setWifiScanError("No se pudo completar el escaneo de redes WiFi. Inténtalo de nuevo.");
      console.error("Error scanning WiFi:", error);
    } finally {
      setWifiScanning(false);
    }
  };

  const handleWifiConnect = async (ssid: string, password?: string) => {
    try {
      await wifiConnect({ ssid, password });
      const status = await wifiStatus();
      setWifiStatusData(status);
      
      const networksResponse = await wifiNetworks();
      setWifiNetworksList(networksResponse.networks);
      setWifiNetworksCount(networksResponse.count);
    } catch (error) {
      console.error("Error connecting to WiFi:", error);
      alert("Error al conectar a la red. Inténtalo de nuevo.");
    }
  };

  const handleWifiDisconnect = async () => {
    try {
      await wifiDisconnect();
      const status = await wifiStatus();
      setWifiStatusData(status);
    } catch (error) {
      console.error("Error disconnecting WiFi:", error);
      alert("Error al desconectar. Inténtalo de nuevo.");
    }
  };

  const handleSaveWifi = async () => {
    // WiFi no guarda configuración, solo conecta/desconecta
    // Este botón puede ser útil para operaciones futuras
    setWifiSaving(true);
    try {
      // Recargar estado
      const status = await wifiStatus();
      setWifiStatusData(status);
      alert("Estado WiFi actualizado");
    } catch (error) {
      console.error("Error:", error);
      alert("Error al actualizar estado WiFi");
    } finally {
      setWifiSaving(false);
    }
  };

  // Helper functions to build complete config objects
  const buildFlightsConfig = (updates?: Partial<FlightsLayerConfigV2>): FlightsLayerConfigV2 => {
    const current = config?.layers?.flights;
    return {
      enabled: updates?.enabled !== undefined ? updates.enabled : (current?.enabled !== undefined ? current.enabled : true),
      provider: updates?.provider ?? current?.provider ?? "opensky",
      refresh_seconds: updates?.refresh_seconds ?? current?.refresh_seconds ?? 12,
      max_age_seconds: updates?.max_age_seconds ?? current?.max_age_seconds ?? 120,
      max_items_global: updates?.max_items_global ?? current?.max_items_global ?? 2000,
      max_items_view: updates?.max_items_view ?? current?.max_items_view ?? 1500,
      rate_limit_per_min: updates?.rate_limit_per_min ?? current?.rate_limit_per_min ?? 6,
      decimate: updates?.decimate ?? current?.decimate ?? "none",
      grid_px: updates?.grid_px ?? current?.grid_px ?? 24,
      styleScale: updates?.styleScale ?? current?.styleScale ?? 3.2,
      render_mode: updates?.render_mode ?? current?.render_mode ?? "circle",
      circle: updates?.circle ?? current?.circle,
      opensky: updates?.opensky ?? current?.opensky,
      aviationstack: updates?.aviationstack ?? current?.aviationstack,
      custom: updates?.custom ?? current?.custom,
    };
  };

  const buildOpenSkyConfig = (updates?: Partial<OpenSkyConfigV2>): OpenSkyConfigV2 => {
    const current = (config?.opensky ?? DEFAULT_OPENSKY_CONFIG) as OpenSkyConfigV2;
    const next = updates ?? {};
    const currentBbox = current.bbox ?? DEFAULT_OPENSKY_CONFIG.bbox;
    const bbox = {
      lamin: next.bbox?.lamin ?? currentBbox.lamin ?? DEFAULT_OPENSKY_CONFIG.bbox.lamin,
      lamax: next.bbox?.lamax ?? currentBbox.lamax ?? DEFAULT_OPENSKY_CONFIG.bbox.lamax,
      lomin: next.bbox?.lomin ?? currentBbox.lomin ?? DEFAULT_OPENSKY_CONFIG.bbox.lomin,
      lomax: next.bbox?.lomax ?? currentBbox.lomax ?? DEFAULT_OPENSKY_CONFIG.bbox.lomax,
    };
    const currentOauth = current.oauth2 ?? DEFAULT_OPENSKY_CONFIG.oauth2;
    return {
      enabled: next.enabled ?? current.enabled ?? false,
      mode: next.mode ?? current.mode ?? "bbox",
      poll_seconds: next.poll_seconds ?? current.poll_seconds ?? DEFAULT_OPENSKY_CONFIG.poll_seconds,
      max_aircraft: next.max_aircraft ?? current.max_aircraft ?? DEFAULT_OPENSKY_CONFIG.max_aircraft,
      cluster: next.cluster ?? current.cluster ?? DEFAULT_OPENSKY_CONFIG.cluster,
      extended: next.extended ?? current.extended ?? DEFAULT_OPENSKY_CONFIG.extended,
      bbox,
      oauth2: {
        client_id: next.oauth2?.client_id ?? currentOauth?.client_id ?? null,
        client_secret: next.oauth2?.client_secret ?? currentOauth?.client_secret ?? null,
        token_url:
          next.oauth2?.token_url ??
          currentOauth?.token_url ??
          DEFAULT_OPENSKY_CONFIG.oauth2.token_url,
        scope: next.oauth2?.scope ?? currentOauth?.scope ?? null,
      },
    };
  };

  const buildShipsConfig = (updates?: Partial<ShipsLayerConfigV2>): ShipsLayerConfigV2 => {
    const current = config?.layers?.ships;
    return {
      enabled: updates?.enabled !== undefined ? updates.enabled : (current?.enabled !== undefined ? current.enabled : false),
      provider: updates?.provider ?? current?.provider ?? "aisstream",
      refresh_seconds: updates?.refresh_seconds ?? current?.refresh_seconds ?? 10,
      max_age_seconds: updates?.max_age_seconds ?? current?.max_age_seconds ?? 180,
      max_items_global: updates?.max_items_global ?? current?.max_items_global ?? 1500,
      max_items_view: updates?.max_items_view ?? current?.max_items_view ?? 420,
      rate_limit_per_min: updates?.rate_limit_per_min ?? current?.rate_limit_per_min ?? 4,
      decimate: updates?.decimate ?? current?.decimate ?? "grid",
      grid_px: updates?.grid_px ?? current?.grid_px ?? 24,
      styleScale: updates?.styleScale ?? current?.styleScale ?? 3.2,
      aisstream: updates?.aisstream ?? current?.aisstream,
      aishub: updates?.aishub ?? current?.aishub,
      ais_generic: updates?.ais_generic ?? current?.ais_generic,
      custom: updates?.custom ?? current?.custom,
    };
  };

  // ===== GRUPO 2: Mapas y Capas =====
  const handleTestMapTiler = async () => {
    if (!config) return;
    
    setMaptilerTesting(true);
    setMaptilerTestResult(null);
    
    try {
      const styleUrl = config.ui_map.maptiler?.styleUrl;
      if (!styleUrl) {
        setMaptilerTestResult({ ok: false, error: "styleUrl no configurado" });
        return;
      }
      
      const result = await testMapTiler({ styleUrl });
      setMaptilerTestResult(result);
    } catch (error) {
      setMaptilerTestResult({ ok: false, error: "Error al probar MapTiler" });
      console.error("Error testing MapTiler:", error);
    } finally {
      setMaptilerTesting(false);
    }
  };

  const handleTestXyz = async () => {
    if (!config) return;
    
    setXyzTesting(true);
    setXyzTestResult(null);
    
    try {
      let tileUrl: string | null = null;
      
      if (config.ui_map.provider === "local_raster_xyz") {
        tileUrl = config.ui_map.local?.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
      } else if (config.ui_map.provider === "custom_xyz") {
        tileUrl = config.ui_map.customXyz?.tileUrl || null;
      }
      
      if (!tileUrl) {
        setXyzTestResult({ ok: false, error: "tileUrl no configurado" });
        return;
      }
      
      const result = await testXyz({ tileUrl: tileUrl });
      setXyzTestResult(result);
    } catch (error) {
      setXyzTestResult({ ok: false, error: "Error al probar XYZ" });
      console.error("Error testing XYZ:", error);
    } finally {
      setXyzTesting(false);
    }
  };

  const handleTestRainViewer = async () => {
    if (!config) return;
    
    setRainviewerTesting(true);
    setRainviewerTestResult(null);
    try {
      const radarConfig = config.layers?.global?.radar ?? config.layers?.global_?.radar;
      const provider = radarConfig?.provider ?? "rainviewer";
      const layer_type = radarConfig?.layer_type ?? "precipitation_new";
      const opacity = radarConfig?.opacity ?? 0.7;
      
      const result = await testRainViewer(provider, layer_type, opacity);
      setRainviewerTestResult(result || { ok: false, status: 0, error: "Sin respuesta" });
    } catch (error) {
      setRainviewerTestResult({ ok: false, status: 0, error: "Error al probar RainViewer", message: error instanceof Error ? error.message : "Error desconocido" });
      console.error("Error testing RainViewer:", error);
    } finally {
      setRainviewerTesting(false);
    }
  };

  const handleViewRainViewerTile = async () => {
    setRainviewerLoadingTile(true);
    setRainviewerTilePreview(null);
    try {
      // Obtener frames disponibles
      const frames = await getRainViewerFrames(90, 5);
      if (frames.length === 0) {
        alert("No hay frames disponibles");
        return;
      }
      
      // Tomar el primer timestamp
      const timestamp = frames[0];
      
      // Obtener URL del tile
      const tileUrl = await getRainViewerTileUrl(timestamp, 2, 1, 1);
      
      // Verificar que el tile esté disponible
      const response = await fetch(tileUrl);
      if (response.ok && response.headers.get("content-type")?.includes("image")) {
        // Crear blob URL para preview
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        setRainviewerTilePreview(blobUrl);
      } else {
        alert("No se pudo cargar el tile de ejemplo");
      }
    } catch (error) {
      console.error("Error loading RainViewer tile:", error);
      alert("Error al cargar el tile de ejemplo");
    } finally {
      setRainviewerLoadingTile(false);
    }
  };

  const handleTestGIBS = async () => {
    setGibsTesting(true);
    setGibsTestResult(null);
    try {
      // Primero obtener frames disponibles
      const framesResponse = await fetch(`${window.location.origin}/api/global/satellite/frames`);
      if (!framesResponse.ok) {
        setGibsTestResult({ ok: false, reason: "backend_error" });
        return;
      }
      
      const framesData = await framesResponse.json();
      if (framesData.error !== null || !framesData.frames || framesData.frames.length === 0) {
        setGibsTestResult({ ok: false, reason: "tile_not_available" });
        return;
      }
      
      // Usar el último frame disponible
      const lastFrame = framesData.frames[framesData.frames.length - 1];
      const timestamp = lastFrame.timestamp;
      
      // Probar un tile con el timestamp del frame
      const tileUrl = `${window.location.origin}/api/global/satellite/tiles/${timestamp}/0/0/0.png`;
      const tileResponse = await fetch(tileUrl);
      
      if (tileResponse.ok && tileResponse.headers.get("content-type")?.includes("image")) {
        setGibsTestResult({ ok: true });
        // Cargar preview del tile
        try {
          const blob = await tileResponse.blob();
          const blobUrl = URL.createObjectURL(blob);
          setGibsTilePreview(blobUrl);
        } catch (error) {
          console.debug("Could not load GIBS tile preview:", error);
        }
      } else {
        setGibsTestResult({ ok: false, reason: "tile_not_available" });
      }
    } catch (error) {
      setGibsTestResult({ ok: false, reason: "connection_error" });
      console.error("Error testing GIBS:", error);
    } finally {
      setGibsTesting(false);
    }
  };

  const handleTestAemet = async () => {
    setAemetTesting(true);
    setAemetTestResult(null);
    try {
      // Si hay apiKey en el input, probarla; si no, usar GET /api/aemet/test
      if (aemetApiKey && aemetApiKey.trim().length > 0) {
        const result = await testAemetApiKey(aemetApiKey);
        setAemetTestResult(result || { ok: false, reason: "Sin respuesta" });
      } else {
        // Usar GET /api/aemet/test para probar la key guardada
        try {
          const response = await fetch(`${window.location.origin}/api/aemet/test`);
          const result = await response.json();
          setAemetTestResult(result || { ok: false, reason: "Sin respuesta" });
        } catch (fetchError) {
          setAemetTestResult({ ok: false, reason: "Error al probar AEMET" });
        }
      }
    } catch (error) {
      setAemetTestResult({ ok: false, reason: "Error al probar la API key" });
      console.error("Error testing AEMET:", error);
    } finally {
      setAemetTesting(false);
    }
  };

  const handleUpdateAemetApiKey = async (apiKey: string | null) => {
    try {
      await updateAemetApiKey(apiKey);
      // Actualizar secrets en config
      setConfig({
        ...config!,
        secrets: {
          ...config!.secrets,
          aemet: {
            ...(config!.secrets?.aemet as any),
            api_key: apiKey,
          } as any,
        },
      });
    } catch (error) {
      console.error("Error updating AEMET API key:", error);
      alert("Error al guardar la API key de AEMET");
    }
  };

  const handleTestFlights = async () => {
    if (!config) return;
    
    setFlightsTesting(true);
    setFlightsTestResult(null);
    
    try {
      // Primero guardar configuración si hay cambios
      if (config.layers?.flights) {
        await saveConfigGroup("layers.flights", config.layers.flights);
      }
      
      const result = await testFlights();
      setFlightsTestResult(result);
    } catch (error) {
      setFlightsTestResult({ ok: false, reason: "connection_error", tip: String(error) });
      console.error("Error testing flights:", error);
    } finally {
      setFlightsTesting(false);
    }
  };

  const handleSaveFlightsLayer = async () => {
    if (!config) {
      return;
    }

    setFlightsSaving(true);
    try {
      const flightsPayload = buildFlightsConfig();
      await saveConfigGroup("layers.flights", flightsPayload);
      await reloadConfig();
      alert("Capa de vuelos guardada. La pantalla se reiniciará en unos segundos.");
      const loadedConfig = await getConfigV2();
      setConfig(withConfigDefaultsV2(loadedConfig));
      dispatchConfigSaved();
    } catch (error) {
      console.error("Error saving flights layer:", error);
      alert("Error al guardar la capa de vuelos");
    } finally {
      setFlightsSaving(false);
    }
  };

  const handleSaveOpenSky = async () => {
    if (!config) {
      return;
    }

    setOpenskySaving(true);
    try {
      const payload = buildOpenSkyConfig();
      await saveConfigGroup("opensky", payload);
      await reloadConfig();
      alert("Configuración de OpenSky guardada. La pantalla se reiniciará en unos segundos.");
      const loadedConfig = await getConfigV2();
      setConfig(withConfigDefaultsV2(loadedConfig));
      dispatchConfigSaved();
    } catch (error) {
      console.error("Error saving OpenSky config:", error);
      alert("Error al guardar la configuración de OpenSky");
    } finally {
      setOpenskySaving(false);
    }
  };

  const handleTestShips = async () => {
    if (!config) return;
    
    setShipsTesting(true);
    setShipsTestResult(null);
    
    try {
      // Primero guardar configuración si hay cambios
      if (config.layers?.ships) {
        await saveConfigGroup("layers.ships", config.layers.ships);
      }
      
      const result = await testShips();
      setShipsTestResult(result);
    } catch (error) {
      setShipsTestResult({ ok: false, reason: "connection_error", tip: String(error) });
      console.error("Error testing ships:", error);
    } finally {
      setShipsTesting(false);
    }
  };

  const handleSaveFlightsSecrets = async () => {
    if (!config) return;
    
    try {
      const secrets: any = {};
      
      if (config.layers?.flights?.provider === "opensky") {
        const openskyCfg = config.layers.flights.opensky;
        if (openskyCfg?.mode === "oauth2") {
          secrets.opensky = {
            oauth2: {
              client_id: openskyOAuth2ClientId || null,
              client_secret: openskyOAuth2ClientSecret || null,
            }
          };
        } else if (openskyCfg?.mode === "basic") {
          secrets.opensky = {
            basic: {
              username: openskyBasicUsername || null,
              password: openskyBasicPassword || null,
            }
          };
        }
      } else if (config.layers?.flights?.provider === "aviationstack") {
        secrets.aviationstack = {
          api_key: aviationstackApiKey || null,
        };
      }
      
      if (Object.keys(secrets).length > 0) {
        await updateSecrets(secrets);
        alert("Secrets guardados correctamente");
      }
    } catch (error) {
      console.error("Error saving flights secrets:", error);
      alert("Error al guardar los secrets");
    }
  };

  const handleSaveShipsSecrets = async () => {
    if (!config) return;
    
    try {
      const secrets: any = {};
      
      if (config.layers?.ships?.provider === "aisstream") {
        secrets.aisstream = {
          api_key: aisstreamApiKey || null,
        };
      } else if (config.layers?.ships?.provider === "aishub") {
        secrets.aishub = {
          api_key: aishubApiKey || null,
        };
      }
      
      if (Object.keys(secrets).length > 0) {
        await updateSecrets(secrets);
        alert("Secrets guardados correctamente");
      }
    } catch (error) {
      console.error("Error saving ships secrets:", error);
      alert("Error al guardar los secrets");
    }
  };

  const handleSaveMap = async () => {
    if (!config) return;

    setMapSaving(true);
    try {
      if (config.ui_map) {
        await saveConfigGroup("ui_map", config.ui_map);
      }

      const legacyMapPayload: Record<string, any> = {};
      const uiMapProvider = config.ui_map?.provider;
      if (uiMapProvider === "maptiler_vector") {
        legacyMapPayload.provider = "maptiler";
        legacyMapPayload.maptiler_api_key =
          config.ui_map.maptiler?.api_key ??
          config.ui_map.maptiler?.apiKey ??
          config.ui_map.maptiler?.key ??
          null;
        legacyMapPayload.styleUrl = config.ui_map.maptiler?.styleUrl ?? null;
      } else if (uiMapProvider === "custom_xyz" || uiMapProvider === "local_raster_xyz") {
        legacyMapPayload.provider = "xyz";
        legacyMapPayload.maptiler_api_key = null;
      }
      if (Object.keys(legacyMapPayload).length > 0) {
        await saveConfigGroup("map", legacyMapPayload);
      }

      await reloadConfig();
      
      // Esperar un momento para que el backend procese el cambio
      await new Promise(resolve => setTimeout(resolve, 500));
      
      alert("Mapa base guardado. La página se recargará en 2 segundos para aplicar los cambios.");
      
      // Forzar recarga completa de la página después de guardar configuración del mapa
      // Esto asegura que el mapa se actualice correctamente en modo kiosko
      // No ejecutar código después de esto ya que la página se recargará
      setTimeout(() => {
        if (typeof window !== "undefined") {
          console.log("[ConfigPage] Recargando página para aplicar cambios en el mapa");
          window.location.reload();
        }
      }, 2000);
      
      // No ejecutar más código después de programar la recarga
      return;
    } catch (error) {
      console.error("Error saving map settings:", error);
      alert("Error al guardar el mapa base");
    } finally {
      setMapSaving(false);
    }
  };

  const handleSaveShipsLayer = async () => {
    if (!config) return;

    const shipsPayload = sanitizeShipsPayload();
    if (!shipsPayload) {
      alert("No hay cambios en la capa de barcos");
      return;
    }

    setShipsSaving(true);
    try {
      await saveConfigGroup("layers.ships", shipsPayload);
      await reloadConfig();
      alert("Capa de barcos guardada. La pantalla se reiniciará en unos segundos.");

      const loadedConfig = await getConfigV2();
      setConfig(withConfigDefaultsV2(loadedConfig));
      dispatchConfigSaved();
    } catch (error) {
      console.error("Error saving ships layer:", error);
      alert("Error al guardar la capa de barcos");
    } finally {
      setShipsSaving(false);
    }
  };

  const handleSaveGlobalLayers = async () => {
    if (!config) {
      return;
    }

    setGlobalSaving(true);
    try {
      // Guardar layers.global (radar y satélite)
      const layersPayload = config.layers ?? {};
      const globalPayload = layersPayload.global ?? layersPayload.global_ ?? {};
      
      // Asegurar que layers existe
      if (!config.layers) {
        await saveConfigV2({
          ...config,
          layers: {
            global: globalPayload,
          },
        });
      } else {
        // Actualizar solo layers.global
        await saveConfigGroup("layers", {
          ...layersPayload,
          global: globalPayload,
        });
      }
      
      await reloadConfig();
      alert("Capas globales guardadas. La pantalla se reiniciará en unos segundos.");

      const loadedConfig = await getConfigV2();
      setConfig(withConfigDefaultsV2(loadedConfig));
      dispatchConfigSaved();
    } catch (error) {
      console.error("Error saving global layers:", error);
      alert("Error al guardar las capas globales");
    } finally {
      setGlobalSaving(false);
    }
  };

  // ===== GRUPO 2.5: Rayos (Blitzortung) =====
  const handleTestLightningMqtt = async () => {
    if (!config) return;
    
    setLightningMqttTesting(true);
    setLightningMqttTestResult(null);
    
    try {
      // Leer configuración de blitzortung (v1 config, no v2)
      const blitzConfig = (config as any).blitzortung || {};
      const result = await testLightningMqtt({
        mqtt_host: blitzConfig.mqtt_host || "127.0.0.1",
        mqtt_port: blitzConfig.mqtt_port || 1883,
        mqtt_topic: blitzConfig.mqtt_topic || "blitzortung/1",
        timeout_sec: 3,
      });
      setLightningMqttTestResult(result);
    } catch (error) {
      setLightningMqttTestResult({ ok: false, connected: false, error: "Error al probar MQTT" });
      console.error("Error testing Lightning MQTT:", error);
    } finally {
      setLightningMqttTesting(false);
    }
  };

  const handleTestLightningWs = async () => {
    if (!config) return;
    
    setLightningWsTesting(true);
    setLightningWsTestResult(null);
    
    try {
      const blitzConfig = (config as any).blitzortung || {};
      const wsUrl = blitzConfig.ws_url;
      if (!wsUrl) {
        setLightningWsTestResult({ ok: false, connected: false, error: "WebSocket URL no configurada" });
        return;
      }
      
      const result = await testLightningWs({
        ws_url: wsUrl,
        timeout_sec: 3,
      });
      setLightningWsTestResult(result);
    } catch (error) {
      setLightningWsTestResult({ ok: false, connected: false, error: "Error al probar WebSocket" });
      console.error("Error testing Lightning WebSocket:", error);
    } finally {
      setLightningWsTesting(false);
    }
  };

  const handleGetLightningStatus = async () => {
    setLightningStatusLoading(true);
    try {
      const status = await getLightningStatus();
      setLightningStatusData(status);
    } catch (error) {
      console.error("Error getting lightning status:", error);
      setLightningStatusData(null);
    } finally {
      setLightningStatusLoading(false);
    }
  };

  const handleSaveLightning = async () => {
    if (!config) return;
    
    setLightningSaving(true);
    try {
      await saveConfigV2(config);
      alert("Configuración de Rayos guardada correctamente");
    } catch (error) {
      console.error("Error saving lightning config:", error);
      alert("Error al guardar la configuración");
    } finally {
      setLightningSaving(false);
    }
  };

  // ===== GRUPO 3: Panel Rotativo =====
  const handleTestNewsFeeds = async () => {
    if (!config) return;
    
    setNewsFeedsTesting(true);
    setNewsFeedsTestResult(null);
    
    try {
      const feeds = config.panels?.news?.feeds || [];
      if (feeds.length === 0) {
        setNewsFeedsTestResult([]);
        return;
      }
      
      const result = await testNewsFeeds({ feeds });
      setNewsFeedsTestResult(result.results || []);
    } catch (error) {
      console.error("Error testing news feeds:", error);
      setNewsFeedsTestResult([]);
    } finally {
      setNewsFeedsTesting(false);
    }
  };

  const handleTestCalendar = async () => {
    setCalendarTesting(true);
    setCalendarTestResult(null);
    setCalendarPreview(null);
    try {
      const result = await testCalendarConnection();
      if (result) {
        setCalendarTestResult({
          ok: result.ok,
          reason: result.reason,
          message: result.message || (result.ok ? `Test exitoso. ${result.count || 0} eventos encontrados.` : "Error al probar el calendario"),
          source: result.source,
          count: result.count,
          range_days: result.range_days
        });
        
        // Si el test es exitoso y hay sample, usar sample para preview
        if (result.ok && result.sample && result.sample.length > 0) {
          setCalendarPreview(result.sample.map(item => ({
            title: item.title,
            start: item.start,
            end: item.end,
            location: item.location,
            all_day: item.allDay
          })));
        } else if (result.ok) {
          // Si no hay sample pero el test fue exitoso, cargar preview
          await handleLoadCalendarPreview();
        }
      } else {
        setCalendarTestResult({ ok: false, reason: "Sin respuesta" });
      }
    } catch (error) {
      setCalendarTestResult({ ok: false, reason: "Error al probar el calendario", message: String(error) });
      console.error("Error testing calendar:", error);
    } finally {
      setCalendarTesting(false);
    }
  };

  const handleLoadCalendarPreview = async () => {
    setCalendarPreviewLoading(true);
    try {
      const preview = await getCalendarPreview(5);
      if (preview.ok && preview.items) {
        setCalendarPreview(preview.items);
      } else {
        setCalendarPreview([]);
      }
    } catch (error) {
      console.error("Error loading calendar preview:", error);
      setCalendarPreview([]);
    } finally {
      setCalendarPreviewLoading(false);
    }
  };
  
  const handleUploadICS = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setCalendarUploading(true);
    setCalendarUploadProgress(0);
    setCalendarTestResult(null);
    
    try {
      // Validar tipo de archivo
      if (!file.name.toLowerCase().endsWith('.ics') && !file.type.includes('calendar')) {
        setCalendarTestResult({ 
          ok: false, 
          reason: "invalid_file_type",
          message: "El archivo debe ser un archivo ICS (.ics)"
        });
        return;
      }
      
      // Simular progress (el backend no tiene progress real, pero podemos mostrar feedback)
      setCalendarUploadProgress(10);
      
      const result = await uploadCalendarICS(file);
      
      setCalendarUploadProgress(90);
      
      if (result.ok) {
        // Recargar config para reflejar cambios (preserva configuración anterior)
        const loadedConfig = await getConfigV2();
        setConfig(withConfigDefaultsV2(loadedConfig));
        
        setCalendarUploadProgress(100);
        
        // Mostrar mensaje de éxito con eventos parseados
        setCalendarTestResult({ 
          ok: true, 
          message: `Archivo ICS subido correctamente. ${result.events_parsed || 0} eventos encontrados (rango: ${result.range_days || 14} días).`,
          source: "ics",
          count: result.events_parsed || 0,
          range_days: result.range_days || 14
        });
        
        // Cargar preview después de un breve delay para mostrar el resultado
        setTimeout(async () => {
          await handleLoadCalendarPreview();
        }, 500);
      } else {
        setCalendarTestResult({ 
          ok: false, 
          reason: result.error || "upload_error",
          message: result.detail || "Error al subir el archivo ICS"
        });
      }
    } catch (error) {
      setCalendarTestResult({ 
        ok: false, 
        reason: "upload_error", 
        message: error instanceof Error ? error.message : String(error)
      });
      console.error("Error uploading ICS:", error);
    } finally {
      setCalendarUploading(false);
      // Resetear progress después de un breve delay
      setTimeout(() => {
        setCalendarUploadProgress(0);
      }, 1000);
      // Resetear input
      event.target.value = "";
    }
  };

  const handleSetICSUrl = async () => {
    if (!config) return;
    
    const url = config.calendar?.ics?.url;
    if (!url || !url.trim()) {
      setCalendarTestResult({ ok: false, reason: "missing_url", message: "URL requerida" });
      return;
    }
    
    setCalendarUrlLoading(true);
    try {
      const result = await setCalendarICSUrl({ url: url.trim() });
      if (result.ok) {
        // Recargar config
        const loadedConfig = await getConfigV2();
        setConfig(withConfigDefaultsV2(loadedConfig));
        
        setCalendarTestResult({ 
          ok: true, 
          message: `URL configurada correctamente. ${result.events || 0} eventos encontrados.` 
        });
        
        // Cargar preview
        await handleLoadCalendarPreview();
      } else {
        setCalendarTestResult({ 
          ok: false, 
          reason: result.error || "url_error",
          message: result.detail || "Error al configurar la URL ICS"
        });
      }
    } catch (error) {
      setCalendarTestResult({ ok: false, reason: "url_error", message: String(error) });
      console.error("Error setting ICS URL:", error);
    } finally {
      setCalendarUrlLoading(false);
    }
  };

  const handleSaveCalendar = async () => {
    if (!config) return;
    
    const calendarSource = config.calendar?.source || config.calendar?.provider;
    const normalizedCalendarSource = calendarSource === "ics" ? "ics" : "google";
    const isIcsActive = Boolean(config.calendar?.enabled) && normalizedCalendarSource === "ics";
    const hasIcsUrl = Boolean(config.calendar?.ics?.url?.trim());
    const hasIcsStoredPath = Boolean(
      config.calendar?.ics?.stored_path?.trim() || config.calendar?.ics_path?.trim()
    );

    if (isIcsActive && !hasIcsUrl && !hasIcsStoredPath) {
      setCalendarTestResult({
        ok: false,
        reason: "missing_ics_source",
        message: "Configura una URL ICS o sube un archivo antes de guardar.",
      });
      return;
    }

    setPanelRotatorSaving(true);
    try {
      // Guardar solo los campos que han cambiado (merge seguro)
      const calendarToSave: Partial<CalendarConfig> = {
        enabled: config.calendar?.enabled ?? false,
        source: normalizedCalendarSource,
      };
      
      if (calendarToSave.source === "ics" && config.calendar?.ics) {
        calendarToSave.ics = {
          max_events: config.calendar.ics.max_events ?? 50,
          days_ahead: config.calendar.ics.days_ahead ?? 14,
        };
      }
      
      // Solo incluir google si existe y tiene cambios
      if (calendarToSave.source === "google" && config.calendar?.google) {
        calendarToSave.google = {
          api_key: config.calendar.google.api_key || undefined,
          calendar_id: config.calendar.google.calendar_id || undefined,
        };
      }
      
      await saveCalendarConfig(calendarToSave);
      
      // Recargar config
      const loadedConfig = await getConfigV2();
      setConfig(withConfigDefaultsV2(loadedConfig));
      dispatchConfigSaved();
    } catch (error) {
      console.error("Error saving calendar config:", error);
      alert("Error al guardar la configuración del calendario");
    } finally {
      setPanelRotatorSaving(false);
    }
  };

  const handleSavePanelRotator = async () => {
    if (!config) return;
    
    setPanelRotatorSaving(true);
    try {
      const panelsPayload = sanitizePanelsPayload();
      if (panelsPayload) {
        await saveConfigGroup("panels", panelsPayload);
      }

      const rotationPayload = sanitizeRotationPayload();
      await saveConfigGroup("ui", { rotation: rotationPayload });
      
      alert("Configuración del Panel Rotativo guardada correctamente");

      const loadedConfig = await getConfigV2();
      setConfig(withConfigDefaultsV2(loadedConfig));
      dispatchConfigSaved();
      dispatchRotationRestart();
    } catch (error) {
      console.error("Error saving panel rotator:", error);
      alert("Error al guardar la configuración");
    } finally {
      setPanelRotatorSaving(false);
    }
  };

  const rawRotationConfig = config?.ui?.rotation;
  const rotationPanels = useMemo(
    () => sanitizeRotationPanels(rawRotationConfig?.panels ?? DEFAULT_UI_ROTATION_CONFIG.panels),
    [rawRotationConfig?.panels]
  );
  const rotationConfig: UIRotationConfigV2 = useMemo(
    () => ({
      ...DEFAULT_UI_ROTATION_CONFIG,
      ...(rawRotationConfig ?? {}),
      panels: rotationPanels,
    }),
    [rawRotationConfig, rotationPanels]
  );
  const availableRotationPanels = useMemo(
    () => ROTATION_PANEL_OPTIONS.filter(({ id }) => !rotationPanels.includes(id)),
    [rotationPanels]
  );

  if (loading || !config) {
    return (
      <div className="config-page">
        <div className="config-page__container">
          <p>Cargando configuración...</p>
        </div>
      </div>
    );
  }

  const calendarSource = config.calendar?.source || config.calendar?.provider;
  const normalizedCalendarSource = calendarSource === "ics" ? "ics" : "google";
  const calendarIsICS = Boolean(config.calendar?.enabled) && normalizedCalendarSource === "ics";
  const calendarHasIcsUrl = Boolean(config.calendar?.ics?.url?.trim());
  const calendarHasIcsStoredPath = Boolean(
    config.calendar?.ics?.stored_path?.trim() || config.calendar?.ics_path?.trim()
  );
  const calendarSaveBlocked = calendarIsICS && !calendarHasIcsUrl && !calendarHasIcsStoredPath;
  const calendarSaveBlockedReason = calendarSaveBlocked
    ? "Configura una URL o ruta ICS antes de guardar."
    : undefined;

  return (
    <div className="config-page">
      <div className="config-page__container">
        <div className="config-page__header">
          <h1>Configuración</h1>
          <p>Gestiona la configuración del sistema</p>
        </div>

        {/* ============================================
            BLOQUE 1: Maps and Layers
            ============================================ */}
        <div style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.8rem", marginBottom: "20px", borderBottom: "2px solid rgba(104, 162, 255, 0.3)", paddingBottom: "8px" }}>
            Mapas y Capas
          </h2>
          
        {/* Tarjeta: Radar global (RainViewer) */}
        <div className="config-card">
          <h2>Radar Global (RainViewer)</h2>
          
          <div className="config-form-fields">
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.layers?.global?.radar?.enabled || config.layers?.global_?.radar?.enabled || false}
                  onChange={(e) => {
                    const currentLayers = config.layers ?? {};
                    const currentGlobal = currentLayers.global ?? currentLayers.global_ ?? {};
                    setConfig({
                      ...config,
                      layers: {
                        ...currentLayers,
                        global: {
                          ...currentGlobal,
                          radar: {
                            ...currentGlobal.radar,
                            enabled: e.target.checked,
                            provider: "rainviewer",
                            opacity: currentGlobal.radar?.opacity ?? 0.7,
                            layer_type: currentGlobal.radar?.layer_type ?? "precipitation_new",
                          },
                        },
                      },
                    });
                  }}
                />
                Habilitar Radar
              </label>
            </div>
            
            {(config.layers?.global?.radar?.enabled || config.layers?.global_?.radar?.enabled) && (
              <>
                <div className="config-field">
                  <label>Proveedor</label>
                  <select value="rainviewer" disabled>
                    <option value="rainviewer">RainViewer v4</option>
                  </select>
                  <div className="config-field__hint">
                    RainViewer proporciona datos globales de radar sin necesidad de API key
                  </div>
                </div>
                
                <div className="config-field">
                  <label>
                    Opacidad: {((config.layers?.global?.radar?.opacity ?? config.layers?.global_?.radar?.opacity ?? 0.7) * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={((config.layers?.global?.radar?.opacity ?? config.layers?.global_?.radar?.opacity ?? 0.7) * 100)}
                    onChange={(e) => {
                      const currentLayers = config.layers ?? {};
                      const currentGlobal = currentLayers.global ?? currentLayers.global_ ?? {};
                      const newOpacity = parseFloat(e.target.value) / 100;
                      setConfig({
                        ...config,
                        layers: {
                          ...currentLayers,
                          global: {
                            ...currentGlobal,
                            radar: {
                              ...currentGlobal.radar,
                              enabled: currentGlobal.radar?.enabled ?? true,
                              provider: "rainviewer",
                              opacity: newOpacity,
                              layer_type: currentGlobal.radar?.layer_type ?? "precipitation_new",
                            },
                          },
                        },
                      });
                    }}
                  />
                  <div className="config-field__hint">
                    Ajusta la opacidad de la capa de radar (0-100%)
                  </div>
                </div>
                
                <div className="config-field">
                  <label>Tipo de Capa</label>
                  <select
                    value={config.layers?.global?.radar?.layer_type ?? config.layers?.global_?.radar?.layer_type ?? "precipitation_new"}
                    onChange={(e) => {
                      const currentLayers = config.layers ?? {};
                      const currentGlobal = currentLayers.global ?? currentLayers.global_ ?? {};
                      setConfig({
                        ...config,
                        layers: {
                          ...currentLayers,
                          global: {
                            ...currentGlobal,
                            radar: {
                              ...currentGlobal.radar,
                              enabled: currentGlobal.radar?.enabled ?? true,
                              provider: "rainviewer",
                              opacity: currentGlobal.radar?.opacity ?? 0.7,
                              layer_type: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                  >
                    <option value="precipitation_new">Precipitación (nuevo)</option>
                    <option value="precipitation">Precipitación (legacy)</option>
                  </select>
                  <div className="config-field__hint">
                    Tipo de datos de radar a mostrar
                  </div>
                </div>
                
                <div className="config-field__actions">
                  <button
                    className="config-button primary"
                    onClick={handleTestRainViewer}
                    disabled={rainviewerTesting}
                  >
                    {rainviewerTesting ? "Probando..." : "Probar RainViewer"}
                  </button>
                  <button
                    className="config-button"
                    onClick={handleViewRainViewerTile}
                    disabled={rainviewerLoadingTile}
                  >
                    {rainviewerLoadingTile ? "Cargando..." : "Ver Tile de Ejemplo"}
                  </button>
                </div>
                
                {rainviewerTestResult && (
                  <div
                    className={`config-field__hint ${
                      rainviewerTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                    }`}
                  >
                    {rainviewerTestResult.ok ? (
                      <>
                        ✓ RainViewer funcionando correctamente
                        {rainviewerTestResult.status && (
                          <span className="config-badge" style={{ marginLeft: "8px" }}>
                            HTTP {rainviewerTestResult.status}
                          </span>
                        )}
                        {rainviewerTestResult.test_tile && (
                          <span className="config-badge" style={{ marginLeft: "8px" }}>
                            Tile: {rainviewerTestResult.test_tile}
                          </span>
                        )}
                      </>
                    ) : (
                      `✗ Error: ${rainviewerTestResult.message || rainviewerTestResult.error || rainviewerTestResult.reason || "Desconocido"}`
                    )}
                  </div>
                )}
                
                {rainviewerTilePreview && (
                  <div className="config-field" style={{ marginTop: "12px" }}>
                    <label>Vista Previa del Tile:</label>
                    <img
                      src={rainviewerTilePreview}
                      alt="RainViewer tile preview"
                      style={{ width: "64px", height: "64px", border: "1px solid rgba(104, 162, 255, 0.3)", borderRadius: "4px" }}
                    />
                    <div className="config-field__hint config-field__hint--success">PNG OK</div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="config-field__actions" style={{ marginTop: "16px" }}>
            <button
              className="config-button"
              onClick={handleSaveGlobalLayers}
              disabled={globalSaving}
            >
              {globalSaving ? "Guardando..." : "Guardar capas globales"}
            </button>
          </div>
        </div>

        {/* Tarjeta: Satélite global (GIBS) */}
        <div className="config-card">
          <h2>Satélite Global (GIBS)</h2>
          
          <div className="config-form-fields">
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.ui_global?.satellite?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      ui_global: {
                        ...config.ui_global,
                        satellite: {
                          enabled: e.target.checked,
                          provider: "gibs",
                          opacity: config.ui_global?.satellite?.opacity || 1.0,
                        },
                      },
                    });
                  }}
                />
                Habilitar Satélite
              </label>
            </div>
            
            {config.ui_global?.satellite?.enabled && (
              <>
                <div className="config-field">
                  <label>Proveedor</label>
                  <select value="gibs" disabled>
                    <option value="gibs">GIBS (NASA)</option>
                  </select>
                  <div className="config-field__hint">
                    GIBS proporciona imágenes de satélite globales de la NASA
                  </div>
                </div>
                
                <div className="config-field">
                  <label>Opacidad</label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={config.ui_global?.satellite?.opacity || 1.0}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        ui_global: {
                          ...config.ui_global,
                          satellite: {
                            enabled: config.ui_global?.satellite?.enabled || false,
                            provider: "gibs",
                            opacity: parseFloat(e.target.value) || 1.0,
                          },
                        },
                      });
                    }}
                  />
                </div>
                
                <div className="config-field__actions">
                  <button
                    className="config-button primary"
                    onClick={handleTestGIBS}
                    disabled={gibsTesting}
                  >
                    {gibsTesting ? "Probando..." : "Probar GIBS"}
                  </button>
                </div>
                
                {gibsTestResult && (
                  <div
                    className={`config-field__hint ${
                      gibsTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                    }`}
                  >
                    {gibsTestResult.ok ? (
                      <>
                        ✓ GIBS funcionando correctamente
                        {gibsTilePreview && (
                          <span className="config-badge" style={{ marginLeft: "8px" }}>PNG OK</span>
                        )}
                      </>
                    ) : (
                      `✗ Error: ${gibsTestResult.reason || "Desconocido"}`
                    )}
                  </div>
                )}
                
                {gibsTilePreview && (
                  <div className="config-field" style={{ marginTop: "12px" }}>
                    <label>Vista Previa del Tile:</label>
                    <img
                      src={gibsTilePreview}
                      alt="GIBS tile preview"
                      style={{ width: "64px", height: "64px", border: "1px solid rgba(104, 162, 255, 0.3)", borderRadius: "4px" }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Tarjeta: Fuentes AEMET (Opcional/Avanzado) */}
        <div className="config-card">
          <h2>Fuentes AEMET (Avanzado)</h2>
          <p className="config-field__hint" style={{ marginBottom: "16px" }}>
            Nota: AEMET ya no alimenta el radar global. Se usará en futuras capas (avisos CAP, radar ES, sat ES) si se reactiva.
          </p>
          
          <div className="config-form-fields">
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={(config as any).aemet?.enabled || false}
                  onChange={async (e) => {
                    const newConfig = {
                      ...config,
                      aemet: {
                        ...(config as any).aemet,
                        enabled: e.target.checked,
                      } as any,
                    };
                    setConfig(newConfig as AppConfigV2);
                    // Guardar inmediatamente
                    try {
                      await saveConfigV2(newConfig as AppConfigV2);
                    } catch (error) {
                      console.error("Error saving AEMET enabled:", error);
                    }
                  }}
                />
                Habilitar AEMET
              </label>
            </div>
            
            <div className="config-field">
              <label>AEMET API Key</label>
              <div className="config-field__secret">
                <input
                  type="text"
                  value={aemetApiKey}
                  onChange={(e) => {
                    const newKey = e.target.value || null;
                    setAemetApiKey(newKey || "");
                    // Guardar en secrets cuando se escribe
                    handleUpdateAemetApiKey(newKey);
                  }}
                  placeholder="API Key de AEMET"
                  style={{
                    borderColor: aemetTestResult && !aemetTestResult.ok && aemetTestResult.reason === "missing_api_key" 
                      ? "rgba(255, 82, 82, 0.5)" 
                      : undefined
                  }}
                />
                <button
                  className="config-button"
                  onClick={handleTestAemet}
                  disabled={aemetTesting}
                >
                  {aemetTesting ? "Probando..." : "Probar AEMET"}
                </button>
              </div>
              {aemetTestResult && (
                <div
                  className={`config-field__hint ${
                    aemetTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                  }`}
                >
                  {aemetTestResult.ok
                    ? "✓ API Key válida"
                    : `✗ Error: ${aemetTestResult.reason || "Desconocido"}`}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tarjeta: Rayos (Blitzortung) */}
        <div className="config-card">
          <h2>Rayos (Blitzortung)</h2>
          
          <div className="config-form-fields">
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={(config as any).blitzortung?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      blitzortung: {
                        ...(config as any).blitzortung,
                        enabled: e.target.checked,
                      } as any,
                    } as AppConfigV2);
                  }}
                />
                Habilitar Rayos
              </label>
            </div>
            
            {(config as any).blitzortung?.enabled && (
              <>
                {/* Configuración MQTT */}
                <div className="config-field">
                  <label>MQTT Host</label>
                  <input
                    type="text"
                    value={(config as any).blitzortung?.mqtt_host || "127.0.0.1"}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        blitzortung: {
                          ...(config as any).blitzortung,
                          mqtt_host: e.target.value || "127.0.0.1",
                        } as any,
                      } as AppConfigV2);
                    }}
                    placeholder="127.0.0.1"
                  />
                </div>
                
                <div className="config-field">
                  <label>MQTT Puerto</label>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={(config as any).blitzortung?.mqtt_port || 1883}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        blitzortung: {
                          ...(config as any).blitzortung,
                          mqtt_port: parseInt(e.target.value) || 1883,
                        } as any,
                      } as AppConfigV2);
                    }}
                  />
                </div>
                
                <div className="config-field">
                  <label>MQTT Topic</label>
                  <input
                    type="text"
                    value={(config as any).blitzortung?.mqtt_topic || "blitzortung/1"}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        blitzortung: {
                          ...(config as any).blitzortung,
                          mqtt_topic: e.target.value || "blitzortung/1",
                        } as any,
                      } as AppConfigV2);
                    }}
                    placeholder="blitzortung/1"
                  />
                </div>
                
                <div className="config-field__actions">
                  <button
                    className="config-button primary"
                    onClick={handleTestLightningMqtt}
                    disabled={lightningMqttTesting}
                  >
                    {lightningMqttTesting ? "Probando..." : "Probar MQTT"}
                  </button>
                </div>
                
                {lightningMqttTestResult && (
                  <div
                    className={`config-field__hint ${
                      lightningMqttTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                    }`}
                  >
                    {lightningMqttTestResult.ok ? (
                      <>
                        ✓ MQTT conectado correctamente
                        {lightningMqttTestResult.received !== undefined && (
                          <span className="config-badge" style={{ marginLeft: "8px" }}>
                            {lightningMqttTestResult.received} mensajes recibidos
                          </span>
                        )}
                        {lightningMqttTestResult.latency_ms !== undefined && (
                          <span className="config-badge" style={{ marginLeft: "8px" }}>
                            {lightningMqttTestResult.latency_ms}ms latencia
                          </span>
                        )}
                      </>
                    ) : (
                      `✗ Error: ${lightningMqttTestResult.error || "Desconocido"}`
                    )}
                  </div>
                )}
                
                {/* Configuración WebSocket (opcional) */}
                <div className="config-field">
                  <label>
                    <input
                      type="checkbox"
                      checked={(config as any).blitzortung?.ws_enabled || false}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          blitzortung: {
                            ...(config as any).blitzortung,
                            ws_enabled: e.target.checked,
                          } as any,
                        } as AppConfigV2);
                      }}
                    />
                    Habilitar WebSocket
                  </label>
                </div>
                
                {(config as any).blitzortung?.ws_enabled && (
                  <>
                    <div className="config-field">
                      <label>WebSocket URL</label>
                      <input
                        type="text"
                        value={(config as any).blitzortung?.ws_url || ""}
                        onChange={(e) => {
                          setConfig({
                            ...config,
                            blitzortung: {
                              ...(config as any).blitzortung,
                              ws_url: e.target.value || null,
                            } as any,
                          } as AppConfigV2);
                        }}
                        placeholder="wss://example.com/ws"
                      />
                    </div>
                    
                    <div className="config-field__actions">
                      <button
                        className="config-button primary"
                        onClick={handleTestLightningWs}
                        disabled={lightningWsTesting}
                      >
                        {lightningWsTesting ? "Probando..." : "Probar WebSocket"}
                      </button>
                    </div>
                    
                    {lightningWsTestResult && (
                      <div
                        className={`config-field__hint ${
                          lightningWsTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                        }`}
                      >
                        {lightningWsTestResult.ok
                          ? "✓ WebSocket conectado correctamente"
                          : `✗ Error: ${lightningWsTestResult.error || "Desconocido"}`}
                      </div>
                    )}
                  </>
                )}
                
                {/* Buffer y TTL */}
                <div className="config-field">
                  <label>Buffer Máximo (eventos)</label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={(config as any).blitzortung?.buffer_max || 500}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        blitzortung: {
                          ...(config as any).blitzortung,
                          buffer_max: parseInt(e.target.value) || 500,
                        } as any,
                      } as AppConfigV2);
                    }}
                  />
                  <div className="config-field__hint">Máximo número de eventos en memoria</div>
                </div>
                
                <div className="config-field">
                  <label>TTL de Eventos (segundos)</label>
                  <input
                    type="number"
                    min="60"
                    max="3600"
                    value={(config as any).blitzortung?.prune_seconds || 900}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        blitzortung: {
                          ...(config as any).blitzortung,
                          prune_seconds: parseInt(e.target.value) || 900,
                        } as any,
                      } as AppConfigV2);
                    }}
                  />
                  <div className="config-field__hint">Tiempo de vida de eventos en segundos (900 = 15 minutos)</div>
                </div>
                
                {/* Modo Tormenta */}
                <div className="config-field" style={{ marginTop: "24px", borderTop: "1px solid rgba(104, 162, 255, 0.2)", paddingTop: "16px" }}>
                  <h3 style={{ marginBottom: "12px" }}>Modo Tormenta</h3>
                  
                  <div className="config-field">
                    <label>
                      <input
                        type="checkbox"
                        checked={(config as any).storm?.enabled || false}
                        onChange={(e) => {
                          setConfig({
                            ...config,
                            storm: {
                              ...(config as any).storm,
                              enabled: e.target.checked,
                            } as any,
                          } as AppConfigV2);
                        }}
                      />
                      Habilitar Modo Tormenta
                    </label>
                  </div>
                  
                  {(config as any).storm?.enabled && (
                    <>
                      <div className="config-field">
                        <label>Centro Latitud</label>
                        <input
                          type="number"
                          step="0.0001"
                          value={(config as any).storm?.center_lat || 39.986}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              storm: {
                                ...(config as any).storm,
                                center_lat: parseFloat(e.target.value) || 39.986,
                              } as any,
                            } as AppConfigV2);
                          }}
                        />
                      </div>
                      
                      <div className="config-field">
                        <label>Centro Longitud</label>
                        <input
                          type="number"
                          step="0.0001"
                          value={(config as any).storm?.center_lng || -0.051}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              storm: {
                                ...(config as any).storm,
                                center_lng: parseFloat(e.target.value) || -0.051,
                              } as any,
                            } as AppConfigV2);
                          }}
                        />
                      </div>
                      
                      <div className="config-field">
                        <label>Zoom</label>
                        <input
                          type="number"
                          step="0.1"
                          min="1"
                          max="20"
                          value={(config as any).storm?.zoom || 9.0}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              storm: {
                                ...(config as any).storm,
                                zoom: parseFloat(e.target.value) || 9.0,
                              } as any,
                            } as AppConfigV2);
                          }}
                        />
                      </div>
                      
                      <div className="config-field">
                        <label>
                          <input
                            type="checkbox"
                            checked={(config as any).storm?.auto_enable || false}
                            onChange={(e) => {
                              setConfig({
                                ...config,
                                storm: {
                                  ...(config as any).storm,
                                  auto_enable: e.target.checked,
                                } as any,
                              } as AppConfigV2);
                            }}
                          />
                          Auto-enable cuando hay rayos cerca
                        </label>
                      </div>
                      
                      {(config as any).storm?.auto_enable && (
                        <>
                          <div className="config-field">
                            <label>Radio para Auto-enable (km)</label>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              max="500"
                              value={(config as any).storm?.radius_km || 30}
                              onChange={(e) => {
                                setConfig({
                                  ...config,
                                  storm: {
                                    ...(config as any).storm,
                                    radius_km: parseFloat(e.target.value) || 30,
                                  } as any,
                                } as AppConfigV2);
                              }}
                            />
                          </div>
                          
                          <div className="config-field">
                            <label>Auto-desactivar después de (minutos)</label>
                            <input
                              type="number"
                              step="1"
                              min="5"
                              max="1440"
                              value={(config as any).storm?.auto_disable_after_minutes || 60}
                              onChange={(e) => {
                                setConfig({
                                  ...config,
                                  storm: {
                                    ...(config as any).storm,
                                    auto_disable_after_minutes: parseInt(e.target.value) || 60,
                                  } as any,
                                } as AppConfigV2);
                              }}
                            />
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
                
                {/* Botón Estado */}
                <div className="config-field__actions" style={{ marginTop: "24px" }}>
                  <button
                    className="config-button"
                    onClick={handleGetLightningStatus}
                    disabled={lightningStatusLoading}
                  >
                    {lightningStatusLoading ? "Cargando..." : "Ver Estado"}
                  </button>
                </div>
                
                {lightningStatusData && (
                  <div className="config-status" style={{ marginTop: "12px" }}>
                    <p>
                      Estado: {lightningStatusData.connected ? "Conectado" : "Desconectado"}
                      <span className="config-badge" style={{ marginLeft: "8px" }}>
                        {lightningStatusData.source || "none"}
                      </span>
                    </p>
                    {lightningStatusData.buffer_size !== undefined && (
                      <p>Buffer: {lightningStatusData.buffer_size} eventos</p>
                    )}
                    {lightningStatusData.last_event_age_sec !== null && (
                      <p>Último evento: hace {lightningStatusData.last_event_age_sec} segundos</p>
                    )}
                    {lightningStatusData.rate_per_min !== undefined && (
                      <p>Tasa: {lightningStatusData.rate_per_min} eventos/minuto</p>
                    )}
                    {lightningStatusData.auto_enable?.active && (
                      <div className="config-badge config-badge--success" style={{ marginTop: "8px" }}>
                        Auto-enable activo (radio: {lightningStatusData.auto_enable.radius_km} km)
                        {lightningStatusData.auto_enable.will_disable_in_min !== null && (
                          <span style={{ marginLeft: "8px" }}>
                            (se desactivará en {lightningStatusData.auto_enable.will_disable_in_min} min)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          
          <div className="config-actions" style={{ marginTop: "24px" }}>
            <button
              className="config-button primary"
              onClick={handleSaveLightning}
              disabled={lightningSaving}
            >
              {lightningSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>

        {/* Tarjeta: Configuración del Mapa y Capas */}
        <div className="config-card">
          <h2>Mapas y Capas</h2>

          <div className="config-form-fields">
            {/* Configuración del Mapa */}
            <div className="config-field">
              <label>Proveedor del Mapa</label>
              <select
                value={config.ui_map.provider}
                onChange={(e) => {
                  const nextProvider = e.target.value as typeof config.ui_map.provider;
                  const nextUiMap = {
                    ...config.ui_map,
                    provider: nextProvider,
                  } as AppConfigV2["ui_map"];

                  if (nextProvider === "maptiler_vector") {
                    const resolvedStyleUrl =
                      config.ui_map.maptiler?.styleUrl ??
                      DEFAULT_MAP_CONFIG.maptiler?.styleUrl ??
                      DEFAULT_STREETS_STYLE_URL;
                    const resolvedKey =
                      config.ui_map.maptiler?.api_key ??
                      config.ui_map.maptiler?.apiKey ??
                      config.ui_map.maptiler?.key ??
                      null;
                    nextUiMap.maptiler = {
                      api_key: resolvedKey,
                      apiKey: resolvedKey,
                      key: config.ui_map.maptiler?.key ?? resolvedKey,
                      style: config.ui_map.maptiler?.style ?? DEFAULT_MAP_CONFIG.maptiler?.style ?? "vector-bright",
                      styleUrl: resolvedStyleUrl,
                      styleUrlDark: config.ui_map.maptiler?.styleUrlDark ?? null,
                      styleUrlLight: config.ui_map.maptiler?.styleUrlLight ?? null,
                      styleUrlBright: config.ui_map.maptiler?.styleUrlBright ?? null,
                      urls: config.ui_map.maptiler?.urls ?? undefined,
                    };
                  } else if (nextProvider === "local_raster_xyz") {
                    nextUiMap.local = {
                      tileUrl: config.ui_map.local?.tileUrl || DEFAULT_LOCAL_RASTER_CONFIG.tileUrl,
                      minzoom: config.ui_map.local?.minzoom ?? DEFAULT_LOCAL_RASTER_CONFIG.minzoom,
                      maxzoom: config.ui_map.local?.maxzoom ?? DEFAULT_LOCAL_RASTER_CONFIG.maxzoom,
                    };
                  } else if (nextProvider === "custom_xyz") {
                    nextUiMap.customXyz = {
                      tileUrl: config.ui_map.customXyz?.tileUrl ?? null,
                      minzoom: config.ui_map.customXyz?.minzoom ?? 0,
                      maxzoom: config.ui_map.customXyz?.maxzoom ?? 19,
                    };
                  }

                  setConfig({
                    ...config,
                    ui_map: nextUiMap,
                  });
                }}
              >
                <option value="local_raster_xyz">XYZ Local</option>
                <option value="maptiler_vector">MapTiler Vector</option>
                <option value="custom_xyz">XYZ Personalizado</option>
              </select>
            </div>

            {config.ui_map.provider === "maptiler_vector" && (
              <>
                <div className="config-field">
                  <label>MapTiler API Key</label>
                  <input
                    type="text"
                    value={config.ui_map.maptiler?.api_key || ""}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        ui_map: {
                          ...config.ui_map,
                          maptiler: {
                            ...config.ui_map.maptiler,
                            api_key: e.target.value || null,
                            apiKey: e.target.value || null,
                            key: e.target.value || null,
                            styleUrl: config.ui_map.maptiler?.styleUrl || null,
                          },
                        },
                      });
                    }}
                    placeholder="API Key de MapTiler"
                  />
                </div>
                
                <div className="config-field">
                  <label>Style URL (Dark)</label>
                  <input
                    type="text"
                    value={config.ui_map.maptiler?.styleUrl || ""}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        ui_map: {
                          ...config.ui_map,
                          maptiler: {
                            ...config.ui_map.maptiler,
                            api_key: config.ui_map.maptiler?.api_key ?? null,
                            apiKey: config.ui_map.maptiler?.api_key ?? null,
                            styleUrl: e.target.value || null,
                          },
                        },
                      });
                    }}
                    placeholder={DEFAULT_STREETS_STYLE_URL}
                  />
                </div>
                
                <div className="config-field__actions">
                  <button
                    className="config-button primary"
                    onClick={handleTestMapTiler}
                    disabled={maptilerTesting}
                  >
                    {maptilerTesting ? "Probando..." : "Probar MapTiler"}
                  </button>
                </div>
                
                {maptilerTestResult && (
                  <div
                    className={`config-field__hint ${
                      maptilerTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                    }`}
                  >
                    {maptilerTestResult.ok ? (
                      <>
                        ✓ MapTiler funcionando correctamente
                        {maptilerTestResult.bytes !== undefined && (
                          <span className="config-badge" style={{ marginLeft: "8px" }}>
                            {maptilerTestResult.bytes} bytes
                          </span>
                        )}
                      </>
                    ) : (
                      `✗ Error: ${maptilerTestResult.error || "Desconocido"}`
                    )}
                  </div>
                )}
              </>
            )}

            <div className="config-field">
              <h3>Mapa satélite híbrido</h3>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={config.ui_map.satellite?.enabled ?? false}
                  onChange={(e) => {
                    const satelliteConfig = config.ui_map.satellite ?? DEFAULT_MAP_CONFIG.satellite!;
                    setConfig({
                      ...config,
                      ui_map: {
                        ...config.ui_map,
                        satellite: {
                          ...satelliteConfig,
                          enabled: e.target.checked,
                        },
                      },
                    });
                  }}
                />
                Activar modo satélite híbrido
              </label>
            </div>

            {config.ui_map.satellite?.enabled && (
              <>
                <div className="config-field">
                  <label>
                    Opacidad ({config.ui_map.satellite?.opacity ?? 0.85})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.ui_map.satellite?.opacity ?? 0.85}
                    onChange={(e) => {
                      const satelliteConfig = config.ui_map.satellite ?? DEFAULT_MAP_CONFIG.satellite!;
                      setConfig({
                        ...config,
                        ui_map: {
                          ...config.ui_map,
                          satellite: {
                            ...satelliteConfig,
                            opacity: parseFloat(e.target.value),
                          },
                        },
                      });
                    }}
                  />
                </div>

                <div className="config-field">
                  <label>URL del estilo satélite</label>
                  <input
                    type="text"
                    value={config.ui_map.satellite?.style_url || ""}
                    onChange={(e) => {
                      const satelliteConfig = config.ui_map.satellite ?? DEFAULT_MAP_CONFIG.satellite!;
                      setConfig({
                        ...config,
                        ui_map: {
                          ...config.ui_map,
                          satellite: {
                            ...satelliteConfig,
                            style_url: e.target.value || undefined,
                          },
                        },
                      });
                    }}
                    placeholder="https://api.maptiler.com/maps/satellite/style.json"
                  />
                  <div className="config-field__hint">
                    URL del estilo MapTiler para obtener los tiles satélite. Ejemplo: https://api.maptiler.com/maps/satellite/style.json?key=TU_API_KEY
                  </div>
                </div>

                <div className="config-field">
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="checkbox"
                      checked={(() => {
                        const overlay = config.ui_map.satellite?.labels_overlay;
                        if (typeof overlay === "object" && overlay !== null && !Array.isArray(overlay) && "enabled" in overlay) {
                          return overlay.enabled ?? true;
                        }
                        return typeof overlay === "boolean" ? overlay : true;
                      })()}
                      onChange={(e) => {
                        const satelliteConfig = config.ui_map.satellite ?? DEFAULT_MAP_CONFIG.satellite!;
                        const currentOverlay = satelliteConfig.labels_overlay;
                        const currentLabelsOverlay = typeof currentOverlay === "object" && currentOverlay !== null && !Array.isArray(currentOverlay) && "enabled" in currentOverlay
                          ? currentOverlay
                          : { enabled: true, style_url: null, layer_filter: null };
                        setConfig({
                          ...config,
                          ui_map: {
                            ...config.ui_map,
                            satellite: {
                              ...satelliteConfig,
                              labels_overlay: {
                                ...currentLabelsOverlay,
                                enabled: e.target.checked,
                              } as typeof currentLabelsOverlay,
                            },
                          },
                        });
                      }}
                    />
                    Mostrar etiquetas vectoriales
                  </label>
                </div>

                <div className="config-field">
                  <label>URL de estilo etiquetas</label>
                  <input
                    type="text"
                    value={(() => {
                      const overlay = config.ui_map.satellite?.labels_overlay;
                      if (typeof overlay === "object" && overlay !== null && !Array.isArray(overlay) && "style_url" in overlay) {
                        return overlay.style_url || "";
                      }
                      return config.ui_map.satellite?.labels_style_url || "";
                    })()}
                    onChange={(e) => {
                      const satelliteConfig = config.ui_map.satellite ?? DEFAULT_MAP_CONFIG.satellite!;
                      const currentOverlay = satelliteConfig.labels_overlay;
                      const currentLabelsOverlay = typeof currentOverlay === "object" && currentOverlay !== null && !Array.isArray(currentOverlay) && "enabled" in currentOverlay
                        ? currentOverlay
                        : { enabled: true, style_url: null, layer_filter: null };
                      setConfig({
                        ...config,
                        ui_map: {
                          ...config.ui_map,
                          satellite: {
                            ...satelliteConfig,
                            labels_overlay: {
                              ...currentLabelsOverlay,
                              style_url: e.target.value || null,
                            } as typeof currentLabelsOverlay,
                            // Mantener compatibilidad con legacy
                            labels_style_url: e.target.value || undefined,
                          },
                        },
                      });
                    }}
                    placeholder="https://api.maptiler.com/maps/streets-v4/style.json"
                  />
                </div>

                <div className="config-field">
                  <label>Filtro de capas (JSON opcional)</label>
                  <input
                    type="text"
                    value={(() => {
                      const overlay = config.ui_map.satellite?.labels_overlay;
                      if (typeof overlay === "object" && overlay !== null && !Array.isArray(overlay) && "layer_filter" in overlay) {
                        return overlay.layer_filter || "";
                      }
                      return "";
                    })()}
                    onChange={(e) => {
                      const satelliteConfig = config.ui_map.satellite ?? DEFAULT_MAP_CONFIG.satellite!;
                      const currentOverlay = satelliteConfig.labels_overlay;
                      const currentLabelsOverlay = typeof currentOverlay === "object" && currentOverlay !== null && !Array.isArray(currentOverlay) && "enabled" in currentOverlay
                        ? currentOverlay
                        : { enabled: true, style_url: null, layer_filter: null };
                      setConfig({
                        ...config,
                        ui_map: {
                          ...config.ui_map,
                          satellite: {
                            ...satelliteConfig,
                            labels_overlay: {
                              ...currentLabelsOverlay,
                              layer_filter: e.target.value || null,
                            } as typeof currentLabelsOverlay,
                          },
                        },
                      });
                    }}
                    placeholder='["==", ["get", "layer"], "poi_label"]'
                  />
                </div>
              </>
            )}

            {(config.ui_map.provider === "local_raster_xyz" || config.ui_map.provider === "custom_xyz") && (
              <>
                {config.ui_map.provider === "local_raster_xyz" && (
                  <div className="config-field">
                    <label>URL de Tiles Local</label>
                    <input
                      type="text"
                      value={config.ui_map.local?.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          ui_map: {
                            ...config.ui_map,
                            local: {
                              ...config.ui_map.local,
                              tileUrl: e.target.value || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                              minzoom: config.ui_map.local?.minzoom || 0,
                              maxzoom: config.ui_map.local?.maxzoom || 19,
                            },
                          },
                        });
                      }}
                      placeholder="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                  </div>
                )}
                
                {config.ui_map.provider === "custom_xyz" && (
                  <div className="config-field">
                    <label>URL de Tiles Personalizado</label>
                    <input
                      type="text"
                      value={config.ui_map.customXyz?.tileUrl || ""}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          ui_map: {
                            ...config.ui_map,
                            customXyz: {
                              ...config.ui_map.customXyz!,
                              tileUrl: e.target.value || null,
                            },
                          },
                        });
                      }}
                      placeholder="https://example.com/{z}/{x}/{y}.png"
                    />
                  </div>
                )}
                
                <div className="config-field__actions">
                  <button
                    className="config-button primary"
                    onClick={handleTestXyz}
                    disabled={xyzTesting}
                  >
                    {xyzTesting ? "Probando..." : "Probar XYZ"}
                  </button>
                </div>
                
                {xyzTestResult && (
                  <div
                    className={`config-field__hint ${
                      xyzTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                    }`}
                  >
                    {xyzTestResult.ok ? (
                      <>
                        ✓ XYZ funcionando correctamente
                        {xyzTestResult.bytes !== undefined && (
                          <span className="config-badge" style={{ marginLeft: "8px" }}>
                            {xyzTestResult.bytes} bytes
                          </span>
                        )}
                        {xyzTestResult.contentType && (
                          <span className="config-badge" style={{ marginLeft: "8px" }}>
                            {xyzTestResult.contentType}
                          </span>
                        )}
                      </>
                    ) : (
                      `✗ Error: ${xyzTestResult.error || "Desconocido"}`
                    )}
                  </div>
                )}
              </>
            )}

            <div className="config-field__actions" style={{ marginTop: "16px" }}>
              <button
                className="config-button primary"
                onClick={handleSaveMap}
                disabled={mapSaving}
              >
                {mapSaving ? "Guardando..." : "Guardar mapa"}
              </button>
            </div>

            {/* Capa Vuelos */}
            <div className="config-field" style={{ marginTop: "24px", borderTop: "1px solid rgba(104, 162, 255, 0.2)", paddingTop: "16px" }}>
              <h3 style={{ marginBottom: "12px" }}>Vuelos</h3>
              <label>
                <input
                  type="checkbox"
                  checked={config.layers?.flights?.enabled || false}
                  onChange={(e) => {
                    const currentFlights = config.layers?.flights;
                    setConfig({
                      ...config,
                      layers: {
                        ...config.layers,
                        flights: {
                          enabled: e.target.checked,
                          provider: currentFlights?.provider || "opensky",
                          refresh_seconds: currentFlights?.refresh_seconds || 12,
                          max_age_seconds: currentFlights?.max_age_seconds || 120,
                          max_items_global: currentFlights?.max_items_global || 2000,
                          max_items_view: currentFlights?.max_items_view || 1500,
                          rate_limit_per_min: currentFlights?.rate_limit_per_min || 6,
                          decimate: currentFlights?.decimate || "none",
                          grid_px: currentFlights?.grid_px || 24,
                          styleScale: currentFlights?.styleScale || 3.2,
                          render_mode: currentFlights?.render_mode || "circle",
                          opensky: currentFlights?.opensky || {
                            mode: "oauth2",
                            bbox: { lamin: 39.5, lamax: 41.0, lomin: -1.0, lomax: 1.5 },
                            extended: 0
                          },
                          aviationstack: currentFlights?.aviationstack || {
                            base_url: "http://api.aviationstack.com/v1"
                          },
                          custom: currentFlights?.custom || {
                            api_url: null,
                            api_key: null
                          }
                        },
                      },
                    });
                  }}
                />
                Habilitar Capa de Vuelos
              </label>
              
              {config.layers?.flights?.enabled && (
                <div style={{ marginLeft: "24px", marginTop: "12px" }}>
                  <div className="config-field" style={{ marginBottom: "16px" }}>
                    <h4>Servicio OpenSky (backend)</h4>
                    <label>
                      <input
                        type="checkbox"
                        checked={config.opensky?.enabled ?? false}
                        onChange={(e) => {
                          if (!config) return;
                          setConfig({
                            ...config,
                            opensky: {
                              ...config.opensky,
                              enabled: e.target.checked,
                            } as OpenSkyConfigV2,
                          });
                        }}
                      />
                      Habilitar descargas desde OpenSky
                    </label>

                    <div className="config-field" style={{ marginTop: "12px" }}>
                      <label>Modo</label>
                      <select
                        value={config.opensky?.mode ?? DEFAULT_OPENSKY_CONFIG.mode}
                        onChange={(e) => {
                          if (!config) return;
                          setConfig({
                            ...config,
                            opensky: {
                              ...config.opensky,
                              mode: e.target.value as OpenSkyConfigV2["mode"],
                            } as OpenSkyConfigV2,
                          });
                        }}
                      >
                        <option value="bbox">BBox (área limitada)</option>
                        <option value="global">Global</option>
                      </select>
                    </div>

                    <div className="config-field">
                      <label>Intervalo de sondeo (segundos)</label>
                      <input
                        type="number"
                        min={5}
                        max={300}
                        value={config.opensky?.poll_seconds ?? DEFAULT_OPENSKY_CONFIG.poll_seconds}
                        onChange={(e) => {
                          if (!config) return;
                          const value = Math.max(5, Math.min(300, Number(e.target.value) || DEFAULT_OPENSKY_CONFIG.poll_seconds));
                          setConfig({
                            ...config,
                            opensky: {
                              ...config.opensky,
                              poll_seconds: value,
                            } as OpenSkyConfigV2,
                          });
                        }}
                      />
                    </div>

                    {config.opensky?.mode === "bbox" && (
                      <div className="config-field">
                        <label>BBox (lat/lon)</label>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                          <input
                            type="number"
                            step="0.01"
                            value={config.opensky?.bbox?.lamin ?? DEFAULT_OPENSKY_CONFIG.bbox.lamin}
                            onChange={(e) => {
                              if (!config) return;
                              const next = {
                                ...(config.opensky?.bbox ?? {}),
                                lamin: Number(e.target.value),
                              };
                              setConfig({
                                ...config,
                                opensky: {
                                  ...config.opensky,
                                  bbox: next,
                                } as OpenSkyConfigV2,
                              });
                            }}
                            placeholder="Latitud mínima"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={config.opensky?.bbox?.lamax ?? DEFAULT_OPENSKY_CONFIG.bbox.lamax}
                            onChange={(e) => {
                              if (!config) return;
                              const next = {
                                ...(config.opensky?.bbox ?? {}),
                                lamax: Number(e.target.value),
                              };
                              setConfig({
                                ...config,
                                opensky: {
                                  ...config.opensky,
                                  bbox: next,
                                } as OpenSkyConfigV2,
                              });
                            }}
                            placeholder="Latitud máxima"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={config.opensky?.bbox?.lomin ?? DEFAULT_OPENSKY_CONFIG.bbox.lomin}
                            onChange={(e) => {
                              if (!config) return;
                              const next = {
                                ...(config.opensky?.bbox ?? {}),
                                lomin: Number(e.target.value),
                              };
                              setConfig({
                                ...config,
                                opensky: {
                                  ...config.opensky,
                                  bbox: next,
                                } as OpenSkyConfigV2,
                              });
                            }}
                            placeholder="Longitud mínima"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={config.opensky?.bbox?.lomax ?? DEFAULT_OPENSKY_CONFIG.bbox.lomax}
                            onChange={(e) => {
                              if (!config) return;
                              const next = {
                                ...(config.opensky?.bbox ?? {}),
                                lomax: Number(e.target.value),
                              };
                              setConfig({
                                ...config,
                                opensky: {
                                  ...config.opensky,
                                  bbox: next,
                                } as OpenSkyConfigV2,
                              });
                            }}
                            placeholder="Longitud máxima"
                          />
                        </div>
                      </div>
                    )}

                    <div className="config-field__actions" style={{ marginTop: "12px" }}>
                      <button
                        className="config-button"
                        onClick={handleSaveOpenSky}
                        disabled={openskySaving}
                      >
                        {openskySaving ? "Guardando..." : "Guardar OpenSky"}
                      </button>
                    </div>
                  </div>

                  <div className="config-field">
                    <label>Proveedor</label>
                    <select
                      value={config.layers.flights.provider || "opensky"}
                      onChange={(e) => {
                        const currentFlights = config.layers?.flights;
                        setConfig({
                          ...config,
                          layers: {
                            ...config.layers,
                            flights: {
                              enabled: currentFlights?.enabled || true,
                              provider: e.target.value as any,
                              refresh_seconds: currentFlights?.refresh_seconds || 12,
                              max_age_seconds: currentFlights?.max_age_seconds || 120,
                              max_items_global: currentFlights?.max_items_global || 2000,
                              max_items_view: currentFlights?.max_items_view || 1500,
                              rate_limit_per_min: currentFlights?.rate_limit_per_min || 6,
                              decimate: currentFlights?.decimate || "none",
                              grid_px: currentFlights?.grid_px || 24,
                              styleScale: currentFlights?.styleScale || 3.2,
                              render_mode: currentFlights?.render_mode || "circle",
                              opensky: currentFlights?.opensky || {
                                mode: "oauth2",
                                bbox: { lamin: 39.5, lamax: 41.0, lomin: -1.0, lomax: 1.5 },
                                extended: 0
                              },
                              aviationstack: currentFlights?.aviationstack || {
                                base_url: "http://api.aviationstack.com/v1"
                              },
                              custom: currentFlights?.custom || {
                                api_url: null,
                                api_key: null
                              }
                            },
                          },
                        });
                      }}
                    >
                      <option value="opensky">OpenSky</option>
                      <option value="aviationstack">AviationStack</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </div>

                  {/* OpenSky Configuration */}
                  {config.layers.flights.provider === "opensky" && (
                    <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(104, 162, 255, 0.1)", borderRadius: "4px" }}>
                      <div className="config-field">
                        <label>Modo de Autenticación</label>
                        <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <input
                              type="radio"
                              name="opensky_auth_mode"
                              checked={config.layers.flights.opensky?.mode === "oauth2"}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const currentFlights = config.layers?.flights;
                                  const currentOpensky = currentFlights?.opensky;
                                  setConfig({
                                    ...config,
                                    layers: {
                                      ...config.layers,
                                      flights: {
                                        enabled: currentFlights?.enabled || true,
                                        provider: currentFlights?.provider || "opensky",
                                        refresh_seconds: currentFlights?.refresh_seconds || 12,
                                        max_age_seconds: currentFlights?.max_age_seconds || 120,
                                        max_items_global: currentFlights?.max_items_global || 2000,
                                        max_items_view: currentFlights?.max_items_view || 1500,
                                        rate_limit_per_min: currentFlights?.rate_limit_per_min || 6,
                                        decimate: currentFlights?.decimate || "none",
                                        grid_px: currentFlights?.grid_px || 24,
                                        styleScale: currentFlights?.styleScale || 3.2,
                                        render_mode: currentFlights?.render_mode || "circle",
                                        opensky: {
                                          mode: "oauth2",
                                          bbox: currentOpensky?.bbox || { lamin: 39.5, lamax: 41.0, lomin: -1.0, lomax: 1.5 },
                                          extended: currentOpensky?.extended || 0,
                                          token_url: currentOpensky?.token_url || null,
                                          scope: currentOpensky?.scope || null
                                        },
                                        aviationstack: currentFlights?.aviationstack,
                                        custom: currentFlights?.custom
                                      }
                                    }
                                  });
                                }
                              }}
                            />
                            OAuth2 (Recomendado)
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <input
                              type="radio"
                              name="opensky_auth_mode"
                              checked={config.layers.flights.opensky?.mode === "basic"}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const currentFlights = config.layers?.flights;
                                  const currentOpensky = currentFlights?.opensky;
                                  setConfig({
                                    ...config,
                                    layers: {
                                      ...config.layers,
                                      flights: {
                                        enabled: currentFlights?.enabled || true,
                                        provider: currentFlights?.provider || "opensky",
                                        refresh_seconds: currentFlights?.refresh_seconds || 12,
                                        max_age_seconds: currentFlights?.max_age_seconds || 120,
                                        max_items_global: currentFlights?.max_items_global || 2000,
                                        max_items_view: currentFlights?.max_items_view || 1500,
                                        rate_limit_per_min: currentFlights?.rate_limit_per_min || 6,
                                        decimate: currentFlights?.decimate || "none",
                                        grid_px: currentFlights?.grid_px || 24,
                                        styleScale: currentFlights?.styleScale || 3.2,
                                        render_mode: currentFlights?.render_mode || "circle",
                                        opensky: {
                                          mode: "basic",
                                          bbox: currentOpensky?.bbox || { lamin: 39.5, lamax: 41.0, lomin: -1.0, lomax: 1.5 },
                                          extended: currentOpensky?.extended || 0,
                                          token_url: currentOpensky?.token_url || null,
                                          scope: currentOpensky?.scope || null
                                        },
                                        aviationstack: currentFlights?.aviationstack,
                                        custom: currentFlights?.custom
                                      }
                                    }
                                  });
                                }
                              }}
                            />
                            Basic Auth
                          </label>
                        </div>
                      </div>

                      {config.layers.flights.opensky?.mode === "oauth2" && (
                        <>
                          <div className="config-field">
                            <label>Client ID</label>
                            <input
                              type="text"
                              value={openskyOAuth2ClientId}
                              onChange={(e) => setOpenskyOAuth2ClientId(e.target.value)}
                              placeholder="Client ID de OpenSky"
                            />
                          </div>
                          <div className="config-field">
                            <label>Client Secret</label>
                            <input
                              type="password"
                              value={openskyOAuth2ClientSecret}
                              onChange={(e) => setOpenskyOAuth2ClientSecret(e.target.value)}
                              placeholder="Client Secret de OpenSky"
                            />
                          </div>
                          <div className="config-field">
                            <label>Token URL</label>
                            <input
                              type="text"
                              value={
                                config.layers.flights.opensky?.token_url ||
                                "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
                              }
                              onChange={(e) => {
                                const currentFlights = config.layers?.flights;
                                const currentOpensky = currentFlights?.opensky;
                                setConfig({
                                  ...config,
                                  layers: {
                                    ...config.layers,
                                    flights: {
                                      enabled: currentFlights?.enabled || true,
                                      provider: currentFlights?.provider || "opensky",
                                      refresh_seconds: currentFlights?.refresh_seconds || 12,
                                      max_age_seconds: currentFlights?.max_age_seconds || 120,
                                      max_items_global: currentFlights?.max_items_global || 2000,
                                      max_items_view: currentFlights?.max_items_view || 1500,
                                      rate_limit_per_min: currentFlights?.rate_limit_per_min || 6,
                                      decimate: currentFlights?.decimate || "none",
                                      grid_px: currentFlights?.grid_px || 24,
                                      styleScale: currentFlights?.styleScale || 3.2,
                                      render_mode: currentFlights?.render_mode || "circle",
                                      opensky: {
                                        mode: currentOpensky?.mode || "oauth2",
                                        bbox: currentOpensky?.bbox || { lamin: 39.5, lamax: 41.0, lomin: -1.0, lomax: 1.5 },
                                        extended: currentOpensky?.extended || 0,
                                        token_url:
                                          e.target.value ||
                                          "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
                                        scope: currentOpensky?.scope || null
                                      },
                                      aviationstack: currentFlights?.aviationstack,
                                      custom: currentFlights?.custom
                                    }
                                  }
                                });
                              }}
                              placeholder="https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
                            />
                            <div className="config-field__hint">Opcional, solo para configuración avanzada</div>
                          </div>
                          <div className="config-field">
                            <label>Scope</label>
                            <input
                              type="text"
                              value={config.layers.flights.opensky?.scope || ""}
                              onChange={(e) => {
                                const currentFlights = config.layers?.flights;
                                const currentOpensky = currentFlights?.opensky;
                                setConfig({
                                  ...config,
                                  layers: {
                                    ...config.layers,
                                    flights: {
                                      enabled: currentFlights?.enabled || true,
                                      provider: currentFlights?.provider || "opensky",
                                      refresh_seconds: currentFlights?.refresh_seconds || 12,
                                      max_age_seconds: currentFlights?.max_age_seconds || 120,
                                      max_items_global: currentFlights?.max_items_global || 2000,
                                      max_items_view: currentFlights?.max_items_view || 1500,
                                      rate_limit_per_min: currentFlights?.rate_limit_per_min || 6,
                                      decimate: currentFlights?.decimate || "none",
                                      grid_px: currentFlights?.grid_px || 24,
                                      styleScale: currentFlights?.styleScale || 3.2,
                                      render_mode: currentFlights?.render_mode || "circle",
                                      opensky: {
                                        mode: currentOpensky?.mode || "oauth2",
                                        bbox: currentOpensky?.bbox || { lamin: 39.5, lamax: 41.0, lomin: -1.0, lomax: 1.5 },
                                        extended: currentOpensky?.extended || 0,
                                        token_url: currentOpensky?.token_url || null,
                                        scope: e.target.value || null
                                      },
                                      aviationstack: currentFlights?.aviationstack,
                                      custom: currentFlights?.custom
                                    }
                                  }
                                });
                              }}
                              placeholder="Opcional"
                            />
                          </div>
                          <button
                            className="config-button"
                            onClick={handleSaveFlightsSecrets}
                            style={{ marginTop: "8px" }}
                          >
                            Guardar Credenciales OAuth2
                          </button>
                        </>
                      )}

                      {config.layers.flights.opensky?.mode === "basic" && (
                        <>
                          <div className="config-field">
                            <label>Username</label>
                            <input
                              type="text"
                              value={openskyBasicUsername}
                              onChange={(e) => setOpenskyBasicUsername(e.target.value)}
                              placeholder="Username de OpenSky"
                            />
                          </div>
                          <div className="config-field">
                            <label>Password</label>
                            <input
                              type="password"
                              value={openskyBasicPassword}
                              onChange={(e) => setOpenskyBasicPassword(e.target.value)}
                              placeholder="Password de OpenSky"
                            />
                          </div>
                          <button
                            className="config-button"
                            onClick={handleSaveFlightsSecrets}
                            style={{ marginTop: "8px" }}
                          >
                            Guardar Credenciales Basic
                          </button>
                        </>
                      )}

                      <div className="config-field" style={{ marginTop: "12px" }}>
                        <label>BBox (Latitud/Longitud)</label>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                          <input
                            type="number"
                            step="0.0001"
                            value={config.layers.flights.opensky?.bbox?.lamin || 39.5}
                            onChange={(e) => {
                              const currentOpensky = config.layers?.flights?.opensky;
                              const currentBbox = currentOpensky?.bbox;
                              setConfig({
                                ...config,
                                layers: {
                                  ...config.layers,
                                  flights: buildFlightsConfig({
                                    opensky: {
                                      mode: currentOpensky?.mode || "oauth2",
                                      bbox: {
                                        lamin: parseFloat(e.target.value) || 39.5,
                                        lamax: currentBbox?.lamax ?? 41.0,
                                        lomin: currentBbox?.lomin ?? -1.0,
                                        lomax: currentBbox?.lomax ?? 1.5,
                                      },
                                      extended: currentOpensky?.extended ?? 0,
                                      token_url: currentOpensky?.token_url ?? null,
                                      scope: currentOpensky?.scope ?? null,
                                    }
                                  })
                                }
                              });
                            }}
                            placeholder="Min Lat"
                          />
                          <input
                            type="number"
                            step="0.0001"
                            value={config.layers.flights.opensky?.bbox?.lamax || 41.0}
                            onChange={(e) => {
                              const currentOpensky = config.layers?.flights?.opensky;
                              const currentBbox = currentOpensky?.bbox;
                              setConfig({
                                ...config,
                                layers: {
                                  ...config.layers,
                                  flights: buildFlightsConfig({
                                    opensky: {
                                      mode: currentOpensky?.mode || "oauth2",
                                      bbox: {
                                        lamin: currentBbox?.lamin ?? 39.5,
                                        lamax: parseFloat(e.target.value) || 41.0,
                                        lomin: currentBbox?.lomin ?? -1.0,
                                        lomax: currentBbox?.lomax ?? 1.5,
                                      },
                                      extended: currentOpensky?.extended ?? 0,
                                      token_url: currentOpensky?.token_url ?? null,
                                      scope: currentOpensky?.scope ?? null,
                                    }
                                  })
                                }
                              });
                            }}
                            placeholder="Max Lat"
                          />
                          <input
                            type="number"
                            step="0.0001"
                            value={config.layers.flights.opensky?.bbox?.lomin || -1.0}
                            onChange={(e) => {
                              const currentOpensky = config.layers?.flights?.opensky;
                              const currentBbox = currentOpensky?.bbox;
                              setConfig({
                                ...config,
                                layers: {
                                  ...config.layers,
                                  flights: buildFlightsConfig({
                                    opensky: {
                                      mode: currentOpensky?.mode || "oauth2",
                                      bbox: {
                                        lamin: currentBbox?.lamin ?? 39.5,
                                        lamax: currentBbox?.lamax ?? 41.0,
                                        lomin: parseFloat(e.target.value) || -1.0,
                                        lomax: currentBbox?.lomax ?? 1.5,
                                      },
                                      extended: currentOpensky?.extended ?? 0,
                                      token_url: currentOpensky?.token_url ?? null,
                                      scope: currentOpensky?.scope ?? null,
                                    }
                                  })
                                }
                              });
                            }}
                            placeholder="Min Lon"
                          />
                          <input
                            type="number"
                            step="0.0001"
                            value={config.layers.flights.opensky?.bbox?.lomax || 1.5}
                            onChange={(e) => {
                              const currentOpensky = config.layers?.flights?.opensky;
                              const currentBbox = currentOpensky?.bbox;
                              setConfig({
                                ...config,
                                layers: {
                                  ...config.layers,
                                  flights: buildFlightsConfig({
                                    opensky: {
                                      mode: currentOpensky?.mode || "oauth2",
                                      bbox: {
                                        lamin: currentBbox?.lamin ?? 39.5,
                                        lamax: currentBbox?.lamax ?? 41.0,
                                        lomin: currentBbox?.lomin ?? -1.0,
                                        lomax: parseFloat(e.target.value) || 1.5,
                                      },
                                      extended: currentOpensky?.extended ?? 0,
                                      token_url: currentOpensky?.token_url ?? null,
                                      scope: currentOpensky?.scope ?? null,
                                    }
                                  })
                                }
                              });
                            }}
                            placeholder="Max Lon"
                          />
                        </div>
                      </div>

                      <div className="config-field">
                        <label>Extended</label>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          value={config.layers.flights.opensky?.extended || 0}
                          onChange={(e) => {
                            const currentOpensky = config.layers?.flights?.opensky;
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                flights: buildFlightsConfig({
                                  opensky: {
                                    mode: currentOpensky?.mode || "oauth2",
                                    bbox: currentOpensky?.bbox,
                                    extended: parseInt(e.target.value) || 0,
                                    token_url: currentOpensky?.token_url ?? null,
                                    scope: currentOpensky?.scope ?? null,
                                  }
                                })
                              }
                            });
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* AviationStack Configuration */}
                  {config.layers.flights.provider === "aviationstack" && (
                    <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(104, 162, 255, 0.1)", borderRadius: "4px" }}>
                      <div className="config-field">
                        <label>API Key</label>
                        <input
                          type="text"
                          value={aviationstackApiKey}
                          onChange={(e) => setAviationstackApiKey(e.target.value)}
                          placeholder="API Key de AviationStack"
                        />
                      </div>
                      <div className="config-field">
                        <label>Base URL</label>
                        <input
                          type="text"
                          value={config.layers.flights.aviationstack?.base_url || "http://api.aviationstack.com/v1"}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                flights: buildFlightsConfig({
                                  aviationstack: {
                                    base_url: e.target.value || "http://api.aviationstack.com/v1"
                                  }
                                })
                              }
                            });
                          }}
                        />
                      </div>
                      <button
                        className="config-button"
                        onClick={handleSaveFlightsSecrets}
                        style={{ marginTop: "8px" }}
                      >
                        Guardar API Key
                      </button>
                    </div>
                  )}

                  {/* Custom Configuration */}
                  {config.layers.flights.provider === "custom" && (
                    <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(104, 162, 255, 0.1)", borderRadius: "4px" }}>
                      <div className="config-field">
                        <label>API URL</label>
                        <input
                          type="text"
                          value={config.layers.flights.custom?.api_url || ""}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                flights: buildFlightsConfig({
                                  custom: {
                                    api_url: e.target.value || null,
                                    api_key: config.layers?.flights?.custom?.api_key ?? null
                                  }
                                })
                              }
                            });
                          }}
                          placeholder="https://api.example.com"
                        />
                      </div>
                      <div className="config-field">
                        <label>API Key (opcional)</label>
                        <input
                          type="text"
                          value={config.layers.flights.custom?.api_key || ""}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                flights: buildFlightsConfig({
                                  custom: {
                                    api_url: config.layers?.flights?.custom?.api_url ?? null,
                                    api_key: e.target.value || null
                                  }
                                })
                              }
                            });
                          }}
                          placeholder="API Key"
                        />
                      </div>
                    </div>
                  )}

                  {/* Parámetros comunes */}
                  <div style={{ marginTop: "12px" }}>
                    <div className="config-field">
                      <label>Refresh (segundos)</label>
                      <input
                        type="number"
                        min="1"
                        max="300"
                        value={config.layers.flights.refresh_seconds || 12}
                        onChange={(e) => {
                          setConfig({
                            ...config,
                            layers: {
                              ...config.layers,
                              flights: buildFlightsConfig({
                                refresh_seconds: parseInt(e.target.value) || 12
                              })
                            }
                          });
                        }}
                      />
                    </div>
                    <div className="config-field">
                      <label>Rate Limit (por minuto)</label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={config.layers.flights.rate_limit_per_min || 6}
                        onChange={(e) => {
                          setConfig({
                            ...config,
                            layers: {
                              ...config.layers,
                              flights: buildFlightsConfig({
                                rate_limit_per_min: parseInt(e.target.value) || 6
                              })
                            }
                          });
                        }}
                      />
                    </div>
                  </div>

                  {/* Botón de Test */}
                  <div className="config-field__actions" style={{ marginTop: "12px" }}>
                    <button
                      className="config-button primary"
                      onClick={handleTestFlights}
                      disabled={flightsTesting}
                    >
                      {flightsTesting ? "Probando..." : "Test Vuelos"}
                    </button>
                    <button
                      className="config-button"
                      style={{ marginLeft: "8px" }}
                      onClick={handleSaveFlightsLayer}
                      disabled={flightsSaving}
                    >
                      {flightsSaving ? "Guardando..." : "Guardar vuelos"}
                    </button>
                  </div>

                  {flightsTestResult && (
                    <div
                      className={`config-field__hint ${
                        flightsTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                      }`}
                      style={{ marginTop: "8px" }}
                    >
                      {flightsTestResult.ok ? (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                            ✓ {flightsTestResult.provider === "opensky" && flightsTestResult.auth === "oauth2" && "OpenSky: Token válido"}
                            {flightsTestResult.provider === "opensky" && flightsTestResult.auth === "basic" && "OpenSky: Credenciales válidas"}
                            {flightsTestResult.provider === "aviationstack" && "AviationStack: API Key válida"}
                            {flightsTestResult.provider === "custom" && "Custom: Conexión OK"}
                          </div>
                          {flightsTestResult.expires_in !== undefined && (
                            <div style={{ fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)", marginTop: "4px" }}>
                              Token válido por {Math.floor(flightsTestResult.expires_in / 60)} minutos
                            </div>
                          )}
                          {flightsTestResult.token_last4 && (
                            <div style={{ fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)", marginTop: "4px" }}>
                              Token: ...{flightsTestResult.token_last4}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                            ✗ Error: {flightsTestResult.reason || "Desconocido"}
                          </div>
                          {flightsTestResult.tip && (
                            <div style={{ marginTop: "4px", fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)" }}>
                              💡 {flightsTestResult.tip}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Capa Barcos */}
            <div className="config-field" style={{ marginTop: "24px", borderTop: "1px solid rgba(104, 162, 255, 0.2)", paddingTop: "16px" }}>
              <h3 style={{ marginBottom: "12px" }}>Barcos</h3>
              <label>
                <input
                  type="checkbox"
                  checked={config.layers?.ships?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      layers: {
                        ...config.layers,
                        ships: {
                          ...config.layers?.ships,
                          enabled: e.target.checked,
                          provider: config.layers?.ships?.provider || "aisstream",
                          refresh_seconds: config.layers?.ships?.refresh_seconds || 10,
                          max_age_seconds: config.layers?.ships?.max_age_seconds || 180,
                          max_items_global: config.layers?.ships?.max_items_global || 1500,
                          max_items_view: config.layers?.ships?.max_items_view || 420,
                          rate_limit_per_min: config.layers?.ships?.rate_limit_per_min || 4,
                          decimate: config.layers?.ships?.decimate || "grid",
                          grid_px: config.layers?.ships?.grid_px || 24,
                          styleScale: config.layers?.ships?.styleScale || 1.4,
                          aisstream: config.layers?.ships?.aisstream || {
                            ws_url: DEFAULT_AISSTREAM_WS_URL
                          },
                          aishub: config.layers?.ships?.aishub || {
                            base_url: "https://www.aishub.net/api"
                          },
                          ais_generic: config.layers?.ships?.ais_generic || {
                            api_url: null
                          },
                          custom: config.layers?.ships?.custom || {
                            api_url: null,
                            api_key: null
                          }
                        },
                      },
                    });
                  }}
                />
                Habilitar Capa de Barcos
              </label>
              
              {config.layers?.ships?.enabled && (
                <div style={{ marginLeft: "24px", marginTop: "12px" }}>
                  <div className="config-field">
                    <label>Proveedor</label>
                    <select
                      value={config.layers.ships.provider || "aisstream"}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          layers: {
                            ...config.layers,
                            ships: {
                              ...config.layers?.ships,
                              enabled: true,
                              provider: e.target.value as any,
                              refresh_seconds: config.layers?.ships?.refresh_seconds || 10,
                              max_age_seconds: config.layers?.ships?.max_age_seconds || 180,
                              max_items_global: config.layers?.ships?.max_items_global || 1500,
                              max_items_view: config.layers?.ships?.max_items_view || 420,
                              rate_limit_per_min: config.layers?.ships?.rate_limit_per_min || 4,
                              decimate: config.layers?.ships?.decimate || "grid",
                              grid_px: config.layers?.ships?.grid_px || 24,
                              styleScale: config.layers?.ships?.styleScale || 1.4,
                              aisstream: config.layers?.ships?.aisstream || {
                                ws_url: DEFAULT_AISSTREAM_WS_URL
                              },
                              aishub: config.layers?.ships?.aishub || {
                                base_url: "https://www.aishub.net/api"
                              },
                              ais_generic: config.layers?.ships?.ais_generic || {
                                api_url: null
                              },
                              custom: config.layers?.ships?.custom || {
                                api_url: null,
                                api_key: null
                              }
                            },
                          },
                        });
                      }}
                    >
                      <option value="aisstream">AIS Stream</option>
                      <option value="aishub">AIS Hub</option>
                      <option value="ais_generic">Genérico</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </div>

                  {/* AISStream Configuration */}
                  {config.layers.ships.provider === "aisstream" && (
                    <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(104, 162, 255, 0.1)", borderRadius: "4px" }}>
                      <div className="config-field">
                        <label>API Key</label>
                        <input
                          type="text"
                          value={aisstreamApiKey}
                          onChange={(e) => setAisstreamApiKey(e.target.value)}
                          placeholder="API Key de AISStream"
                        />
                      </div>
                      <div className="config-field">
                        <label>WebSocket URL</label>
                        <input
                          type="text"
                          value={config.layers.ships.aisstream?.ws_url || DEFAULT_AISSTREAM_WS_URL}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                ships: buildShipsConfig({
                                  aisstream: {
                                    ws_url: e.target.value || DEFAULT_AISSTREAM_WS_URL
                                  }
                                })
                              }
                            });
                          }}
                          placeholder={DEFAULT_AISSTREAM_WS_URL}
                        />
                        <div className="config-field__hint">Solo modificar en configuración avanzada</div>
                      </div>
                      <button
                        className="config-button"
                        onClick={handleSaveShipsSecrets}
                        style={{ marginTop: "8px" }}
                      >
                        Guardar API Key
                      </button>
                    </div>
                  )}

                  {/* AIS Hub Configuration */}
                  {config.layers.ships.provider === "aishub" && (
                    <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(104, 162, 255, 0.1)", borderRadius: "4px" }}>
                      <div className="config-field">
                        <label>API Key</label>
                        <input
                          type="text"
                          value={aishubApiKey}
                          onChange={(e) => setAishubApiKey(e.target.value)}
                          placeholder="API Key de AIS Hub"
                        />
                      </div>
                      <div className="config-field">
                        <label>Base URL</label>
                        <input
                          type="text"
                          value={config.layers.ships.aishub?.base_url || "https://www.aishub.net/api"}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                ships: buildShipsConfig({
                                  aishub: {
                                    base_url: e.target.value || "https://www.aishub.net/api"
                                  }
                                })
                              }
                            });
                          }}
                        />
                      </div>
                      <button
                        className="config-button"
                        onClick={handleSaveShipsSecrets}
                        style={{ marginTop: "8px" }}
                      >
                        Guardar API Key
                      </button>
                    </div>
                  )}

                  {/* AIS Generic Configuration */}
                  {config.layers.ships.provider === "ais_generic" && (
                    <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(104, 162, 255, 0.1)", borderRadius: "4px" }}>
                      <div className="config-field">
                        <label>API URL</label>
                        <input
                          type="text"
                          value={config.layers.ships.ais_generic?.api_url || ""}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                ships: buildShipsConfig({
                                  ais_generic: {
                                    api_url: e.target.value || null
                                  }
                                })
                              }
                            });
                          }}
                          placeholder="https://api.example.com"
                        />
                      </div>
                    </div>
                  )}

                  {/* Custom Configuration */}
                  {config.layers.ships.provider === "custom" && (
                    <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(104, 162, 255, 0.1)", borderRadius: "4px" }}>
                      <div className="config-field">
                        <label>API URL</label>
                        <input
                          type="text"
                          value={config.layers.ships.custom?.api_url || ""}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                ships: buildShipsConfig({
                                  custom: {
                                    api_url: e.target.value || null,
                                    api_key: config.layers?.ships?.custom?.api_key ?? null
                                  }
                                })
                              }
                            });
                          }}
                          placeholder="https://api.example.com"
                        />
                      </div>
                      <div className="config-field">
                        <label>API Key (opcional)</label>
                        <input
                          type="text"
                          value={config.layers.ships.custom?.api_key || ""}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              layers: {
                                ...config.layers,
                                ships: buildShipsConfig({
                                  custom: {
                                    api_url: config.layers?.ships?.custom?.api_url ?? null,
                                    api_key: e.target.value || null
                                  }
                                })
                              }
                            });
                          }}
                          placeholder="API Key"
                        />
                      </div>
                    </div>
                  )}

                  {/* Parámetros comunes */}
                  <div style={{ marginTop: "12px" }}>
                    <div className="config-field">
                      <label>Refresh (segundos)</label>
                      <input
                        type="number"
                        min="1"
                        max="300"
                        value={config.layers.ships.refresh_seconds || 10}
                        onChange={(e) => {
                          setConfig({
                            ...config,
                            layers: {
                              ...config.layers,
                              ships: buildShipsConfig({
                                refresh_seconds: parseInt(e.target.value) || 10
                              })
                            }
                          });
                        }}
                      />
                    </div>
                    <div className="config-field">
                      <label>Rate Limit (por minuto)</label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={config.layers.ships.rate_limit_per_min || 4}
                        onChange={(e) => {
                          setConfig({
                            ...config,
                            layers: {
                              ...config.layers,
                              ships: buildShipsConfig({
                                rate_limit_per_min: parseInt(e.target.value) || 4
                              })
                            }
                          });
                        }}
                      />
                    </div>
                  </div>

                  {/* Botón de Test */}
                  <div className="config-field__actions" style={{ marginTop: "12px" }}>
                    <button
                      className="config-button primary"
                      onClick={handleTestShips}
                      disabled={shipsTesting}
                    >
                      {shipsTesting ? "Probando..." : "Test Barcos"}
                    </button>
                    <button
                      className="config-button"
                      style={{ marginLeft: "8px" }}
                      onClick={handleSaveShipsLayer}
                      disabled={shipsSaving}
                    >
                      {shipsSaving ? "Guardando..." : "Guardar barcos"}
                    </button>
                  </div>

                  {shipsTestResult && (
                    <div
                      className={`config-field__hint ${
                        shipsTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                      }`}
                      style={{ marginTop: "8px" }}
                    >
                      {shipsTestResult.ok ? (
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            ✓ {shipsTestResult.provider === "aisstream" && "AISStream: API Key configurada"}
                            {shipsTestResult.provider === "aishub" && "AIS Hub: API Key válida"}
                            {shipsTestResult.provider === "ais_generic" && "AIS Generic: Conexión OK"}
                            {shipsTestResult.provider === "custom" && "Custom: Conexión OK"}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                            ✗ Error: {shipsTestResult.reason || "Desconocido"}
                          </div>
                          {shipsTestResult.tip && (
                            <div style={{ marginTop: "4px", fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)" }}>
                              💡 {shipsTestResult.tip}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
        </div>
        {/* End BLOQUE 1: Maps and Layers */}

        {/* ============================================
            BLOQUE 2: Rotating Panel
            ============================================ */}
        <div style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.8rem", marginBottom: "20px", borderBottom: "2px solid rgba(104, 162, 255, 0.3)", paddingBottom: "8px" }}>
            Panel Rotativo
          </h2>

        {/* GRUPO 3: Panel Rotativo */}
        <div className="config-card">
          <h2>Panel Rotativo</h2>

          <div className="config-form-fields">
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={rotationConfig.enabled}
                  onChange={(e) => {
                    handleRotationToggle(e.target.checked);
                  }}
                />
                Habilitar Rotación
              </label>
            </div>

            {rotationConfig.enabled && (
              <>
                <div className="config-field">
                  <label>Duración por panel (segundos)</label>
                  <input
                    type="number"
                    min={3}
                    max={3600}
                    value={rotationConfig.duration_sec}
                    onChange={(e) => {
                      const nextValue = Number(e.target.value);
                      handleRotationDurationChange(
                        Number.isFinite(nextValue) ? nextValue : rotationConfig.duration_sec
                      );
                    }}
                  />
                  <div className="config-field__hint">Entre 3 y 3600 segundos por panel.</div>
                </div>

                <div className="config-field">
                  <label>Orden de paneles</label>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      marginTop: "8px",
                    }}
                  >
                    {rotationPanels.map((panelId, index) => (
                      <div
                        key={panelId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          backgroundColor: "rgba(104, 162, 255, 0.08)",
                          borderRadius: "4px",
                          padding: "8px 12px",
                        }}
                      >
                        <span>{ROTATION_PANEL_LABELS[panelId] ?? panelId}</span>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            className="config-button"
                            style={{ minWidth: "32px" }}
                            onClick={() => handleMoveRotationPanel(panelId, "up")}
                            disabled={index === 0}
                            title="Subir"
                          >
                            ↑
                          </button>
                          <button
                            className="config-button"
                            style={{ minWidth: "32px" }}
                            onClick={() => handleMoveRotationPanel(panelId, "down")}
                            disabled={index === rotationPanels.length - 1}
                            title="Bajar"
                          >
                            ↓
                          </button>
                          <button
                            className="config-button"
                            style={{ minWidth: "64px" }}
                            onClick={() => handleRemoveRotationPanel(panelId)}
                            disabled={rotationPanels.length <= 1}
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {availableRotationPanels.length > 0 && (
                    <div style={{ marginTop: "12px" }}>
                      <div
                        style={{
                          marginBottom: "8px",
                          fontSize: "0.9rem",
                          color: "rgba(255, 255, 255, 0.8)",
                        }}
                      >
                        Añadir paneles disponibles:
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {availableRotationPanels.map(({ id, label }) => (
                          <button
                            key={id}
                            className="config-button"
                            onClick={() => handleAddRotationPanel(id)}
                          >
                            Añadir {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Panel Noticias */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.panels?.news?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      panels: {
                        ...config.panels,
                        news: {
                          enabled: e.target.checked,
                          feeds: config.panels?.news?.feeds || [],
                        },
                      },
                    });
                  }}
                />
                Habilitar Panel de Noticias
              </label>
              {config.panels?.news?.enabled && (
                <div className="config-field" style={{ marginLeft: "24px", marginTop: "8px" }}>
                  <label>Feeds RSS (uno por línea)</label>
                  <textarea
                    value={(config.panels.news.feeds || []).join("\n")}
                    onChange={(e) => {
                      const feeds = e.target.value
                        .split("\n")
                        .map((f) => f.trim())
                        .filter((f) => f.length > 0);
                      setConfig({
                        ...config,
                        panels: {
                          ...config.panels,
                          news: {
                            enabled: config.panels?.news?.enabled || false,
                            feeds,
                          },
                        },
                      });
                    }}
                    placeholder="https://www.example.com/rss"
                  />
                  <button
                    className="config-button"
                    onClick={handleTestNewsFeeds}
                    disabled={newsFeedsTesting}
                    style={{ marginTop: "8px" }}
                  >
                    {newsFeedsTesting ? "Probando..." : "Test Feeds"}
                  </button>
                  
                  {newsFeedsTestResult && newsFeedsTestResult.length > 0 && (
                    <div className="config-table" style={{ marginTop: "12px" }}>
                      <div className="config-table__header">
                        <span>Resultados de Test de Feeds</span>
                      </div>
                      {newsFeedsTestResult.map((result, idx) => (
                        <div key={idx} className="config-table__row">
                          <div style={{ flex: 1 }}>
                            <strong>{result.url}</strong>
                            {result.title && (
                              <div style={{ fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)", marginTop: "4px" }}>
                                {result.title}
                              </div>
                            )}
                            {result.reachable ? (
                              <span className="config-badge config-badge--success" style={{ marginLeft: "8px" }}>
                                {result.items} items
                              </span>
                            ) : (
                              <span className="config-badge config-badge--error" style={{ marginLeft: "8px" }}>
                                {result.error || "Error"}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Panel Calendario */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.calendar?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      calendar: {
                        ...config.calendar,
                        enabled: e.target.checked,
                        source: config.calendar?.source || "google",
                        days_ahead: config.calendar?.days_ahead || 14,
                      } as any,
                    });
                  }}
                />
                Habilitar Calendario
              </label>
              {config.calendar?.enabled && (
                <div className="config-field" style={{ marginLeft: "24px", marginTop: "8px" }}>
                  <label>Origen</label>
                  <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <input
                        type="radio"
                        name="calendar_source"
                        checked={config.calendar?.source === "ics"}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setConfig({
                              ...config,
                              calendar: {
                                ...config.calendar,
                                source: "ics",
                                enabled: config.calendar?.enabled || false,
                                days_ahead: config.calendar?.days_ahead || 14,
                                ics: config.calendar?.ics || {
                                  mode: "upload",
                                  file_path: null,
                                  url: null,
                                  last_ok: null,
                                  last_error: null,
                                },
                              } as any,
                            });
                          }
                        }}
                      />
                      ICS
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <input
                        type="radio"
                        name="calendar_source"
                        checked={config.calendar?.source === "google"}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setConfig({
                              ...config,
                              calendar: {
                                ...config.calendar,
                                source: "google",
                                enabled: config.calendar?.enabled || false,
                                days_ahead: config.calendar?.days_ahead || 14,
                              } as any,
                            });
                          }
                        }}
                      />
                      Google Calendar
                    </label>
                  </div>
                  
                  {config.calendar?.source === "ics" && (
                    <div style={{ marginTop: "12px" }}>
                      <label style={{ display: "block", marginBottom: "8px" }}>Modo ICS</label>
                      <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <input
                            type="radio"
                            name="ics_mode"
                            checked={config.calendar?.ics?.mode === "upload"}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setConfig({
                                  ...config,
                                  calendar: {
                                    ...config.calendar,
                                    ics: {
                                      ...config.calendar?.ics,
                                      mode: "upload",
                                      url: null,
                                    } as any,
                                  } as any,
                                });
                              }
                            }}
                          />
                          Subir archivo
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <input
                            type="radio"
                            name="ics_mode"
                            checked={config.calendar?.ics?.mode === "url"}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setConfig({
                                  ...config,
                                  calendar: {
                                    ...config.calendar,
                                    ics: {
                                      ...config.calendar?.ics,
                                      mode: "url",
                                      url: config.calendar?.ics?.url || "",
                                    } as any,
                                  } as any,
                                });
                              }
                            }}
                          />
                          URL remota
                        </label>
                      </div>
                      
                      {config.calendar?.ics?.mode === "upload" && (
                        <div>
                          <label>Subir archivo ICS</label>
                          <input
                            type="file"
                            accept=".ics,text/calendar"
                            onChange={handleUploadICS}
                            disabled={calendarUploading}
                            style={{ marginTop: "8px" }}
                          />
                          {calendarUploading && (
                            <div style={{ marginTop: "8px" }}>
                              <div style={{ fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)", marginBottom: "4px" }}>
                                Subiendo archivo... {calendarUploadProgress > 0 && `${calendarUploadProgress}%`}
                              </div>
                              {calendarUploadProgress > 0 && (
                                <div style={{ 
                                  width: "100%", 
                                  height: "4px", 
                                  backgroundColor: "rgba(104, 162, 255, 0.2)", 
                                  borderRadius: "2px",
                                  overflow: "hidden"
                                }}>
                                  <div style={{ 
                                    width: `${calendarUploadProgress}%`, 
                                    height: "100%", 
                                    backgroundColor: "rgba(104, 162, 255, 0.8)",
                                    transition: "width 0.3s ease"
                                  }} />
                                </div>
                              )}
                            </div>
                          )}
                          {!calendarUploading && config.calendar?.ics?.stored_path && (
                            <div style={{ marginTop: "8px", fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)" }}>
                              <span className="config-badge config-badge--success" style={{ marginRight: "8px" }}>
                                ✓ Archivo guardado
                              </span>
                              {config.calendar.ics.stored_path.split("/").pop()}
                            </div>
                          )}
                          {calendarTestResult && calendarTestResult.ok && calendarTestResult.source === "ics" && (
                            <div className="config-field__hint config-field__hint--success" style={{ marginTop: "8px" }}>
                              ✓ {calendarTestResult.message}
                              {calendarTestResult.count !== undefined && (
                                <span className="config-badge" style={{ marginLeft: "8px" }}>
                                  {calendarTestResult.count} eventos
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {config.calendar?.ics?.mode === "url" && (
                        <div>
                          <label>URL del calendario ICS</label>
                          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                            <input
                              type="text"
                              value={config.calendar?.ics?.url || ""}
                              onChange={(e) => {
                                setConfig({
                                  ...config,
                                  calendar: {
                                    ...config.calendar,
                                    ics: {
                                      ...config.calendar?.ics,
                                      url: e.target.value || null,
                                    } as any,
                                  } as any,
                                });
                              }}
                              placeholder="https://example.com/calendar.ics"
                              style={{ flex: 1 }}
                            />
                            <button
                              className="config-button"
                              onClick={handleSetICSUrl}
                              disabled={calendarUrlLoading}
                            >
                              {calendarUrlLoading ? "Guardando..." : "Descargar y Guardar"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {config.calendar?.source === "google" && (
                    <div style={{ marginTop: "12px" }}>
                      <div className="config-field__hint config-field__hint--warning">
                        ⚠ Para usar Google Calendar, configura api_key y calendar_id en secrets.google
                      </div>
                    </div>
                  )}
                  
                  <div style={{ marginTop: "12px" }}>
                    <label>Días hacia adelante</label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={config.calendar?.days_ahead || 14}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          calendar: {
                            ...config.calendar,
                            days_ahead: parseInt(e.target.value) || 14,
                          } as any,
                        });
                      }}
                      style={{ marginTop: "8px", width: "100px" }}
                    />
                  </div>
                  
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button
                      className="config-button primary"
                      onClick={handleTestCalendar}
                      disabled={calendarTesting}
                    >
                      {calendarTesting ? "Probando..." : "Test Calendario"}
                    </button>
                    <button
                      className="config-button"
                      onClick={handleSaveCalendar}
                      disabled={panelRotatorSaving || calendarSaveBlocked}
                      title={calendarSaveBlockedReason}
                    >
                      {panelRotatorSaving ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                  {calendarTestResult && (
                    <div
                      className={`config-field__hint ${
                        calendarTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                      }`}
                      style={{ marginTop: "8px", padding: "12px", borderRadius: "8px", border: calendarTestResult.ok ? "1px solid rgba(76, 175, 80, 0.3)" : "1px solid rgba(244, 67, 54, 0.3)" }}
                    >
                      {calendarTestResult.ok ? (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                            ✓ {calendarTestResult.message || "Conexión exitosa"}
                          </div>
                          {calendarTestResult.count !== undefined && (
                            <div style={{ fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)", marginTop: "4px" }}>
                              {calendarTestResult.count} eventos encontrados
                              {calendarTestResult.range_days && ` (próximos ${calendarTestResult.range_days} días)`}
                            </div>
                          )}
                          {calendarTestResult.source && (
                            <div style={{ fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)", marginTop: "4px" }}>
                              Fuente: {calendarTestResult.source === "ics" ? "ICS" : calendarTestResult.source === "google" ? "Google Calendar" : calendarTestResult.source}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                            ✗ {calendarTestResult.message || calendarTestResult.reason || "Error desconocido"}
                          </div>
                          {calendarTestResult.reason && calendarTestResult.reason !== calendarTestResult.message && (
                            <div style={{ fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)", marginTop: "4px" }}>
                              Código: {calendarTestResult.reason}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Preview de eventos */}
                  {calendarPreview !== null && (
                    <div style={{ marginTop: "12px" }}>
                      <label>Vista previa de próximos eventos</label>
                      {calendarPreviewLoading ? (
                        <div style={{ marginTop: "8px", fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)" }}>
                          Cargando...
                        </div>
                      ) : calendarPreview.length === 0 ? (
                        <div style={{ marginTop: "8px", fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)" }}>
                          No hay eventos próximos
                        </div>
                      ) : (
                        <div className="config-table" style={{ marginTop: "8px" }}>
                          <div className="config-table__header">
                            <span>Próximos eventos</span>
                          </div>
                          {calendarPreview.map((event, idx) => (
                            <div key={idx} className="config-table__row">
                              <div style={{ flex: 1 }}>
                                <strong>{event.title || "Sin título"}</strong>
                                <div style={{ fontSize: "0.875rem", color: "rgba(255, 255, 255, 0.7)", marginTop: "4px" }}>
                                  {event.all_day ? "Todo el día" : new Date(event.start).toLocaleString()}
                                  {event.location && ` • ${event.location}`}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Panel Efemérides */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.panels?.ephemerides?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      panels: {
                        ...config.panels,
                        ephemerides: {
                          ...config.panels?.ephemerides,
                          enabled: e.target.checked,
                        },
                      },
                    });
                  }}
                />
                Habilitar Panel de Efemérides
              </label>
            </div>

            {/* Panel Cosechas */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.panels?.harvest?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      panels: {
                        ...config.panels,
                        harvest: {
                          ...config.panels?.harvest,
                          enabled: e.target.checked,
                        },
                      },
                    });
                  }}
                />
                Habilitar Panel de Cosechas (Frutas, Verduras y Hortalizas de Temporada)
              </label>
              <div className="config-field__hint" style={{ marginTop: "8px" }}>
                Muestra las frutas, verduras y hortalizas de temporada según el mes actual. Los datos se obtienen automáticamente del calendario estacional.
              </div>
            </div>

            {/* Panel Clima Semanal */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.panels?.weatherWeekly?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      panels: {
                        ...config.panels,
                        weatherWeekly: {
                          ...config.panels?.weatherWeekly,
                          enabled: e.target.checked,
                        },
                      },
                    });
                  }}
                />
                Habilitar Panel de Clima Semanal
              </label>
            </div>
          </div>

          <div className="config-actions" style={{ marginTop: "24px" }}>
            <button
              className="config-button primary"
              onClick={handleSavePanelRotator}
              disabled={panelRotatorSaving}
            >
              {panelRotatorSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
        </div>

        {/* ============================================
            BLOQUE 3: Connectivity/Wi-Fi
            ============================================ */}
        <div style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.8rem", marginBottom: "20px", borderBottom: "2px solid rgba(104, 162, 255, 0.3)", paddingBottom: "8px" }}>
            Conectividad / Wi-Fi
          </h2>
          
          {/* GRUPO 1: WiFi */}
          <div className="config-card">
            <h2>WiFi</h2>
            
            <div className="config-form-fields">
              {/* Estado actual de WiFi */}
              {wifiStatusData && (
                <div className="config-field">
                  <label>Estado actual</label>
                  <div style={{ padding: "12px", backgroundColor: "rgba(104, 162, 255, 0.1)", borderRadius: "4px" }}>
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Interfaz:</strong> {wifiStatusData.interface}
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Conectado:</strong> {wifiStatusData.connected ? "Sí" : "No"}
                    </div>
                    {wifiStatusData.connected && (
                      <>
                        {wifiStatusData.ssid && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>SSID:</strong> {wifiStatusData.ssid}
                          </div>
                        )}
                        {wifiStatusData.ip_address && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>IP:</strong> {wifiStatusData.ip_address}
                          </div>
                        )}
                        {wifiStatusData.signal !== null && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>Señal:</strong> {wifiStatusData.signal}%
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {wifiStatusData.connected && (
                    <div className="config-field__actions" style={{ marginTop: "12px" }}>
                      <button
                        className="config-button"
                        onClick={handleWifiDisconnect}
                      >
                        Desconectar
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Botón de escaneo */}
              <div className="config-field">
                <div className="config-field__actions">
                  <button
                    className="config-button primary"
                    onClick={handleWifiScan}
                    disabled={wifiScanning}
                  >
                    {wifiScanning ? "Escaneando..." : "Buscar redes"}
                  </button>
                  {wifiScanError && (
                    <button
                      className="config-button"
                      onClick={handleWifiScan}
                      disabled={wifiScanning}
                    >
                      Reintentar
                    </button>
                  )}
                </div>
                {wifiScanError && (
                  <div className="config-field__hint config-field__hint--error" style={{ marginTop: "8px" }}>
                    {wifiScanError}
                  </div>
                )}
              </div>

              {/* Lista de redes disponibles */}
              {wifiNetworksCount > 0 && (
                <div className="config-field">
                  <label>Redes disponibles ({wifiNetworksCount})</label>
                  <div style={{ maxHeight: "400px", overflowY: "auto", border: "1px solid rgba(104, 162, 255, 0.3)", borderRadius: "4px", padding: "8px" }}>
                    {wifiNetworksList.map((network, index) => (
                      <div
                        key={index}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "12px",
                          marginBottom: "8px",
                          backgroundColor: "rgba(104, 162, 255, 0.05)",
                          borderRadius: "4px",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>{network.ssid}</div>
                          <div style={{ fontSize: "0.9rem", color: "rgba(255, 255, 255, 0.7)" }}>
                            Señal: {network.signal}% | Seguridad: {network.security}
                          </div>
                        </div>
                        <button
                          className="config-button"
                          onClick={() => {
                            const password = network.security !== "--" ? prompt(`Ingresa la contraseña para "${network.ssid}":`) : undefined;
                            if (password !== null) {
                              handleWifiConnect(network.ssid, password);
                            }
                          }}
                        >
                          Conectar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Botón de guardar/actualizar */}
              <div className="config-actions" style={{ marginTop: "24px" }}>
                <button
                  className="config-button primary"
                  onClick={handleSaveWifi}
                  disabled={wifiSaving}
                >
                  {wifiSaving ? "Guardando..." : "Actualizar estado"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};