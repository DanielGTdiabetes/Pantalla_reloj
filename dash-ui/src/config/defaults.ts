import type {
  AEMETConfig,
  AIConfig,
  AISStreamConfig,
  AISHubConfig,
  AppConfig,
  AviationStackConfig,
  BlitzortungConfig,
  CalendarConfig,
  CustomFlightConfig,
  CustomShipConfig,
  DisplayConfig,
  EphemeridesConfig,
  FlightsLayerConfig,
  FlightsLayerCircleConfig,
  FlightsLayerSymbolConfig,
  FlightsLayerRenderMode,
  ShipsLayerRenderMode,
  ShipsLayerCircleConfig,
  ShipsLayerSymbolConfig,
  GenericAISConfig,
  GlobalLayersConfig,
  GlobalRadarLayerConfig,
  GlobalSatelliteLayerConfig,
  HarvestConfig,
  LayersConfig,
  MapCinemaBand,
  MapCinemaConfig,
  MapCinemaMotionConfig,
  MapConfig,
  MapIdlePanConfig,
  MapThemeConfig,
  MaptilerConfig,
  XyzConfig,
  MapPreferences,
  NewsConfig,
  OpenSkyOAuthConfig,
  OpenSkyConfig,
  OpenSkyAuthConfig,
  RotationConfig,
  SaintsConfig,
  ShipsLayerConfig,
  StormModeConfig,
  UIConfig,
} from "../types/config";

const clampNumber = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const toNumber = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const sanitizeString = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
};

const sanitizeNullableString = (value: unknown, fallback: string | null): string | null => {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  return fallback;
};

const sanitizeColorString = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed;
  }
  if (/^rgba?\(/i.test(trimmed) || /^hsla?\(/i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
};

const sanitizeRenderMode = (
  value: unknown,
  fallback: FlightsLayerRenderMode,
): FlightsLayerRenderMode => {
  if (value === "auto" || value === "symbol" || value === "symbol_custom" || value === "circle") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "auto" || normalized === "symbol" || normalized === "symbol_custom" || normalized === "circle") {
      return normalized as FlightsLayerRenderMode;
    }
  }
  return fallback;
};

const sanitizeShipsRenderMode = (
  value: unknown,
  fallback: ShipsLayerRenderMode,
): ShipsLayerRenderMode => {
  if (value === "auto" || value === "symbol" || value === "symbol_custom" || value === "circle") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "auto" || normalized === "symbol" || normalized === "symbol_custom" || normalized === "circle") {
      return normalized as ShipsLayerRenderMode;
    }
  }
  return fallback;
};

const mergeSymbolOptions = (
  source: Partial<FlightsLayerSymbolConfig> | undefined,
  fallback: FlightsLayerSymbolConfig,
): FlightsLayerSymbolConfig => {
  const candidate = source ?? {};
  return {
    size_vh: clampNumber(toNumber(candidate.size_vh, fallback.size_vh), 0.1, 10.0),
    allow_overlap: toBoolean(candidate.allow_overlap, fallback.allow_overlap),
  };
};

const mergeCircleOptions = (
  source: Partial<FlightsLayerCircleConfig> | undefined,
  fallback: FlightsLayerCircleConfig,
): FlightsLayerCircleConfig => {
  const candidate = source ?? {};
  return {
    radius_vh: clampNumber(toNumber(candidate.radius_vh, fallback.radius_vh), 0.1, 10.0),
    opacity: clampNumber(toNumber(candidate.opacity, fallback.opacity), 0.0, 1.0),
    color: sanitizeColorString(candidate.color, fallback.color),
    stroke_color: sanitizeColorString(candidate.stroke_color, fallback.stroke_color),
    stroke_width: clampNumber(toNumber(candidate.stroke_width, fallback.stroke_width), 0.0, 10.0),
  };
};

const sanitizeRadarProvider = (
  value: unknown,
  fallback: GlobalRadarLayerConfig["provider"],
): GlobalRadarLayerConfig["provider"] => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "rainviewer" || normalized === "openweathermap" || normalized === "maptiler_weather") {
      return normalized as GlobalRadarLayerConfig["provider"];
    }
  }
  return fallback;
};

const DEFAULT_CINEMA_BANDS: readonly MapCinemaBand[] = [
  { lat: 0, zoom: 3.1, pitch: 10, minZoom: 2.9, duration_sec: 900 },
  { lat: 18, zoom: 3.3, pitch: 8, minZoom: 3.1, duration_sec: 720 },
  { lat: 32, zoom: 3.6, pitch: 6, minZoom: 3.3, duration_sec: 600 },
  { lat: 42, zoom: 3.9, pitch: 6, minZoom: 3.5, duration_sec: 480 },
  { lat: -18, zoom: 3.3, pitch: 8, minZoom: 3.1, duration_sec: 720 },
  { lat: -32, zoom: 3.6, pitch: 6, minZoom: 3.3, duration_sec: 600 },
];

const DEFAULT_THEME: MapThemeConfig = {
  sea: "#0b3756",
  land: "#20262c",
  label: "#d6e7ff",
  contrast: 0.15,
  tint: "rgba(0,170,255,0.06)",
};

const DEFAULT_CINEMA_MOTION: MapCinemaMotionConfig = {
  speedPreset: "medium",
  amplitudeDeg: 60,
  easing: "ease-in-out",
  pauseWithOverlay: true,
  phaseOffsetDeg: 25,
};

const DEFAULT_XYZ: XyzConfig = {
  urlTemplate: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "© Esri, Maxar, Earthstar, CNES/Airbus, USDA, USGS, IGN, GIS User Community",
  minzoom: 0,
  maxzoom: 19,
  tileSize: 256,
  labelsOverlay: true,
};

const DEFAULT_MAPTILER: MaptilerConfig = {
  key: null,
  apiKey: null,
  styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json?key=fBZDqPrUD4EwoZLV4L6A",
  styleUrlDark: "https://api.maptiler.com/maps/dark/style.json",
  styleUrlLight: "https://api.maptiler.com/maps/streets/style.json",
  styleUrlBright: "https://api.maptiler.com/maps/bright/style.json",
};

