"""
Esquema v2 de configuración - limpio y mínimo para Fase 2.
"""
from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Optional, Literal, List, Dict, Any, Union

from .constants import (
    GIBS_DEFAULT_DEFAULT_ZOOM,
    GIBS_DEFAULT_EPSG,
    GIBS_DEFAULT_FORMAT_EXT,
    GIBS_DEFAULT_FRAME_STEP,
    GIBS_DEFAULT_HISTORY_MINUTES,
    GIBS_DEFAULT_LAYER,
    GIBS_DEFAULT_MAX_ZOOM,
    GIBS_DEFAULT_MIN_ZOOM,
    GIBS_DEFAULT_TILE_MATRIX_SET,
    GIBS_DEFAULT_TIME_MODE,
    GIBS_DEFAULT_TIME_VALUE,
)


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
    """Configuración del proveedor MapTiler vector.
    
    IMPORTANTE: Cuando se usa provider="maptiler_vector", styleUrl debe estar presente
    y ser válido. Si solo se proporciona style + api_key, el backend puede construir
    styleUrl automáticamente, pero es preferible proporcionarlo explícitamente.
    """
    style: Optional[str] = Field(default="vector-bright", max_length=64)  # "vector-dark", "vector-bright", "streets-v4", "hybrid", "satellite", etc.
    api_key: Optional[str] = Field(default=None, max_length=256)
    styleUrl: Optional[str] = Field(default=None, max_length=512)
    urls: Optional[MapTilerUrlsConfig] = None
    
    @field_validator("style", mode="before")
    @classmethod
    def normalize_style(cls, value: object) -> str:
        """Normalize style to default if empty.
        
        Valores válidos: "hybrid", "satellite", "streets-v4", "vector-dark", 
        "vector-bright", "vector-light", "basic", "basic-dark"
        """
        if value is None or (isinstance(value, str) and not value.strip()):
            return "vector-bright"
        if isinstance(value, str):
            normalized = value.strip()
            # Validar que sea un estilo conocido
            valid_styles = {"hybrid", "satellite", "streets-v4", "vector-dark", "vector-bright", "vector-light", "basic", "basic-dark"}
            if normalized not in valid_styles:
                # Si no es válido, usar default pero mantener el valor para logging
                return "vector-bright"
            return normalized
        return "vector-bright"
    
    @field_validator("api_key", mode="before")
    @classmethod
    def normalize_api_key(cls, value: object, info: Any) -> Optional[str]:
        """Normalize apiKey → api_key (accept both, store as api_key)."""
        # Si viene api_key, usarlo
        if value is not None and isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        # Si no hay api_key pero hay apiKey en raw data, migrarlo
        if hasattr(info, "data") and isinstance(info.data, dict):
            legacy_key = info.data.get("apiKey")
            if legacy_key is not None and isinstance(legacy_key, str):
                stripped = legacy_key.strip()
                return stripped or None
        return None
    
    @field_validator("styleUrl")
    @classmethod
    def validate_style_url_format(cls, value: Optional[str]) -> Optional[str]:
        """Valida el formato de styleUrl si está presente."""
        if value is None:
            return None
        if not isinstance(value, str) or not value.strip():
            return None
        value = value.strip()
        # Validar formato básico: debe empezar con https://api.maptiler.com/maps/ y contener style.json
        if not value.startswith("https://api.maptiler.com/maps/"):
            raise ValueError("styleUrl must start with 'https://api.maptiler.com/maps/'")
        if "style.json" not in value:
            raise ValueError("styleUrl must contain 'style.json'")
        return value


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


class SatelliteLabelsOverlay(BaseModel):
    """Configuración de superposición de etiquetas vectoriales sobre satélite."""
    model_config = ConfigDict(extra="ignore")
    
    enabled: bool = Field(default=True, description="Habilita la superposición de etiquetas")
    style_url: Optional[str] = Field(
        default=None,
        max_length=512,
        description="URL del estilo vectorial de etiquetas"
    )
    layer_filter: str = Field(
        default='["==", ["get", "layer"], "poi_label"]',
        description="Filtro JSON (cadena serializada) para seleccionar capas de tipo label",
    )
    opacity: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Opacidad aplicada a las etiquetas del overlay",
    )


