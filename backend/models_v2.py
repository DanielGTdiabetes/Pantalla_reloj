"""
Esquema v2 de configuración - limpio y mínimo para Fase 2.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Literal, List, Dict, Any


class ConfigVersion(BaseModel):
    """Versión del esquema de configuración."""
    version: int = Field(default=2, ge=1, le=2)


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
    provider: Literal["xyz"] = "xyz"
    xyz: XyzConfig
    labelsOverlay: Optional[LabelsOverlayConfig] = None
    viewMode: Literal["fixed", "aoiCycle"] = "fixed"
    fixed: Optional[MapFixedView] = None
    aoiCycle: Optional[MapAoiCycle] = None
    region: Optional[MapRegion] = None


class AemetWarningsConfig(BaseModel):
    """Configuración de avisos AEMET."""
    enabled: bool = True
    min_severity: Literal["yellow", "orange", "red", "extreme"] = "yellow"


class AemetRadarConfig(BaseModel):
    """Configuración de radar AEMET."""
    enabled: bool = True
    opacity: float = Field(default=0.6, ge=0, le=1)
    speed: float = Field(default=1.0, ge=0.1, le=5.0)


class AemetSatConfig(BaseModel):
    """Configuración de satélite AEMET."""
    enabled: bool = False
    opacity: float = Field(default=0.5, ge=0, le=1)


class AemetConfig(BaseModel):
    """Configuración AEMET v2."""
    enabled: bool = True
    warnings: Optional[AemetWarningsConfig] = None
    radar: Optional[AemetRadarConfig] = None
    sat: Optional[AemetSatConfig] = None


class PanelRotateConfig(BaseModel):
    """Configuración de rotación del panel."""
    enabled: bool = True
    order: List[str] = Field(default_factory=lambda: [
        "weather_now", "forecast_week", "luna", "harvest",
        "efemerides", "news", "calendar"
    ])
    intervalSec: int = Field(default=12, ge=1)


class PanelNewsConfig(BaseModel):
    """Configuración de noticias RSS."""
    feeds: List[str] = Field(default_factory=list)


class PanelEphemeridesConfig(BaseModel):
    """Configuración de efemérides."""
    source: Literal["built-in", "api"] = "built-in"


class PanelConfig(BaseModel):
    """Configuración del panel rotatorio v2."""
    rotate: Optional[PanelRotateConfig] = None
    news: Optional[PanelNewsConfig] = None
    efemerides: Optional[PanelEphemeridesConfig] = None


class UIConfig(BaseModel):
    """Configuración de UI v2."""
    layout: Literal["grid-2-1", "grid-1-1", "full"] = "grid-2-1"
    map: MapConfig
    aemet: Optional[AemetConfig] = None
    panel: Optional[PanelConfig] = None


class FlightsLayerSymbolConfig(BaseModel):
    """Configuración de símbolos de vuelos."""
    size_vh: float = Field(default=1.6, ge=0.1, le=10)
    allow_overlap: bool = True


class FlightsLayerCircleConfig(BaseModel):
    """Configuración de círculos de vuelos."""
    radius_vh: float = Field(default=0.9, ge=0.1, le=10)
    color: str = "#FFD400"
    stroke_color: str = "#000000"
    stroke_width: float = Field(default=2.0, ge=0, le=10)


class FlightsLayerConfig(BaseModel):
    """Configuración de capa de vuelos v2."""
    enabled: bool = True
    provider: Literal["opensky", "aviationstack", "custom"] = "opensky"
    render_mode: Literal["auto", "symbol", "symbol_custom", "circle"] = "symbol_custom"
    max_items_view: int = Field(default=1200, ge=1, le=10000)
    symbol: Optional[FlightsLayerSymbolConfig] = None
    circle: Optional[FlightsLayerCircleConfig] = None


class ShipsLayerSymbolConfig(BaseModel):
    """Configuración de símbolos de barcos."""
    size_vh: float = Field(default=1.4, ge=0.1, le=10)
    allow_overlap: bool = True


class ShipsLayerCircleConfig(BaseModel):
    """Configuración de círculos de barcos."""
    radius_vh: float = Field(default=0.8, ge=0.1, le=10)
    color: str = "#5ad35a"
    stroke_color: str = "#002200"
    stroke_width: float = Field(default=2.0, ge=0, le=10)


class ShipsLayerConfig(BaseModel):
    """Configuración de capa de barcos v2."""
    enabled: bool = True
    provider: Literal["aisstream", "aishub", "ais_generic", "custom"] = "aisstream"
    decimate: Literal["grid", "none"] = "grid"
    grid_px: int = Field(default=24, ge=8, le=128)
    max_items_view: int = Field(default=420, ge=1, le=5000)
    symbol: Optional[ShipsLayerSymbolConfig] = None
    circle: Optional[ShipsLayerCircleConfig] = None


class LayersConfig(BaseModel):
    """Configuración de capas v2."""
    flights: Optional[FlightsLayerConfig] = None
    ships: Optional[ShipsLayerConfig] = None


class SecretsConfig(BaseModel):
    """Secrets (metadata only, no valores reales)."""
    opensky: Optional[Dict[str, Any]] = None
    google: Optional[Dict[str, Any]] = None
    aemet: Optional[Dict[str, Any]] = None


class AppConfigV2(BaseModel):
    """Esquema v2 completo de configuración."""
    model_config = ConfigDict(extra="ignore")

    version: int = Field(default=2, ge=2, le=2)
    ui: UIConfig
    layers: Optional[LayersConfig] = None
    secrets: Optional[SecretsConfig] = None

