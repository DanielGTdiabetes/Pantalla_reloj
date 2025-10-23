from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .config import AppConfig

logger = logging.getLogger(__name__)

CONFIG_DIR = Path(os.environ.get("PANTALLA_CONFIG_DIR", "/etc/pantalla-dash"))
CONFIG_PATH = CONFIG_DIR / "config.json"
SECRETS_PATH = CONFIG_DIR / "secrets.json"


def _sync_openai_env(api_key: str | None, env_path: Path = Path("/etc/pantalla-dash/env")) -> None:
    """Ensure the ``OPENAI_API_KEY`` entry in the env file matches ``api_key``."""

    if not api_key:
        return

    try:
        env_path.parent.mkdir(parents=True, exist_ok=True)
        current = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
        lines = [
            line
            for line in current.splitlines()
            if not re.match(r"^\s*#?\s*OPENAI_API_KEY\s*=", line)
        ]
        lines.append(f"OPENAI_API_KEY={api_key}")
        env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        logger.info("OPENAI_API_KEY sincronizada en %s", env_path)
    except OSError as exc:  # pragma: no cover - entorno sin permisos
        logger.warning("No se pudo actualizar %s: %s", env_path, exc)

class SecretPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class OpenAISecret(BaseModel):
        model_config = ConfigDict(extra="forbid")

        apiKey: str | None = Field(default=None, alias="apiKey", max_length=200)

    class GoogleSecret(BaseModel):
        model_config = ConfigDict(extra="forbid")

        client_id: str | None = Field(default=None, alias="client_id", max_length=200)
        client_secret: str | None = Field(default=None, alias="client_secret", max_length=200)
        refresh_token: str | None = Field(default=None, alias="refresh_token", max_length=500)

    openai: OpenAISecret | None = None
    google: GoogleSecret | None = Field(default=None, alias="google")


