from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, conint, validator


class Wifi(BaseModel):
    preferredInterface: Optional[str] = None


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
    mqtt_host: Optional[str] = Field(default=None, alias="mqtt_host")
    mqtt_port: conint(ge=1, le=65535) = Field(1883, alias="mqtt_port")  # type: ignore[call-arg]
    topic_base: str = Field("blitzortung/", alias="topic_base")
    radius_km: conint(ge=0, le=2000) = Field(100, alias="radius_km")  # type: ignore[call-arg]
    time_window_min: conint(ge=1, le=360) = Field(30, alias="time_window_min")  # type: ignore[call-arg]

    @validator("mqtt_host")
    def _normalize_mqtt_host(cls, value: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @validator("topic_base")
    def _normalize_topic_base(cls, value: str) -> str:  # type: ignore[override]
        normalized = (value or "blitzortung/").strip()
        if not normalized:
            normalized = "blitzortung/"
        normalized = normalized.replace("#", "").lstrip("/")
        if not normalized.endswith("/"):
            normalized = f"{normalized}/"
        return normalized

    @validator("radius_km")
    def _clamp_radius(cls, value: int) -> int:  # type: ignore[override]
        return max(0, min(2000, value))

    @validator("time_window_min")
    def _clamp_window(cls, value: int) -> int:  # type: ignore[override]
        return max(1, min(360, value))


