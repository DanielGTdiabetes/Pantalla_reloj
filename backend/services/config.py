from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, MutableMapping, Optional

from pydantic import BaseModel, Field, ValidationError, validator

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = Path("/etc/pantalla-dash/config.json")
EXAMPLE_CONFIG_PATH = PROJECT_ROOT / "config" / "config.example.json"

CONFIG_PATH = Path(os.environ.get("PANTALLA_CONFIG_PATH", DEFAULT_CONFIG_PATH))


class WeatherConfig(BaseModel):
    apiKey: Optional[str] = Field(default=None, alias="apiKey")
    lat: float
    lon: float
    city: Optional[str] = None
    units: Optional[str] = Field(default="metric")

    @validator("units")
    def validate_units(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if value not in {"metric", "imperial"}:
            raise ValueError("units must be 'metric' or 'imperial'")
        return value


class ThemeConfig(BaseModel):
    current: Optional[str] = None


class BackgroundConfig(BaseModel):
    intervalMinutes: Optional[int] = Field(default=None, ge=1, le=240)


class TTSConfig(BaseModel):
    voice: Optional[str] = None
    volume: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class WifiConfig(BaseModel):
    preferredInterface: Optional[str] = None


class AppConfig(BaseModel):
    weather: Optional[WeatherConfig] = None
    theme: Optional[ThemeConfig] = None
    background: Optional[BackgroundConfig] = None
    tts: Optional[TTSConfig] = None
    wifi: Optional[WifiConfig] = None

    def public_view(self) -> Dict[str, Any]:
        return {
            "weather": {
                key: value
                for key, value in (self.weather.dict(by_alias=True) if self.weather else {}).items()
                if key in {"lat", "lon", "city", "units"}
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
        "weather": {"lat", "lon", "city", "units", "apiKey"},
        "theme": {"current"},
        "background": {"intervalMinutes"},
        "tts": {"voice", "volume"},
        "wifi": {"preferredInterface"},
    }

    sanitized: Dict[str, Any] = {}
    for section, fields in allowed_fields.items():
        if section in payload and isinstance(payload[section], dict):
            sanitized[section] = {k: v for k, v in payload[section].items() if k in fields}

    merged = _deep_merge(data, sanitized)

    # Ensure sensitive fields are preserved if missing from payload
    if config.weather and config.weather.apiKey and (
        "weather" not in sanitized or "apiKey" not in sanitized.get("weather", {})
    ):
        merged.setdefault("weather", {})
        merged["weather"]["apiKey"] = config.weather.apiKey

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
    return config.weather.apiKey if config.weather else None


def get_wifi_interface(config: Optional[AppConfig] = None) -> Optional[str]:
    cfg = config or read_config()
    return cfg.wifi.preferredInterface if cfg.wifi else None