class SatelliteSettings(BaseModel):
    """Configuración de modo satélite híbrido con etiquetas vectoriales."""
    model_config = ConfigDict(extra="ignore")

    enabled: bool = Field(default=False, description="Activa el modo híbrido satélite")
    opacity: float = Field(default=1.0, ge=0.0, le=1.0, description="Opacidad de la textura satélite")
    style_url: Optional[str] = Field(
        default="https://api.maptiler.com/maps/satellite/style.json",
        max_length=512,
        description="URL del estilo satélite (para obtener tiles raster)"
    )
    labels_overlay: SatelliteLabelsOverlay = Field(
        default_factory=SatelliteLabelsOverlay,
        description="Configuración de superposición de etiquetas vectoriales"
    )
    # DEPRECATED: Usar labels_overlay.style_url en su lugar
    labels_style_url: Optional[str] = Field(
        default=None,
        max_length=512,
        description="[DEPRECATED] Vector labels overlay URL. Usar labels_overlay.style_url"
    )

    @model_validator(mode="before")
    @classmethod
    def migrate_labels_style_url(cls, data: Any) -> Any:
        """Migra labels_style_url (deprecated) a labels_overlay.style_url."""
        if not isinstance(data, dict):
            return data
        
        # Si existe labels_style_url pero no labels_overlay o labels_overlay no tiene style_url
        if "labels_style_url" in data and data["labels_style_url"]:
            labels_style_url_value = data["labels_style_url"]
            
            # Inicializar labels_overlay si no existe
            if "labels_overlay" not in data:
                data["labels_overlay"] = {}
            elif not isinstance(data["labels_overlay"], dict):
                # Si es bool, convertir a objeto
                if isinstance(data["labels_overlay"], bool):
                    data["labels_overlay"] = {"enabled": data["labels_overlay"]}
                else:
                    data["labels_overlay"] = {}
            
            # Copiar labels_style_url a labels_overlay.style_url si no existe
            if "style_url" not in data["labels_overlay"] or not data["labels_overlay"]["style_url"]:
                data["labels_overlay"]["style_url"] = labels_style_url_value
            
            # No eliminar labels_style_url aquí (se hace en la serialización pública)
        
        return data

    @field_validator("labels_overlay", mode="before")
    @classmethod
    def normalize_labels_overlay(cls, value: Any) -> SatelliteLabelsOverlay:
        """Normaliza labels_overlay a objeto SatelliteLabelsOverlay."""
        if isinstance(value, dict):
            try:
                return SatelliteLabelsOverlay(**value)
            except Exception:
                # Si falla la validación, crear objeto por defecto
                return SatelliteLabelsOverlay()
        if isinstance(value, bool):
            # Si es bool, crear objeto con enabled
            return SatelliteLabelsOverlay(enabled=value)
        # Si es None o cualquier otro tipo, devolver objeto por defecto
        return SatelliteLabelsOverlay()


class MapSatelliteConfig(BaseModel):
    """Configuración de modo satélite con etiquetas vectoriales (legacy)."""
    model_config = ConfigDict(extra="ignore")

    enabled: bool = Field(default=False, description="Activa el modo híbrido satélite")
    opacity: float = Field(default=0.85, ge=0.0, le=1.0, description="Opacidad de la textura satélite")
    labels_enabled: bool = Field(default=True, description="Habilita etiquetas vectoriales por encima de la capa satélite")
    provider: Literal["maptiler"] = Field(default="maptiler", description="Proveedor de tiles satélite")
    style_raster: str = Field(
        default="https://api.maptiler.com/maps/satellite/style.json",
        max_length=512,
        description="URL del estilo raster de satélite",
    )
    style_labels: str = Field(
        default="https://api.maptiler.com/maps/streets/style.json",
        max_length=512,
        description="URL del estilo vectorial para etiquetas",
    )
    labels_overlay: SatelliteLabelsOverlay = Field(default_factory=SatelliteLabelsOverlay)


