from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, confloat, conint, validator


class Wifi(BaseModel):
    preferredInterface: Optional[str] = None


class UiAppearance(BaseModel):
    transparentCards: bool = False


class OverlayConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    position: Literal["left", "right"] = Field("right", alias="position")
    width_px: conint(ge=280, le=640) = Field(420, alias="width_px")  # type: ignore[call-arg]
    opacity: confloat(ge=0.3, le=1.0) = Field(0.85, alias="opacity")  # type: ignore[call-arg]
    blur_px: conint(ge=0, le=10) = Field(6, alias="blur_px")  # type: ignore[call-arg]
    dwell_seconds: conint(ge=3, le=180) = Field(15, alias="dwell_seconds")  # type: ignore[call-arg]
    transition_ms: conint(ge=100, le=10_000) = Field(450, alias="transition_ms")  # type: ignore[call-arg]
    order: list[str] = Field(
        default_factory=lambda: [
            "weather_now",
            "weather_week",
            "moon",
            "season",
            "ephemeris",
            "news",
            "saints",
            "calendar",
        ]
    )


class UiConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    mode: str = Field(default="geoscope_with_overlay")
    wifi: Wifi = Field(default_factory=Wifi)
    blitzortung: "Blitzortung" = Field(default_factory=lambda: Blitzortung())
    appearance: UiAppearance = Field(default_factory=UiAppearance)
    overlay: OverlayConfig = Field(default_factory=OverlayConfig)


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


class GeoscopeConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    enabled: bool = True
    rotate: bool = True
    fps_cap: conint(ge=1, le=120) = Field(30, alias="fps_cap")  # type: ignore[call-arg]


