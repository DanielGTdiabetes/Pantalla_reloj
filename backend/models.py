from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


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


class AppConfig(BaseModel):
    display: DisplaySettings = Field(default_factory=DisplaySettings)
    api_keys: APIKeys = Field(default_factory=APIKeys)
    mqtt: MQTTSettings = Field(default_factory=MQTTSettings)
    wifi: WiFiSettings = Field(default_factory=WiFiSettings)
    storm_mode: StormMode = Field(default_factory=StormMode)

    def to_path(self, path: Path) -> None:
        path.write_text(self.model_dump_json(indent=2, exclude_none=True), encoding="utf-8")


class ConfigUpdate(BaseModel):
    display: Optional[DisplaySettings] = None
    api_keys: Optional[APIKeys] = None
    mqtt: Optional[MQTTSettings] = None
    wifi: Optional[WiFiSettings] = None
    storm_mode: Optional[StormMode] = None


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
    "MQTTSettings",
    "StormMode",
    "WiFiSettings",
]