class MapConfig(BaseModel):
    """Configuración del mapa v2.
    
    IMPORTANTE: Cuando provider="maptiler_vector", maptiler.styleUrl debe estar presente
    y ser válido. Si falta, el backend intentará construirlo desde maptiler.style + maptiler.api_key,
    pero es preferible proporcionarlo explícitamente para evitar estados inconsistentes.
    """
    engine: Literal["maplibre"] = "maplibre"
    provider: Literal["local_raster_xyz", "maptiler_vector", "custom_xyz"] = "local_raster_xyz"
    renderWorldCopies: bool = Field(default=True)
    interactive: bool = Field(default=False)
    controls: bool = Field(default=False)
    local: Optional[LocalRasterConfig] = None
    maptiler: Optional[MapTilerConfig] = None
    customXyz: Optional[CustomXyzConfig] = None
    satellite: SatelliteSettings = Field(
        default_factory=SatelliteSettings,
        description="Satellite/hybrid layer settings"
    )
    # Legacy satellite config (mantenido para compatibilidad)
    satellite_legacy: Optional[MapSatelliteConfig] = None
    viewMode: Literal["fixed", "aoiCycle"] = "fixed"
    fixed: Optional[MapFixedView] = None
    aoiCycle: Optional[MapAoiCycle] = None
    region: Optional[MapRegion] = None
    
    @model_validator(mode="after")
    def validate_maptiler_config(self) -> "MapConfig":
        """Valida que cuando provider="maptiler_vector", maptiler.styleUrl esté presente o se pueda construir."""
        if self.provider == "maptiler_vector":
            if not self.maptiler:
                raise ValueError("maptiler config is required when provider='maptiler_vector'")
            
            # Si no hay styleUrl, intentar construir desde style + api_key
            if not self.maptiler.styleUrl or not self.maptiler.styleUrl.strip():
                if not self.maptiler.style or not self.maptiler.api_key:
                    raise ValueError(
                        "When provider='maptiler_vector', either styleUrl must be provided, "
                        "or both style and api_key must be present to construct styleUrl"
                    )
                
                # Construir styleUrl automáticamente
                style_name = self.maptiler.style.strip()
                if style_name in {"hybrid", "satellite", "vector-bright"}:
                    style_name = "streets-v4"
                
                api_key = self.maptiler.api_key.strip()
                self.maptiler.styleUrl = f"https://api.maptiler.com/maps/{style_name}/style.json?key={api_key}"
                # Validar el styleUrl construido
                try:
                    MapTilerConfig.validate_style_url_format(self.maptiler.styleUrl)
                except ValueError as e:
                    raise ValueError(f"Invalid constructed styleUrl: {e}") from e
            else:
                # Validar el styleUrl proporcionado
                try:
                    MapTilerConfig.validate_style_url_format(self.maptiler.styleUrl)
                except ValueError as e:
                    raise ValueError(f"Invalid styleUrl format: {e}") from e
        
        return self


class WeatherLayerConfig(BaseModel):
    """Configuración de una capa meteorológica."""
    enabled: bool = Field(default=True)
    provider: str = Field(default="", max_length=64)
    opacity: float = Field(default=0.7, ge=0.0, le=1.0)


class WeatherLayersConfig(BaseModel):
    """Configuración de capas meteorológicas unificadas."""
    radar: Optional[WeatherLayerConfig] = Field(
        default_factory=lambda: WeatherLayerConfig(enabled=True, provider="rainviewer", opacity=0.7)
    )
    satellite: Optional[WeatherLayerConfig] = Field(
        default_factory=lambda: WeatherLayerConfig(enabled=True, provider="gibs", opacity=0.8)
    )
    alerts: Optional[WeatherLayerConfig] = Field(
        default_factory=lambda: WeatherLayerConfig(enabled=True, provider="cap_aemet", opacity=0.6)
    )


class GlobalSatelliteGibsConfig(BaseModel):
    """Configuración de parámetros WMTS específicos de NASA GIBS."""

    epsg: str = Field(default=GIBS_DEFAULT_EPSG, min_length=1, max_length=32)
    tile_matrix_set: str = Field(
        default=GIBS_DEFAULT_TILE_MATRIX_SET,
        min_length=1,
        max_length=128,
    )
    layer: str = Field(default=GIBS_DEFAULT_LAYER, min_length=1, max_length=128)
    format_ext: str = Field(default=GIBS_DEFAULT_FORMAT_EXT, min_length=1, max_length=16)
    time_mode: Literal["default", "date"] = Field(default=GIBS_DEFAULT_TIME_MODE)
    time_value: str = Field(default=GIBS_DEFAULT_TIME_VALUE, min_length=1, max_length=64)


