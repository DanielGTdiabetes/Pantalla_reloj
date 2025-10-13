from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, MutableMapping, Optional

from pydantic import AnyUrl, BaseModel, Field, ValidationError, validator

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = Path("/etc/pantalla-dash/config.json")
EXAMPLE_CONFIG_PATH = PROJECT_ROOT / "config" / "config.example.json"

CONFIG_PATH = Path(os.environ.get("PANTALLA_CONFIG_PATH", DEFAULT_CONFIG_PATH))


class AemetConfig(BaseModel):
    apiKey: Optional[str] = Field(default=None, alias="apiKey")
    municipioId: str = Field(default="28079", alias="municipioId", min_length=1)

    class Config:
        allow_population_by_field_name = True
        extra = "ignore"


class WeatherConfig(BaseModel):
    units: str = Field(default="metric")
    city: Optional[str] = None

    @validator("units")
    def validate_units(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"metric", "imperial"}:
            raise ValueError("units must be 'metric' or 'imperial'")
        return normalized

    class Config:
        allow_population_by_field_name = True
        extra = "ignore"


class StormConfig(BaseModel):
    threshold: float = Field(default=0.6, ge=0.0, le=1.0)
    enableExperimentalLightning: bool = Field(default=False, alias="enableExperimentalLightning")

    class Config:
        allow_population_by_field_name = True


class ThemeConfig(BaseModel):
    current: Optional[str] = None


class BackgroundConfig(BaseModel):
    intervalMinutes: Optional[int] = Field(default=None, ge=1, le=240)
    mode: Optional[str] = Field(default=None)
    retainDays: Optional[int] = Field(default=None, ge=1, le=90)

    @validator("mode")
    def validate_mode(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.lower()
        if normalized not in {"daily", "weather"}:
            raise ValueError("mode must be 'daily' or 'weather'")
        return normalized


class TTSConfig(BaseModel):
    voice: Optional[str] = None
    volume: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class WifiConfig(BaseModel):
    preferredInterface: Optional[str] = None


class CalendarConfig(BaseModel):
    enabled: bool = False
    icsUrl: Optional[AnyUrl] = Field(default=None, alias="icsUrl")
    maxEvents: int = Field(default=3, ge=1, le=10, alias="maxEvents")
    notifyMinutesBefore: int = Field(default=15, ge=0, le=360, alias="notifyMinutesBefore")

    class Config:
        populate_by_name = True


class LocaleConfig(BaseModel):
    country: Optional[str] = None
    autonomousCommunity: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None


class PatronConfig(BaseModel):
    city: Optional[str] = None
    name: Optional[str] = None
    month: Optional[int] = Field(default=None, ge=1, le=12)
    day: Optional[int] = Field(default=None, ge=1, le=31)


class AppConfig(BaseModel):
    aemet: Optional[AemetConfig] = None
    weather: Optional[WeatherConfig] = None
    storm: Optional[StormConfig] = None
    theme: Optional[ThemeConfig] = None
    background: Optional[BackgroundConfig] = None
    tts: Optional[TTSConfig] = None
    wifi: Optional[WifiConfig] = None
    calendar: Optional[CalendarConfig] = None
    locale: Optional[LocaleConfig] = None
    patron: Optional[PatronConfig] = None

    def public_view(self) -> Dict[str, Any]:
        return {
            "weather": {
                key: value
                for key, value in (self.weather.dict(by_alias=True) if self.weather else {}).items()
                if key in {"city", "units"}
            },
            "storm": {
                key: value
                for key, value in (self.storm.dict(by_alias=True) if self.storm else {}).items()
                if key in {"threshold", "enableExperimentalLightning"}
            },
            "theme": (self.theme.dict() if self.theme else {}),
            "background": (self.background.dict() if self.background else {}),
            "tts": {
                key: value
                for key, value in (self.tts.dict() if self.tts else {}).items()
                if key in {"voice", "volume"}
            },
            "wifi": {
                key: value
                for key, value in (self.wifi.dict() if self.wifi else {}).items()
                if key in {"preferredInterface"}
            },
            "calendar": (
                {
                    **{
                        key: value
                        for key, value in (
                            self.calendar.dict(by_alias=True, exclude={"icsUrl"}) if self.calendar else {}
                        )
                        if key in {"enabled", "maxEvents", "notifyMinutesBefore"}
                    },
                    "icsConfigured": bool(self.calendar.icsUrl) if self.calendar else False,
                }
                if self.calendar
                else {}
            ),
            "locale": (self.locale.dict() if self.locale else {}),
            "patron": (
                {
                    key: value
                    for key, value in (self.patron.dict() if self.patron else {}).items()
                    if key in {"city", "name", "month", "day"}
                }
                if self.patron
                else {}
            ),
        }


def _ensure_parent_permissions(path: Path) -> None:
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)


