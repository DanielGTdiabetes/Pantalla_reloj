from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from .models import AppConfig, ConfigUpdate


class ConfigManager:
    """Utility class that handles persistent configuration for the dashboard."""

    def __init__(
        self,
        config_file: Path | None = None,
        default_config_file: Path | None = None,
    ) -> None:
        self.logger = logging.getLogger("pantalla.backend.config")
        state_path = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
        self.config_file = config_file or Path(
            os.getenv("PANTALLA_CONFIG_FILE", state_path / "config.json")
        )
        self.default_config_file = default_config_file or Path(
            os.getenv(
                "PANTALLA_DEFAULT_CONFIG_FILE",
                Path(__file__).resolve().parent / "default_config.json",
            )
        )
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file_exists()
        self.logger.info(
            "Using configuration file %s (default template: %s)",
            self.config_file,
            self.default_config_file,
        )

    def _ensure_file_exists(self) -> None:
        if not self.config_file.exists():
            if self.default_config_file.exists():
                self.config_file.write_text(self.default_config_file.read_text(), encoding="utf-8")
            else:
                AppConfig().to_path(self.config_file)
            os.chmod(self.config_file, 0o644)
            self.logger.info("Created new configuration file at %s", self.config_file)
        else:
            try:
                os.chmod(self.config_file, 0o644)
            except PermissionError:
                self.logger.warning("Could not adjust permissions for %s", self.config_file)

    def read(self) -> AppConfig:
        data = json.loads(self.config_file.read_text(encoding="utf-8"))
        return AppConfig.model_validate(data)

    def update(self, payload: Dict[str, Any]) -> AppConfig:
        current = self.read()
        update_model = ConfigUpdate.model_validate(payload)
        updated = current.model_copy(update=update_model.model_dump(exclude_unset=True))
        updated.to_path(self.config_file)
        try:
            os.chmod(self.config_file, 0o644)
        except PermissionError:
            self.logger.warning("Could not adjust permissions for %s", self.config_file)
        return updated


__all__ = ["ConfigManager"]