class SatelliteConfig(BaseModel):
    """Configuración de satélite global."""
    enabled: bool = True
    provider: Literal["gibs"] = "gibs"
    opacity: float = Field(default=1.0, ge=0, le=1)
    layer: str = Field(default=GIBS_DEFAULT_LAYER, min_length=1, max_length=128)
    tile_matrix_set: str = Field(
        default=GIBS_DEFAULT_TILE_MATRIX_SET,
        min_length=1,
        max_length=128,
    )
    min_zoom: int = Field(default=GIBS_DEFAULT_MIN_ZOOM, ge=0, le=24)
    max_zoom: int = Field(default=GIBS_DEFAULT_MAX_ZOOM, ge=0, le=24)
    default_zoom: int = Field(default=GIBS_DEFAULT_DEFAULT_ZOOM, ge=0, le=24)
    history_minutes: int = Field(default=GIBS_DEFAULT_HISTORY_MINUTES, ge=1, le=360)
    frame_step: int = Field(default=GIBS_DEFAULT_FRAME_STEP, ge=1, le=120)
    gibs: GlobalSatelliteGibsConfig = Field(default_factory=GlobalSatelliteGibsConfig)

    @model_validator(mode="after")
    def ensure_zoom_bounds(cls, values: "SatelliteConfig") -> "SatelliteConfig":  # type: ignore[override]
        if values.max_zoom < values.min_zoom:
            values.max_zoom = values.min_zoom
        if values.default_zoom < values.min_zoom:
            values.default_zoom = values.min_zoom
        elif values.default_zoom > values.max_zoom:
            values.default_zoom = values.max_zoom
        return values


class RadarConfig(BaseModel):
    """Configuración de radar global."""
    enabled: bool = False
    provider: Literal["rainviewer"] = "rainviewer"
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
    """Configuración global de UI (satélite, radar, overlay, weather_layers)."""
    satellite: Optional[SatelliteConfig] = None
    radar: Optional[RadarConfig] = None
    overlay: Optional[OverlayConfig] = None
    weather_layers: Optional[WeatherLayersConfig] = None


class FlightsLayerCircleConfig(BaseModel):
    """Configuración de círculos de vuelos."""
    radius_base: float = Field(default=7.5, ge=1, le=50)
    radius_zoom_scale: float = Field(default=1.7, ge=0.1, le=5)
    opacity: float = Field(default=1.0, ge=0, le=1)
    color: str = "#FFD400"
    stroke_color: str = "#000000"
    stroke_width: float = Field(default=2.0, ge=0, le=10)


class FlightsLayerSymbolConfig(BaseModel):
    """Configuración de iconos personalizados de vuelos."""
    size_vh: float = Field(default=2.0, ge=0.1, le=10)
    allow_overlap: bool = Field(default=True)


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
    render_mode: Literal["circle", "symbol", "symbol_custom", "auto"] = "symbol_custom"
    circle: Optional[FlightsLayerCircleConfig] = None
    symbol: Optional[FlightsLayerSymbolConfig] = None
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
    """Configuración de capa global de satélite (NASA GIBS o similar)."""
    enabled: bool = Field(default=True)
    provider: Literal["gibs"] = "gibs"
    refresh_minutes: int = Field(default=10, ge=1, le=240)
    history_minutes: int = Field(default=GIBS_DEFAULT_HISTORY_MINUTES, ge=5, le=360)
    frame_step: int = Field(default=GIBS_DEFAULT_FRAME_STEP, ge=1, le=60)
    layer: str = Field(default=GIBS_DEFAULT_LAYER, min_length=1, max_length=128)
    tile_matrix_set: str = Field(
        default=GIBS_DEFAULT_TILE_MATRIX_SET,
        min_length=1,
        max_length=128,
    )
    min_zoom: int = Field(default=GIBS_DEFAULT_MIN_ZOOM, ge=0, le=24)
    max_zoom: int = Field(default=GIBS_DEFAULT_MAX_ZOOM, ge=0, le=24)
    default_zoom: int = Field(default=GIBS_DEFAULT_DEFAULT_ZOOM, ge=0, le=24)
    gibs: GlobalSatelliteGibsConfig = Field(default_factory=GlobalSatelliteGibsConfig)

    @model_validator(mode="after")
    def ensure_zoom_bounds(
        cls, values: "GlobalSatelliteLayerConfig"
    ) -> "GlobalSatelliteLayerConfig":  # type: ignore[override]
        if values.max_zoom < values.min_zoom:
            values.max_zoom = values.min_zoom
        if values.default_zoom < values.min_zoom:
            values.default_zoom = values.min_zoom
        elif values.default_zoom > values.max_zoom:
            values.default_zoom = values.max_zoom
        return values


