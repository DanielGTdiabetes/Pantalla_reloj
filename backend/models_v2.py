"""
Esquema v2 de configuración - limpio y mínimo para Fase 2.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Literal, List, Dict, Any


class MapCenter(BaseModel):
    """Coordenadas del centro del mapa."""
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class LocalRasterConfig(BaseModel):
    """Configuración del proveedor local raster OSM."""
    tileUrl: str = Field(default="https://tile.openstreetmap.org/{z}/{x}/{y}.png")
    minzoom: int = Field(default=0, ge=0, le=24)
    maxzoom: int = Field(default=19, ge=0, le=24)


class MapTilerConfig(BaseModel):
    """Configuración del proveedor MapTiler vector."""
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


class ShipsLayerConfig(BaseModel):
    """Configuración de capa de barcos v2."""
    enabled: bool = False
    provider: Literal["aisstream", "aishub", "ais_generic", "custom"] = "aisstream"
    refresh_seconds: int = Field(default=10, ge=1, le=300)
    max_age_seconds: int = Field(default=180, ge=10, le=600)
    max_items_global: int = Field(default=1500, ge=1, le=10000)
    max_items_view: int = Field(default=420, ge=1, le=5000)
    decimate: Literal["grid", "none"] = "grid"
    grid_px: int = Field(default=24, ge=8, le=128)
    styleScale: float = Field(default=1.4, ge=0.1, le=10)


class LayersConfig(BaseModel):
    """Configuración de capas v2."""
    flights: Optional[FlightsLayerConfig] = None
    ships: Optional[ShipsLayerConfig] = None


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


class PanelCalendarConfig(BaseModel):
    """Configuración de panel de calendario."""
    enabled: bool = True
    provider: Literal["google", "ics", "disabled"] = Field(default="google")
    ics_path: Optional[str] = Field(default=None, max_length=1024)


class CalendarConfig(BaseModel):
    """Configuración de calendario top-level."""
    enabled: bool = True
    provider: Literal["google", "ics", "disabled"] = Field(default="google")
    ics_path: Optional[str] = Field(default=None, max_length=1024)


class PanelsConfig(BaseModel):
    """Configuración de paneles v2."""
    weatherWeekly: Optional[PanelWeatherWeeklyConfig] = None
    ephemerides: Optional[PanelEphemeridesConfig] = None
    news: Optional[PanelNewsConfig] = None
    calendar: Optional[PanelCalendarConfig] = None


class GoogleSecretsConfig(BaseModel):
    """Metadatos de secretos de Google Calendar."""
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=512)
    calendar_id: Optional[str] = Field(default=None, min_length=1, max_length=512)


class CalendarICSSecretsConfig(BaseModel):
    """Metadatos de secretos de calendarios ICS."""
    url: Optional[str] = Field(default=None, max_length=2048)
    path: Optional[str] = Field(default=None, max_length=1024)


class SecretsConfig(BaseModel):
    """Secrets (metadata only, no valores reales)."""
    opensky: Optional[Dict[str, Any]] = None
    google: Optional[GoogleSecretsConfig] = None
    aemet: Optional[Dict[str, Any]] = None
    calendar_ics: Optional[CalendarICSSecretsConfig] = None


class AppConfigV2(BaseModel):
    """Esquema v2 completo de configuración."""
    model_config = ConfigDict(extra="ignore")

    version: int = Field(default=2, ge=2, le=2)
    ui_map: MapConfig
    ui_global: Optional[UIGlobalConfig] = None
    layers: Optional[LayersConfig] = None
    panels: Optional[PanelsConfig] = None
    secrets: Optional[SecretsConfig] = None
    calendar: Optional[CalendarConfig] = None
