from __future__ import annotations

import json
import logging
import os
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

from .config_manager import ConfigManager

LOGGER = logging.getLogger("pantalla.backend.config_store")

CONFIG_PATH = Path("/var/lib/pantalla-reloj/config.json")
ICS_STORAGE_DIR = Path("/var/lib/pantalla-reloj/ics")
ICS_STORAGE_PATH = ICS_STORAGE_DIR / "personal.ics"


class CalendarValidationError(Exception):
    """Raised when calendar settings fail validation."""

    def __init__(self, message: str, missing: Optional[Iterable[str]] = None) -> None:
        super().__init__(message)
        self.missing = list(missing or [])


def load_raw_config(path: Path | None = None) -> Dict[str, Any]:
    """Load the configuration file as a plain dictionary.

    Unknown keys are preserved exactly as stored on disk.
    """

    config_path = path or CONFIG_PATH
    if not config_path.exists():
        LOGGER.debug("Config path %s does not exist; returning empty dict", config_path)
        return {}

    try:
        with config_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        LOGGER.error("Invalid JSON in %s: %s", config_path, exc)
        raise
    except OSError as exc:  # noqa: BLE001 - propagate to caller for proper handling
        LOGGER.error("Unable to read %s: %s", config_path, exc)
        raise


def deep_merge(base: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge two dictionaries without mutating the inputs."""

    result: Dict[str, Any] = deepcopy(base)
    for key, value in incoming.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def resolve_calendar_provider(payload: Dict[str, Any]) -> Tuple[str, bool, Optional[str]]:
    """Normalise calendar configuration between legacy and new layout.

    Returns provider, enabled flag and ICS path after normalisation.
    """

    panels_raw = payload.get("panels")
    panels = dict(panels_raw) if isinstance(panels_raw, dict) else {}
    payload["panels"] = panels

    panel_calendar_raw = panels.get("calendar") if isinstance(panels, dict) else None
    panel_calendar = dict(panel_calendar_raw) if isinstance(panel_calendar_raw, dict) else {}

    legacy_calendar_raw = payload.get("calendar")
    legacy_calendar = (
        dict(legacy_calendar_raw) if isinstance(legacy_calendar_raw, dict) else {}
    )

    provider_value = panel_calendar.get("provider") or legacy_calendar.get("provider")
    provider = str(provider_value).strip().lower() if provider_value else "google"
    if provider not in {"google", "ics", "disabled"}:
        provider = "google"

    enabled_value = panel_calendar.get("enabled")
    if enabled_value is None:
        enabled_value = legacy_calendar.get("enabled")
    enabled = bool(enabled_value) if enabled_value is not None else True

    ics_path_value = panel_calendar.get("ics_path") or legacy_calendar.get("ics_path")
    ics_path = None
    if isinstance(ics_path_value, str):
        candidate = ics_path_value.strip()
        if candidate:
            ics_path = candidate

    normalized_panel = {"enabled": enabled, "provider": provider}
    normalized_top = {"enabled": enabled, "provider": provider}
    if provider == "ics" and ics_path:
        normalized_panel["ics_path"] = ics_path
        normalized_top["ics_path"] = ics_path

    panels["calendar"] = normalized_panel
    payload["calendar"] = normalized_top

    return provider, enabled, ics_path


def default_layers_if_missing(config: Dict[str, Any]) -> None:
    """Ensure key layers and radar settings exist with safe defaults."""

    layers_raw = config.get("layers")
    layers = layers_raw if isinstance(layers_raw, dict) else {}
    if layers_raw is not layers:
        config["layers"] = layers

    flights_raw = layers.get("flights")
    if isinstance(flights_raw, dict):
        flights = flights_raw
    else:
        flights = {}
        layers["flights"] = flights
    flights.setdefault("enabled", True)

    ships_raw = layers.get("ships")
    if isinstance(ships_raw, dict):
        ships = ships_raw
    else:
        ships = {}
        layers["ships"] = ships
    ships.setdefault("enabled", True)

    ui_global_raw = config.get("ui_global")
    ui_global = ui_global_raw if isinstance(ui_global_raw, dict) else {}
    if ui_global_raw is not ui_global:
        config["ui_global"] = ui_global

    radar_raw = ui_global.get("radar") if isinstance(ui_global, dict) else None
    if isinstance(radar_raw, dict):
        radar = radar_raw
    else:
        radar = {}
        ui_global["radar"] = radar
    radar.setdefault("enabled", True)
    radar.setdefault("provider", "aemet")


def default_panels_if_missing(config: Dict[str, Any]) -> None:
    """Ensure key panels settings exist with safe defaults."""
    
    panels_raw = config.get("panels")
    panels = panels_raw if isinstance(panels_raw, dict) else {}
    if panels_raw is not panels:
        config["panels"] = panels
    
    # Historical Events panel defaults
    historical_events_raw = panels.get("historicalEvents")
    if isinstance(historical_events_raw, dict):
        historical_events = historical_events_raw
    else:
        historical_events = {}
        panels["historicalEvents"] = historical_events
    
    historical_events.setdefault("enabled", True)
    historical_events.setdefault("provider", "local")
    historical_events.setdefault("rotation_seconds", 6)
    historical_events.setdefault("max_items", 5)
    
    local_raw = historical_events.get("local")
    if isinstance(local_raw, dict):
        local = local_raw
    else:
        local = {}
        historical_events["local"] = local
    
    local.setdefault("data_path", "/var/lib/pantalla-reloj/data/efemerides.json")


def validate_calendar_provider(
    provider: str,
    enabled: bool,
    ics_path: Optional[str],
) -> None:
    """Validate provider-specific requirements for the calendar."""

    if provider == "ics" and enabled:
        missing = ["panels.calendar.ics_path", "calendar.ics_path"]
        if not ics_path or not ics_path.strip():
            raise CalendarValidationError(
                "Calendar provider 'ics' requires readable file at calendar.ics_path",
                missing,
            )
        path_obj = Path(ics_path.strip())
        if not path_obj.exists() or not path_obj.is_file():
            raise CalendarValidationError(
                f"Calendar provider 'ics' requires readable file at calendar.ics_path (not found: {path_obj})",
                missing,
            )
        if not os.access(path_obj, os.R_OK):
            raise CalendarValidationError(
                f"Calendar provider 'ics' requires readable file at calendar.ics_path (permission denied: {path_obj})",
                missing,
            )


def write_config_atomic(config: Dict[str, Any], path: Path | None = None) -> None:
    """Persist configuration atomically using tmp+fsync+rename."""

    config_path = path or CONFIG_PATH
    config_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        stat_info = config_path.stat()
        uid, gid = stat_info.st_uid, stat_info.st_gid
    except FileNotFoundError:
        uid = gid = None

    tmp_fd = None
    tmp_path: Optional[str] = None
    try:
        tmp_fd, tmp_path = os.mkstemp(
            dir=str(config_path.parent),
            prefix=config_path.name + ".",
            suffix=".tmp",
        )
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        tmp_fd = None

        os.replace(tmp_path, config_path)

        try:
            dir_fd = os.open(str(config_path.parent), os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError as exc:
            LOGGER.debug("Could not fsync directory %s: %s", config_path.parent, exc)

        if uid is not None or gid is not None:
            try:
                os.chown(
                    config_path,
                    uid if uid is not None else -1,
                    gid if gid is not None else -1,
                )
            except OSError as exc:
                LOGGER.debug("Could not chown %s to %s:%s: %s", config_path, uid, gid, exc)

        try:
            os.chmod(config_path, 0o644)
        except OSError as exc:
            LOGGER.debug("Could not chmod %s to 0644: %s", config_path, exc)
    finally:
        if tmp_fd is not None:
            try:
                os.close(tmp_fd)
            except OSError:
                pass
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def reload_runtime_config(config_manager: ConfigManager) -> bool:
    """Reload the in-memory configuration and return whether it changed."""

    try:
        _, reloaded = config_manager.reload()
        return bool(reloaded)
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Failed to reload runtime config: %s", exc)
        return False
