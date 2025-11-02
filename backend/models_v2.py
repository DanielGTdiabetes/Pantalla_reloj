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


class XyzConfig(BaseModel):
    """Configuración del proveedor XYZ (satelital)."""
    urlTemplate: str
    attribution: str
    minzoom: int = Field(default=0, ge=0, le=24)
    maxzoom: int = Field(default=19, ge=0, le=24)
    tileSize: int = Field(default=256, ge=128, le=512)


class LabelsOverlayConfig(BaseModel):
    """Configuración de overlay de etiquetas."""
    enabled: bool = True
    style: str = Field(default="carto-only-labels")


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
    provider: Literal["xyz", "osm"] = "xyz"
    xyz: Optional[XyzConfig] = None
    labelsOverlay: Optional[LabelsOverlayConfig] = None
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


class UIGlobalConfig(BaseModel):
    """Configuración global de UI (satélite, radar)."""
    satellite: Optional[SatelliteConfig] = None
    radar: Optional[RadarConfig] = None


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


class PanelsConfig(BaseModel):
    """Configuración de paneles v2."""
    weatherWeekly: Optional[PanelWeatherWeeklyConfig] = None
    ephemerides: Optional[PanelEphemeridesConfig] = None
    news: Optional[PanelNewsConfig] = None
    calendar: Optional[PanelCalendarConfig] = None


class SecretsConfig(BaseModel):
    """Secrets (metadata only, no valores reales)."""
    opensky: Optional[Dict[str, Any]] = None
    google: Optional[Dict[str, Any]] = None
    aemet: Optional[Dict[str, Any]] = None


class AppConfigV2(BaseModel):
    """Esquema v2 completo de configuración."""
    model_config = ConfigDict(extra="ignore")

    version: int = Field(default=2, ge=2, le=2)
    ui_map: MapConfig
    ui_global: Optional[UIGlobalConfig] = None
    layers: Optional[LayersConfig] = None
    panels: Optional[PanelsConfig] = None
    secrets: Optional[SecretsConfig] = None
