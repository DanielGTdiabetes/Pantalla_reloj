from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Tuple
from unittest.mock import patch



class _FixedDateTime(datetime):
    """Helper datetime that always returns the same moment."""

    _fixed = datetime(2025, 11, 14, 15, 30, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz: timezone | None = None):  # type: ignore[override]
        if tz is None:
            return cls._fixed.replace(tzinfo=None)
        return cls._fixed.astimezone(tz)

    @classmethod
    def utcnow(cls):  # type: ignore[override]
        return cls._fixed.replace(tzinfo=None)


def test_global_satellite_frames_disabled_when_config_disabled(
    app_module: Tuple[object, Path]
) -> None:
    module, _ = app_module

    config_path = Path(module.config_manager.config_file)
    original = config_path.read_text(encoding="utf-8")
    try:
        config_data = json.loads(original)
        layers = config_data.setdefault("layers", {})
        key = "global" if "global" in layers else "global_"
        layers.setdefault(key, {}).setdefault("satellite", {})
        layers[key]["satellite"]["enabled"] = False
        if key == "global_":
            layers.setdefault("global", json.loads(json.dumps(layers[key])))
            layers["global"].setdefault("satellite", {})
            layers["global"]["satellite"]["enabled"] = False
        config_path.write_text(json.dumps(config_data), encoding="utf-8")

        response = module.get_global_satellite_frames()

        assert response.enabled is False
        assert response.frames == []
        assert response.provider == "gibs"
    finally:
        config_path.write_text(original, encoding="utf-8")


def test_global_satellite_frames_default_config_returns_frames(
    app_module: Tuple[object, Path]
) -> None:
    module, _ = app_module

    with patch("backend.main.datetime", _FixedDateTime):
        response = module.get_global_satellite_frames()

    assert response.enabled is True
    assert response.provider == "gibs"
    assert response.now_iso == "2025-11-14T15:30:00Z"

    assert response.history_minutes == 90
    assert response.frame_step == 10

    timestamps = [frame.timestamp for frame in response.frames]
    assert timestamps == sorted(timestamps)

    expected_frames = (response.history_minutes // response.frame_step) + 1
    assert len(response.frames) == expected_frames

    first_frame = response.frames[0]
    last_frame = response.frames[-1]

    assert first_frame.t_iso == "2025-11-14T14:00:00Z"
    assert last_frame.t_iso == "2025-11-14T15:30:00Z"

    assert module.GIBS_DEFAULT_LAYER in first_frame.tile_url
    assert "{z}/{y}/{x}.jpg" in first_frame.tile_url


def test_openapi_includes_global_satellite_frames(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    schema = module.app.openapi()

    assert "/api/global/satellite/frames" in schema.get("paths", {})
