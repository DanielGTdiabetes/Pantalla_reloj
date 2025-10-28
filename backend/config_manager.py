from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from pydantic import ValidationError

from .models import AppConfig


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
        self.snapshot_dir = state_path / "config.snapshots"
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
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
        try:
            data = json.loads(self.config_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            self.logger.warning("Failed to parse configuration, regenerating defaults: %s", exc)
            config = AppConfig()
            self._atomic_write(config)
            return config
        try:
            config = AppConfig.model_validate(data)
        except ValidationError as exc:
            self.logger.warning("Invalid configuration on disk, regenerating defaults: %s", exc)
            config = AppConfig()
            self._atomic_write(config)
            return config
        return config

    def write(self, payload: Dict[str, Any]) -> AppConfig:
        config = AppConfig.model_validate(payload)
        self._atomic_write(config)
        self._write_snapshot(config)
        return config

    def _atomic_write(self, config: AppConfig) -> None:
        serialized = config.model_dump(mode="json", exclude_none=True)
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=self.config_file.parent,
            prefix=".config",
            suffix=".tmp",
        )
        try:
            os.fchmod(tmp_fd, 0o600)
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as handle:
                json.dump(serialized, handle, indent=2, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, self.config_file)
            try:
                dir_fd = os.open(self.config_file.parent, os.O_DIRECTORY)
            except (PermissionError, FileNotFoundError):
                dir_fd = None
            else:
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
            try:
                os.chmod(self.config_file, 0o644)
            except PermissionError:
                self.logger.warning("Could not adjust permissions for %s", self.config_file)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def _write_snapshot(self, config: AppConfig) -> None:
        today = datetime.now().strftime("%Y-%m-%d")
        snapshot_file = self.snapshot_dir / f"{today}.json"
        if snapshot_file.exists():
            return
        try:
            snapshot_file.write_text(
                json.dumps(config.model_dump(mode="json", exclude_none=True), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as exc:
            self.logger.warning("Failed to write configuration snapshot %s: %s", snapshot_file, exc)


__all__ = ["ConfigManager"]
