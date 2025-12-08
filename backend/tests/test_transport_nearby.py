from typing import Tuple

import pytest
from fastapi.testclient import TestClient


class DummySnapshot:
    def __init__(self, payload: dict) -> None:
        self.payload = payload


class DummyShipsService:
    def get_snapshot(self):  # pragma: no cover - compatibility stub
        return {"features": []}


@pytest.mark.usefixtures("app_module")
def test_transport_nearby_includes_aircraft(
    app_module: Tuple[object, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    cfg = module.config_manager.read().model_dump(mode="json")
    cfg.setdefault("opensky", {})["enabled"] = True
    cfg.setdefault("layers", {}).setdefault("flights", {})["enabled"] = True
    module.config_manager.write(cfg)

    def fake_snapshot(config, bbox, extended_override):  # type: ignore[no-untyped-def]
        return DummySnapshot(
            {
                "items": [
                    {
                        "icao24": "abc123",
                        "callsign": "TEST",
                        "lat": 40.0,
                        "lon": -3.0,
                        "alt": 1200.0,
                        "velocity": 200.0,
                        "track": 90.0,
                        "origin_country": "ES",
                        "last_contact": 1,
                    }
                ]
            }
        )

    monkeypatch.setattr(module, "opensky_service", module.opensky_service, raising=False)
    monkeypatch.setattr(module.opensky_service, "get_snapshot", fake_snapshot)
    monkeypatch.setattr(module, "ships_service", DummyShipsService())

    response = client.get("/api/transport/nearby?lat=40.0&lon=-3.0&radius_km=50")
    assert response.status_code == 200
    data = response.json()

    assert data["ok"] is True
    assert data["aircraft"]
    plane = data["aircraft"][0]
    assert plane["callsign"] == "TEST"
    assert plane["heading_deg"] == pytest.approx(90.0)
    assert plane["altitude_ft"] == pytest.approx(3937.0, rel=1e-3)
    assert plane["distance_km"] == pytest.approx(0.0)

