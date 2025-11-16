from typing import Tuple

from fastapi.testclient import TestClient


def _enable_google_calendar(
    client: TestClient,
    api_key: str = "TESTKEY",
    calendar_id: str = "example@calendar"
) -> None:
    payload = client.get("/api/config").json()
    calendar_block = payload.setdefault("calendar", {})
    calendar_block.update({"enabled": True, "provider": "google"})
    panels = payload.setdefault("panels", {})
    panels.setdefault("calendar", {})["enabled"] = True
    panels["calendar"]["provider"] = "google"
    secrets_block = payload.setdefault("secrets", {}).setdefault("google", {})
    secrets_block["api_key"] = api_key
    secrets_block["calendar_id"] = calendar_id
    response = client.post("/api/config", json=payload)
    assert response.status_code == 200, response.text


def _disable_calendar(client: TestClient) -> None:
    payload = client.get("/api/config").json()
    calendar_block = payload.setdefault("calendar", {})
    calendar_block.update({"enabled": False, "provider": None})
    panels = payload.setdefault("panels", {})
    panels.setdefault("calendar", {})["enabled"] = False
    panels["calendar"]["provider"] = None
    response = client.post("/api/config", json=payload)
    assert response.status_code == 200, response.text


def test_calendar_disabled_returns_clean_payload(app_module: Tuple[object, object]) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    _disable_calendar(client)

    response = client.get("/api/calendar")
    assert response.status_code == 200

    data = response.json()
    assert data["enabled"] is False
    assert data["status"] == "disabled"
    assert data["upcoming"] == []
    assert data["events"] == []
    assert "error_message" not in data


def test_calendar_error_when_google_credentials_missing(
    app_module: Tuple[object, object]
) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    _enable_google_calendar(client)
    module.secret_store.set_secret("google_calendar_api_key", None)
    module.secret_store.set_secret("google_calendar_id", None)

    response = client.get("/api/calendar")
    assert response.status_code == 200

    data = response.json()
    assert data["enabled"] is True
    assert data["status"] == "error"
    assert "credentials" in data.get("error_message", "").lower()
    assert data["events"] == []


def test_calendar_handles_provider_failure(
    app_module: Tuple[object, object], monkeypatch
) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    _enable_google_calendar(client)

    def _raise(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr(module, "fetch_google_calendar_events", _raise)

    response = client.get("/api/calendar")
    assert response.status_code == 200

    data = response.json()
    assert data["enabled"] is True
    assert data["status"] == "error"
    assert "boom" in data.get("error_message", "")
    assert data["events"] == []