const sanitizeApiKey = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
};

export const createDefaultMapPreferences = (): MapPreferences => ({
  provider: "maptiler",
  maptiler_api_key: null,
});

export const createDefaultMapCinema = (): MapCinemaConfig => ({
  enabled: true,
  panLngDegPerSec: 0.9,
  debug: false,
  bandTransition_sec: 8,
  fsmEnabled: true,
  motion: { ...DEFAULT_CINEMA_MOTION },
  bands: DEFAULT_CINEMA_BANDS.map((band) => ({ ...band })),
});

export const createDefaultMapIdlePan = (): MapIdlePanConfig => ({
  enabled: false,
  intervalSec: 300,
});

export const createDefaultMapSettings = (): MapConfig => ({
  engine: "maplibre",
  style: "streets-v4",
  provider: "maptiler",
  maptiler: { ...DEFAULT_MAPTILER },
  xyz: { ...DEFAULT_XYZ },
  viewMode: "fixed",
  fixed: {
    center: { lat: 39.98, lon: 0.20 }, // Castellón por defecto
    zoom: 7.8,
    bearing: 0,
    pitch: 0,
  },
  region: {
    postalCode: "12001", // Castellón por defecto
  },
  renderWorldCopies: true,
  interactive: false,
  controls: false,
  respectReducedMotion: false,
  cinema: createDefaultMapCinema(),
  idlePan: createDefaultMapIdlePan(),
  theme: { ...DEFAULT_THEME },
});

export const createDefaultGlobalSatelliteLayer = (): GlobalSatelliteLayerConfig => ({
  enabled: true,
  provider: "gibs",
  refresh_minutes: 10,
  history_minutes: 90,
  frame_step: 10,
  opacity: 0.7,
});

export const createDefaultGlobalRadarLayer = (): GlobalRadarLayerConfig => ({
  enabled: true,
  provider: "maptiler_weather",
  layer_type: "precipitation_new",
  refresh_minutes: 5,
  history_minutes: 90,
  frame_step: 5,
  opacity: 0.7,
});

export const createDefaultGlobalLayers = (): GlobalLayersConfig => ({
  satellite: createDefaultGlobalSatelliteLayer(),
  radar: createDefaultGlobalRadarLayer(),
});

const mergeCinemaBand = (candidate: unknown, fallback: MapCinemaBand): MapCinemaBand => {
  const source = (candidate as Partial<MapCinemaBand>) ?? {};
  const zoom = toNumber(source.zoom, fallback.zoom);
  const minZoom = Math.min(toNumber(source.minZoom, fallback.minZoom), zoom);
  return {
    lat: toNumber(source.lat, fallback.lat),
    zoom,
    pitch: toNumber(source.pitch, fallback.pitch),
    minZoom,
    duration_sec: Math.max(1, Math.round(toNumber(source.duration_sec, fallback.duration_sec))),
  };
};

const mergeCinema = (candidate: unknown): MapCinemaConfig => {
  const fallback = createDefaultMapCinema();
  const source = (candidate as Partial<MapCinemaConfig>) ?? {};
  const bandsSource = Array.isArray(source.bands) ? source.bands : [];
  const bands = DEFAULT_CINEMA_BANDS.map((band, index) => mergeCinemaBand(bandsSource[index], band));
  const fallbackMotion = { ...DEFAULT_CINEMA_MOTION };
  const motionSource = (source.motion ?? {}) as Partial<MapCinemaMotionConfig>;

  const derivePreset = (): MapCinemaMotionConfig["speedPreset"] => {
    const speed = Math.max(0, toNumber(source.panLngDegPerSec, fallback.panLngDegPerSec));
    if (speed <= 3) {
      return "slow";
    }
    if (speed <= 7) {
      return "medium";
    }
    return "fast";
  };

  const motion: MapCinemaMotionConfig = {
    speedPreset:
      motionSource.speedPreset === "slow" || motionSource.speedPreset === "medium" || motionSource.speedPreset === "fast"
        ? motionSource.speedPreset
        : derivePreset(),
    amplitudeDeg: clampNumber(
      toNumber(motionSource.amplitudeDeg, fallbackMotion.amplitudeDeg),
      1,
      180
    ),
    easing: motionSource.easing === "linear" ? "linear" : "ease-in-out",
    pauseWithOverlay: toBoolean(
      motionSource.pauseWithOverlay,
      fallbackMotion.pauseWithOverlay
    ),
    phaseOffsetDeg: clampNumber(
      toNumber(motionSource.phaseOffsetDeg, fallbackMotion.phaseOffsetDeg),
      0,
      360
    ),
  };

  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    panLngDegPerSec: Math.max(0, toNumber(source.panLngDegPerSec, fallback.panLngDegPerSec)),
    debug: toBoolean((source as { debug?: unknown })?.debug, fallback.debug),
    bandTransition_sec: Math.max(1, Math.round(toNumber(source.bandTransition_sec, fallback.bandTransition_sec))),
    fsmEnabled: toBoolean((source as { fsmEnabled?: unknown })?.fsmEnabled, fallback.fsmEnabled),
    motion,
    bands,
  };
};

const mergeIdlePan = (candidate: unknown): MapIdlePanConfig => {
  const fallback = createDefaultMapIdlePan();
  const source = (candidate as Partial<MapIdlePanConfig>) ?? {};
  const interval = Math.max(10, Math.round(toNumber(source.intervalSec, fallback.intervalSec)));
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    intervalSec: interval,
  };
};

const mergeTheme = (candidate: unknown): MapThemeConfig => {
  const fallback = { ...DEFAULT_THEME };
  const source = (candidate as Partial<MapThemeConfig>) ?? {};
  return {
    sea: sanitizeString(source.sea, fallback.sea),
    land: sanitizeString(source.land, fallback.land),
    label: sanitizeString(source.label, fallback.label),
    contrast: toNumber(source.contrast, fallback.contrast),
    tint: sanitizeString(source.tint, fallback.tint),
  };
};

