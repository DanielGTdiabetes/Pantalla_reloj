from __future__ import annotations

from typing import Tuple

import pytest
from fastapi.testclient import TestClient

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.opensky_client import OpenSkyClientError


class DummyAuth:
    def __init__(self, token: str = "dummy") -> None:
        self._token = token
        self.token_cached = True
        self.calls: list[dict[str, object]] = []

    def credentials_configured(self) -> bool:
        return True

    def get_token(
        self,
        *,
        token_url: str | None = None,
        scope: str | None = None,
        force_refresh: bool = False,
    ) -> str:
        self.calls.append({
            "token_url": token_url,
            "scope": scope,
            "force_refresh": force_refresh,
        })
        return self._token

    def describe(self) -> dict[str, object]:
        return {
            "token_cached": self.token_cached,
            "expires_in_sec": 3600 if self.token_cached else None,
        }

    def invalidate(self) -> None:
        self.token_cached = False

    def close(self) -> None:  # pragma: no cover - compatibility stub
        return


@pytest.mark.usefixtures("app_module")
class TestOpenSkyRefreshEndpoint:
    def _prepare_client(self, app_module: Tuple[object, object]) -> TestClient:
        module, _ = app_module
        client = TestClient(module.app)
        config = module.config_manager.read()
        config_dict = config.model_dump(mode="json")
        config_dict.setdefault("opensky", {})["enabled"] = True
        module.config_manager.write(config_dict)
        return client

    def test_refresh_success_updates_health(self, app_module: Tuple[object, object], monkeypatch: pytest.MonkeyPatch) -> None:
        module, _ = app_module
        client = self._prepare_client(app_module)

        auth_stub = DummyAuth()
        monkeypatch.setattr(module.opensky_service, "_auth", auth_stub, raising=False)

        calls: list[tuple] = []

        def fake_fetch_states(bbox, extended, token):  # type: ignore[no-untyped-def]
            calls.append((bbox, extended, token))
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
                        1.1,
                        2.2,
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
            headers = {"X-Rate-Limit-Remaining": "37"}
            return payload, headers

        monkeypatch.setattr(module.opensky_service._client, "fetch_states", fake_fetch_states)

        response = client.post("/api/providers/opensky/refresh")
        assert response.status_code == 200
        payload = response.json()
        assert payload["fetch"]["status"] == "ok"
        expected_mode = module.config_manager.read().opensky.mode
        assert payload["fetch"]["mode"] == expected_mode
        assert payload["fetch"]["items"] == 1
        assert payload["error"] is None
        assert payload["auth"]["token_cached"] is True
        assert isinstance(payload["auth"]["expires_in_sec"], int) and payload["auth"]["expires_in_sec"] > 0
        assert auth_stub.calls and auth_stub.calls[0]["force_refresh"] is True
        assert len(calls) == 1

        health = client.get("/api/health")
        assert health.status_code == 200
        health_payload = health.json()
        opensky_block = health_payload["providers"]["opensky"]
        assert opensky_block["status"] in {"ok", "stale"}
        assert opensky_block["items"] == 1
        assert opensky_block["last_fetch_iso"] is not None

        snapshot = module.opensky_service.get_last_snapshot()
        assert snapshot is not None
        assert snapshot.payload["count"] == 1

    def test_refresh_failure_reports_error(self, app_module: Tuple[object, object], monkeypatch: pytest.MonkeyPatch) -> None:
        module, _ = app_module
        client = self._prepare_client(app_module)

        auth_stub = DummyAuth()
        monkeypatch.setattr(module.opensky_service, "_auth", auth_stub, raising=False)

        attempts = 0

        def failing_fetch_states(*_: object, **__: object):
            nonlocal attempts
            attempts += 1
            raise OpenSkyClientError("unauthorized", status=401)

        monkeypatch.setattr(module.opensky_service._client, "fetch_states", failing_fetch_states)
        monkeypatch.setattr("backend.services.opensky_service.time.sleep", lambda _delay: None)

        response = client.post("/api/providers/opensky/refresh")
        assert response.status_code == 200
        payload = response.json()
        assert payload["fetch"]["status"] == "error"
        assert payload["error"] == "unauthorized:401"
        assert payload["auth"]["token_cached"] is False
        assert attempts == 4
        assert auth_stub.token_cached is False

        health = client.get("/api/health")
        assert health.status_code == 200
        health_payload = health.json()
        opensky_block = health_payload["providers"]["opensky"]
        assert opensky_block["status"] == "error"
        assert opensky_block["last_fetch_iso"] is not None
        assert opensky_block["items"] in {0, None}
