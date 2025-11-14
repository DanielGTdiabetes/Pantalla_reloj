"""Pydantic models for global satellite endpoints."""

from typing import List, Optional

from pydantic import BaseModel, Field


class GlobalSatelliteFrame(BaseModel):
    """Metadata for a single GIBS frame."""

    timestamp: int = Field(..., ge=0, description="Unix timestamp for the frame")
    t_iso: str = Field(..., min_length=1, description="UTC timestamp in ISO8601 format")
    layer: str = Field(..., min_length=1, max_length=128)
    time_key: str = Field(..., min_length=1, max_length=32)
    tile_matrix_set: str = Field(..., min_length=1, max_length=128)
    z: int = Field(..., ge=0, le=24, description="Recommended zoom level for the animation")
    min_zoom: int = Field(..., ge=0, le=24)
    max_zoom: int = Field(..., ge=0, le=24)
    tile_url: str = Field(..., min_length=1, description="Tile URL template containing {z}/{y}/{x} placeholders")


class GlobalSatelliteFramesResponse(BaseModel):
    """Response payload for /api/global/satellite/frames."""

    provider: str = Field(default="gibs")
    enabled: bool = Field(...)
    history_minutes: Optional[int] = Field(default=None, ge=1, le=720)
    frame_step: Optional[int] = Field(default=None, ge=1, le=240)
    now_iso: str = Field(..., min_length=1)
    frames: List[GlobalSatelliteFrame] = Field(default_factory=list)
    error: Optional[str] = Field(default=None, description="Optional error information when frames are unavailable")
