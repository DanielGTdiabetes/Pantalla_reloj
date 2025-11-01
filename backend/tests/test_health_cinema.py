import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Tuple


def _reset_runtime(module: object) -> None:
    module._cinema_runtime_state = None  # type: ignore[attr-defined]
    module._cinema_runtime_expires_at = None  # type: ignore[attr-defined]


def test_health_includes_cinema_config(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    _reset_runtime(module)

    payload = module.healthcheck()
    cinema = payload["cinema"]
    config_cinema = module.config_manager.read().ui.map.cinema

    assert cinema["enabled"] == config_cinema.enabled
    assert cinema["panLngDegPerSec"] == config_cinema.panLngDegPerSec
    assert cinema["state"] is None
    assert cinema["lastPanTickIso"] is None
    assert cinema["reducedMotion"] is None


def test_cinema_telemetry_roundtrip(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    _reset_runtime(module)

    timestamp = datetime.now(timezone.utc).replace(microsecond=0)
    telemetry_payload = module.CinemaTelemetryPayload(  # type: ignore[attr-defined]
        state="PANNING",
        lastPanTickIso=timestamp.isoformat(),
        reducedMotion=False,
    )

    asyncio.run(module.update_cinema_telemetry(telemetry_payload))

    cinema = module.healthcheck()["cinema"]

    assert cinema["state"] == "PANNING"
    assert datetime.fromisoformat(cinema["lastPanTickIso"]) == timestamp
    assert cinema["reducedMotion"] is False


def test_cinema_telemetry_expires(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    _reset_runtime(module)

    timestamp = datetime.now(timezone.utc).replace(microsecond=0)
    telemetry_payload = module.CinemaTelemetryPayload(  # type: ignore[attr-defined]
        state="READY",
        lastPanTickIso=timestamp.isoformat(),
        reducedMotion=True,
    )

    asyncio.run(module.update_cinema_telemetry(telemetry_payload))

    # Forzar expiración del estado en memoria
    module._cinema_runtime_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    cinema = module.healthcheck()["cinema"]

    assert cinema["state"] is None
    assert cinema["lastPanTickIso"] is None
    assert cinema["reducedMotion"] is None
