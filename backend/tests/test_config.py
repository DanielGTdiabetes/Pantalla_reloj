from __future__ import annotations

import json
from pathlib import Path

from backend.config_manager import ConfigManager
from backend.models import AppConfig


def test_load_and_persist_v2_schema(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    default_path = repo_root / "backend" / "default_config.json"
    config_path = tmp_path / "config.json"

    data = json.loads(default_path.read_text(encoding="utf-8"))
    cfg = AppConfig.model_validate(data)
    assert cfg.ui_map.provider == "maptiler_vector"

    manager = ConfigManager(config_file=config_path, default_config_file=default_path)
    manager.write(cfg.model_dump(mode="json", exclude_none=True))
    reloaded = manager.read()

    assert reloaded.ui_map.provider == "maptiler_vector"
    assert reloaded.ui_map.maptiler is not None
    assert reloaded.ui_map.maptiler.styleUrl == cfg.ui_map.maptiler.styleUrl

