import asyncio
import importlib
import json
import sys
from pathlib import Path
from typing import Dict, Generator, Tuple

import pytest

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "default_config.json"


class DummyResponse:
    def __init__(self, status_code: int, payload: Dict[str, object] | None = None) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> Dict[str, object]:
        if self._payload is None:
            raise ValueError("no json payload")
        return self._payload


@pytest.fixture()
def app_module(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[Tuple[object, Path], None, None]:
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    config_file = state_dir / "config.json"
    config_file.write_text(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"), encoding="utf-8")

    monkeypatch.setenv("PANTALLA_STATE_DIR", str(state_dir))
    monkeypatch.setenv("PANTALLA_CONFIG_FILE", str(config_file))
    monkeypatch.setenv("PANTALLA_DEFAULT_CONFIG_FILE", str(DEFAULT_CONFIG_PATH))

    if "backend.main" in sys.modules:
        del sys.modules["backend.main"]

    module = importlib.import_module("backend.main")
    yield module, config_file


def _write_aemet_key(module: object, api_key: str | None) -> None:
    config = module.config_manager.read()
    payload = config.model_dump(mode="json", by_alias=True)
    payload.setdefault("aemet", {})["api_key"] = api_key
    module.config_manager.write(payload)


def test_config_masks_aemet_secret(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    _write_aemet_key(module, "SECRETKEY1234")

    public = module._build_public_config(module.config_manager.read())
    aemet_info = public["aemet"]

    assert "api_key" not in aemet_info
    assert aemet_info["has_api_key"] is True
    assert aemet_info["api_key_last4"] == "1234"


def test_update_aemet_secret_persists(app_module: Tuple[object, Path]) -> None:
    module, config_path = app_module

    asyncio.run(module.update_aemet_secret(module.AemetSecretRequest(api_key="AEMET123456")))

    raw = json.loads(config_path.read_text(encoding="utf-8"))
    assert raw["aemet"]["api_key"] == "AEMET123456"

    public = module._build_public_config(module.config_manager.read())["aemet"]
    assert public["has_api_key"] is True
    assert public["api_key_last4"] == "3456"


def test_update_aemet_secret_allows_clearing(app_module: Tuple[object, Path]) -> None:
    module, config_path = app_module
    _write_aemet_key(module, "ABCD9876")

    asyncio.run(module.update_aemet_secret(module.AemetSecretRequest(api_key=None)))

    raw = json.loads(config_path.read_text(encoding="utf-8"))
    assert "api_key" not in raw["aemet"]

    public = module._build_public_config(module.config_manager.read())["aemet"]
    assert public["has_api_key"] is False
    assert public["api_key_last4"] is None


def test_test_key_requires_secret(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    result = module.test_aemet_key(module.AemetTestRequest(api_key=None))
    assert result == {"ok": False, "reason": "missing_api_key"}


def test_test_key_uses_candidate(monkeypatch: pytest.MonkeyPatch, app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    captured: Dict[str, object] = {}

    def fake_get(url: str, *, headers: Dict[str, str], timeout: float):  # type: ignore[override]
        captured["url"] = url
        captured["headers"] = headers
        captured["timeout"] = timeout
        return DummyResponse(200, {"estado": 200})

    monkeypatch.setattr(module.requests, "get", fake_get)

    response = module.test_aemet_key(module.AemetTestRequest(api_key="INLINEKEY"))
    assert response == {"ok": True}

    assert captured["headers"]["api_key"] == "INLINEKEY"
    assert captured["timeout"] == 6


def test_test_key_network_failure(monkeypatch: pytest.MonkeyPatch, app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    _write_aemet_key(module, "NETWORKKEY")

    def fake_get(url: str, *, headers: Dict[str, str], timeout: float):  # type: ignore[override]
        raise module.requests.RequestException("network down")

    monkeypatch.setattr(module.requests, "get", fake_get)

    result = module.test_aemet_key(module.AemetTestRequest(api_key=None))
    assert result == {"ok": False, "reason": "network"}


def test_test_key_http_errors(monkeypatch: pytest.MonkeyPatch, app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    _write_aemet_key(module, "HTTPKEY")

    monkeypatch.setattr(module.requests, "get", lambda *_, **__: DummyResponse(401))
    unauthorized = module.test_aemet_key(module.AemetTestRequest(api_key=None))
    assert unauthorized == {"ok": False, "reason": "unauthorized"}

    monkeypatch.setattr(module.requests, "get", lambda *_, **__: DummyResponse(503))
    upstream = module.test_aemet_key(module.AemetTestRequest(api_key=None))
    assert upstream == {"ok": False, "reason": "upstream"}

    monkeypatch.setattr(module.requests, "get", lambda *_, **__: DummyResponse(200, {"estado": 401}))
    payload_unauthorized = module.test_aemet_key(module.AemetTestRequest(api_key=None))
    assert payload_unauthorized == {"ok": False, "reason": "unauthorized"}


def test_cinema_motion_serialization(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    config = module.config_manager.read()
    payload = config.model_dump(mode="json", by_alias=True)

    motion = payload["ui"]["map"]["cinema"]["motion"]
    motion.update(
        {
            "speedPreset": "fast",
            "amplitudeDeg": 120,
            "easing": "linear",
            "pauseWithOverlay": False,
            "phaseOffsetDeg": 90,
        }
    )
    payload["ui"]["map"]["cinema"].update(
        {
            "motion": motion,
            "enabled": True,
            "panLngDegPerSec": 9,
        }
    )

    module.config_manager.write(payload)

    public = module._build_public_config(module.config_manager.read())
    returned_motion = public["ui"]["map"]["cinema"]["motion"]
    assert returned_motion == {
        "speedPreset": "fast",
        "amplitudeDeg": 120,
        "easing": "linear",
        "pauseWithOverlay": False,
        "phaseOffsetDeg": 90,
    }

    stored_motion = module.config_manager.read().ui.map.cinema.motion
    assert stored_motion.speed_preset == "fast"
    assert pytest.approx(stored_motion.amplitude_deg) == 120
    assert stored_motion.pause_with_overlay is False
    assert pytest.approx(stored_motion.phase_offset_deg) == 90
