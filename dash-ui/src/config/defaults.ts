import type {
  AEMETConfig,
  AIConfig,
  AppConfig,
  BlitzortungConfig,
  CalendarConfig,
  DisplayConfig,
  EphemeridesConfig,
  FlightsLayerConfig,
  GlobalLayersConfig,
  GlobalRadarLayerConfig,
  GlobalSatelliteLayerConfig,
  HarvestConfig,
  LayersConfig,
  MapCinemaBand,
  MapCinemaConfig,
  MapConfig,
  MapIdlePanConfig,
  MapThemeConfig,
  MaptilerConfig,
  MapPreferences,
  NewsConfig,
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

const DEFAULT_CINEMA_BANDS: readonly MapCinemaBand[] = [
  { lat: 0, zoom: 2.8, pitch: 10, minZoom: 2.6, duration_sec: 900 },
  { lat: 18, zoom: 3.0, pitch: 8, minZoom: 2.8, duration_sec: 720 },
  { lat: 32, zoom: 3.3, pitch: 6, minZoom: 3.0, duration_sec: 600 },
  { lat: 42, zoom: 3.6, pitch: 6, minZoom: 3.2, duration_sec: 480 },
  { lat: -18, zoom: 3.0, pitch: 8, minZoom: 2.8, duration_sec: 720 },
  { lat: -32, zoom: 3.3, pitch: 6, minZoom: 3.0, duration_sec: 600 },
];

const DEFAULT_THEME: MapThemeConfig = {
  sea: "#0b3756",
  land: "#20262c",
  label: "#d6e7ff",
  contrast: 0.15,
  tint: "rgba(0,170,255,0.06)",
};

const DEFAULT_MAPTILER: MaptilerConfig = {
  key: null,
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
  provider: "osm",
  maptiler_api_key: null,
});

export const createDefaultMapCinema = (): MapCinemaConfig => ({
  enabled: false,
  panLngDegPerSec: 0,
  bandTransition_sec: 8,
  bands: DEFAULT_CINEMA_BANDS.map((band) => ({ ...band })),
});

export const createDefaultMapIdlePan = (): MapIdlePanConfig => ({
  enabled: false,
  intervalSec: 300,
});

export const createDefaultMapSettings = (): MapConfig => ({
  engine: "maplibre",
  style: "vector-dark",
  provider: "osm",
  maptiler: { ...DEFAULT_MAPTILER },
  renderWorldCopies: true,
  interactive: false,
  controls: false,
  respectReducedMotion: false,
  cinema: createDefaultMapCinema(),
  idlePan: createDefaultMapIdlePan(),
  theme: { ...DEFAULT_THEME },
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
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    panLngDegPerSec: Math.max(0, toNumber(source.panLngDegPerSec, fallback.panLngDegPerSec)),
    bandTransition_sec: Math.max(1, Math.round(toNumber(source.bandTransition_sec, fallback.bandTransition_sec))),
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
    key: sanitizeNullableString(source.key, fallback.key),
    styleUrlDark: sanitizeNullableString(source.styleUrlDark, fallback.styleUrlDark),
    styleUrlLight: sanitizeNullableString(source.styleUrlLight, fallback.styleUrlLight),
    styleUrlBright: sanitizeNullableString(source.styleUrlBright, fallback.styleUrlBright),
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
  ];
  const allowedProviders: MapConfig["provider"][] = ["maptiler", "osm"];
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
  const provider: MapPreferences["provider"] = source.provider === "maptiler" ? "maptiler" : fallback.provider;
  const key = sanitizeApiKey(source.maptiler_api_key);
  return {
    provider,
    maptiler_api_key: provider === "maptiler" ? key : null,
  };
};