const mergeMaptiler = (candidate: unknown): MaptilerConfig => {
  const fallback = { ...DEFAULT_MAPTILER };
  const source = (candidate as Partial<MaptilerConfig>) ?? {};
  return {
    key: sanitizeNullableString(source.key, fallback.key ?? null),
    apiKey: sanitizeNullableString(source.apiKey, fallback.apiKey ?? null),
    styleUrl: source.styleUrl || fallback.styleUrl,
    styleUrlDark: sanitizeNullableString(source.styleUrlDark, fallback.styleUrlDark ?? null),
    styleUrlLight: sanitizeNullableString(source.styleUrlLight, fallback.styleUrlLight ?? null),
    styleUrlBright: sanitizeNullableString(source.styleUrlBright, fallback.styleUrlBright ?? null),
  };
};

const mergeXyz = (candidate: unknown): XyzConfig => {
  const fallback = { ...DEFAULT_XYZ };
  const source = (candidate as Partial<XyzConfig>) ?? {};
  return {
    urlTemplate: sanitizeString(source.urlTemplate, fallback.urlTemplate),
    attribution: sanitizeString(source.attribution, fallback.attribution),
    minzoom: clampNumber(Math.round(toNumber(source.minzoom, fallback.minzoom)), 0, 24),
    maxzoom: clampNumber(Math.round(toNumber(source.maxzoom, fallback.maxzoom)), 0, 24),
    tileSize: clampNumber(Math.round(toNumber(source.tileSize, fallback.tileSize)), 64, 512),
    labelsOverlay: toBoolean(source.labelsOverlay, fallback.labelsOverlay ?? false),
  };
};

const mergeMap = (candidate: unknown): MapConfig => {
  const fallback = createDefaultMapSettings();
  const source = (candidate as Partial<MapConfig>) ?? {};
  const allowedStyles: MapConfig["style"][] = [
    "vector-dark",
    "vector-light",
    "vector-bright",
    "raster-carto-dark",
    "raster-carto-light",
    "streets-v4",
  ];
  const allowedProviders: MapConfig["provider"][] = ["maptiler", "osm", "openstreetmap", "xyz"];
  const style = allowedStyles.includes(source.style ?? fallback.style)
    ? (source.style as MapConfig["style"])
    : fallback.style;
  const provider = allowedProviders.includes(source.provider ?? fallback.provider)
    ? (source.provider as MapConfig["provider"])
    : fallback.provider;
  return {
    engine: "maplibre",
    style,
    provider,
    maptiler: mergeMaptiler(source.maptiler),
    xyz: mergeXyz(source.xyz),
    renderWorldCopies: toBoolean(source.renderWorldCopies, fallback.renderWorldCopies),
    interactive: toBoolean(source.interactive, fallback.interactive),
    controls: toBoolean(source.controls, fallback.controls),
    respectReducedMotion: toBoolean(
      (source as { respectReducedMotion?: unknown })?.respectReducedMotion,
      fallback.respectReducedMotion
    ),
    cinema: mergeCinema(source.cinema),
    idlePan: mergeIdlePan((source as { idlePan?: unknown })?.idlePan),
    theme: mergeTheme(source.theme),
  };
};

const mergeMapPreferences = (candidate: unknown): MapPreferences => {
  const fallback = createDefaultMapPreferences();
  const source = (candidate as Partial<MapPreferences>) ?? {};
  const provider: MapPreferences["provider"] =
    source.provider === "maptiler"
      ? "maptiler"
      : source.provider === "openstreetmap"
        ? "openstreetmap"
        : fallback.provider;
  const key = sanitizeApiKey(source.maptiler_api_key);
  return {
    provider,
    maptiler_api_key: provider === "maptiler" ? key : null,
  };
};

const mergeRotation = (candidate: unknown): RotationConfig => {
  const fallback: RotationConfig = {
    enabled: true,
    duration_sec: 10,
    panels: ["clock", "weather", "astronomy", "santoral", "calendar", "harvest", "news", "historicalEvents"],
  };
  const source = (candidate as Partial<RotationConfig>) ?? {};
  const panels = Array.isArray(source.panels)
    ? source.panels.filter((panel): panel is string => typeof panel === "string" && panel.trim().length > 0)
    : fallback.panels;
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    duration_sec: clampNumber(Math.round(toNumber(source.duration_sec, fallback.duration_sec)), 3, 3600),
    panels: panels.length > 0 ? panels : fallback.panels,
  };
};

export const createDefaultStormMode = (): StormModeConfig => ({
  enabled: false,
  center_lat: 39.986,
  center_lng: -0.051,
  zoom: 9.0,
  auto_enable: false,
  auto_disable_after_minutes: 60,
});

export const createDefaultAEMET = (): AEMETConfig => ({
  enabled: false,
  api_key: null,
  cap_enabled: true,
  radar_enabled: true,
  satellite_enabled: false,
  cache_minutes: 15,
  has_api_key: false,
  api_key_last4: null,
});

export const createDefaultBlitzortung = (): BlitzortungConfig => ({
  enabled: false,
  mqtt_host: "127.0.0.1",
  mqtt_port: 1883,
  mqtt_topic: "blitzortung/1",
  ws_enabled: false,
  ws_url: null,
});

export const createDefaultNews = (): NewsConfig => ({
  enabled: true,
  rss_feeds: [
    "https://www.elperiodicomediterraneo.com/rss",
    "https://www.xataka.com/feed",
  ],
  max_items_per_feed: 10,
  refresh_minutes: 30,
});

export const createDefaultCalendar = (): CalendarConfig => ({
  enabled: true,
  google_api_key: null,
  google_calendar_id: null,
  days_ahead: 14,
});

export const createDefaultHarvest = (): HarvestConfig => ({
  enabled: true,
  custom_items: [],
});

