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

    detail = response.json()["detail"]
    assert detail["error"].startswith("Calendar provider 'google'")
    assert set(detail["missing"]) == {"secrets.google.api_key", "secrets.google.calendar_id"}


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


def test_config_merge_preserves_layers_flags(app_module: Tuple[object, Path]) -> None:
    """Test que POST /api/config preserva flags de layers.flights/ships en merge no destructivo."""
    module, config_file = app_module
    client = TestClient(module.app)

    # Cargar config actual
    payload = _load_current_config(client)

    # Asegurar que layers.flights/ships existen y están habilitados
    if "layers" not in payload:
        payload["layers"] = {}
    if "flights" not in payload["layers"]:
        payload["layers"]["flights"] = {"enabled": True}
    if "ships" not in payload["layers"]:
        payload["layers"]["ships"] = {"enabled": True}

    # Guardar config con flags activados
    payload["layers"]["flights"]["enabled"] = True
    payload["layers"]["ships"]["enabled"] = True

    response = client.post("/api/config", json=payload)
    assert response.status_code == 200

    # Actualizar solo calendar
    payload["panels"] = {"calendar": {"provider": "ics", "enabled": False}}

    response = client.post("/api/config", json=payload)
    assert response.status_code == 200

    # Verificar que los flags se preservaron
    refreshed = _load_current_config(client)
    assert refreshed["layers"]["flights"]["enabled"] is True
    assert refreshed["layers"]["ships"]["enabled"] is True


def test_config_merge_preserves_radar_flags(app_module: Tuple[object, Path]) -> None:
    """Test que POST /api/config preserva flags de ui_global.radar en merge no destructivo."""
    module, config_file = app_module
    client = TestClient(module.app)

    # Cargar config actual
    payload = _load_current_config(client)

    # Asegurar que ui_global.radar existe
    if "ui_global" not in payload:
        payload["ui_global"] = {}
    if "radar" not in payload["ui_global"]:
        payload["ui_global"]["radar"] = {"enabled": True, "provider": "aemet"}

    payload["ui_global"]["radar"]["enabled"] = True

    response = client.post("/api/config", json=payload)
    assert response.status_code == 200

    # Actualizar solo calendar
    payload["panels"] = {"calendar": {"provider": "google", "enabled": False}}

    response = client.post("/api/config", json=payload)
    assert response.status_code == 200

    # Verificar que el flag se preservó
    refreshed = _load_current_config(client)
    assert refreshed["ui_global"]["radar"]["enabled"] is True


def test_ics_path_validation_error_messages(app_module: Tuple[object, Path], tmp_path: Path) -> None:
    """Test que POST /api/config devuelve mensajes 400 claros cuando ics_path no existe."""
    module, _ = app_module
    client = TestClient(module.app)

    payload = _load_current_config(client)

    # Configurar ICS provider con path inexistente
    payload.setdefault("panels", {})["calendar"] = {
        "enabled": True,
        "provider": "ics",
        "ics_path": str(tmp_path / "nonexistent.ics"),
    }

    response = client.post("/api/config", json=payload)
    assert response.status_code == 400

    detail = response.json()["detail"]
    assert "ics_path" in detail["error"].lower() or "readable" in detail["error"].lower()


def test_calendar_ics_requires_source_in_group_patch(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    response = client.patch(
        "/api/config/group/calendar",
        json={"enabled": True, "source": "ics"},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error"].startswith("Calendar provider 'ics' requires url or path")

    # Proporcionar URL vía secrets y reintentar
    response = client.patch(
        "/api/config/group/secrets",
        json={"calendar_ics": {"url": "https://example.com/sample.ics"}},
    )
    assert response.status_code == 200

    response = client.patch(
        "/api/config/group/calendar",
        json={"enabled": True, "source": "ics"},
    )
    assert response.status_code == 200
    refreshed = response.json()
    assert refreshed["calendar"]["enabled"] is True
    assert refreshed["calendar"]["provider"] == "ics"


def test_layers_ships_disabled_accepts_null_ws_url(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    response = client.patch(
        "/api/config/group/layers",
        json={
            "ships": {
                "enabled": False,
                "provider": "aisstream",
                "aisstream": {"ws_url": None},
            }
        },
    )
    assert response.status_code == 200
    config = response.json()
    ships_cfg = config.get("layers", {}).get("ships", {})
    assert ships_cfg.get("enabled") is False
    assert ships_cfg.get("aisstream", {}).get("ws_url") == "wss://stream.aisstream.io/v0/stream"


def test_ics_upload_validation_basic_format(app_module: Tuple[object, Path], tmp_path: Path) -> None:
    """Test que POST /api/config/upload/ics valida formato ICS básico."""
    module, _ = app_module
    client = TestClient(module.app)

    # Archivo inválido (sin BEGIN:VCALENDAR)
    invalid_content = b"This is not an ICS file"

    response = client.post(
        "/api/config/upload/ics",
        files={"file": ("invalid.ics", invalid_content, "text/calendar")},
    )
    assert response.status_code == 400

    detail = response.json()
    assert "VCALENDAR" in detail["error"]

    # Archivo válido mínimo
    valid_ics = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
SUMMARY:Test Event
DTSTART:20250101T120000Z
DTEND:20250101T130000Z
END:VEVENT
END:VCALENDAR
"""

    response = client.post(
        "/api/config/upload/ics",
        files={"file": ("valid.ics", valid_ics, "text/calendar")},
    )
    assert response.status_code == 200

    result = response.json()
    assert "path" in result
    assert "size" in result
    assert "mtime_iso" in result
    assert result["size"] > 0