const mergeRotation = (candidate: unknown): RotationConfig => {
  const fallback: RotationConfig = {
    enabled: false,
    duration_sec: 10,
    panels: ["news", "ephemerides", "moon", "forecast", "calendar"],
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
  layers: {
    flights: {
      enabled: true,
      opacity: 0.9,
      provider: "opensky",
      refresh_seconds: 12,
      max_age_seconds: 120,
      max_items_global: 2000,
      max_items_view: 360,
      rate_limit_per_min: 6,
      decimate: "grid",
      grid_px: 28,
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
    },
    ships: {
      enabled: true,
      opacity: 0.9,
      provider: "ais_generic",
      refresh_seconds: 18,
      max_age_seconds: 180,
      max_items_global: 1500,
      max_items_view: 300,
      min_speed_knots: 2.0,
      rate_limit_per_min: 4,
      decimate: "grid",
      grid_px: 28,
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
        ws_url: null,
        api_key: null,
      },
      aishub: {
        base_url: "https://www.aishub.net/api",
        api_key: null,
      },
    },
    global: {
      satellite: {
        enabled: true,
        provider: "gibs" as const,
        refresh_minutes: 10,
        history_minutes: 90,
        frame_step: 10,
        opacity: 0.7,
      },
      radar: {
        enabled: true,
        provider: "rainviewer" as const,
        refresh_minutes: 5,
        history_minutes: 90,
        frame_step: 5,
        opacity: 0.7,
      },
    },
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
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    api_key: sanitizeNullableString(source.api_key, fallback.api_key),
    cap_enabled: toBoolean(source.cap_enabled, fallback.cap_enabled),
    radar_enabled: toBoolean(source.radar_enabled, fallback.radar_enabled),
    satellite_enabled: toBoolean(source.satellite_enabled, fallback.satellite_enabled),
    cache_minutes: clampNumber(
      Math.round(toNumber(source.cache_minutes, fallback.cache_minutes)),
      1,
      60,
    ),
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

const mergeFlightsLayer = (candidate: unknown): FlightsLayerConfig => {
  const fallback = DEFAULT_CONFIG.layers.flights;
  const source = (candidate as Partial<FlightsLayerConfig>) ?? {};
  const cineFocusSource = source.cine_focus ?? {};
  const cineFocusFallback = fallback.cine_focus;
  
  const openskySource = source.opensky ?? {};
  const openskyFallback = fallback.opensky ?? { username: null, password: null };
  const aviationstackSource = source.aviationstack ?? {};
  const aviationstackFallback = fallback.aviationstack ?? { base_url: "http://api.aviationstack.com/v1", api_key: null };
  
  const provider = (source.provider === "aviationstack" || source.provider === "custom")
    ? source.provider
    : "opensky";
  
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    opacity: clampNumber(toNumber(source.opacity, fallback.opacity), 0.0, 1.0),
    provider: provider,
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
      base_url: sanitizeNullableString(aviationstackSource.base_url, aviationstackFallback.base_url),
      api_key: sanitizeNullableString(aviationstackSource.api_key, aviationstackFallback.api_key),
    },
  };
};

const mergeShipsLayer = (candidate: unknown): ShipsLayerConfig => {
  const fallback = DEFAULT_CONFIG.layers.ships;
  const source = (candidate as Partial<ShipsLayerConfig>) ?? {};
  const cineFocusSource = source.cine_focus ?? {};
  const cineFocusFallback = fallback.cine_focus;
  
  const aisGenericSource = source.ais_generic ?? {};
  const aisGenericFallback = fallback.ais_generic ?? { api_url: null, api_key: null };
  const aisstreamSource = source.aisstream ?? {};
  const aisstreamFallback = fallback.aisstream ?? { ws_url: null, api_key: null };
  const aishubSource = source.aishub ?? {};
  const aishubFallback = fallback.aishub ?? { base_url: "https://www.aishub.net/api", api_key: null };
  
  const provider = (source.provider === "aisstream" || source.provider === "aishub" || source.provider === "custom")
    ? source.provider
    : "ais_generic";
  
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    opacity: clampNumber(toNumber(source.opacity, fallback.opacity), 0.0, 1.0),
    provider: provider,
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
      api_url: sanitizeNullableString(aisGenericSource.api_url, aisGenericFallback.api_url),
      api_key: sanitizeNullableString(aisGenericSource.api_key, aisGenericFallback.api_key),
    },
    aisstream: {
      ws_url: sanitizeNullableString(aisstreamSource.ws_url, aisstreamFallback.ws_url),
      api_key: sanitizeNullableString(aisstreamSource.api_key, aisstreamFallback.api_key),
    },
    aishub: {
      base_url: sanitizeNullableString(aishubSource.base_url, aishubFallback.base_url),
      api_key: sanitizeNullableString(aishubSource.api_key, aishubFallback.api_key),
    },
  };
};

const mergeGlobalSatelliteLayer = (candidate: unknown): GlobalSatelliteLayerConfig => {
  const fallback = DEFAULT_CONFIG.layers.global.satellite;
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
  const fallback = DEFAULT_CONFIG.layers.global.radar;
  const source = (candidate as Partial<GlobalRadarLayerConfig>) ?? {};
  
  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    provider: "rainviewer", // Solo un proveedor por ahora
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

const mergeGlobalLayers = (candidate: unknown): GlobalLayersConfig => {
  const fallback = DEFAULT_CONFIG.layers.global;
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
  const layers = (payload.layers ?? {}) as Partial<LayersConfig>;

  return {
    display: {
      timezone: sanitizeString(display.timezone, DEFAULT_CONFIG.display.timezone),
      module_cycle_seconds: clampNumber(
        Math.round(toNumber(display.module_cycle_seconds, DEFAULT_CONFIG.display.module_cycle_seconds)),
        5,
        600,
      ),
    },
    map: mergeMapPreferences(map),
    ui: {
      layout: "grid-2-1",
      map: mergeMap(ui.map),
      rotation: mergeRotation(ui.rotation),
      cineMode: toBoolean(ui.cineMode, DEFAULT_CONFIG.ui.cineMode),
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
    layers: {
      flights: mergeFlightsLayer(layers.flights),
      ships: mergeShipsLayer(layers.ships),
      global: mergeGlobalLayers(layers.global),
    },
  };
};
