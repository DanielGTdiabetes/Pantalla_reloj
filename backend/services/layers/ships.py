from __future__ import annotations

import importlib
from typing import Any, Dict, Optional, Tuple

import httpx

PROBE_TIMEOUT = 6.0


def _load_main_module():
    return importlib.import_module("backend.main")


async def get_status() -> Dict[str, Any]:
    main = _load_main_module()
    config = main.config_manager.read()
    ships_cfg = config.layers.ships

    provider = ships_cfg.provider
    enabled = bool(ships_cfg.enabled)

    base_status: Dict[str, Any] = {
        "enabled": enabled,
        "provider": provider,
        "source": provider,
        "update_interval": ships_cfg.update_interval,
        "refresh_seconds": ships_cfg.refresh_seconds,
        "max_items_view": ships_cfg.max_items_view,
    }

    try:
        runtime_status = main.ships_service.get_status()
        base_status.update(runtime_status)
    except Exception as exc:  # noqa: BLE001
        base_status["runtime_error"] = str(exc)

    probe_result, probe_error = await _probe_provider(main, provider)
    base_status["probe"] = probe_result
    base_status["ok"] = bool(probe_result.get("ok")) if isinstance(probe_result, dict) else False
    if probe_error:
        base_status["probe_error"] = probe_error
        base_status["ok"] = False

    if provider == "aisstream":
        base_status["has_api_key"] = bool(_has_aisstream_key(main))

    return base_status


async def _probe_provider(main_module, provider: str) -> Tuple[Dict[str, Any], Optional[str]]:
    if provider == "aisstream":
        api_key = _get_aisstream_key(main_module)
        if not api_key:
            return {"ok": False, "reason": "missing_api_key"}, "missing_api_key"
        return await _probe_aisstream(api_key)

    if provider in {"ais_generic", "aishub", "custom"}:
        return {
            "ok": False,
            "reason": f"probe_not_implemented_for_{provider}",
        }, f"probe_not_implemented_for_{provider}"

    return {"ok": False, "reason": "unknown_provider"}, "unknown_provider"


async def _probe_aisstream(api_key: str) -> Tuple[Dict[str, Any], Optional[str]]:
    url = "https://api.aisstream.io/v0/ships"
    headers = {
        "x-api-key": api_key,
        "User-Agent": "pantalla-reloj-layers-probe/1.0",
    }
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
            response = await client.get(url, headers=headers)
            result = {
                "status_code": response.status_code,
                "reason": response.reason_phrase,
                "elapsed_ms": int(response.elapsed.total_seconds() * 1000),
            }
            if response.status_code == 200:
                data = response.json()
                result["ships"] = len(data.get("ships", []) or [])
                result["ok"] = True
                return result, None
            result["ok"] = False
            return result, f"http_{response.status_code}"
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout"}, "timeout"
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": "error", "detail": str(exc)}, str(exc)


def _has_aisstream_key(main_module) -> bool:
    try:
        return bool(main_module.secret_store.has_secret("aisstream_api_key"))
    except Exception:  # noqa: BLE001
        return False


def _get_aisstream_key(main_module) -> Optional[str]:
    try:
        api_key = main_module.secret_store.get_secret("aisstream_api_key")
        if api_key:
            return api_key.strip()
        return None
    except Exception:  # noqa: BLE001
        return None