export const createDefaultSaints = (): SaintsConfig => ({
  enabled: true,
  include_namedays: true,
  locale: "es",
});

export const createDefaultEphemerides = (): EphemeridesConfig => ({
  enabled: true,
  latitude: 39.986,
  longitude: -0.051,
  timezone: "Europe/Madrid",
});

export const createDefaultOpenSky = (): OpenSkyConfig => ({
  enabled: false,
  mode: "bbox",
  bbox: {
    lamin: 39.5,
    lamax: 41.0,
    lomin: -1.0,
    lomax: 1.5,
  },
  poll_seconds: 10,
  extended: 0,
  max_aircraft: 400,
  cluster: true,
  oauth2: {
    token_url:
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    client_id: "danigt-api-client",
    client_secret: "Mph0txbYD1udcExVL7OrsLoxDjl3eKbQ",
    scope: null,
    has_credentials: true,
    client_id_last4: "ient",
  },
});

export const DEFAULT_CONFIG: AppConfig = {
  display: {
    timezone: "Europe/Madrid",
    module_cycle_seconds: 20,
  },
  map: createDefaultMapPreferences(),
  ui: {
    layout: "grid-2-1",
    map: createDefaultMapSettings(),
    rotation: mergeRotation(undefined),
    cineMode: true,
  },
  news: createDefaultNews(),
  ai: {
    enabled: false,
  },
  storm: createDefaultStormMode(),
  aemet: createDefaultAEMET(),
  blitzortung: createDefaultBlitzortung(),
  calendar: createDefaultCalendar(),
  harvest: createDefaultHarvest(),
  saints: createDefaultSaints(),
  ephemerides: createDefaultEphemerides(),
  opensky: createDefaultOpenSky(),
  layers: {
    flights: {
      enabled: true,
      opacity: 1.0,
      provider: "opensky",
      refresh_seconds: 12,
      max_age_seconds: 90,
      max_items_global: 2000,
      max_items_view: 1200,
      rate_limit_per_min: 6,
      decimate: "none",
      grid_px: 24,
      styleScale: 1.4,
      render_mode: "symbol_custom",
      circle: {
        radius_vh: 0.9, // 0.9% de la altura de la ventana
        opacity: 1.0,
        color: "#FFD400",
        stroke_color: "#000000",
        stroke_width: 2.0,
      },
      symbol: {
        size_vh: 1.6, // 1.6% de la altura de la ventana
        allow_overlap: true,
      },
      cine_focus: {
        enabled: true,
        mode: "both",
        min_severity: "orange",
        radar_dbz_threshold: 30.0,
        buffer_km: 25.0,
        outside_dim_opacity: 0.25,
        hard_hide_outside: false,
      },
      opensky: {
        username: null,
        password: null,
      },
      aviationstack: {
        base_url: "http://api.aviationstack.com/v1",
        api_key: null,
      },
      custom: {
        api_url: null,
        api_key: null,
      },
    },
    ships: {
      enabled: true,
      opacity: 0.9,
      provider: "aisstream",
      update_interval: 10,
      refresh_seconds: 10,
      max_age_seconds: 180,
      max_items_global: 1500,
      max_items_view: 420,
      min_speed_knots: 2.0,
      rate_limit_per_min: 4,
      decimate: "grid",
      grid_px: 24,
      styleScale: 1.4,
      render_mode: "symbol_custom",
      circle: {
        radius_vh: 0.8, // 0.8% de viewport height (más pequeño que vuelos)
        opacity: 1.0,
        color: "#38bdf8",
        stroke_color: "#0f172a",
        stroke_width: 1.5,
      },
      symbol: {
        size_vh: 1.4, // 1.4% de viewport height
        allow_overlap: true,
      },
      cine_focus: {
        enabled: true,
        mode: "both",
        min_severity: "yellow",
        radar_dbz_threshold: 20.0,
        buffer_km: 20.0,
        outside_dim_opacity: 0.30,
        hard_hide_outside: false,
      },
      ais_generic: {
        api_url: null,
        api_key: null,
      },
      aisstream: {
        ws_url: "wss://stream.aisstream.io/v0/stream",
        api_key: "38dd87bbfef35a1f4dc6133293bed27f0e2c9ff7",
        has_api_key: true,
        api_key_last4: "9ff7",
      },
      aishub: {
        base_url: "https://www.aishub.net/api",
        api_key: null,
      },
      custom: {
        api_url: null,
        api_key: null,
      },
    },
    global: createDefaultGlobalLayers(),
  },
};

const mergeStormMode = (candidate: unknown): StormModeConfig => {
  const fallback = createDefaultStormMode();
  const source = (candidate as Partial<StormModeConfig>) ?? {};
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    center_lat: clampNumber(toNumber(source.center_lat, fallback.center_lat), -90, 90),
    center_lng: clampNumber(toNumber(source.center_lng, fallback.center_lng), -180, 180),
    zoom: clampNumber(toNumber(source.zoom, fallback.zoom), 1, 20),
    auto_enable: toBoolean(source.auto_enable, fallback.auto_enable),
    auto_disable_after_minutes: clampNumber(
      Math.round(toNumber(source.auto_disable_after_minutes, fallback.auto_disable_after_minutes)),
      5,
      1440,
    ),
  };
};

const mergeAEMET = (candidate: unknown): AEMETConfig => {
  const fallback = createDefaultAEMET();
  const source = (candidate as Partial<AEMETConfig>) ?? {};
  const sanitizedKey = sanitizeNullableString(source.api_key, null);
  const hasKeyExplicit = typeof source.has_api_key === "boolean" ? source.has_api_key : undefined;
  const derivedHasKey = hasKeyExplicit ?? Boolean(sanitizedKey);
  const last4 = typeof source.api_key_last4 === "string" && source.api_key_last4.trim().length > 0
    ? source.api_key_last4.trim()
    : (sanitizedKey && sanitizedKey.length > 0 ? sanitizedKey.slice(-4) : null);
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    api_key: sanitizedKey,
    cap_enabled: toBoolean(source.cap_enabled, fallback.cap_enabled),
    radar_enabled: toBoolean(source.radar_enabled, fallback.radar_enabled),
    satellite_enabled: toBoolean(source.satellite_enabled, fallback.satellite_enabled),
    cache_minutes: clampNumber(
      Math.round(toNumber(source.cache_minutes, fallback.cache_minutes)),
      1,
      60,
    ),
    has_api_key: derivedHasKey,
    api_key_last4: derivedHasKey ? last4 : null,
  };
};

