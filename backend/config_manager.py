from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Tuple
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic import ValidationError

from .models import AppConfig, AppConfigResponse, ResolvedConfig, ResolvedMap


class ConfigManager:
    """Utility class that handles persistent configuration for the dashboard."""

    def __init__(
        self,
        config_file: Path | None = None,
        default_config_file: Path | None = None,
    ) -> None:
        self.logger = logging.getLogger("pantalla.backend.config")
        state_path = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
        self.state_path = state_path
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
        self._ensure_state_dir()
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        self._apply_ownership(self.snapshot_dir, directory=True)
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        self._version = 0
        self._fallback_logged = False
        self._ensure_file_exists()
        self._version = self._initial_version()
        self.logger.info(
            "Using configuration file %s (default template: %s)",
            self.config_file,
            self.default_config_file,
        )

    def _ensure_state_dir(self) -> None:
        self.state_path.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.state_path, 0o755)
        except PermissionError:
            self.logger.warning("Could not adjust permissions for %s", self.state_path)
        self._apply_ownership(self.state_path, directory=True)

    def _apply_ownership(self, path: Path, directory: bool = False) -> None:
        user = os.getenv("PANTALLA_USER", "dani")
        group = os.getenv("PANTALLA_GROUP", "dani")
        try:
            shutil.chown(path, user=user, group=group)
        except (LookupError, PermissionError, FileNotFoundError):
            if directory:
                self.logger.debug("Ownership adjustment skipped for %s", path)
        except OSError as exc:
            self.logger.debug("Failed to chown %s: %s", path, exc)

    def _ensure_file_exists(self) -> None:
        if not self.config_file.exists():
            if self.default_config_file.exists():
                data = json.loads(self.default_config_file.read_text(encoding="utf-8"))
                config = AppConfig.model_validate(data)
            else:
                config = AppConfig()
            self._atomic_write(config, update_version=False)
            self.logger.info("Created new configuration file at %s", self.config_file)
        else:
            try:
                os.chmod(self.config_file, 0o600)
            except PermissionError:
                self.logger.warning("Could not adjust permissions for %s", self.config_file)
            self._apply_ownership(self.config_file)

    def _initial_version(self) -> int:
        try:
            return int(self.config_file.stat().st_mtime_ns)
        except OSError:
            return 0

    @property
    def version(self) -> int:
        return self._version

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

    def read_response(self) -> AppConfigResponse:
        config = self.read()
        resolved, fallback = self._resolve_map_settings(config)
        if fallback and not self._fallback_logged:
            self.logger.warning("MapTiler key missing; using Carto raster fallback")
            self._fallback_logged = True
        elif not fallback:
            self._fallback_logged = False
        payload = config.model_dump(mode="json", exclude_none=True)
        payload["resolved"] = resolved.model_dump(mode="json", exclude_none=True)
        payload["version"] = self.version
        return AppConfigResponse.model_validate(payload)

    def write(self, payload: Dict[str, Any]) -> AppConfig:
        config = AppConfig.model_validate(payload)
        self._atomic_write(config)
        self._write_snapshot(config)
        return config

    def write_response(self, payload: Dict[str, Any]) -> AppConfigResponse:
        config = self.write(payload)
        resolved, fallback = self._resolve_map_settings(config)
        if fallback and not self._fallback_logged:
            self.logger.warning("MapTiler key missing; using Carto raster fallback")
            self._fallback_logged = True
        elif not fallback:
            self._fallback_logged = False
        response = config.model_dump(mode="json", exclude_none=True)
        response["resolved"] = resolved.model_dump(mode="json", exclude_none=True)
        response["version"] = self.version
        return AppConfigResponse.model_validate(response)

    def _atomic_write(self, config: AppConfig, *, update_version: bool = True) -> None:
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
                os.chmod(self.config_file, 0o600)
            except PermissionError:
                self.logger.warning("Could not adjust permissions for %s", self.config_file)
            self._apply_ownership(self.config_file)
            if update_version:
                self._version = max(self._version + 1, self._initial_version())
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

    def _resolve_map_settings(self, config: AppConfig) -> Tuple[ResolvedConfig, bool]:
        map_config = config.ui.map
        style_name = (map_config.style or "").strip() or "vector-dark"
        provider = (map_config.provider or "").strip() or "maptiler"
        maptiler = map_config.maptiler or {}
        key = (maptiler.get("key") or "").strip()

        style_lower = style_name.lower()
        should_use_vector = style_lower.startswith("vector") and provider == "maptiler"
        fallback_reason = False

        if should_use_vector and key:
            style_url = self._resolve_maptiler_style(style_lower, maptiler, key)
            if style_url:
                resolved = ResolvedConfig(
                    map=ResolvedMap(engine="maplibre", type="vector", style_url=style_url)
                )
                return resolved, False
            fallback_reason = True
        elif should_use_vector:
            fallback_reason = True

        raster_style = style_name if style_lower.startswith("raster-carto") else "raster-carto-light"
        tiles_url = self._resolve_carto_tiles(raster_style)
        resolved = ResolvedConfig(
            map=ResolvedMap(engine="maplibre", type="raster", style_url=tiles_url)
        )
        return resolved, fallback_reason

    def _resolve_maptiler_style(
        self,
        style_name: str,
        settings: Dict[str, Any],
        key: str,
    ) -> str | None:
        mapping = {
            "vector-dark": settings.get("styleUrlDark")
            or "https://api.maptiler.com/maps/dark/style.json",
            "vector-light": settings.get("styleUrlLight")
            or "https://api.maptiler.com/maps/streets/style.json",
            "vector-bright": settings.get("styleUrlBright")
            or "https://api.maptiler.com/maps/bright/style.json",
        }
        base_url = (mapping.get(style_name) or "").strip()
        if not base_url:
            return None
        if "{key}" in base_url:
            return base_url.replace("{key}", key)
        return self._inject_key_into_url(base_url, key)

    def _resolve_carto_tiles(self, style_name: str) -> str:
        mapping = {
            "raster-carto-dark": "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "raster-carto-light": "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        }
        base = mapping.get(style_name)
        if base:
            return base
        return mapping["raster-carto-light"]

    def _inject_key_into_url(self, url: str, key: str) -> str:
        try:
            parsed = urlparse(url)
        except ValueError:
            delimiter = "&" if "?" in url else "?"
            return f"{url}{delimiter}key={key}"
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query["key"] = key
        new_query = urlencode(query, doseq=True)
        return urlunparse(parsed._replace(query=new_query))


__all__ = ["ConfigManager"]
