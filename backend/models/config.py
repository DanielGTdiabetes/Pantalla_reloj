from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt, conint


class BlitzMQTT(BaseModel):
    host: str = Field("", description="Broker del relay MQTT")
    port: conint(ge=1, le=65535) = 8883  # type: ignore[call-arg]
    ssl: bool = True
    username: Optional[str] = None
    password: Optional[str] = None
    baseTopic: str = Field("", description="Prefijo del relay, p.ej. blitzortung/<region>")
    geohash: Optional[str] = None
    radius_km: NonNegativeInt = 100  # type: ignore[assignment]


class Blitzortung(BaseModel):
    enabled: bool = False
    mode: str = Field("mqtt", pattern=r"^(mqtt|ws)$")
    mqtt: BlitzMQTT = Field(default_factory=BlitzMQTT)


class Wifi(BaseModel):
    preferredInterface: str = "wlp2s0"


class UiAppearance(BaseModel):
    transparentCards: bool = False


class UiConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    wifi: Wifi = Field(default_factory=Wifi)
    blitzortung: Blitzortung = Field(default_factory=Blitzortung)
    appearance: UiAppearance = Field(default_factory=UiAppearance)