const mergeBlitzortung = (candidate: unknown): BlitzortungConfig => {
  const fallback = createDefaultBlitzortung();
  const source = (candidate as Partial<BlitzortungConfig>) ?? {};
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    mqtt_host: sanitizeString(source.mqtt_host, fallback.mqtt_host),
    mqtt_port: clampNumber(Math.round(toNumber(source.mqtt_port, fallback.mqtt_port)), 1, 65535),
    mqtt_topic: sanitizeString(source.mqtt_topic, fallback.mqtt_topic),
    ws_enabled: toBoolean(source.ws_enabled, fallback.ws_enabled),
    ws_url: sanitizeNullableString(source.ws_url, fallback.ws_url),
  };
};

const mergeNews = (candidate: unknown): NewsConfig => {
  const fallback = createDefaultNews();
  const source = (candidate as Partial<NewsConfig>) ?? {};
  const rssFeeds = Array.isArray(source.rss_feeds)
    ? source.rss_feeds.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : fallback.rss_feeds;
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    rss_feeds: rssFeeds.length > 0 ? rssFeeds : fallback.rss_feeds,
    max_items_per_feed: clampNumber(
      Math.round(toNumber(source.max_items_per_feed, fallback.max_items_per_feed)),
      1,
      50,
    ),
    refresh_minutes: clampNumber(
      Math.round(toNumber(source.refresh_minutes, fallback.refresh_minutes)),
      5,
      1440,
    ),
  };
};

const mergeCalendar = (candidate: unknown): CalendarConfig => {
  const fallback = createDefaultCalendar();
  const source = (candidate as Partial<CalendarConfig>) ?? {};
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    google_api_key: sanitizeNullableString(source.google_api_key, fallback.google_api_key),
    google_calendar_id: sanitizeNullableString(source.google_calendar_id, fallback.google_calendar_id),
    days_ahead: clampNumber(Math.round(toNumber(source.days_ahead, fallback.days_ahead)), 1, 90),
  };
};

const mergeHarvest = (candidate: unknown): HarvestConfig => {
  const fallback = createDefaultHarvest();
  const source = (candidate as Partial<HarvestConfig>) ?? {};
  const customItems = Array.isArray(source.custom_items)
    ? source.custom_items.filter(
      (item): item is Record<string, string> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    )
    : fallback.custom_items;
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    custom_items: customItems,
  };
};

const mergeSaints = (candidate: unknown): SaintsConfig => {
  const fallback = createDefaultSaints();
  const source = (candidate as Partial<SaintsConfig>) ?? {};
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    include_namedays: toBoolean(source.include_namedays, fallback.include_namedays),
    locale: sanitizeString(source.locale, fallback.locale).substring(0, 5),
  };
};

const mergeEphemerides = (candidate: unknown): EphemeridesConfig => {
  const fallback = createDefaultEphemerides();
  const source = (candidate as Partial<EphemeridesConfig>) ?? {};
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    latitude: clampNumber(toNumber(source.latitude, fallback.latitude), -90, 90),
    longitude: clampNumber(toNumber(source.longitude, fallback.longitude), -180, 180),
    timezone: sanitizeString(source.timezone, fallback.timezone),
  };
};

const mergeOpenSky = (candidate: unknown): OpenSkyConfig => {
  const fallback = DEFAULT_CONFIG.opensky ?? createDefaultOpenSky();
  const source = (candidate as Partial<OpenSkyConfig>) ?? {};
  const bboxSource = (source.bbox ?? {}) as Partial<OpenSkyConfig["bbox"]>;
  const bboxFallback = fallback.bbox;
  const oauthSource = (source.oauth2 ?? {}) as Partial<OpenSkyOAuthConfig>;
  const oauthFallback = fallback.oauth2;

  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    mode: source.mode === "global" ? "global" : "bbox",
    bbox: {
      lamin: clampNumber(toNumber(bboxSource.lamin, bboxFallback.lamin), -90, 90),
      lamax: clampNumber(toNumber(bboxSource.lamax, bboxFallback.lamax), -90, 90),
      lomin: clampNumber(toNumber(bboxSource.lomin, bboxFallback.lomin), -180, 180),
      lomax: clampNumber(toNumber(bboxSource.lomax, bboxFallback.lomax), -180, 180),
    },
    poll_seconds: clampNumber(Math.round(toNumber(source.poll_seconds, fallback.poll_seconds)), 5, 3600),
    extended: source.extended === 1 ? 1 : 0,
    max_aircraft: clampNumber(Math.round(toNumber(source.max_aircraft, fallback.max_aircraft)), 100, 1000),
    cluster: toBoolean(source.cluster, fallback.cluster),
    oauth2: {
      token_url: sanitizeString(oauthSource.token_url, oauthFallback.token_url),
      client_id: sanitizeNullableString(oauthSource.client_id, null),
      client_secret: sanitizeNullableString(oauthSource.client_secret, null),
      scope: sanitizeNullableString(oauthSource.scope, oauthFallback.scope ?? null),
      has_credentials: toBoolean(oauthSource.has_credentials, oauthFallback.has_credentials),
      client_id_last4:
        typeof oauthSource.client_id_last4 === "string" && oauthSource.client_id_last4.trim().length > 0
          ? oauthSource.client_id_last4.trim()
          : oauthFallback.client_id_last4 ?? null,
    },
  };
};