class GlobalRadarLayerConfig(BaseModel):
    """Configuración de radar meteorológico global (RainViewer, etc.)."""
    enabled: bool = Field(default=True)
    provider: Literal["rainviewer"] = "rainviewer"
    refresh_minutes: int = Field(default=5, ge=1, le=120)
    history_minutes: int = Field(default=90, ge=5, le=360)
    frame_step: int = Field(default=5, ge=1, le=60)


class GlobalLayersConfig(BaseModel):
    """Contenedor de capas globales (satellite, radar)."""
    satellite: Optional[GlobalSatelliteLayerConfig] = Field(default_factory=GlobalSatelliteLayerConfig)
    radar: Optional[GlobalRadarLayerConfig] = Field(default_factory=GlobalRadarLayerConfig)


class LayersConfig(BaseModel):
    """Configuración de capas v2."""
    flights: Optional[FlightsLayerConfig] = None
    ships: Optional[ShipsLayerConfig] = None
    global_: Optional[GlobalLayersConfig] = Field(default_factory=GlobalLayersConfig, alias="global")


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


class HarvestConfig(BaseModel):
    """Configuración de hortalizas (harvest) v2."""

    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    custom_items: List[Dict[str, str]] = Field(default_factory=list)


class SaintsConfig(BaseModel):
    """Configuración de santoral v2."""

    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    include_namedays: bool = True
    locale: str = Field(default="es", min_length=2, max_length=5)


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
    enabled: bool = Field(default=True, description="Habilita las efemérides astronómicas")
    latitude: float = Field(default=39.986, ge=-90, le=90)
    longitude: float = Field(default=-0.051, ge=-180, le=180)
    timezone: str = Field(default="Europe/Madrid", min_length=1)


class OpenSkyOAuth2Config(BaseModel):
    """Configuración OAuth2 para OpenSky."""
    client_id: Optional[str] = Field(default=None, max_length=512)
    client_secret: Optional[str] = Field(default=None, max_length=512)
    token_url: str = Field(
        default="https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
        max_length=512,
    )
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
    calendar_ics: Optional[CalendarICSSecretsConfig] = None
    aviationstack: Optional[AviationStackSecretsConfig] = None
    aisstream: Optional[AISStreamSecretsConfig] = None
    aishub: Optional[AISHubSecretsConfig] = None


class AppConfigV2(BaseModel):
    """Esquema v2 completo de configuración."""
    model_config = ConfigDict(extra="ignore")

    version: int = Field(default=2, ge=2, le=2)
    display: Optional[DisplayConfig] = None
    ui_map: MapConfig = Field(default_factory=MapConfig)
    ui_global: Optional[UIGlobalConfig] = None
    panels: Optional[PanelsConfig] = None
    layers: Optional[LayersConfig] = Field(default_factory=LayersConfig)
    storm: Optional[StormModeConfig] = None
    blitzortung: Optional[BlitzortungConfig] = None
    news: Optional[NewsTopLevelConfig] = None
    ephemerides: Optional[EphemeridesTopLevelConfig] = None
    calendar: Optional[CalendarConfig] = None
    harvest: HarvestConfig = Field(default_factory=HarvestConfig)
    saints: SaintsConfig = Field(default_factory=SaintsConfig)
    opensky: Optional[OpenSkyTopLevelConfig] = None
    ais: Optional[AISConfig] = None
    secrets: Optional[SecretsConfig] = None
    
    @model_validator(mode="before")
    @classmethod
    def reject_v1_keys(cls, data: Any) -> Any:
        """Rechazar claves v1 legacy antes de validar."""
        if not isinstance(data, dict):
            return data
        
        v1_keys = []
        
        # Detectar ui.map (v1)
        if "ui" in data and isinstance(data["ui"], dict):
            if "map" in data["ui"]:
                v1_keys.append("ui.map")
        
        # Detectar claves legacy directas
        legacy_direct = ["maptiler", "cinema", "global"]
        for key in legacy_direct:
            if key in data:
                v1_keys.append(key)
        
        if v1_keys:
            raise ValueError(f"v1 keys not allowed: {', '.join(v1_keys)}")
        
        # Forzar version=2
        if "version" not in data or data["version"] != 2:
            data["version"] = 2
        
        return data
