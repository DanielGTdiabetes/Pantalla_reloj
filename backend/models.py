from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


DEFAULT_CINEMA_BANDS: List[Dict[str, float | int]] = [
    {"lat": 0.0, "zoom": 2.8, "pitch": 10.0, "minZoom": 2.6, "duration_sec": 900},
    {"lat": 18.0, "zoom": 3.0, "pitch": 8.0, "minZoom": 2.8, "duration_sec": 720},
    {"lat": 32.0, "zoom": 3.3, "pitch": 6.0, "minZoom": 3.0, "duration_sec": 600},
    {"lat": 42.0, "zoom": 3.6, "pitch": 6.0, "minZoom": 3.2, "duration_sec": 480},
    {"lat": -18.0, "zoom": 3.0, "pitch": 8.0, "minZoom": 2.8, "duration_sec": 720},
    {"lat": -32.0, "zoom": 3.3, "pitch": 6.0, "minZoom": 3.0, "duration_sec": 600},
]


class Display(BaseModel):
    model_config = ConfigDict(extra="ignore")

    timezone: str = Field(default="Europe/Madrid", min_length=1)
    module_cycle_seconds: int = Field(default=20, ge=5, le=600)


class MapCinemaBand(BaseModel):
    model_config = ConfigDict(extra="ignore")

    lat: float
    zoom: float
    pitch: float
    minZoom: float
    duration_sec: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_zoom(cls, values: "MapCinemaBand") -> "MapCinemaBand":  # type: ignore[override]
        if values.minZoom > values.zoom:
            raise ValueError("minZoom must be less than or equal to zoom")
        return values


class MapCinema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    panLngDegPerSec: float = Field(default=0.0, ge=0)
    bandTransition_sec: int = Field(default=8, ge=1)
    bands: List[MapCinemaBand] = Field(
        default_factory=lambda: [MapCinemaBand(**band) for band in DEFAULT_CINEMA_BANDS]
    )

    @model_validator(mode="after")
    def validate_bands(cls, values: "MapCinema") -> "MapCinema":  # type: ignore[override]
        bands = values.bands
        if len(bands) != len(DEFAULT_CINEMA_BANDS):
            raise ValueError(
                f"cinema must define exactly {len(DEFAULT_CINEMA_BANDS)} bands"
            )
        return values


class MapIdlePan(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    intervalSec: int = Field(default=300, ge=10)


class MapTheme(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sea: str = "#0b3756"
    land: str = "#20262c"
    label: str = "#d6e7ff"
    contrast: float = 0.15
    tint: str = "rgba(0,170,255,0.06)"


DEFAULT_MAPTILER_SETTINGS: Dict[str, Optional[str]] = {
    "key": None,
    "styleUrlDark": "https://api.maptiler.com/maps/dark/style.json",
    "styleUrlLight": "https://api.maptiler.com/maps/streets/style.json",
    "styleUrlBright": "https://api.maptiler.com/maps/bright/style.json",
}


class MapConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    engine: Literal["maplibre"] = "maplibre"
    style: Literal[
        "vector-dark",
        "vector-light",
        "vector-bright",
        "raster-carto-dark",
        "raster-carto-light",
    ] = "vector-dark"
    provider: Literal["maptiler", "osm"] = "osm"
    maptiler: Dict[str, Optional[str]] = Field(
        default_factory=lambda: DEFAULT_MAPTILER_SETTINGS.copy()
    )
    renderWorldCopies: bool = True
    interactive: bool = False
    controls: bool = False
    cinema: MapCinema = Field(default_factory=MapCinema)
    idlePan: MapIdlePan = Field(default_factory=MapIdlePan)
    theme: MapTheme = Field(default_factory=MapTheme)


class Rotation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    duration_sec: int = Field(default=10, ge=3, le=3600)
    panels: List[str] = Field(
        default_factory=lambda: [
            "news",
            "ephemerides",
            "moon",
            "forecast",
            "calendar",
        ]
    )

    @field_validator("panels")
    @classmethod
    def validate_panels(cls, value: List[str]) -> List[str]:
        sanitized = [panel for panel in value if panel]
        if not sanitized:
            raise ValueError("rotation.panels must include at least one panel")
        lower = [panel.lower() for panel in sanitized]
        if len(lower) != len(set(lower)):
            raise ValueError("rotation.panels must not include duplicates")
        return sanitized


class UI(BaseModel):
    model_config = ConfigDict(extra="ignore")

    layout: Literal["grid-2-1"] = "grid-2-1"
    map: MapConfig = Field(default_factory=MapConfig)
    rotation: Rotation = Field(default_factory=Rotation)


class News(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = True


class AI(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False


class StormMode(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    center_lat: float = Field(default=39.986, ge=-90, le=90)
    center_lng: float = Field(default=-0.051, ge=-180, le=180)
    zoom: float = Field(default=9.0, ge=1, le=20)
    auto_enable: bool = False
    auto_disable_after_minutes: int = Field(default=60, ge=5, le=1440)


class AEMET(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    api_key: Optional[str] = Field(default=None, max_length=256)
    cap_enabled: bool = True
    radar_enabled: bool = True
    satellite_enabled: bool = False
    cache_minutes: int = Field(default=15, ge=1, le=60)


class Blitzortung(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    mqtt_host: str = Field(default="127.0.0.1", min_length=1)
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_topic: str = Field(default="blitzortung/1", min_length=1)
    ws_enabled: bool = False
    ws_url: Optional[str] = Field(default=None, max_length=512)


class MapBackend(BaseModel):
    model_config = ConfigDict(extra="ignore")

    provider: Literal["maptiler", "osm"] = "osm"
    maptiler_api_key: Optional[str] = Field(default=None, max_length=128)

    @field_validator("maptiler_api_key", mode="before")
    @classmethod
    def normalize_api_key(cls, value: object) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        raise TypeError("maptiler_api_key must be a string or null")

    @field_validator("maptiler_api_key")
    @classmethod
    def validate_key_pattern(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")
        if not value:
            return None
        if any(char not in allowed for char in value):
            raise ValueError("maptiler_api_key solo puede contener letras, números, punto, guion y guion bajo")
        return value

    @model_validator(mode="after")
    def validate_dependencies(self) -> "MapBackend":  # type: ignore[override]
        if self.provider == "maptiler" and not self.maptiler_api_key:
            raise ValueError("map.maptiler_api_key es obligatorio cuando el proveedor es MapTiler")
        return self


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    display: Display = Field(default_factory=Display)
    ui: UI = Field(default_factory=UI)
    news: News = Field(default_factory=News)
    ai: AI = Field(default_factory=AI)
    map: MapBackend = Field(default_factory=MapBackend)
    storm: StormMode = Field(default_factory=StormMode)
    aemet: AEMET = Field(default_factory=AEMET)
    blitzortung: Blitzortung = Field(default_factory=Blitzortung)

    def to_path(self, path: Path) -> None:
        path.write_text(
            self.model_dump_json(indent=2, exclude_none=True, by_alias=True),
            encoding="utf-8",
        )


class CachedPayload(BaseModel):
    source: str
    fetched_at: datetime
    payload: Dict


__all__ = [
    "AI",
    "AEMET",
    "AppConfig",
    "Blitzortung",
    "CachedPayload",
    "Display",
    "MapBackend",
    "MapCinema",
    "MapCinemaBand",
    "MapConfig",
    "MapIdlePan",
    "MapTheme",
    "News",
    "Rotation",
    "StormMode",
    "UI",
]