const mergeCustomFlight = (candidate: unknown): CustomFlightConfig => {
  const fallback: Required<CustomFlightConfig> = {
    api_url: null,
    api_key: null,
  };
  const source = (candidate as Partial<CustomFlightConfig>) ?? {};
  return {
    api_url: sanitizeNullableString(source.api_url, fallback.api_url),
    api_key: sanitizeNullableString(source.api_key, fallback.api_key),
  };
};

const mergeCustomShip = (candidate: unknown): CustomShipConfig => {
  const fallback: Required<CustomShipConfig> = {
    api_url: null,
    api_key: null,
  };
  const source = (candidate as Partial<CustomShipConfig>) ?? {};
  return {
    api_url: sanitizeNullableString(source.api_url, fallback.api_url),
    api_key: sanitizeNullableString(source.api_key, fallback.api_key),
  };
};

const mergeFlightsLayer = (candidate: unknown): FlightsLayerConfig => {
  const fallback = DEFAULT_CONFIG.layers.flights;
  const source = (candidate as Partial<FlightsLayerConfig>) ?? {};
  const cineFocusSource: Partial<FlightsLayerConfig["cine_focus"]> = source.cine_focus ?? {};
  const cineFocusFallback = fallback.cine_focus;

  const openskySource: Partial<OpenSkyAuthConfig> = source.opensky ?? {};
  const openskyFallback: Required<OpenSkyAuthConfig> = {
    username: fallback.opensky?.username ?? null,
    password: fallback.opensky?.password ?? null,
  };

  const aviationstackSource: Partial<AviationStackConfig> = source.aviationstack ?? {};
  const aviationstackFallback: Required<AviationStackConfig> = {
    base_url: fallback.aviationstack?.base_url ?? "http://api.aviationstack.com/v1",
    api_key: fallback.aviationstack?.api_key ?? null,
  };

  const circleSource: Partial<FlightsLayerCircleConfig> = source.circle ?? {};
  const circleFallback: FlightsLayerCircleConfig = fallback.circle ?? {
    radius_vh: 0.9,
    opacity: 1.0,
    color: "#FFD400",
    stroke_color: "#000000",
    stroke_width: 2.0,
  };

  const symbolSource: Partial<FlightsLayerSymbolConfig> = source.symbol ?? {};
  const symbolFallback: FlightsLayerSymbolConfig = fallback.symbol ?? {
    size_vh: 1.6,
    allow_overlap: true,
  };

  const allowedProviders: Array<"opensky" | "aviationstack" | "custom"> = ["opensky", "aviationstack", "custom"];
  const provider = allowedProviders.includes(source.provider as any)
    ? (source.provider as "opensky" | "aviationstack" | "custom")
    : "opensky";

  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    opacity: clampNumber(toNumber(source.opacity, fallback.opacity), 0.0, 1.0),
    provider,
    refresh_seconds: clampNumber(
      Math.round(toNumber(source.refresh_seconds, fallback.refresh_seconds)),
      1,
      300,
    ),
    max_age_seconds: clampNumber(
      Math.round(toNumber(source.max_age_seconds, fallback.max_age_seconds)),
      10,
      600,
    ),
    max_items_global: clampNumber(
      Math.round(toNumber(source.max_items_global, fallback.max_items_global)),
      1,
      10000,
    ),
    max_items_view: clampNumber(
      Math.round(toNumber(source.max_items_view, fallback.max_items_view)),
      1,
      2000,
    ),
    rate_limit_per_min: clampNumber(
      Math.round(toNumber(source.rate_limit_per_min, fallback.rate_limit_per_min)),
      1,
      60,
    ),
    decimate: source.decimate === "none" ? "none" : "grid",
    grid_px: clampNumber(
      Math.round(toNumber(source.grid_px, fallback.grid_px)),
      8,
      128,
    ),
    styleScale: clampNumber(toNumber(source.styleScale, fallback.styleScale), 0.1, 4.0),
    render_mode: sanitizeRenderMode(source.render_mode, fallback.render_mode ?? "auto"),
    circle: mergeCircleOptions(circleSource, circleFallback),
    symbol: mergeSymbolOptions(symbolSource, symbolFallback),
    cine_focus: {
      enabled: toBoolean(cineFocusSource.enabled, cineFocusFallback.enabled),
      mode: (cineFocusSource.mode === "cap" || cineFocusSource.mode === "radar")
        ? cineFocusSource.mode
        : "both",
      min_severity: (cineFocusSource.min_severity === "yellow" || cineFocusSource.min_severity === "red")
        ? cineFocusSource.min_severity
        : "orange",
      radar_dbz_threshold: clampNumber(
        toNumber(cineFocusSource.radar_dbz_threshold, cineFocusFallback.radar_dbz_threshold),
        0.0,
        100.0,
      ),
      buffer_km: clampNumber(
        toNumber(cineFocusSource.buffer_km, cineFocusFallback.buffer_km),
        0.0,
        500.0,
      ),
      outside_dim_opacity: clampNumber(
        toNumber(cineFocusSource.outside_dim_opacity, cineFocusFallback.outside_dim_opacity),
        0.0,
        1.0,
      ),
      hard_hide_outside: toBoolean(cineFocusSource.hard_hide_outside, cineFocusFallback.hard_hide_outside),
    },
    opensky: {
      username: sanitizeNullableString(openskySource.username, openskyFallback.username),
      password: sanitizeNullableString(openskySource.password, openskyFallback.password),
    },
    aviationstack: {
      base_url: sanitizeNullableString(aviationstackSource.base_url, aviationstackFallback.base_url ?? null),
      api_key: sanitizeNullableString(aviationstackSource.api_key, aviationstackFallback.api_key ?? null),
    },
    custom: mergeCustomFlight(source.custom),
  };
};

