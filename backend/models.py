from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class DisplayModule(BaseModel):
    name: str
    enabled: bool = True
    duration_seconds: int = Field(default=20, ge=5, le=600)


class DisplaySettings(BaseModel):
    timezone: str = "Europe/Madrid"
    rotation: str = "left"
    module_cycle_seconds: int = Field(default=20, ge=5, le=600)
    modules: List[DisplayModule] = Field(
        default_factory=lambda: [
            DisplayModule(name="clock"),
            DisplayModule(name="weather"),
            DisplayModule(name="moon"),
            DisplayModule(name="news"),
            DisplayModule(name="events"),
            DisplayModule(name="calendar"),
        ]
    )


class APIKeys(BaseModel):
    weather: Optional[str] = None
    news: Optional[str] = None
    astronomy: Optional[str] = None
    calendar: Optional[str] = None


class MQTTSettings(BaseModel):
    enabled: bool = False
    host: str = "localhost"
    port: int = 1883
    topic: str = "pantalla/reloj"
    username: Optional[str] = None
    password: Optional[str] = None


class WiFiSettings(BaseModel):
    interface: str = "wlan2"
    ssid: Optional[str] = None
    psk: Optional[str] = None


class StormMode(BaseModel):
    enabled: bool = False
    last_triggered: Optional[datetime] = None


class UIScrollSettings(BaseModel):
    enabled: bool = True
    direction: Literal["left", "up"] = "left"
    speed: float | Literal["slow", "normal", "fast"] = "normal"
    gap_px: int = Field(default=48, ge=0, le=480)


class UITextSettings(BaseModel):
    scroll: Dict[str, UIScrollSettings] = Field(
        default_factory=lambda: {
            "news": UIScrollSettings(direction="left", speed="normal", gap_px=48),
            "ephemerides": UIScrollSettings(direction="up", speed="slow", gap_px=24),
            "forecast": UIScrollSettings(direction="up", speed="slow", gap_px=24),
        }
    )


class UIFixedClockSettings(BaseModel):
    format: str = "HH:mm"


class UIFixedTemperatureSettings(BaseModel):
    unit: str = "C"


class UIFixedSettings(BaseModel):
    clock: UIFixedClockSettings = Field(default_factory=UIFixedClockSettings)
    temperature: UIFixedTemperatureSettings = Field(default_factory=UIFixedTemperatureSettings)


class UIRotationSettings(BaseModel):
    enabled: bool = True
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


class UIMapSettings(BaseModel):
    provider: str = "osm"
    center: List[float] = Field(default_factory=lambda: [0.0, 0.0])
    zoom: int = Field(default=2, ge=0, le=18)
    interactive: bool = False
    controls: bool = False


class UISettings(BaseModel):
    model_config = ConfigDict(extra="allow")

    rotation: UIRotationSettings = Field(default_factory=UIRotationSettings)
    fixed: UIFixedSettings = Field(default_factory=UIFixedSettings)
    map: UIMapSettings = Field(default_factory=UIMapSettings)
    text: UITextSettings = Field(default_factory=UITextSettings)


class AppConfig(BaseModel):
    display: DisplaySettings = Field(default_factory=DisplaySettings)
    api_keys: APIKeys = Field(default_factory=APIKeys)
    mqtt: MQTTSettings = Field(default_factory=MQTTSettings)
    wifi: WiFiSettings = Field(default_factory=WiFiSettings)
    storm_mode: StormMode = Field(default_factory=StormMode)
    ui: UISettings = Field(default_factory=UISettings)

    def to_path(self, path: Path) -> None:
        path.write_text(self.model_dump_json(indent=2, exclude_none=True), encoding="utf-8")


class ConfigUpdate(BaseModel):
    display: Optional[DisplaySettings] = None
    api_keys: Optional[APIKeys] = None
    mqtt: Optional[MQTTSettings] = None
    wifi: Optional[WiFiSettings] = None
    storm_mode: Optional[StormMode] = None
    ui: Optional[UISettings] = None


class CachedPayload(BaseModel):
    source: str
    fetched_at: datetime
    payload: Dict


__all__ = [
    "AppConfig",
    "APIKeys",
    "CachedPayload",
    "ConfigUpdate",
    "DisplayModule",
    "DisplaySettings",
    "UIScrollSettings",
    "UITextSettings",
    "UIFixedSettings",
    "UIRotationSettings",
    "UIMapSettings",
    "UISettings",
    "MQTTSettings",
    "StormMode",
    "WiFiSettings",
]
