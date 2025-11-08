"""
Esquema v2 de configuración - limpio y mínimo para Fase 2.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Optional, Literal, List, Dict, Any


class DisplayConfig(BaseModel):
    """Configuración de display."""
    timezone: str = Field(default="Europe/Madrid", min_length=1)
    module_cycle_seconds: Optional[int] = Field(default=20, ge=1, le=300)


class MapCenter(BaseModel):
    """Coordenadas del centro del mapa."""
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class LocalRasterConfig(BaseModel):
    """Configuración del proveedor local raster OSM."""
    tileUrl: str = Field(default="https://tile.openstreetmap.org/{z}/{x}/{y}.png")
    minzoom: int = Field(default=0, ge=0, le=24)
    maxzoom: int = Field(default=19, ge=0, le=24)


class MapTilerUrlsConfig(BaseModel):
    """URLs de estilos MapTiler v2."""
    styleUrlDark: Optional[str] = Field(default=None, max_length=512)
    styleUrlLight: Optional[str] = Field(default=None, max_length=512)
    styleUrlBright: Optional[str] = Field(default=None, max_length=512)


class MapTilerConfig(BaseModel):
    """Configuración del proveedor MapTiler vector."""
    style: Optional[str] = Field(default=None, max_length=64)  # "vector-dark", "streets-v2", etc.
    urls: Optional[MapTilerUrlsConfig] = None
    # Legacy fields
    apiKey: Optional[str] = Field(default=None, max_length=256)
    styleUrl: Optional[str] = Field(default=None, max_length=512)


class CustomXyzConfig(BaseModel):
    """Configuración del proveedor XYZ personalizado."""
    tileUrl: Optional[str] = Field(default=None, max_length=512)
    minzoom: int = Field(default=0, ge=0, le=24)
    maxzoom: int = Field(default=19, ge=0, le=24)


class MapFixedView(BaseModel):
    """Vista fija del mapa."""
    center: MapCenter
    zoom: float = Field(ge=1, le=20)
    bearing: float = Field(default=0, ge=-180, le=180)
    pitch: float = Field(default=0, ge=0, le=60)


class MapAoiCycleStop(BaseModel):
    """Parada en el ciclo de AOI."""
    center: MapCenter
    zoom: float = Field(ge=1, le=20)
    bearing: float = Field(default=0, ge=-180, le=180)
    pitch: float = Field(default=0, ge=0, le=60)
    duration_sec: Optional[int] = Field(default=None, ge=1)


class MapAoiCycle(BaseModel):
    """Ciclo de áreas de interés."""
    intervalSec: int = Field(ge=1)
    stops: List[MapAoiCycleStop] = Field(default_factory=list)


class MapRegion(BaseModel):
    """Región del mapa por código postal."""
    postalCode: Optional[str] = Field(default=None, max_length=10)


class MapConfig(BaseModel):
    """Configuración del mapa v2."""
    engine: Literal["maplibre"] = "maplibre"
    provider: Literal["local_raster_xyz", "maptiler_vector", "custom_xyz"] = "local_raster_xyz"
    renderWorldCopies: bool = Field(default=True)
    interactive: bool = Field(default=False)
    controls: bool = Field(default=False)
    local: Optional[LocalRasterConfig] = None
    maptiler: Optional[MapTilerConfig] = None
    customXyz: Optional[CustomXyzConfig] = None
    viewMode: Literal["fixed", "aoiCycle"] = "fixed"
    fixed: Optional[MapFixedView] = None
    aoiCycle: Optional[MapAoiCycle] = None
    region: Optional[MapRegion] = None


class SatelliteConfig(BaseModel):
    """Configuración de satélite global."""
    enabled: bool = True
    provider: Literal["gibs"] = "gibs"
    opacity: float = Field(default=1.0, ge=0, le=1)


class RadarConfig(BaseModel):
    """Configuración de radar global."""
    enabled: bool = False
    provider: Literal["rainviewer", "aemet"] = "rainviewer"
    opacity: float = Field(default=0.7, ge=0.0, le=1.0)
    layer_type: Optional[str] = Field(default="precipitation_new", max_length=64)


class RotatorDurationsConfig(BaseModel):
    """Configuración de duraciones por tarjeta del rotator."""
    clock: int = Field(default=10, ge=3, le=300)
    weather: int = Field(default=12, ge=3, le=300)
    astronomy: int = Field(default=10, ge=3, le=300)
    santoral: int = Field(default=8, ge=3, le=300)
    calendar: int = Field(default=12, ge=3, le=300)
    news: int = Field(default=12, ge=3, le=300)


class RotatorConfig(BaseModel):
    """Configuración del panel rotativo overlay."""
    enabled: bool = Field(default=True)
    order: List[str] = Field(
        default_factory=lambda: ["clock", "weather", "astronomy", "santoral", "calendar", "news"]
    )
    durations_sec: Optional[RotatorDurationsConfig] = None
    transition_ms: int = Field(default=400, ge=0, le=2000)
    pause_on_alert: bool = Field(default=False)


class OverlayConfig(BaseModel):
    """Configuración del overlay (rotator, etc.)."""
    rotator: Optional[RotatorConfig] = None


class UIGlobalConfig(BaseModel):
    """Configuración global de UI (satélite, radar, overlay)."""
    satellite: Optional[SatelliteConfig] = None
    radar: Optional[RadarConfig] = None
    overlay: Optional[OverlayConfig] = None


class FlightsLayerCircleConfig(BaseModel):
    """Configuración de círculos de vuelos."""
    radius_base: float = Field(default=7.5, ge=1, le=50)
    radius_zoom_scale: float = Field(default=1.7, ge=0.1, le=5)
    opacity: float = Field(default=1.0, ge=0, le=1)
    color: str = "#FFD400"
    stroke_color: str = "#000000"
    stroke_width: float = Field(default=2.0, ge=0, le=10)


class OpenSkyBBoxConfig(BaseModel):
    """Configuración de bounding box para OpenSky."""
    lamin: float = Field(default=39.5, ge=-90, le=90)
    lamax: float = Field(default=41.0, ge=-90, le=90)
    lomin: float = Field(default=-1.0, ge=-180, le=180)
    lomax: float = Field(default=1.5, ge=-180, le=180)


class OpenSkyProviderConfig(BaseModel):
    """Configuración específica del proveedor OpenSky."""
    mode: Literal["oauth2", "basic"] = Field(default="oauth2")
    bbox: Optional[OpenSkyBBoxConfig] = None
    extended: int = Field(default=0, ge=0, le=1)
    token_url: Optional[str] = Field(default=None, max_length=512)
    scope: Optional[str] = Field(default=None, max_length=256)


class AviationStackProviderConfig(BaseModel):
    """Configuración específica del proveedor AviationStack."""
    base_url: str = Field(default="http://api.aviationstack.com/v1", max_length=512)


class CustomFlightProviderConfig(BaseModel):
    """Configuración específica del proveedor personalizado de vuelos."""
    api_url: Optional[str] = Field(default=None, max_length=512)
    api_key: Optional[str] = Field(default=None, max_length=512)


class FlightsLayerConfig(BaseModel):
    """Configuración de capa de vuelos v2."""
    enabled: bool = True
    provider: Literal["opensky", "aviationstack", "custom"] = "opensky"
    refresh_seconds: int = Field(default=12, ge=1, le=300)
    max_age_seconds: int = Field(default=120, ge=10, le=600)
    max_items_global: int = Field(default=2000, ge=1, le=10000)
    max_items_view: int = Field(default=1500, ge=1, le=10000)
    rate_limit_per_min: int = Field(default=6, ge=1, le=60)
    decimate: Literal["none", "grid"] = "none"
    grid_px: int = Field(default=24, ge=8, le=128)
    styleScale: float = Field(default=3.2, ge=0.1, le=10)
    render_mode: Literal["circle", "symbol", "symbol_custom", "auto"] = "circle"
    circle: Optional[FlightsLayerCircleConfig] = None
    opensky: Optional[OpenSkyProviderConfig] = None
    aviationstack: Optional[AviationStackProviderConfig] = None
    custom: Optional[CustomFlightProviderConfig] = None


DEFAULT_AISSTREAM_WS_URL = "wss://stream.aisstream.io/v0/stream"


class AISStreamProviderConfig(BaseModel):
    """Configuración específica del proveedor AISStream."""
    model_config = ConfigDict(extra="ignore")

    ws_url: Optional[str] = Field(default=DEFAULT_AISSTREAM_WS_URL, max_length=512)

    @field_validator("ws_url", mode="before")
    @classmethod
    def normalize_ws_url(cls, value: object) -> str:
        if value is None:
            return DEFAULT_AISSTREAM_WS_URL
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or DEFAULT_AISSTREAM_WS_URL
        raise TypeError("ws_url must be a string or null")


class AISHubProviderConfig(BaseModel):
    """Configuración específica del proveedor AIS Hub."""
    base_url: str = Field(default="https://www.aishub.net/api", max_length=512)


class AISGenericProviderConfig(BaseModel):
    """Configuración específica del proveedor AIS genérico."""
    api_url: Optional[str] = Field(default=None, max_length=512)


class CustomShipProviderConfig(BaseModel):
    """Configuración específica del proveedor personalizado de barcos."""
    api_url: Optional[str] = Field(default=None, max_length=512)
    api_key: Optional[str] = Field(default=None, max_length=512)


class ShipsLayerConfig(BaseModel):
    """Configuración de capa de barcos v2."""
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    provider: Literal["aisstream", "aishub", "ais_generic", "custom"] = "aisstream"
    refresh_seconds: int = Field(default=10, ge=1, le=300)
    max_age_seconds: int = Field(default=180, ge=10, le=600)
    max_items_global: int = Field(default=1500, ge=1, le=10000)
    max_items_view: int = Field(default=420, ge=1, le=5000)
    rate_limit_per_min: int = Field(default=4, ge=1, le=60)
    decimate: Literal["grid", "none"] = "grid"
    grid_px: int = Field(default=24, ge=8, le=128)
    styleScale: float = Field(default=1.4, ge=0.1, le=10)
    aisstream: Optional[AISStreamProviderConfig] = None
    aishub: Optional[AISHubProviderConfig] = None
    ais_generic: Optional[AISGenericProviderConfig] = None
    custom: Optional[CustomShipProviderConfig] = None

    @model_validator(mode="after")
    def ensure_provider_defaults(cls, values: "ShipsLayerConfig") -> "ShipsLayerConfig":  # type: ignore[override]
        if not values.enabled:
            return values

        if values.provider == "aisstream":
            if values.aisstream is None:
                values.aisstream = AISStreamProviderConfig()
            else:
                values.aisstream.ws_url = values.aisstream.ws_url or DEFAULT_AISSTREAM_WS_URL
        elif values.provider == "aishub":
            if values.aishub is None:
                values.aishub = AISHubProviderConfig()
        elif values.provider == "ais_generic":
            if values.ais_generic is None:
                values.ais_generic = AISGenericProviderConfig()
        elif values.provider == "custom":
            if values.custom is None:
                values.custom = CustomShipProviderConfig()

        return values


class GlobalSatelliteLayerConfig(BaseModel):
    """Configuración de capa de satélite global."""
    enabled: bool = True
    provider: Literal["gibs"] = "gibs"
    refresh_minutes: int = Field(default=10, ge=1, le=60)
    history_minutes: int = Field(default=90, ge=1, le=1440)
    frame_step: int = Field(default=10, ge=1, le=60)


class GlobalRadarLayerConfig(BaseModel):
    """Configuración de capa de radar global."""
    enabled: bool = True
    provider: Literal["rainviewer"] = "rainviewer"
    refresh_minutes: int = Field(default=5, ge=1, le=60)
    history_minutes: int = Field(default=90, ge=1, le=1440)
    frame_step: int = Field(default=5, ge=1, le=60)


class GlobalLayersConfig(BaseModel):
    """Configuración de capas globales."""
    satellite: Optional[GlobalSatelliteLayerConfig] = None
    radar: Optional[GlobalRadarLayerConfig] = None


class LayersConfig(BaseModel):
    """Configuración de capas v2."""
    flights: Optional[FlightsLayerConfig] = None
    ships: Optional[ShipsLayerConfig] = None
    global_: Optional[GlobalLayersConfig] = Field(default=None, alias="global")


class PanelWeatherWeeklyConfig(BaseModel):
    """Configuración de panel de clima semanal."""
    enabled: bool = True


class PanelEphemeridesConfig(BaseModel):
    """Configuración de panel de efemérides."""
    enabled: bool = True


class PanelNewsConfig(BaseModel):
    """Configuración de panel de noticias RSS."""
    enabled: bool = True
    feeds: List[str] = Field(default_factory=list)
    max_items_per_feed: Optional[int] = Field(default=10, ge=1, le=50)
    refresh_minutes: Optional[int] = Field(default=30, ge=1, le=1440)


class PanelCalendarConfig(BaseModel):
    """Configuración de panel de calendario."""
    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    provider: Literal["google", "ics", "disabled"] = Field(default="google")
    ics_path: Optional[str] = Field(default=None, max_length=1024)
    days_ahead: Optional[int] = Field(default=14, ge=1, le=90)

    @model_validator(mode="before")
    @classmethod
    def normalize_panel_provider(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        provider_raw = data.get("provider")
        provider = str(provider_raw).strip().lower() if isinstance(provider_raw, str) else "google"

        if provider == "disabled":
            data["enabled"] = False
            provider = "google"

        if provider not in {"google", "ics"}:
            provider = "google"

        data["provider"] = provider

        if data.get("enabled") is None:
            data["enabled"] = False

        return data


class PanelHistoricalEventsLocalConfig(BaseModel):
    """Configuración local del proveedor de efemérides históricas."""
    data_path: str = Field(default="/var/lib/pantalla-reloj/data/efemerides.json", max_length=1024)


class PanelHistoricalEventsWikimediaConfig(BaseModel):
    """Configuración para proveedor Wikimedia OnThisDay."""
    language: str = Field(default="es", pattern="^[a-z]{2}$")  # Código ISO 639-1
    event_type: Literal["all", "events", "births", "deaths", "holidays"] = Field(default="all")
    api_user_agent: str = Field(
        default="PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)",
        max_length=256
    )
    max_items: int = Field(default=10, ge=1, le=50)  # Límite de items por tipo
    timeout_seconds: int = Field(default=10, ge=1, le=30)


class PanelHistoricalEventsConfig(BaseModel):
    """Configuración de panel de efemérides históricas."""
    enabled: bool = True
    provider: Literal["local", "wikimedia"] = "wikimedia"  # Cambiar default a wikimedia
    
    # Configuración para proveedor local
    local: Optional[PanelHistoricalEventsLocalConfig] = None
    
    # Configuración para proveedor Wikimedia
    wikimedia: Optional[PanelHistoricalEventsWikimediaConfig] = None
    
    rotation_seconds: int = Field(default=6, ge=3, le=60)
    max_items: int = Field(default=5, ge=1, le=20)
    # Campos adicionales para compatibilidad con el objetivo
    lang: Optional[str] = Field(default="es", pattern="^[a-z]{2}$")
    cache_hours: Optional[int] = Field(default=24, ge=1, le=168)


class CalendarICSConfig(BaseModel):
    """Configuración de calendario ICS."""
    filename: Optional[str] = Field(default=None, max_length=256)  # nombre almacenado (solo lectura)
    stored_path: Optional[str] = Field(default=None, max_length=1024)  # ruta en disco (solo backend, no se expone)
    max_events: int = Field(default=50, ge=1, le=1000)
    days_ahead: int = Field(default=14, ge=1, le=90)
    # Legacy fields para retrocompatibilidad
    mode: Optional[Literal["upload", "url"]] = Field(default=None)
    file_path: Optional[str] = Field(default=None, max_length=1024)
    url: Optional[str] = Field(default=None, max_length=2048)
    last_ok: Optional[str] = Field(default=None, max_length=64)  # ISO datetime
    last_error: Optional[str] = Field(default=None, max_length=512)


class CalendarGoogleConfig(BaseModel):
    """Configuración de Google Calendar."""
    api_key: Optional[str] = Field(default=None, max_length=512)
    calendar_id: Optional[str] = Field(default=None, max_length=512)


class CalendarConfig(BaseModel):
    """Configuración de calendario top-level."""
    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    source: Literal["google", "ics"] = Field(default="google")
    ics: Optional[CalendarICSConfig] = Field(default=None)
    google: Optional[CalendarGoogleConfig] = Field(default=None)
    # Legacy fields para retrocompatibilidad
    google_api_key: Optional[str] = Field(default=None, max_length=512)
    google_calendar_id: Optional[str] = Field(default=None, max_length=512)
    days_ahead: Optional[int] = Field(default=None, ge=1, le=60)
    provider: Optional[Literal["google", "ics", "disabled"]] = Field(default=None)
    ics_path: Optional[str] = Field(default=None, max_length=1024)

    @model_validator(mode="before")
    @classmethod
    def normalize_calendar(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        provider_raw = data.get("source") or data.get("provider")
        provider = str(provider_raw).strip().lower() if isinstance(provider_raw, str) else "google"

        if provider == "disabled":
            data["enabled"] = False
            provider = "google"

        if provider not in {"google", "ics"}:
            provider = "google"

        data["source"] = provider
        data["provider"] = provider

        if data.get("enabled") is None:
            data["enabled"] = False

        return data

    @field_validator("ics_path", mode="before")
    @classmethod
    def trim_ics_path(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        raise TypeError("ics_path must be a string or null")


class PanelsConfig(BaseModel):
    """Configuración de paneles v2."""
    weatherWeekly: Optional[PanelWeatherWeeklyConfig] = None
    ephemerides: Optional[PanelEphemeridesConfig] = None
    news: Optional[PanelNewsConfig] = None
    calendar: Optional[PanelCalendarConfig] = None
    historicalEvents: Optional[PanelHistoricalEventsConfig] = None


class GoogleSecretsConfig(BaseModel):
    """Metadatos de secretos de Google Calendar."""
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=512)
    calendar_id: Optional[str] = Field(default=None, min_length=1, max_length=512)


class CalendarICSSecretsConfig(BaseModel):
    """Metadatos de secretos de calendarios ICS."""
    url: Optional[str] = Field(default=None, max_length=2048)
    path: Optional[str] = Field(default=None, max_length=1024)


class OpenSkyOAuth2SecretsConfig(BaseModel):
    """Secrets OAuth2 para OpenSky."""
    client_id: Optional[str] = Field(default=None, max_length=512)
    client_secret: Optional[str] = Field(default=None, max_length=512)
    token_url: Optional[str] = Field(default=None, max_length=512)
    scope: Optional[str] = Field(default=None, max_length=256)


class OpenSkyBasicSecretsConfig(BaseModel):
    """Secrets Basic Auth para OpenSky."""
    username: Optional[str] = Field(default=None, max_length=256)
    password: Optional[str] = Field(default=None, max_length=256)


class OpenSkySecretsConfig(BaseModel):
    """Secrets para OpenSky (metadata only, no valores reales)."""
    oauth2: Optional[OpenSkyOAuth2SecretsConfig] = None
    basic: Optional[OpenSkyBasicSecretsConfig] = None


class AviationStackSecretsConfig(BaseModel):
    """Secrets para AviationStack (metadata only)."""
    api_key: Optional[str] = Field(default=None, max_length=512)


class AISStreamSecretsConfig(BaseModel):
    """Secrets para AISStream (metadata only)."""
    api_key: Optional[str] = Field(default=None, max_length=512)


class AISHubSecretsConfig(BaseModel):
    """Secrets para AIS Hub (metadata only)."""
    api_key: Optional[str] = Field(default=None, max_length=512)


class MapTilerSecretsConfig(BaseModel):
    """Secrets para MapTiler (metadata only)."""
    api_key: Optional[str] = Field(default=None, max_length=512)


class StormModeConfig(BaseModel):
    """Configuración de modo tormenta."""
    enabled: bool = True
    center_lat: float = Field(default=39.986, ge=-90, le=90)
    center_lng: float = Field(default=-0.051, ge=-180, le=180)
    zoom: float = Field(default=9.0, ge=1, le=20)
    auto_enable: bool = Field(default=True)
    auto_disable_after_minutes: int = Field(default=60, ge=1, le=1440)


class BlitzortungAutoStormConfig(BaseModel):
    """Configuración de auto-activación de modo tormenta."""
    enabled: bool = True
    radius_km: float = Field(default=30, ge=1, le=500)
    min_events_in_5min: int = Field(default=3, ge=1, le=100)
    cooldown_minutes: int = Field(default=60, ge=1, le=1440)


class BlitzortungConfig(BaseModel):
    """Configuración de Blitzortung (rayos)."""
    enabled: bool = True
    mqtt_host: str = Field(default="127.0.0.1", max_length=256)
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_topic: str = Field(default="blitzortung/1", max_length=256)
    auto_storm_mode: Optional[BlitzortungAutoStormConfig] = None
    retention_minutes: int = Field(default=30, ge=1, le=1440)
    max_points: int = Field(default=1500, ge=1, le=10000)
    # Legacy fields
    ws_enabled: Optional[bool] = None
    ws_url: Optional[str] = None
    buffer_max: Optional[int] = None
    prune_seconds: Optional[int] = None


class NewsTopLevelConfig(BaseModel):
    """Configuración top-level de noticias."""
    rss_feeds: List[str] = Field(default_factory=list)


class EphemeridesTopLevelConfig(BaseModel):
    """Configuración top-level de efemérides astronómicas."""
    latitude: float = Field(default=39.986, ge=-90, le=90)
    longitude: float = Field(default=-0.051, ge=-180, le=180)
    timezone: str = Field(default="Europe/Madrid", min_length=1)


class OpenSkyOAuth2Config(BaseModel):
    """Configuración OAuth2 para OpenSky."""
    client_id: Optional[str] = Field(default=None, max_length=512)
    client_secret: Optional[str] = Field(default=None, max_length=512)
    token_url: str = Field(default="https://auth.opensky-network.org/oauth/token", max_length=512)
    scope: Optional[str] = Field(default=None, max_length=256)


class OpenSkyBBoxTopLevelConfig(BaseModel):
    """Bounding box top-level para OpenSky."""
    lamin: float = Field(default=39.5, ge=-90, le=90)
    lamax: float = Field(default=41.0, ge=-90, le=90)
    lomin: float = Field(default=-1.0, ge=-180, le=180)
    lomax: float = Field(default=1.5, ge=-180, le=180)


class OpenSkyTopLevelConfig(BaseModel):
    """Configuración top-level de OpenSky."""
    enabled: bool = False
    mode: Literal["bbox", "oauth2"] = "bbox"
    bbox: Optional[OpenSkyBBoxTopLevelConfig] = None
    poll_seconds: int = Field(default=10, ge=1, le=300)
    oauth2: Optional[OpenSkyOAuth2Config] = None


class AISConfig(BaseModel):
    """Configuración top-level de AIS (barcos)."""
    enabled: bool = False
    provider: Literal["aisstream", "aishub", "generic"] = "aisstream"
    ws_url: Optional[str] = Field(default=None, max_length=512)


class SecretsConfig(BaseModel):
    """Secrets (metadata only, no valores reales)."""
    maptiler: Optional[MapTilerSecretsConfig] = None
    opensky: Optional[OpenSkySecretsConfig] = None
    google: Optional[GoogleSecretsConfig] = None
    aemet: Optional[Dict[str, Any]] = None
    calendar_ics: Optional[CalendarICSSecretsConfig] = None
    aviationstack: Optional[AviationStackSecretsConfig] = None
    aisstream: Optional[AISStreamSecretsConfig] = None
    aishub: Optional[AISHubSecretsConfig] = None


class AppConfigV2(BaseModel):
    """Esquema v2 completo de configuración."""
    model_config = ConfigDict(extra="ignore")

    version: int = Field(default=2, ge=2, le=2)
    display: Optional[DisplayConfig] = None
    ui_map: MapConfig
    ui_global: Optional[UIGlobalConfig] = None
    panels: Optional[PanelsConfig] = None
    layers: Optional[LayersConfig] = None
    storm: Optional[StormModeConfig] = None
    blitzortung: Optional[BlitzortungConfig] = None
    news: Optional[NewsTopLevelConfig] = None
    ephemerides: Optional[EphemeridesTopLevelConfig] = None
    calendar: Optional[CalendarConfig] = None
    opensky: Optional[OpenSkyTopLevelConfig] = None
    ais: Optional[AISConfig] = None
    secrets: Optional[SecretsConfig] = None
