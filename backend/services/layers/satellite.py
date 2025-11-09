from __future__ import annotations

import importlib
from typing import Dict

import httpx

PROBE_TIMEOUT = 6.0
GIBS_HEAD_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi"


def _load_main_module():
    return importlib.import_module("backend.main")


async def test() -> Dict[str, Any]:
    main = _load_main_module()
    config = main.config_manager.read()
    layers = getattr(config.layers, "global_", None) or getattr(config.layers, "global", None)

    if layers is None:
        return {
            "ok": False,
            "enabled": False,
            "reason": "global_layers_not_configured",
        }

    satellite_cfg = layers.satellite
    provider = satellite_cfg.provider
    enabled = bool(satellite_cfg.enabled)

    status: Dict[str, Any] = {
        "enabled": enabled,
        "provider": provider,
        "history_minutes": satellite_cfg.history_minutes,
        "frame_step": satellite_cfg.frame_step,
        "refresh_minutes": satellite_cfg.refresh_minutes,
    }

    if not enabled:
        status["ok"] = False
        status["reason"] = "layer_disabled"
        return status

    if provider != "gibs":
        status.update(
            {
                "ok": False,
                "probe": {"ok": False, "reason": f"provider_{provider}_not_supported"},
                "probe_error": f"provider_{provider}_not_supported",
            }
        )
        return status

    probe_result = await _probe_gibs()
    status["probe"] = probe_result
    status["ok"] = bool(probe_result.get("ok"))
    if not status["ok"] and "reason" in probe_result:
        status["probe_error"] = probe_result.get("reason")

    return status


async def _probe_gibs() -> Dict[str, Any]:
    headers = {"User-Agent": "pantalla-reloj-layers-probe/1.0"}
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
            response = await client.head(GIBS_HEAD_URL, headers=headers)
            result: Dict[str, Any] = {
                "status_code": response.status_code,
                "reason": response.reason_phrase,
                "elapsed_ms": int(response.elapsed.total_seconds() * 1000),
            }
            if response.status_code == 200:
                result["ok"] = True
            else:
                result["ok"] = False
                result["reason"] = f"http_{response.status_code}"
            return result
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": "error", "detail": str(exc)}


