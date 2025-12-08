from typing import Tuple

import pytest
from fastapi.testclient import TestClient


class DummyAuth:
    def __init__(self, token: str = "dummy") -> None:
        self._token = token

    def credentials_configured(self) -> bool:
        return True

    def get_token(
        self,
        *,
        token_url: str | None = None,
        scope: str | None = None,
        force_refresh: bool = False,
    ) -> str:
        return self._token

    def describe(self) -> dict[str, object]:  # pragma: no cover - compatibility stub
        return {"token_cached": True}

    def invalidate(self) -> None:  # pragma: no cover - compatibility stub
        return


@pytest.mark.usefixtures("app_module")
class TestFlightsEndpoint:
    def _prepare_client(self, app_module: Tuple[object, object]) -> TestClient:
        module, _ = app_module
        client = TestClient(module.app)
        config = module.config_manager.read().model_dump(mode="json")
        config.setdefault("opensky", {})["enabled"] = True
        config.setdefault("layers", {}).setdefault("flights", {})["enabled"] = True
        module.config_manager.write(config)

        # Clear caches between runs to avoid stale snapshots
        if hasattr(module.opensky_service, "_cache"):
            module.opensky_service._cache.clear()
        if hasattr(module.opensky_service, "_snapshots"):
            module.opensky_service._snapshots.clear()

        return client

    def test_flights_endpoint_returns_geojson(
        self,
        app_module: Tuple[object, object],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        module, _ = app_module
        client = self._prepare_client(app_module)

        dummy_auth = DummyAuth()
        monkeypatch.setattr(module.opensky_service, "_auth", dummy_auth, raising=False)

        def fake_fetch_states(bbox, extended, token):  # type: ignore[no-untyped-def]
            assert bbox == (35.0, 44.0, -10.0, 4.5)
            assert extended == 0
            assert token == "dummy"
            payload = {
                "time": 1,
                "states": [
                    [
                        "abc123",
                        "CALL",
                        "ES",
                        0,
                        1,
                        -3.7038,
                        40.4168,
                        1000.0,
                        0,
                        230.0,
                        90.0,
                        0.0,
                        None,
                        1050.0,
                        "7000",
                        None,
                        None,
                        0,
                    ]
                ],
            }
            headers = {"X-Rate-Limit-Remaining": "5"}
            return payload, headers

        monkeypatch.setattr(module.opensky_service._client, "fetch_states", fake_fetch_states)

        response = client.get("/api/layers/flights?bbox=35.0,44.0,-10.0,4.5")
        assert response.status_code == 200
        data = response.json()

        assert data["count"] == 1
        assert data["items"]
        first = data["items"][0]
        assert first["lon"] == pytest.approx(-3.7038)
        assert first["lat"] == pytest.approx(40.4168)

        assert data.get("features")
        feature = data["features"][0]
        coords = feature["geometry"]["coordinates"]
        assert coords[0] == pytest.approx(-3.7038)
        assert coords[1] == pytest.approx(40.4168)