const mergeShipsLayer = (candidate: unknown): ShipsLayerConfig => {
  const fallback = DEFAULT_CONFIG.layers.ships;
  const source = (candidate as Partial<ShipsLayerConfig>) ?? {};
  const cineFocusSource: Partial<ShipsLayerConfig["cine_focus"]> = source.cine_focus ?? {};
  const cineFocusFallback = fallback.cine_focus;

  const aisGenericSource: Partial<GenericAISConfig> = source.ais_generic ?? {};
  const aisGenericFallback: Required<GenericAISConfig> = {
    api_url: fallback.ais_generic?.api_url ?? null,
    api_key: fallback.ais_generic?.api_key ?? null,
  };
  const aisstreamSource: Partial<AISStreamConfig> = source.aisstream ?? {};
  const aisstreamFallback: Required<AISStreamConfig> = {
    ws_url: fallback.aisstream?.ws_url ?? null,
    api_key: null,
    has_api_key: fallback.aisstream?.has_api_key ?? false,
    api_key_last4: fallback.aisstream?.api_key_last4 ?? null,
  };
  const aishubSource: Partial<AISHubConfig> = source.aishub ?? {};
  const aishubFallback: Required<AISHubConfig> = {
    base_url: fallback.aishub?.base_url ?? "https://www.aishub.net/api",
    api_key: fallback.aishub?.api_key ?? null,
  };

  const allowedProviders: Array<"ais_generic" | "aisstream" | "aishub" | "custom"> = ["ais_generic", "aisstream", "aishub", "custom"];
  const provider = allowedProviders.includes(source.provider as any)
    ? (source.provider as "ais_generic" | "aisstream" | "aishub" | "custom")
    : "ais_generic";

  const updateInterval = clampNumber(
    Math.round(
      toNumber(
        source.update_interval,
        toNumber(source.refresh_seconds, fallback.update_interval ?? fallback.refresh_seconds),
      ),
    ),
    1,
    300,
  );

  const refreshSeconds = clampNumber(
    Math.round(toNumber(source.refresh_seconds, updateInterval)),
    1,
    300,
  );

  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    opacity: clampNumber(toNumber(source.opacity, fallback.opacity), 0.0, 1.0),
    provider,
    update_interval: updateInterval,
    refresh_seconds: refreshSeconds,
    max_age_seconds: clampNumber(
      Math.round(toNumber(source.max_age_seconds, fallback.max_age_seconds)),
      10,
      600,
    ),
    max_items_global: clampNumber(
      Math.round(toNumber(source.max_items_global, fallback.max_items_global)),
      1,
      10000,
    ),
    max_items_view: clampNumber(
      Math.round(toNumber(source.max_items_view, fallback.max_items_view)),
      1,
      2000,
    ),
    min_speed_knots: clampNumber(
      toNumber(source.min_speed_knots, fallback.min_speed_knots),
      0.0,
      50.0,
    ),
    rate_limit_per_min: clampNumber(
      Math.round(toNumber(source.rate_limit_per_min, fallback.rate_limit_per_min)),
      1,
      60,
    ),
    decimate: source.decimate === "none" ? "none" : "grid",
    grid_px: clampNumber(
      Math.round(toNumber(source.grid_px, fallback.grid_px)),
      8,
      128,
    ),
    styleScale: clampNumber(toNumber(source.styleScale, fallback.styleScale), 0.1, 4.0),
    render_mode: sanitizeShipsRenderMode(source.render_mode, fallback.render_mode ?? "auto"),
    circle: mergeCircleOptions(
      (source.circle as Partial<ShipsLayerCircleConfig>) ?? {},
      (fallback.circle as ShipsLayerCircleConfig) ?? {
        radius_vh: 0.8,
        opacity: 1.0,
        color: "#5ad35a",
        stroke_color: "#002200",
        stroke_width: 2.0,
      }
    ) as ShipsLayerCircleConfig,
    symbol: mergeSymbolOptions(
      (source.symbol as Partial<ShipsLayerSymbolConfig>) ?? {},
      (fallback.symbol as ShipsLayerSymbolConfig) ?? {
        size_vh: 1.4,
        allow_overlap: true,
      }
    ) as ShipsLayerSymbolConfig,
    cine_focus: {
      enabled: toBoolean(cineFocusSource.enabled, cineFocusFallback.enabled),
      mode: (cineFocusSource.mode === "cap" || cineFocusSource.mode === "radar")
        ? cineFocusSource.mode
        : "both",
      min_severity: (cineFocusSource.min_severity === "yellow" || cineFocusSource.min_severity === "red")
        ? cineFocusSource.min_severity
        : "yellow",
      radar_dbz_threshold: clampNumber(
        toNumber(cineFocusSource.radar_dbz_threshold, cineFocusFallback.radar_dbz_threshold),
        0.0,
        100.0,
      ),
      buffer_km: clampNumber(
        toNumber(cineFocusSource.buffer_km, cineFocusFallback.buffer_km),
        0.0,
        500.0,
      ),
      outside_dim_opacity: clampNumber(
        toNumber(cineFocusSource.outside_dim_opacity, cineFocusFallback.outside_dim_opacity),
        0.0,
        1.0,
      ),
      hard_hide_outside: toBoolean(cineFocusSource.hard_hide_outside, cineFocusFallback.hard_hide_outside),
    },
    ais_generic: {
      api_url: sanitizeNullableString(aisGenericSource.api_url, aisGenericFallback.api_url ?? null),
      api_key: sanitizeNullableString(aisGenericSource.api_key, aisGenericFallback.api_key ?? null),
    },
    aisstream: {
      ws_url: sanitizeNullableString(aisstreamSource.ws_url, aisstreamFallback.ws_url ?? null),
      api_key: null,
      has_api_key: Boolean(
        aisstreamSource.has_api_key ?? aisstreamFallback.has_api_key ?? false,
      ),
      api_key_last4: sanitizeNullableString(
        aisstreamSource.api_key_last4,
        aisstreamFallback.api_key_last4 ?? null,
      ),
    },
    aishub: {
      base_url: sanitizeNullableString(aishubSource.base_url, aishubFallback.base_url ?? null),
      api_key: sanitizeNullableString(aishubSource.api_key, aishubFallback.api_key ?? null),
    },
    custom: mergeCustomShip(source.custom),
  };
};