def _ensure_dir(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:  # pragma: no cover - defensive
        logger.warning("No se pudo crear directorio %s: %s", path, exc)
    try:
        os.chmod(path, 0o755)
    except PermissionError:
        logger.debug("No se pudo ajustar permisos de %s porque no somos dueños", path)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        logger.warning("JSON inválido en %s: %s", path, exc)
        return {}
    except OSError as exc:  # pragma: no cover - defensive
        logger.error("No se pudo leer %s: %s", path, exc)
        return {}


def _write_json(
    path: Path,
    data: dict[str, Any],
    *,
    mode: int,
    owner: int | None = None,
    group: int | None = None,
) -> None:
    _ensure_dir(path.parent)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    os.chmod(tmp_path, mode)
    # Ajustamos propietario/grupo solo cuando corremos como root; en modo no-root lo omitimos.
    if (owner is not None or group is not None) and os.geteuid() == 0:
        try:
            os.chown(tmp_path, owner if owner is not None else -1, group if group is not None else -1)
        except PermissionError as exc:  # pragma: no cover - defensive
            logger.error("No se pudo ajustar propietario de %s: %s", tmp_path, exc)
            raise
    os.replace(tmp_path, path)
    os.chmod(path, mode)
    if (owner is not None or group is not None) and os.geteuid() == 0:
        try:
            os.chown(path, owner if owner is not None else -1, group if group is not None else -1)
        except PermissionError as exc:  # pragma: no cover - defensive
            logger.error("No se pudo ajustar propietario final de %s: %s", path, exc)
            raise


def _mask_secret(value: str) -> str:
    masked = value.strip()
    if len(masked) <= 4:
        return "***"
    last4 = masked[-4:]
    return f"***…{last4}"


def _deep_merge(base: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge ``update`` into ``base`` preserving nested mappings."""

    result = dict(base)
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)  # type: ignore[arg-type]
        else:
            result[key] = value
    return result


def _collect_unknown_keys(value: Any, prefix: str = "") -> list[str]:
    unknown: list[str] = []
    if isinstance(value, BaseModel):
        extras = getattr(value, "model_extra", {}) or {}
        for key, extra_value in extras.items():
            path = f"{prefix}.{key}" if prefix else key
            unknown.append(path)
            unknown.extend(_collect_unknown_keys(extra_value, path))
        for field_name in value.model_fields:
            nested_prefix = f"{prefix}.{field_name}" if prefix else field_name
            nested_value = getattr(value, field_name)
            unknown.extend(_collect_unknown_keys(nested_value, nested_prefix))
    elif isinstance(value, dict):
        for key, nested in value.items():
            path = f"{prefix}.{key}" if prefix else key
            unknown.append(path)
            unknown.extend(_collect_unknown_keys(nested, path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            list_prefix = f"{prefix}[{index}]"
            unknown.extend(_collect_unknown_keys(item, list_prefix))
    return unknown


def _migrate_config(data: dict[str, Any]) -> dict[str, Any]:
    migrated = dict(data)
    needs_write = False

    background = migrated.get("background")
    if isinstance(background, dict):
        mode = background.get("mode")
        if mode == "auto":
            background = dict(background)
            background["mode"] = "daily"
            migrated["background"] = background
            logger.warning("Migrando background.mode=auto -> daily")
            needs_write = True

    calendar = migrated.get("calendar")
    if isinstance(calendar, dict):
        calendar_copy = dict(calendar)
        calendar_changed = False
        if "icsUrl" in calendar_copy:
            if "url" not in calendar_copy:
                calendar_copy["url"] = calendar_copy["icsUrl"]
            calendar_copy.pop("icsUrl", None)
            calendar_changed = True
        if "mode" not in calendar_copy:
            calendar_copy["mode"] = "ics" if calendar_copy.get("icsPath") else "url"
            calendar_changed = True
        provider = str(calendar_copy.get("provider") or "").strip().lower()
        if provider not in {"none", "ics", "url", "google"}:
            enabled = bool(calendar_copy.get("enabled", False))
            if not enabled:
                provider = "none"
            else:
                mode_hint = str(calendar_copy.get("mode") or "").strip().lower()
                if mode_hint in {"ics", "url"}:
                    provider = mode_hint
                elif calendar_copy.get("icsPath"):
                    provider = "ics"
                elif calendar_copy.get("url"):
                    provider = "url"
                else:
                    provider = "none"
            calendar_copy["provider"] = provider
            calendar_changed = True
        if calendar_changed:
            migrated["calendar"] = calendar_copy
            needs_write = True

    if needs_write:
        try:
            _write_json(CONFIG_PATH, migrated, mode=0o644)
        except OSError as exc:
            logger.error("No se pudo persistir migración de configuración: %s", exc)
    return migrated


def read_config() -> tuple[dict[str, Any], str]:
    data = _load_json(CONFIG_PATH)
    if not data and not CONFIG_PATH.exists():
        try:
            _write_json(CONFIG_PATH, {}, mode=0o644)
        except OSError as exc:  # pragma: no cover - defensive
            logger.error("No se pudo inicializar config.json: %s", exc)
    migrated = _migrate_config(data)
    return migrated, str(CONFIG_PATH)


def read_secrets() -> tuple[dict[str, Any], str]:
    data = _load_json(SECRETS_PATH)
    if not data and not SECRETS_PATH.exists():
        try:
            _write_json(SECRETS_PATH, {}, mode=0o600)
        except OSError as exc:  # pragma: no cover - defensive
            logger.error("No se pudo inicializar secrets.json: %s", exc)
    return data, str(SECRETS_PATH)


def has_openai_key() -> bool:
    secrets, _ = read_secrets()
    value = secrets.get("openai") if isinstance(secrets, dict) else None
    if isinstance(value, dict):
        api_key = value.get("apiKey")
        return isinstance(api_key, str) and api_key.strip() != ""
    return False


def write_config_patch(patch: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if not isinstance(patch, dict):
        raise ValueError("El cuerpo debe ser un objeto JSON")
    current, _ = read_config()
    merged = _deep_merge(current, patch)
    try:
        validated = AppConfig.model_validate(merged)
    except ValidationError as exc:
        details = exc.errors()
        if details:
            first = details[0]
            location = ".".join(str(part) for part in first.get("loc", []))
            message = first.get("msg", str(exc))
            if location:
                raise ValueError(f"{location}: {message}") from exc
            raise ValueError(message) from exc
        raise ValueError(str(exc)) from exc
    try:
        _write_json(CONFIG_PATH, merged, mode=0o644)
    except OSError as exc:  # pragma: no cover - permisos insuficientes
        raise PermissionError("No se pudo escribir config.json") from exc
    logger.info("config merged")
    preserved = sorted(set(_collect_unknown_keys(validated)))
    message = ", ".join(preserved) if preserved else "(none)"
    logger.info("unknown keys preserved: %s", message)
    return merged, str(CONFIG_PATH)


def write_secrets_patch(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    try:
        patch = SecretPatch.model_validate(payload)
    except ValidationError as exc:
        details = exc.errors()
        if details:
            first = details[0]
            location = ".".join(str(part) for part in first.get("loc", []))
            message = first.get("msg", str(exc))
            if location:
                raise ValueError(f"{location}: {message}") from exc
            raise ValueError(message) from exc
        raise ValueError(str(exc)) from exc

    secrets, _ = read_secrets()
    updated = dict(secrets)
    if patch.openai:
        target = patch.openai.apiKey.strip() if patch.openai.apiKey else ""
        if target:
            updated.setdefault("openai", {})
            updated["openai"]["apiKey"] = target
        else:
            openai_data = updated.get("openai")
            if isinstance(openai_data, dict):
                openai_data.pop("apiKey", None)
            if not openai_data:
                updated.pop("openai", None)

    if patch.google:
        google_data = updated.get("google") if isinstance(updated.get("google"), dict) else {}
        google_section: dict[str, Any] = dict(google_data) if google_data else {}

        if patch.google.client_id is not None:
            client_id = patch.google.client_id.strip() if patch.google.client_id else ""
            if client_id:
                google_section["client_id"] = client_id
            else:
                google_section.pop("client_id", None)

        if patch.google.client_secret is not None:
            client_secret = patch.google.client_secret.strip() if patch.google.client_secret else ""
            if client_secret:
                google_section["client_secret"] = client_secret
            else:
                google_section.pop("client_secret", None)

        if patch.google.refresh_token is not None:
            refresh_token = patch.google.refresh_token.strip() if patch.google.refresh_token else ""
            if refresh_token:
                google_section["refresh_token"] = refresh_token
            else:
                google_section.pop("refresh_token", None)

        if google_section:
            updated["google"] = google_section
        else:
            updated.pop("google", None)

    try:
        _write_json(SECRETS_PATH, updated, mode=0o600)
    except OSError as exc:  # pragma: no cover - permisos insuficientes
        raise PermissionError("No se pudo escribir secrets.json") from exc

    try:
        openai_data = updated.get("openai") if isinstance(updated, dict) else None
        api_key = openai_data.get("apiKey") if isinstance(openai_data, dict) else None
        _sync_openai_env(api_key)
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning("No se pudo sincronizar OPENAI_API_KEY: %s", exc)
    return updated, str(SECRETS_PATH)


def mask_secrets(secrets: dict[str, Any]) -> dict[str, Any]:
    masked: dict[str, Any] = {}
    openai_secret = secrets.get("openai") if isinstance(secrets, dict) else None
    if isinstance(openai_secret, dict):
        api_key = openai_secret.get("apiKey")
        if isinstance(api_key, str) and api_key.strip():
            masked["openai"] = {
                "hasKey": True,
                "masked": _mask_secret(api_key),
            }
        else:
            masked["openai"] = {"hasKey": False, "masked": None}
    else:
        masked["openai"] = {"hasKey": False, "masked": None}

    google_secret = secrets.get("google") if isinstance(secrets, dict) else None
    if isinstance(google_secret, dict):
        has_credentials = bool(
            isinstance(google_secret.get("client_id"), str)
            and google_secret.get("client_id", "").strip()
            and isinstance(google_secret.get("client_secret"), str)
            and google_secret.get("client_secret", "").strip()
        )
        has_refresh = bool(
            isinstance(google_secret.get("refresh_token"), str)
            and google_secret.get("refresh_token", "").strip()
        )
        masked["google"] = {
            "hasCredentials": has_credentials,
            "hasRefreshToken": has_refresh,
        }
    else:
        masked["google"] = {"hasCredentials": False, "hasRefreshToken": False}
    return masked


def secrets_metadata() -> dict[str, Any]:
    meta: dict[str, Any] = {}
    if SECRETS_PATH.exists():
        stat = SECRETS_PATH.stat()
        updated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        has_key = has_openai_key()
        meta["openai"] = {
            "hasKey": has_key,
            "updatedAt": updated_at,
            "path": str(SECRETS_PATH),
        }
    else:
        meta["openai"] = {"hasKey": False, "updatedAt": None, "path": str(SECRETS_PATH)}
    secrets, _ = read_secrets()
    google_secret = secrets.get("google") if isinstance(secrets, dict) else None
    if isinstance(google_secret, dict):
        has_credentials = bool(
            isinstance(google_secret.get("client_id"), str)
            and google_secret.get("client_id", "").strip()
            and isinstance(google_secret.get("client_secret"), str)
            and google_secret.get("client_secret", "").strip()
        )
        has_refresh = bool(
            isinstance(google_secret.get("refresh_token"), str)
            and google_secret.get("refresh_token", "").strip()
        )
    else:
        has_credentials = False
        has_refresh = False
    meta["google"] = {
        "hasCredentials": has_credentials,
        "hasRefreshToken": has_refresh,
        "path": str(SECRETS_PATH),
    }
    return meta


def read_google_secrets() -> dict[str, str]:
    secrets, _ = read_secrets()
    google_secret = secrets.get("google") if isinstance(secrets, dict) else None
    if not isinstance(google_secret, dict):
        return {}
    payload: dict[str, str] = {}
    for key in ("client_id", "client_secret", "refresh_token"):
        value = google_secret.get(key)
        if isinstance(value, str) and value.strip():
            payload[key] = value.strip()
    return payload


def write_google_refresh_token(refresh_token: str | None) -> dict[str, Any]:
    secrets, _ = read_secrets()
    updated = dict(secrets)
    google_secret = updated.get("google") if isinstance(updated.get("google"), dict) else {}
    google_section: dict[str, Any] = dict(google_secret) if google_secret else {}

    if refresh_token and refresh_token.strip():
        google_section["refresh_token"] = refresh_token.strip()
    else:
        google_section.pop("refresh_token", None)

    if google_section:
        updated["google"] = google_section
    else:
        updated.pop("google", None)

    _write_json(SECRETS_PATH, updated, mode=0o600)
    return updated
