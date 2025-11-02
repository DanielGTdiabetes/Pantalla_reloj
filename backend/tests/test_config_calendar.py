from __future__ import annotations

from pathlib import Path
from typing import Tuple

from fastapi.testclient import TestClient


def _load_current_config(client: TestClient) -> dict[str, object]:
    response = client.get("/api/config")
    assert response.status_code == 200
    return response.json()


def test_google_provider_requires_credentials(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    payload = _load_current_config(client)

    payload.setdefault("calendar", {})
    payload["calendar"].update({"enabled": True, "provider": "google"})

    panels_calendar = payload.setdefault("panels", {}).setdefault("calendar", {})
    panels_calendar.update({"enabled": True, "provider": "google"})
    panels_calendar.pop("ics_path", None)

    payload.setdefault("secrets", {})["google"] = {}

    response = client.post("/api/config", json=payload)
    assert response.status_code == 400

    detail = response.json()
    assert detail["error"].startswith("Calendar provider 'google'")
    assert set(detail["missing"]) == {"google.api_key", "google.calendar_id"}


def test_ics_provider_persists_and_syncs_panel(app_module: Tuple[object, Path], tmp_path: Path) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    ics_file = tmp_path / "calendar.ics"
    ics_file.write_text(
        """BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Sample Event\nDTSTART:20250101T120000Z\nDTEND:20250101T130000Z\nEND:VEVENT\nEND:VCALENDAR\n""",
        encoding="utf-8",
    )

    payload = _load_current_config(client)
    payload.setdefault("calendar", {})
    payload["calendar"].update(
        {
            "enabled": True,
            "provider": "ics",
            "ics_path": str(ics_file),
        }
    )

    panels_calendar = payload.setdefault("panels", {}).setdefault("calendar", {})
    panels_calendar.update({"enabled": True, "provider": "google"})

    payload.setdefault("secrets", {}).setdefault("calendar_ics", {})

    response = client.post("/api/config", json=payload)
    assert response.status_code == 200
    assert response.json() == {"success": True}

    refreshed = _load_current_config(client)
    assert refreshed["calendar"]["provider"] == "ics"
    assert refreshed["calendar"]["ics_path"] == str(ics_file)

    panel_calendar = refreshed["panels"]["calendar"]
    assert panel_calendar["provider"] == "ics"
    assert panel_calendar["ics_path"] == str(ics_file)

    assert module.secret_store.get_secret("calendar_ics_path") == str(ics_file)
