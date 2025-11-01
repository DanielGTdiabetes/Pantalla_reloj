from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config_manager import ConfigManager

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "default_config.json"


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_cinema_defaults_seed_when_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw = _load_json(DEFAULT_CONFIG_PATH)
    cinema = raw["ui"]["map"]["cinema"]
    cinema.pop("panLngDegPerSec", None)
    cinema.pop("debug", None)

    config_file = tmp_path / "config.json"
    config_file.parent.mkdir(parents=True, exist_ok=True)
    _write_json(config_file, raw)

    state_dir = tmp_path / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("PANTALLA_STATE_DIR", str(state_dir))

    manager = ConfigManager(config_file=config_file, default_config_file=DEFAULT_CONFIG_PATH)
    config = manager.read()

    assert config.ui.map.cinema.panLngDegPerSec == 0.9
    assert config.ui.map.cinema.debug is False

    updated_raw = _load_json(config_file)
    assert updated_raw["ui"]["map"]["cinema"]["panLngDegPerSec"] == 0.9
    assert updated_raw["ui"]["map"]["cinema"]["debug"] is False


def test_cinema_defaults_respect_existing_values(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw = _load_json(DEFAULT_CONFIG_PATH)
    cinema = raw["ui"]["map"]["cinema"]
    cinema["panLngDegPerSec"] = 1.7
    cinema.pop("debug", None)
    raw["ui"]["map"]["respectReducedMotion"] = True

    config_file = tmp_path / "config.json"
    config_file.parent.mkdir(parents=True, exist_ok=True)
    _write_json(config_file, raw)

    state_dir = tmp_path / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("PANTALLA_STATE_DIR", str(state_dir))

    manager = ConfigManager(config_file=config_file, default_config_file=DEFAULT_CONFIG_PATH)
    config = manager.read()

    assert config.ui.map.cinema.panLngDegPerSec == 1.7
    assert config.ui.map.cinema.debug is False
    assert config.ui.map.respectReducedMotion is True

    updated_raw = _load_json(config_file)
    assert updated_raw["ui"]["map"]["cinema"]["panLngDegPerSec"] == 1.7
    assert updated_raw["ui"]["map"]["cinema"]["debug"] is False
    assert updated_raw["ui"]["map"]["respectReducedMotion"] is True
