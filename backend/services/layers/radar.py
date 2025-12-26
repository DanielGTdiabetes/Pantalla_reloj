from __future__ import annotations

import importlib
from typing import Any, Dict, Optional, Tuple

import httpx

PROBE_TIMEOUT = 6.0


def _load_main_module():
    return importlib.import_module("backend.main")


def _model_to_dict(model_obj: Any) -> Optional[Dict[str, Any]]:
    if model_obj is None:
        return None
    if hasattr(model_obj, "model_dump"):
        return model_obj.model_dump()
    if hasattr(model_obj, "dict"):
        return model_obj.dict()
    return None


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

    radar_cfg = layers.radar
    provider = radar_cfg.provider
    enabled = bool(radar_cfg.enabled)

    status: Dict[str, Any] = {
        "enabled": enabled,
        "provider": provider,
        "history_minutes": radar_cfg.history_minutes,
        "frame_step": radar_cfg.frame_step,
        "refresh_minutes": radar_cfg.refresh_minutes,
        "layer_type": getattr(radar_cfg, "layer_type", None),
    }

    if not enabled:
        status["ok"] = False
        status["reason"] = "layer_disabled"
        return status

    probe_result: Dict[str, Any]
    probe_error: Optional[str]

    if provider == "rainviewer":
        probe_result, probe_error = await _probe_rainviewer()
        # RainViewer no requiere API key
        status["has_api_key"] = None
    elif provider == "openweathermap":
        api_key = _get_openweather_key(main)
        if not api_key:
            status.update(
                {
                    "ok": False,
                    "probe": {"ok": False, "reason": "missing_api_key"},
                    "probe_error": "missing_api_key",
                    "has_api_key": False,
                }
            )
            return status
        probe_result, probe_error = await _probe_openweather(api_key, radar_cfg.layer_type)
        status["has_api_key"] = True
    elif provider == "maptiler_weather":
        # Para MapTiler Weather, verificar API key de MapTiler
        maptiler_key = _get_maptiler_key(main)
        if not maptiler_key:
            status.update(
                {
                    "ok": False,
                    "probe": {"ok": False, "reason": "missing_api_key"},
                    "probe_error": "missing_api_key",
                    "has_api_key": False,
                }
            )
            return status
        # MapTiler Weather no requiere probe específico (usa RadarLayer de @maptiler/weather)
        # Marcar como ok si hay API key
        status["has_api_key"] = True
        status["ok"] = True
        probe_result = {"ok": True, "reason": "maptiler_weather_provider"}
        probe_error = None
    else:
        status.update(
            {
                "ok": False,
                "probe": {"ok": False, "reason": f"provider_{provider}_not_supported"},
                "probe_error": f"provider_{provider}_not_supported",
            }
        )
        return status

    status["probe"] = probe_result
    status["ok"] = bool(probe_result.get("ok")) if isinstance(probe_result, dict) else False
    if probe_error:
        status["probe_error"] = probe_error
        status["ok"] = False

    return status


async def _probe_rainviewer() -> Tuple[Dict[str, Any], Optional[str]]:
    url = "https://api.rainviewer.com/public/weather-maps.json"
    headers = {"User-Agent": "pantalla-reloj-layers-probe/1.0"}
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
            response = await client.get(url, headers=headers)
            result = {
                "status_code": response.status_code,
                "reason": response.reason_phrase,
                "elapsed_ms": int(response.elapsed.total_seconds() * 1000),
            }
            if response.status_code == 200:
                payload = response.json()
                radar_data = payload.get("radar") or {}
                past = radar_data.get("past")
                nowcast = radar_data.get("nowcast")
                result.update(
                    {
                        "past_frames": len(past or []),
                        "nowcast_frames": len(nowcast or []),
                        "ok": True,
                    }
                )
                return result, None
            result["ok"] = False
            return result, f"http_{response.status_code}"
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout"}, "timeout"
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": "error", "detail": str(exc)}, str(exc)


async def _probe_openweather(api_key: str, layer_type: Optional[str]) -> Tuple[Dict[str, Any], Optional[str]]:
    safe_layer = layer_type or "precipitation_new"
    url = f"https://tile.openweathermap.org/map/{safe_layer}/0/0/0.png"
    params = {"appid": api_key}
    headers = {"User-Agent": "pantalla-reloj-layers-probe/1.0"}
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
            response = await client.get(url, params=params, headers=headers)
            result = {
                "status_code": response.status_code,
                "reason": response.reason_phrase,
                "elapsed_ms": int(response.elapsed.total_seconds() * 1000),
            }
            if response.status_code == 200:
                result["ok"] = True
                result["content_length"] = int(response.headers.get("Content-Length") or 0)
                return result, None
            result["ok"] = False
            return result, f"http_{response.status_code}"
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout"}, "timeout"
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": "error", "detail": str(exc)}, str(exc)


def _get_openweather_key(main_module) -> Optional[str]:
    try:
        value = main_module.secret_store.get_secret("openweathermap_api_key")
        if value:
            return value.strip()
        return None
    except Exception:  # noqa: BLE001
        return None


def _get_maptiler_key(main_module) -> Optional[str]:
    """Obtiene la API key de MapTiler desde secrets o configuración."""
    try:
        # Intentar desde secrets primero
        value = main_module.secret_store.get_secret("maptiler_key")
        if value:
            return value.strip()
        
        # Fallback: intentar desde ui_map.maptiler.api_key
        config = main_module.config_manager.read()
        if hasattr(config, "ui") and hasattr(config.ui, "map") and hasattr(config.ui.map, "maptiler"):
            maptiler_config = config.ui.map.maptiler
            if isinstance(maptiler_config, dict) and maptiler_config.get("api_key"):
                api_key = maptiler_config["api_key"]
                if isinstance(api_key, str) and api_key.strip():
                    return api_key.strip()
        
        return None
    except Exception:  # noqa: BLE001
        return None