const mergeGlobalSatelliteLayer = (candidate: unknown): GlobalSatelliteLayerConfig => {
  const globalFallback = DEFAULT_CONFIG.layers.global ?? createDefaultGlobalLayers();
  const fallback = globalFallback.satellite;
  const source = (candidate as Partial<GlobalSatelliteLayerConfig>) ?? {};

  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    provider: "gibs", // Solo un proveedor por ahora
    refresh_minutes: clampNumber(
      Math.round(toNumber(source.refresh_minutes, fallback.refresh_minutes)),
      1,
      1440,
    ),
    history_minutes: clampNumber(
      Math.round(toNumber(source.history_minutes, fallback.history_minutes)),
      1,
      1440,
    ),
    frame_step: clampNumber(
      Math.round(toNumber(source.frame_step, fallback.frame_step)),
      1,
      1440,
    ),
    opacity: clampNumber(toNumber(source.opacity, fallback.opacity), 0.0, 1.0),
  };
};

const mergeGlobalRadarLayer = (candidate: unknown): GlobalRadarLayerConfig => {
  const globalFallback = DEFAULT_CONFIG.layers.global ?? createDefaultGlobalLayers();
  const fallback = globalFallback.radar;
  const source = (candidate as Partial<GlobalRadarLayerConfig>) ?? {};
  const fallbackHasKey = typeof fallback.has_api_key === "boolean" ? fallback.has_api_key : false;
  const fallbackLast4 = typeof fallback.api_key_last4 === "string" ? fallback.api_key_last4 : null;

  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    provider: sanitizeRadarProvider(source.provider, fallback.provider),
    refresh_minutes: clampNumber(
      Math.round(toNumber(source.refresh_minutes, fallback.refresh_minutes)),
      1,
      1440,
    ),
    history_minutes: clampNumber(
      Math.round(toNumber(source.history_minutes, fallback.history_minutes)),
      1,
      1440,
    ),
    frame_step: clampNumber(
      Math.round(toNumber(source.frame_step, fallback.frame_step)),
      1,
      1440,
    ),
    opacity: clampNumber(toNumber(source.opacity, fallback.opacity), 0.0, 1.0),
    has_api_key:
      typeof (source as { has_api_key?: unknown }).has_api_key === "boolean"
        ? Boolean((source as { has_api_key?: unknown }).has_api_key)
        : fallbackHasKey,
    api_key_last4: sanitizeNullableString(
      (source as { api_key_last4?: unknown }).api_key_last4,
      fallbackLast4,
    ),
  };
};

const mergeGlobalLayers = (candidate: unknown): GlobalLayersConfig => {
  const fallback = DEFAULT_CONFIG.layers.global ?? createDefaultGlobalLayers();
  const source = (candidate as Partial<GlobalLayersConfig>) ?? {};

  return {
    satellite: mergeGlobalSatelliteLayer(source.satellite),
    radar: mergeGlobalRadarLayer(source.radar),
  };
};

export const withConfigDefaults = (payload?: Partial<AppConfig>): AppConfig => {
  if (!payload) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig;
  }

  const display = (payload.display ?? {}) as Partial<DisplayConfig>;
  const map = (payload.map ?? {}) as Partial<MapPreferences>;
  const ui = (payload.ui ?? {}) as Partial<UIConfig>;
  const news = (payload.news ?? {}) as Partial<NewsConfig>;
  const ai = (payload.ai ?? {}) as Partial<AIConfig>;
  const storm = (payload.storm ?? {}) as Partial<StormModeConfig>;
  const aemet = (payload.aemet ?? {}) as Partial<AEMETConfig>;
  const blitzortung = (payload.blitzortung ?? {}) as Partial<BlitzortungConfig>;
  const calendar = (payload.calendar ?? {}) as Partial<CalendarConfig>;
  const harvest = (payload.harvest ?? {}) as Partial<HarvestConfig>;
  const saints = (payload.saints ?? {}) as Partial<SaintsConfig>;
  const ephemerides = (payload.ephemerides ?? {}) as Partial<EphemeridesConfig>;
  const opensky = (payload.opensky ?? {}) as Partial<OpenSkyConfig>;
  const layers = (payload.layers ?? {}) as Partial<LayersConfig>;

  // Usar getters seguros para evitar crashes si display o timezone no existen
  const displayTimezone = display?.timezone;
  const safeTimezone = typeof displayTimezone === "string" && displayTimezone.trim()
    ? displayTimezone.trim()
    : DEFAULT_CONFIG.display.timezone;

  const displayModuleCycle = display?.module_cycle_seconds;
  const safeModuleCycle = clampNumber(
    Math.round(toNumber(displayModuleCycle, DEFAULT_CONFIG.display.module_cycle_seconds)),
    5,
    600,
  );

  return {
    display: {
      timezone: safeTimezone,
      module_cycle_seconds: safeModuleCycle,
    },
    map: mergeMapPreferences(map),
    ui: {
      layout: "grid-2-1",
      map: mergeMap(ui.map),
      rotation: mergeRotation(ui.rotation),
      cineMode: toBoolean(ui.cineMode, DEFAULT_CONFIG.ui.cineMode ?? true),
    },
    news: mergeNews(news),
    ai: {
      enabled: toBoolean(ai.enabled, DEFAULT_CONFIG.ai.enabled),
    },
    storm: mergeStormMode(storm),
    aemet: mergeAEMET(aemet),
    blitzortung: mergeBlitzortung(blitzortung),
    calendar: mergeCalendar(calendar),
    harvest: mergeHarvest(harvest),
    saints: mergeSaints(saints),
    ephemerides: mergeEphemerides(ephemerides),
    opensky: mergeOpenSky(opensky),
    layers: {
      flights: mergeFlightsLayer(layers.flights),
      ships: mergeShipsLayer(layers.ships),
      global: mergeGlobalLayers(layers.global),
    },
  };
};
