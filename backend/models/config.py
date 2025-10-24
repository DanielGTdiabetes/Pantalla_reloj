from __future__ import annotations

from typing import Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    NonNegativeInt,
    conint,
    root_validator,
    validator,
)
from pydantic.functional_validators import model_validator


_MQTT_MODE_PATTERN = r"^(public_proxy|custom_broker)$"


class BlitzMQTT(BaseModel):
    mode: str = Field("public_proxy", pattern=_MQTT_MODE_PATTERN)
    proxy_host: str = "mqtt.blitzortung.org"
    proxy_port: conint(ge=1, le=65535) = 8883  # type: ignore[call-arg]
    proxy_ssl: bool = True
    proxy_baseTopic: str = "blitzortung"
    geohash: Optional[str] = None
    radius_km: NonNegativeInt = 100  # type: ignore[assignment]

    host: Optional[str] = None
    port: Optional[conint(ge=1, le=65535)] = 1883  # type: ignore[call-arg]
    ssl: bool = False
    username: Optional[str] = None
    password: Optional[str] = None

    @validator("mode")
    def _validate_mode(cls, value: str) -> str:  # type: ignore[override]
        normalized = (value or "public_proxy").strip()
        if normalized not in {"public_proxy", "custom_broker"}:
            raise ValueError("mode debe ser 'public_proxy' o 'custom_broker'")
        return normalized

    @validator("proxy_host")
    def _normalize_proxy_host(cls, value: str) -> str:  # type: ignore[override]
        normalized = (value or "").strip()
        return normalized or "mqtt.blitzortung.org"

    @validator("proxy_baseTopic")
    def _normalize_proxy_base_topic(cls, value: str) -> str:  # type: ignore[override]
        normalized = (value or "").strip().strip("/")
        return normalized or "blitzortung"

    @validator("geohash")
    def _normalize_geohash(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        normalized = value.strip().strip("/")
        return normalized or None

    @validator("host")
    def _normalize_host(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @validator("username")
    def _normalize_username(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @validator("password")
    def _normalize_password(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @root_validator
    def _validate_custom_broker(cls, values: dict) -> dict:  # type: ignore[override]
        mode = values.get("mode")
        host = values.get("host")
        if mode == "custom_broker":
            if not host:
                raise ValueError("host es obligatorio en modo custom_broker")
        return values


class Wifi(BaseModel):
    preferredInterface: str = "wlp2s0"


class UiAppearance(BaseModel):
    transparentCards: bool = False


class UiConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    wifi: Wifi = Field(default_factory=Wifi)
    blitzortung: "Blitzortung" = Field(default_factory=lambda: Blitzortung())
    appearance: UiAppearance = Field(default_factory=UiAppearance)


class Blitzortung(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    enabled: bool = False
    mode: str = Field("public_proxy", pattern=_MQTT_MODE_PATTERN)
    mqtt: BlitzMQTT = Field(default_factory=BlitzMQTT)

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy(cls, value):
        if isinstance(value, dict):
            migrated = dict(value)
            if "mqtt" not in migrated:
                mqtt_keys = {
                    "host",
                    "port",
                    "ssl",
                    "username",
                    "password",
                    "baseTopic",
                    "base_topic",
                    "geohash",
                    "radius_km",
                }
                if any(key in migrated for key in mqtt_keys):
                    mqtt_payload = {
                        "host": migrated.pop("host", None),
                        "port": migrated.pop("port", None),
                        "ssl": migrated.pop("ssl", None),
                        "username": migrated.pop("username", None),
                        "password": migrated.pop("password", None),
                        "proxy_baseTopic": migrated.pop("baseTopic", None) or migrated.pop("base_topic", None),
                        "geohash": migrated.pop("geohash", None),
                        "radius_km": migrated.pop("radius_km", None),
                    }
                    migrated["mqtt"] = {k: v for k, v in mqtt_payload.items() if v is not None}
            return migrated
        return value

    @model_validator(mode="after")
    def _sync_mode(self):
        mqtt_mode = self.mqtt.mode
        if mqtt_mode != self.mode:
            object.__setattr__(self, "mode", mqtt_mode)
        return self


