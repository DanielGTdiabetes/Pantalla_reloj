from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Tuple
import json
import os

ETC_DIR = Path("/etc/pantalla-dash")
HOME_DIR = Path.home() / ".config" / "pantalla-dash"
CONFIG_PATHS = [ETC_DIR / "config.json", HOME_DIR / "config.json"]
ENV_PATHS = [ETC_DIR / "env", HOME_DIR / "env"]


def _first_existing(paths):
    for path in paths:
        if path.exists():
            return path
    return None


def _ensure_parent(path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass


def _load_json(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}


def _read_env_file(path: Path) -> Dict[str, str]:
    data: Dict[str, str] = {}
    try:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                data[key.strip()] = value.strip()
    except OSError:
        return {}
    return data


def _merge_dict(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = _merge_dict(dict(base[key]), value)
        else:
            base[key] = value
    return base


def _dump_json(path: Path, data: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")
    try:
        os.chmod(path, 0o660)
    except OSError:
        pass


def _write_env(path: Path, data: Dict[str, str]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for key, value in data.items():
            fh.write(f"{key}={value}\n")
    try:
        os.chmod(path, 0o660)
    except OSError:
        pass


def read_config() -> Tuple[Dict[str, Any], str]:
    target = _first_existing(CONFIG_PATHS)
    if target is None:
        return {}, str(CONFIG_PATHS[-1])
    return _load_json(target), str(target)


def read_env() -> Tuple[Dict[str, str], str]:
    target = _first_existing(ENV_PATHS)
    if target is None:
        return {}, str(ENV_PATHS[-1])
    return _read_env_file(target), str(target)


def has_openai_key() -> bool:
    env, _ = read_env()
    key = env.get("OPENAI_API_KEY", "").strip()
    return bool(key)


def _find_writable(paths) -> Path | None:
    for path in paths:
        try:
            _ensure_parent(path)
            if path.exists():
                with path.open("a", encoding="utf-8"):
                    pass
            else:
                with path.open("w", encoding="utf-8"):
                    pass
            return path
        except OSError:
            continue
    return None


def write_config_partial(patch: Dict[str, Any]) -> Tuple[bool, str]:
    writable = _find_writable(CONFIG_PATHS)
    if writable is None:
        return False, "read-only: ajusta permisos"

    current, _ = read_config()
    merged = _merge_dict(dict(current), patch)
    try:
        _dump_json(writable, merged)
    except OSError:
        return False, "read-only: ajusta permisos"
    return True, str(writable)


def write_openai_key(value: str) -> Tuple[bool, str]:
    writable = _find_writable(ENV_PATHS)
    if writable is None:
        return False, "read-only: ajusta permisos"

    env_data, _ = read_env()
    env_data = dict(env_data)
    if value:
        env_data["OPENAI_API_KEY"] = value.strip()
    else:
        env_data.pop("OPENAI_API_KEY", None)
    try:
        _write_env(writable, env_data)
    except OSError:
        return False, "read-only: ajusta permisos"
    return True, str(writable)
