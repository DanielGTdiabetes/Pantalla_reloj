from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .config import AppConfig

logger = logging.getLogger(__name__)

CONFIG_DIR = Path(os.environ.get("PANTALLA_CONFIG_DIR", "/etc/pantalla-dash"))
CONFIG_PATH = CONFIG_DIR / "config.json"
SECRETS_PATH = CONFIG_DIR / "secrets.json"

ALLOWED_CONFIG_FIELDS: dict[str, set[str]] = {
    "aemet": {"municipioId", "municipioName", "apiKey", "postalCode", "province"},
    "weather": {"city", "units"},
    "storm": {"threshold", "enableExperimentalLightning"},
    "theme": {"current"},
    "background": {"intervalMinutes", "mode", "retainDays"},
    "tts": {"voice", "volume"},
    "wifi": {"preferredInterface"},
    "calendar": {"enabled", "icsUrl", "maxEvents", "notifyMinutesBefore"},
    "locale": {"country", "autonomousCommunity", "province", "city"},
    "patron": {"city", "name", "month", "day"},
}

class SecretPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class OpenAISecret(BaseModel):
        model_config = ConfigDict(extra="forbid")

        apiKey: str | None = Field(default=None, alias="apiKey", max_length=200)

    openai: OpenAISecret | None = None


def _ensure_dir(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:  # pragma: no cover - defensive
        logger.warning("No se pudo crear directorio %s: %s", path, exc)


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


def _write_json(path: Path, data: dict[str, Any], *, mode: int) -> None:
    _ensure_dir(path.parent)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    os.chmod(tmp_path, mode)
    tmp_path.replace(path)


def _mask_secret(value: str) -> str:
    masked = value.strip()
    if len(masked) <= 4:
        return "***"
    last4 = masked[-4:]
    return f"***…{last4}"


def _merge(base: dict[str, Any], patches: Iterable[dict[str, Any]]) -> dict[str, Any]:
    result = dict(base)
    for patch in patches:
        for key, value in patch.items():
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = _merge(result[key], [value])  # type: ignore[arg-type]
            else:
                result[key] = value
    return result


def _sanitize_patch(payload: dict[str, Any]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    invalid_top = [key for key in payload if key not in ALLOWED_CONFIG_FIELDS]
    if invalid_top:
        raise ValueError(
            "Claves no permitidas: " + ", ".join(sorted(invalid_top))
        )
    for section, allowed_fields in ALLOWED_CONFIG_FIELDS.items():
        if section not in payload:
            continue
        value = payload[section]
        if not isinstance(value, dict):
            raise ValueError(f"Sección {section} debe ser un objeto")
        filtered = {k: v for k, v in value.items() if k in allowed_fields}
        invalid_nested = [k for k in value.keys() if k not in allowed_fields]
        if invalid_nested:
            raise ValueError(
                f"Claves no permitidas en {section}: " + ", ".join(sorted(invalid_nested))
            )
        if filtered:
            sanitized[section] = filtered
    return sanitized


def _migrate_config(data: dict[str, Any]) -> dict[str, Any]:
    migrated = dict(data)
    background = migrated.get("background")
    if isinstance(background, dict):
        mode = background.get("mode")
        if mode == "auto":
            background = dict(background)
            background["mode"] = "daily"
            migrated["background"] = background
            logger.warning("Migrando background.mode=auto -> daily")
            try:
                _write_json(CONFIG_PATH, migrated, mode=0o640)
            except OSError as exc:
                logger.error("No se pudo persistir migración de background.mode: %s", exc)
    return migrated


def read_config() -> tuple[dict[str, Any], str]:
    data = _load_json(CONFIG_PATH)
    if not data and not CONFIG_PATH.exists():
        try:
            _write_json(CONFIG_PATH, {}, mode=0o640)
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
    sanitized = _sanitize_patch(patch)
    current, _ = read_config()
    merged = _merge(current, [sanitized])
    try:
        AppConfig.model_validate(merged)
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
        _write_json(CONFIG_PATH, merged, mode=0o640)
    except OSError as exc:  # pragma: no cover - permisos insuficientes
        raise PermissionError("No se pudo escribir config.json") from exc
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

    try:
        _write_json(SECRETS_PATH, updated, mode=0o600)
    except OSError as exc:  # pragma: no cover - permisos insuficientes
        raise PermissionError("No se pudo escribir secrets.json") from exc
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
    return meta
