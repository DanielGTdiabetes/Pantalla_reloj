from __future__ import annotations

import copy
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, MutableMapping, Optional

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, ValidationError, validator
from pydantic.functional_validators import model_validator

from backend.models.config import UiConfig

logger = logging.getLogger(__name__)

JWT_API_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]+={0,2}\.[A-Za-z0-9_-]+={0,2}\.[A-Za-z0-9_-]+={0,2}$")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = Path("/etc/pantalla-dash/config.json")
EXAMPLE_CONFIG_PATH = PROJECT_ROOT / "config" / "config.example.json"

CONFIG_PATH = Path(os.environ.get("PANTALLA_CONFIG_PATH", DEFAULT_CONFIG_PATH))


class ExtraAllowModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class AemetConfig(ExtraAllowModel):
    apiKey: str = Field(..., alias="apiKey", min_length=32, max_length=512, description="AEMET API key (JWT o legacy 32 hex)")
    municipioId: str = Field(default="28079", alias="municipioId", min_length=1)

    @validator("apiKey")
    def normalize_api_key(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("apiKey no puede estar vacío")
        if normalized.upper() == "AEMET_API_KEY_PLACEHOLDER":
            raise ValueError("apiKey debe establecerse con una clave real")
        if re.fullmatch(r"[0-9A-Fa-f]{32}", normalized):
            return normalized
        if JWT_API_KEY_PATTERN.fullmatch(normalized):
            return normalized
        raise ValueError("apiKey debe ser un JWT válido o 32 caracteres hexadecimales")

class WeatherConfig(ExtraAllowModel):
    units: str = Field(default="metric")
    city: Optional[str] = None

    @validator("units")
    def validate_units(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"metric", "imperial"}:
            raise ValueError("units must be 'metric' or 'imperial'")
        return normalized

class StormConfig(ExtraAllowModel):
    provider: str = Field(default="aemet", alias="provider")
    threshold: float = Field(default=0.6, ge=0.0, le=1.0)
    enableExperimentalLightning: bool = Field(default=False, alias="enableExperimentalLightning")
    radarCacheSeconds: int | None = Field(
        default=None, ge=60, le=3600, alias="radarCacheSeconds"
    )
    nearKm: float = Field(default=15.0, alias="nearKm")
    recentMinutes: int = Field(default=30, alias="recentMinutes", ge=1, le=180)
    alert: Optional["StormAlertConfig"] = None

    @validator("provider", pre=True, always=True)
    def normalize_provider(cls, value: Optional[str]) -> str:  # type: ignore[override]
        normalized = (value or "aemet").strip().lower()
        if normalized not in {"aemet", "blitzortung"}:
            return "aemet"
        return normalized


class StormAlertConfig(ExtraAllowModel):
    soundEnabled: bool = Field(default=False, alias="soundEnabled")
    cooldownMinutes: int = Field(default=30, alias="cooldownMinutes", ge=1, le=360)


class ThemeConfig(ExtraAllowModel):
    current: Optional[str] = None


class BackgroundConfig(ExtraAllowModel):
    intervalMinutes: Optional[int] = Field(default=None, ge=1, le=240)
    mode: Optional[str] = Field(default=None)
    retainDays: Optional[int] = Field(default=None, ge=1, le=90)

    @validator("mode")
    def validate_mode(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.lower()
        allowed_modes = {"daily", "weekly", "weather"}
        if normalized not in allowed_modes:
            allowed_list = "', '".join(sorted(allowed_modes))
            raise ValueError(f"mode must be one of '{allowed_list}'")
        return normalized


class TTSConfig(ExtraAllowModel):
    voice: Optional[str] = None
    volume: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class WifiConfig(ExtraAllowModel):
    preferredInterface: Optional[str] = None


class MQTTConfig(ExtraAllowModel):
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=1883, ge=1, le=65535)

    @validator("host")
    def normalize_host(cls, value: str) -> str:  # type: ignore[override]
        normalized = value.strip()
        return normalized or "127.0.0.1"


class BlitzortungMQTTConfig(ExtraAllowModel):
    mode: str = Field(default="public_proxy", alias="mode")
    proxy_host: str = Field(default="mqtt.blitzortung.org", alias="proxy_host")
    proxy_port: int = Field(default=8883, ge=1, le=65535, alias="proxy_port")
    proxy_ssl: bool = Field(default=True, alias="proxy_ssl")
    proxy_baseTopic: str = Field(default="blitzortung", alias="proxy_baseTopic")
    geohash: Optional[str] = None
    radius_km: Optional[int] = Field(default=100, ge=0, le=2000, alias="radius_km")
    host: Optional[str] = Field(default=None, alias="host")
    port: Optional[int] = Field(default=1883, ge=1, le=65535, alias="port")
    ssl: bool = Field(default=False, alias="ssl")
    username: Optional[str] = Field(default=None, alias="username")
    password: Optional[str] = Field(default=None, alias="password")

    @validator("mode")
    def normalize_mode(cls, value: str) -> str:  # type: ignore[override]
        normalized = (value or "public_proxy").strip().lower()
        if normalized not in {"public_proxy", "custom_broker"}:
            return "public_proxy"
        return normalized

    @validator("proxy_host")
    def normalize_proxy_host(cls, value: str) -> str:  # type: ignore[override]
        normalized = (value or "").strip()
        return normalized or "mqtt.blitzortung.org"

    @validator("proxy_baseTopic")
    def normalize_proxy_base_topic(cls, value: str) -> str:  # type: ignore[override]
        normalized = (value or "").strip().strip("/")
        return normalized or "blitzortung"

    @validator("geohash")
    def normalize_geohash(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        normalized = value.strip().strip("/")
        return normalized or None

    @validator("host")
    def normalize_host(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @validator("username")
    def normalize_username(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @validator("password")
    def normalize_password(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @validator("radius_km")
    def normalize_radius(cls, value: Optional[int]) -> Optional[int]:  # type: ignore[override]
        if value is None:
            return None
        return max(0, int(value))

    @validator("port")
    def normalize_port(cls, value: Optional[int]) -> Optional[int]:  # type: ignore[override]
        if value is None:
            return None
        return int(value)

    @root_validator
    def ensure_custom_broker_host(cls, values: Dict[str, Any]) -> Dict[str, Any]:  # type: ignore[override]
        mode = values.get("mode")
        host = values.get("host")
        if (mode or "") == "custom_broker" and not host:
            raise ValueError("host es obligatorio en modo custom_broker")
        return values


class BlitzortungConfig(ExtraAllowModel):
    enabled: bool = False
    mqtt: BlitzortungMQTTConfig = Field(default_factory=BlitzortungMQTTConfig)

    @property
    def mode(self) -> str:
        return self.mqtt.mode

    @model_validator(mode="before")
    @classmethod
    def merge_legacy_mode(cls, value: Any):
        if isinstance(value, MutableMapping):
            payload = dict(value)
            mode = payload.get("mode")
            mqtt_payload = payload.get("mqtt")
            if isinstance(mqtt_payload, MutableMapping):
                merged = dict(mqtt_payload)
                if mode is not None and "mode" not in merged:
                    merged["mode"] = mode
                payload["mqtt"] = merged
            elif mode is not None and "mqtt" not in payload:
                payload["mqtt"] = {"mode": mode}
            return payload
        return value

class CalendarGoogleConfig(ExtraAllowModel):
    calendarId: str = Field(default="primary", alias="calendarId", min_length=1)


class CalendarConfig(ExtraAllowModel):
    enabled: bool = False
    mode: str = Field(default="url")
    provider: Optional[str] = Field(default=None)
    url: Optional[AnyUrl] = None
    icsPath: Optional[str] = Field(default=None, alias="icsPath")
    maxEvents: int = Field(default=3, ge=1, le=10, alias="maxEvents")
    notifyMinutesBefore: int = Field(default=15, ge=0, le=360, alias="notifyMinutesBefore")
    google: Optional[CalendarGoogleConfig] = None

    @validator("mode")
    def validate_mode(cls, value: str) -> str:
        normalized = (value or "url").lower()
        if normalized not in {"url", "ics"}:
            raise ValueError("mode must be 'url' or 'ics'")
        return normalized

    @validator("provider", pre=True, always=True)
    def normalize_provider(cls, value: Optional[str], values: Dict[str, Any]) -> str:  # type: ignore[override]
        if value is not None and str(value).strip():
            normalized = str(value).strip().lower()
            if normalized not in {"none", "ics", "url", "google"}:
                raise ValueError("provider must be 'none', 'ics', 'url' or 'google'")
            return normalized

        enabled = bool(values.get("enabled", False))
        if not enabled:
            return "none"

        mode = (values.get("mode") or "").strip().lower()
        if mode in {"ics", "url"}:
            return mode

        if values.get("url"):
            return "url"
        if values.get("icsPath"):
            return "ics"
        return "none"

    @validator("icsPath")
    def normalize_ics_path(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.strip()
        return normalized or None

    @validator("url")
    def normalize_url(cls, value: Optional[AnyUrl]) -> Optional[AnyUrl]:
        return value

    @validator("mode", pre=True, always=True)
    def default_mode(cls, value: Optional[str], values: Dict[str, Any]) -> str:  # type: ignore[override]
        if value:
            return value
        if values.get("icsPath"):
            return "ics"
        raw_url = values.get("url")
        if raw_url:
            return "url"
        return "url"

    @validator("url", pre=True)
    def alias_ics_url(cls, value: Any, values: Dict[str, Any]) -> Any:  # type: ignore[override]
        if value is not None:
            return value
        legacy = values.get("icsUrl")
        return legacy

    def provider_kind(self) -> str:
        provider = (self.provider or "").strip().lower()
        if provider in {"none", "ics", "url", "google"}:
            return provider
        if not self.enabled:
            return "none"
        mode = (self.mode or "").strip().lower()
        if mode in {"ics", "url"}:
            return mode
        if self.url:
            return "url"
        if self.icsPath:
            return "ics"
        return "none"

class LocaleConfig(ExtraAllowModel):
    country: Optional[str] = None
    autonomousCommunity: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None


class PatronConfig(ExtraAllowModel):
    city: Optional[str] = None
    name: Optional[str] = None
    month: Optional[int] = Field(default=None, ge=1, le=12)
    day: Optional[int] = Field(default=None, ge=1, le=31)


class AppConfig(ExtraAllowModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    aemet: Optional[AemetConfig] = None
    weather: Optional[WeatherConfig] = None
    storm: Optional[StormConfig] = None
    blitzortung: Optional[BlitzortungConfig] = None
    theme: Optional[ThemeConfig] = None
    background: Optional[BackgroundConfig] = None
    tts: Optional[TTSConfig] = None
    wifi: Optional[WifiConfig] = None
    mqtt: Optional[MQTTConfig] = None
    calendar: Optional[CalendarConfig] = None
    locale: Optional[LocaleConfig] = None
    patron: Optional[PatronConfig] = None
    ui: Optional[UiConfig] = None

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
                if key
                in {
                    "provider",
                    "threshold",
                    "enableExperimentalLightning",
                    "nearKm",
                    "recentMinutes",
                    "alert",
                }
            },
            "blitzortung": (
                {
                    "mode": self.blitzortung.mode,
                    "enabled": self.blitzortung.enabled,
                    "mqtt": {
                        key: value
                        for key, value in (
                            self.blitzortung.mqtt.dict(by_alias=True)
                            if self.blitzortung and self.blitzortung.mqtt
                            else {}
                        ).items()
                        if key
                        in {
                            "mode",
                            "proxy_host",
                            "proxy_port",
                            "proxy_ssl",
                            "proxy_baseTopic",
                            "geohash",
                            "radius_km",
                            "host",
                            "port",
                            "ssl",
                            "username",
                        }
                    },
                }
                if self.blitzortung
                else {}
            ),
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
                            self.calendar.dict(
                                by_alias=True,
                                include={
                                    "enabled",
                                    "mode",
                                    "provider",
                                    "url",
                                    "icsPath",
                                    "maxEvents",
                                    "notifyMinutesBefore",
                                    "google",
                                },
                            )
                            if self.calendar
                            else {}
                        )
                    },
                    "icsConfigured": bool(self.calendar.icsPath) if self.calendar else False,
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
            "ui": (
                {
                    "wifi": {
                        "preferredInterface": self.ui.wifi.preferredInterface
                    },
                    "blitzortung": {
                        "enabled": self.ui.blitzortung.enabled,
                        "mode": self.ui.blitzortung.mode,
                        "mqtt": {
                            key: value
                            for key, value in self.ui.blitzortung.mqtt.model_dump().items()
                            if key
                            in {
                                "mode",
                                "proxy_host",
                                "proxy_port",
                                "proxy_ssl",
                                "proxy_baseTopic",
                                "geohash",
                                "radius_km",
                                "host",
                                "port",
                                "ssl",
                                "username",
                            }
                        },
                    },
                    "appearance": self.ui.appearance.model_dump(),
                }
                if self.ui
                else {}
            ),
        }


def _ensure_parent_permissions(path: Path) -> None:
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)


def read_config() -> AppConfig:
    """Read configuration from disk. Falls back to example file for development.

    Si la configuración principal no está disponible o contiene placeholders
    inválidos, degradamos de forma segura a una configuración vacía para evitar
    que el backend quede inutilizado.
    """

    source_path: Path
    using_example = False
    if CONFIG_PATH.exists():
        source_path = CONFIG_PATH
    elif EXAMPLE_CONFIG_PATH.exists():
        logger.warning("Using example configuration file at %s", EXAMPLE_CONFIG_PATH)
        source_path = EXAMPLE_CONFIG_PATH
        using_example = True
    else:
        raise FileNotFoundError("No configuration file available")

    with source_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # El archivo de ejemplo incluye placeholders para credenciales. Los
    # eliminamos para que el modelo pueda validarse y el servicio arranque.
    if isinstance(data, dict):
        aemet_section = data.get("aemet")
        placeholder = "AEMET_API_KEY_PLACEHOLDER"
        if (
            isinstance(aemet_section, dict)
            and str(aemet_section.get("apiKey", "")).strip().upper() == placeholder
        ):
            logger.info("Dropping placeholder AEMET config while loading %s", source_path)
            data = dict(data)
            data.pop("aemet", None)

    try:
        config = AppConfig.model_validate(data)
    except ValidationError as exc:
        if using_example:
            logger.warning(
                "Example configuration invalid (%s). Falling back to empty AppConfig.", exc
            )
            return AppConfig()
        logger.error("Invalid configuration: %s", exc)
        raise

    default_ui = UiConfig()
    ui_config = config.ui or default_ui

    wifi_pref = None
    if config.wifi and config.wifi.preferredInterface:
        wifi_pref = config.wifi.preferredInterface.strip()
    raw_ui = data.get("ui") if isinstance(data, dict) else None
    if isinstance(raw_ui, dict):
        wifi_data = raw_ui.get("wifi")
        if isinstance(wifi_data, dict):
            candidate = str(wifi_data.get("preferredInterface") or "").strip()
            if candidate:
                wifi_pref = candidate

    if wifi_pref:
        if not ui_config.wifi.preferredInterface or ui_config.wifi.preferredInterface == default_ui.wifi.preferredInterface:
            ui_config = ui_config.model_copy(update={"wifi": {"preferredInterface": wifi_pref}})

    blitz_source = None
    if isinstance(raw_ui, dict) and isinstance(raw_ui.get("blitzortung"), dict):
        blitz_source = raw_ui.get("blitzortung")
    elif config.blitzortung is not None:
        blitz_source = config.blitzortung.dict(by_alias=True)

    if isinstance(blitz_source, dict):
        mqtt_source = blitz_source.get("mqtt") if isinstance(blitz_source.get("mqtt"), dict) else {}
        default_mqtt = ui_config.blitzortung.mqtt
        mode_value = str(
            blitz_source.get("mode")
            or (mqtt_source.get("mode") if isinstance(mqtt_source, dict) else None)
            or default_mqtt.mode
            or "public_proxy"
        )
        blitz_update: dict[str, Any] = {
            "enabled": bool(blitz_source.get("enabled", ui_config.blitzortung.enabled)),
            "mode": mode_value,
            "mqtt": {
                "mode": str(mqtt_source.get("mode", mode_value)) if isinstance(mqtt_source, dict) else mode_value,
                "proxy_host": str(
                    (mqtt_source.get("proxy_host") if isinstance(mqtt_source, dict) else None)
                    or (mqtt_source.get("host") if isinstance(mqtt_source, dict) else None)
                    or default_mqtt.proxy_host
                    or ""
                ),
                "proxy_port": int(
                    (mqtt_source.get("proxy_port") if isinstance(mqtt_source, dict) else None)
                    or (mqtt_source.get("port") if isinstance(mqtt_source, dict) else None)
                    or default_mqtt.proxy_port
                ),
                "proxy_ssl": bool(
                    (mqtt_source.get("proxy_ssl") if isinstance(mqtt_source, dict) else None)
                    if isinstance(mqtt_source, dict) and mqtt_source.get("proxy_ssl") is not None
                    else (
                        (mqtt_source.get("ssl") if isinstance(mqtt_source, dict) else None)
                        if isinstance(mqtt_source, dict) and mqtt_source.get("ssl") is not None
                        else default_mqtt.proxy_ssl
                    )
                ),
                "proxy_baseTopic": str(
                    (mqtt_source.get("proxy_baseTopic") if isinstance(mqtt_source, dict) else None)
                    or (mqtt_source.get("baseTopic") if isinstance(mqtt_source, dict) else None)
                    or default_mqtt.proxy_baseTopic
                    or ""
                ),
                "geohash": (
                    mqtt_source.get("geohash", default_mqtt.geohash)
                    if isinstance(mqtt_source, dict)
                    else default_mqtt.geohash
                ),
                "radius_km": (
                    mqtt_source.get("radius_km", default_mqtt.radius_km)
                    if isinstance(mqtt_source, dict)
                    else default_mqtt.radius_km
                ),
                "host": (
                    mqtt_source.get("host", default_mqtt.host)
                    if isinstance(mqtt_source, dict)
                    else default_mqtt.host
                ),
                "port": (
                    mqtt_source.get("port", default_mqtt.port)
                    if isinstance(mqtt_source, dict)
                    else default_mqtt.port
                ),
                "ssl": (
                    bool(mqtt_source.get("ssl", default_mqtt.ssl))
                    if isinstance(mqtt_source, dict)
                    else default_mqtt.ssl
                ),
                "username": (
                    mqtt_source.get("username", default_mqtt.username)
                    if isinstance(mqtt_source, dict)
                    else default_mqtt.username
                ),
            },
        }
        ui_config = ui_config.model_copy(update={"blitzortung": blitz_update})

    if config.ui != ui_config:
        config = config.model_copy(update={"ui": ui_config})

    return config


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
    base_data: Dict[str, Any] = {}
    source_candidates = [CONFIG_PATH, EXAMPLE_CONFIG_PATH]
    for candidate in source_candidates:
        if candidate.exists():
            try:
                with candidate.open("r", encoding="utf-8") as handle:
                    raw = json.load(handle)
                    if isinstance(raw, dict):
                        base_data = raw
                        break
            except (OSError, json.JSONDecodeError):
                logger.warning("No se pudo leer configuración desde %s", candidate, exc_info=True)
    if not base_data:
        base_data = config.dict(by_alias=True, exclude_none=True)

    data = copy.deepcopy(base_data)
    allowed_fields = {
        "aemet": {"apiKey", "municipioId"},
        "weather": {"city", "units"},
        "storm": {"threshold", "enableExperimentalLightning"},
        "theme": {"current"},
        "background": {"intervalMinutes", "mode", "retainDays"},
        "tts": {"voice", "volume"},
        "wifi": {"preferredInterface"},
        "calendar": {
            "enabled",
            "mode",
            "provider",
            "url",
            "icsPath",
            "icsUrl",
            "maxEvents",
            "notifyMinutesBefore",
            "google",
        },
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

    calendar_payload = sanitized.get("calendar")
    if isinstance(calendar_payload, dict) and "icsUrl" in calendar_payload and "url" not in calendar_payload:
        calendar_payload["url"] = calendar_payload.pop("icsUrl")

    if config.calendar:
        merged.setdefault("calendar", {})
        if (
            config.calendar.url
            and (
                "calendar" not in sanitized
                or (
                    isinstance(sanitized.get("calendar"), dict)
                    and "url" not in sanitized.get("calendar", {})
                    and "icsUrl" not in sanitized.get("calendar", {})
                )
            )
        ):
            merged["calendar"]["url"] = str(config.calendar.url)

        if (
            config.calendar.icsPath
            and (
                "calendar" not in sanitized
                or "icsPath" not in sanitized.get("calendar", {})
            )
        ):
            merged["calendar"]["icsPath"] = config.calendar.icsPath

        if (
            config.calendar.mode
            and (
                "calendar" not in sanitized
                or "mode" not in sanitized.get("calendar", {})
            )
        ):
            merged["calendar"]["mode"] = config.calendar.mode

    updated = AppConfig.model_validate(merged)
    canonical = updated.dict(by_alias=True, exclude_none=True)
    serialized = copy.deepcopy(merged)
    _deep_merge(serialized, canonical)
    aemet_section = serialized.get("aemet")
    if isinstance(aemet_section, dict):
        api_key_value = aemet_section.get("apiKey")
        if not api_key_value or str(api_key_value).strip().upper() == "AEMET_API_KEY_PLACEHOLDER":
            aemet_section.pop("apiKey", None)

    if CONFIG_PATH.exists() or CONFIG_PATH.parent.exists():
        _ensure_parent_permissions(CONFIG_PATH)
        tmp_path = CONFIG_PATH.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(serialized, f, indent=2, ensure_ascii=False)
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
    if cfg.ui and cfg.ui.wifi and cfg.ui.wifi.preferredInterface:
        return cfg.ui.wifi.preferredInterface
    return cfg.wifi.preferredInterface if cfg.wifi else None