def read_config() -> AppConfig:
    """Read configuration from disk. Falls back to example file for development."""
    source_path: Path
    if CONFIG_PATH.exists():
        source_path = CONFIG_PATH
    elif EXAMPLE_CONFIG_PATH.exists():
        logger.warning("Using example configuration file at %s", EXAMPLE_CONFIG_PATH)
        source_path = EXAMPLE_CONFIG_PATH
    else:
        raise FileNotFoundError("No configuration file available")

    with source_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    try:
        return AppConfig.parse_obj(data)
    except ValidationError as exc:
        logger.error("Invalid configuration: %s", exc)
        raise


def _deep_merge(original: MutableMapping[str, Any], updates: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(original.get(key), dict):
            _deep_merge(original[key], value)
        else:
            original[key] = value
    return original


def update_config(payload: Dict[str, Any]) -> AppConfig:
    """Update a subset of the configuration while keeping the rest intact."""
    config = read_config()
    data = config.dict(by_alias=True, exclude_none=True)
    allowed_fields = {
        "aemet": {"apiKey", "municipioId"},
        "weather": {"city", "units"},
        "storm": {"threshold", "enableExperimentalLightning"},
        "theme": {"current"},
        "background": {"intervalMinutes", "mode", "retainDays"},
        "tts": {"voice", "volume"},
        "wifi": {"preferredInterface"},
        "calendar": {"enabled", "icsUrl", "maxEvents", "notifyMinutesBefore"},
        "locale": {"country", "autonomousCommunity", "province", "city"},
        "patron": {"city", "name", "month", "day"},
    }

    sanitized: Dict[str, Any] = {}
    for section, fields in allowed_fields.items():
        if section in payload and isinstance(payload[section], dict):
            sanitized[section] = {k: v for k, v in payload[section].items() if k in fields}

    merged = _deep_merge(data, sanitized)

    # Ensure sensitive fields are preserved if missing from payload
    if config.aemet and config.aemet.apiKey and (
        "aemet" not in sanitized or "apiKey" not in sanitized.get("aemet", {})
    ):
        merged.setdefault("aemet", {})
        merged["aemet"]["apiKey"] = config.aemet.apiKey

    if config.calendar and config.calendar.icsUrl and (
        "calendar" not in sanitized or "icsUrl" not in sanitized.get("calendar", {})
    ):
        merged.setdefault("calendar", {})
        merged["calendar"]["icsUrl"] = config.calendar.icsUrl

    updated = AppConfig.parse_obj(merged)

    if CONFIG_PATH.exists() or CONFIG_PATH.parent.exists():
        _ensure_parent_permissions(CONFIG_PATH)
        tmp_path = CONFIG_PATH.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(updated.dict(by_alias=True, exclude_none=True), f, indent=2, ensure_ascii=False)
        os.chmod(tmp_path, 0o600)
        tmp_path.replace(CONFIG_PATH)
    else:
        logger.warning("Skipping config write, target path %s missing", CONFIG_PATH)

    return updated


def get_api_key() -> Optional[str]:
    config = read_config()
    return config.aemet.apiKey if config.aemet else None


def get_wifi_interface(config: Optional[AppConfig] = None) -> Optional[str]:
    cfg = config or read_config()
    return cfg.wifi.preferredInterface if cfg.wifi else None
