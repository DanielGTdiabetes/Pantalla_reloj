from __future__ import annotations

import json
import logging
import os
import re
import time
import traceback
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

from .services.maptiler import normalize_maptiler_style_url

from .config_manager import ConfigManager

LOGGER = logging.getLogger("pantalla.backend.config_store")

CONFIG_PATH = Path("/var/lib/pantalla-reloj/config.json")
ICS_STORAGE_DIR = Path("/var/lib/pantalla-reloj/calendar")
ICS_STORAGE_PATH = ICS_STORAGE_DIR / "calendar.ics"


class CalendarValidationError(Exception):
    """Raised when calendar settings fail validation."""

    def __init__(self, message: str, missing: Optional[Iterable[str]] = None) -> None:
        super().__init__(message)
        self.missing = list(missing or [])


class ConfigWriteError(Exception):
    """Raised when configuration write fails."""

    pass


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
    """Deep merge two dictionaries without mutating the inputs.
    
    This function performs a recursive merge where keys present in `incoming`
    overwrite corresponding keys in `base`, but keys not present in `incoming`
    are preserved from `base`.
    """

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


def normalize_maptiler_url(api_key: str | None, url: str) -> str:
    """Compatibilidad histórica; delega en normalize_maptiler_style_url."""

    normalized = normalize_maptiler_style_url(api_key, url)
    if normalized is None:
        return ""
    return normalized


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

    provider_value = (
        legacy_calendar.get("source")
        or legacy_calendar.get("provider")
        or panel_calendar.get("source")
        or panel_calendar.get("provider")
    )
    provider = str(provider_value).strip().lower() if provider_value else "google"
    if provider == "disabled":
        panel_calendar["enabled"] = False
        legacy_calendar["enabled"] = False
        provider = "google"
    if provider not in {"google", "ics"}:
        provider = "google"

    enabled_value = legacy_calendar.get("enabled")
    if enabled_value is None:
        enabled_value = panel_calendar.get("enabled")
    enabled = bool(enabled_value) if enabled_value is not None else False

    ics_path_value = panel_calendar.get("ics_path") or legacy_calendar.get("ics_path")
    ics_path = None
    if isinstance(ics_path_value, str):
        candidate = ics_path_value.strip()
        if candidate:
            ics_path = candidate

    normalized_panel = {"enabled": enabled, "provider": provider, "source": provider}
    normalized_top = {"enabled": enabled, "provider": provider, "source": provider}
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
    
    # News panel defaults
    news_raw = panels.get("news")
    if isinstance(news_raw, dict):
        news = news_raw
    else:
        news = {}
        panels["news"] = news
    news.setdefault("enabled", True)
    if "feeds" not in news or not isinstance(news.get("feeds"), list):
        news["feeds"] = []
    
    # Calendar panel defaults
    calendar_raw = panels.get("calendar")
    if isinstance(calendar_raw, dict):
        calendar = calendar_raw
    else:
        calendar = {}
        panels["calendar"] = calendar
    calendar.setdefault("enabled", False)  # Por defecto off hasta configurar secrets
    
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

    if provider != "ics" or not enabled:
        return

    if not ics_path or not ics_path.strip():
        return

    path_obj = Path(ics_path.strip())
    missing = ["panels.calendar.ics_path", "calendar.ics_path"]

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
    """Persist configuration atomically using tmp+fsync+rename.
    
    Args:
        config: Configuration dictionary to write
        path: Target path (defaults to CONFIG_PATH)
        
    Raises:
        ConfigWriteError: If write fails for any reason
    """
    config_path = path or CONFIG_PATH
    config_path = config_path.resolve()  # Ensure absolute path
    
    # Ensure parent directory exists
    config_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Get ownership from existing file if it exists
    try:
        stat_info = config_path.stat()
        uid, gid = stat_info.st_uid, stat_info.st_gid
    except FileNotFoundError:
        uid = gid = None
    
    # Create temporary file with safe name: .config.json.tmp-<pid>-<timestamp>
    pid = os.getpid()
    timestamp = int(time.time() * 1000000)  # microseconds
    tmp_name = f".{config_path.name}.tmp-{pid}-{timestamp}"
    tmp_path = config_path.parent / tmp_name
    tmp_path_str = str(tmp_path)
    
    tmp_fd = None
    dir_fd = None
    try:
        # Create temporary file in the same directory as final
        tmp_fd = os.open(
            tmp_path_str,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o644,  # Set permissions immediately
        )
        
        # Serialize config to JSON
        json_bytes = json.dumps(
            config,
            ensure_ascii=False,
            separators=(',', ':'),
        ).encode('utf-8')
        
        # Write using os.write
        written = 0
        while written < len(json_bytes):
            chunk = os.write(tmp_fd, json_bytes[written:])
            written += chunk
        
        # Sync file data to disk
        os.fsync(tmp_fd)
        
        # Open directory fd for fsync
        dir_fd = os.open(str(config_path.parent), os.O_RDONLY)
        
        # Sync directory metadata
        os.fsync(dir_fd)
        
        # Close dir_fd before replace
        os.close(dir_fd)
        dir_fd = None
        
        # Close tmp_fd before replace
        os.close(tmp_fd)
        tmp_fd = None
        
        # Atomic replace
        os.replace(tmp_path_str, str(config_path))
        
        # Restore ownership if we had it
        if uid is not None or gid is not None:
            try:
                os.chown(
                    config_path,
                    uid if uid is not None else -1,
                    gid if gid is not None else -1,
                )
            except OSError as exc:
                LOGGER.debug("Could not chown %s to %s:%s: %s", config_path, uid, gid, exc)
        
        # Ensure final permissions
        try:
            os.chmod(config_path, 0o644)
        except OSError as exc:
            LOGGER.debug("Could not chmod %s to 0644: %s", config_path, exc)
        
    except Exception as exc:
        # Log full error details
        exc_type = type(exc).__name__
        exc_msg = str(exc)
        traceback_str = traceback.format_exc()
        
        LOGGER.error(
            "[config] Failed to write config atomically: final=%s, tmp=%s, type=%s, msg=%s\n%s",
            config_path,
            tmp_path_str,
            exc_type,
            exc_msg,
            traceback_str,
        )
        
        # Clean up temporary file if it exists
        if tmp_path.exists():
            try:
                os.unlink(tmp_path_str)
            except OSError:
                pass
        
        # Re-raise as ConfigWriteError
        raise ConfigWriteError(f"Failed to write config: {exc_msg}") from exc
        
    finally:
        # Cleanup: close file descriptors
        if tmp_fd is not None:
            try:
                os.close(tmp_fd)
            except OSError:
                pass
        if dir_fd is not None:
            try:
                os.close(dir_fd)
            except OSError:
                pass
        # Cleanup: remove temporary file if it still exists
        if tmp_path.exists():
            try:
                os.unlink(tmp_path_str)
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
