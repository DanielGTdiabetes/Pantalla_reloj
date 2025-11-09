from __future__ import annotations

import importlib
import time
from typing import Any, Dict, Optional, Tuple

import httpx


def _model_to_dict(model_obj: Any) -> Optional[Dict[str, Any]]:
    if model_obj is None:
        return None
    if hasattr(model_obj, "model_dump"):
        return model_obj.model_dump()
    if hasattr(model_obj, "dict"):
        return model_obj.dict()
    return None

PROBE_TIMEOUT = 6.0


def _load_main_module():
    """
    Carga perezosamente el módulo principal para acceder a singletons ya inicializados
    (config_manager, opensky_service, secret_store, etc.).
    """

    return importlib.import_module("backend.main")


async def get_status() -> Dict[str, Any]:
    """
    Devuelve el estado actual de la capa de vuelos según la configuración y el servicio OpenSky.
    """

    main = _load_main_module()
    config = main.config_manager.read()
    flights_cfg = config.layers.flights
    opensky_cfg = config.opensky

    provider = flights_cfg.provider
    enabled = bool(flights_cfg.enabled and opensky_cfg.enabled)

    bbox_dict = _model_to_dict(getattr(opensky_cfg, "bbox", None))

    status: Dict[str, Any] = {
        "enabled": enabled,
        "provider": provider,
        "opensky_enabled": bool(opensky_cfg.enabled),
        "opensky_mode": getattr(opensky_cfg, "mode", None),
        "bbox": bbox_dict,
        "max_aircraft": int(getattr(opensky_cfg, "max_aircraft", 0) or 0),
        "extended": int(getattr(opensky_cfg, "extended", 0) or 0),
        "source": "opensky",
    }

    if provider != "opensky":
        status["ok"] = False
        status["reason"] = f"provider_{provider}_not_supported"
        return status

    try:
        opensky_status = main.opensky_service.get_status(config)
        now = time.time()
        last_fetch_ts = opensky_status.get("last_fetch_ts")
        status.update(
            {
                "ok": bool(opensky_status.get("ok", True)),
                "effective_poll": opensky_status.get("effective_poll"),
                "has_credentials": bool(opensky_status.get("has_credentials")),
                "token_cached": bool(opensky_status.get("token_cached")),
                "last_fetch_ts": last_fetch_ts,
                "last_fetch_age": int(now - last_fetch_ts) if last_fetch_ts else None,
                "remaining": opensky_status.get("remaining"),
                "stale": opensky_status.get("stale"),
            }
        )
        auth_block = opensky_status.get("auth")
        if isinstance(auth_block, dict):
            status["auth"] = {
                "mode": auth_block.get("mode"),
                "has_credentials": bool(auth_block.get("has_credentials")),
                "token_cached": bool(auth_block.get("token_cached")),
                "expires_in_sec": auth_block.get("expires_in_sec"),
            }
    except Exception as exc:  # noqa: BLE001
        status["ok"] = False
        status["error"] = "opensky_status_failed"
        status["error_detail"] = str(exc)
        return status

    probe_result, probe_error = await _probe_opensky(opensky_cfg)
    status["probe"] = probe_result
    if probe_error:
        status["ok"] = False
        status["probe_error"] = probe_error

    return status


async def _probe_opensky(opensky_cfg) -> Tuple[Dict[str, Any], Optional[str]]:
    """
    Realiza una petición ligera a OpenSky para validar conectividad.
    """

    bbox = _model_to_dict(getattr(opensky_cfg, "bbox", None))
    params: Dict[str, Any] = {}
    if bbox:
        lamin = bbox.get("lamin")
        lamax = bbox.get("lamax")
        lomin = bbox.get("lomin")
        lomax = bbox.get("lomax")
        # Ajustar si la configuración es inválida o nula
        if isinstance(lamin, (int, float)) and isinstance(lamax, (int, float)) and lamax > lamin:
            params.update(
                {
                    "lamin": lamin,
                    "lamax": lamax,
                }
            )
        if isinstance(lomin, (int, float)) and isinstance(lomax, (int, float)) and lomax > lomin:
            params.update(
                {
                    "lomin": lomin,
                    "lomax": lomax,
                }
            )

    # Añadir límites por defecto si la configuración no aporta uno válido
    if not params:
        params = {"lamin": 39.0, "lamax": 41.0, "lomin": -4.0, "lomax": -2.0}

    url = "https://opensky-network.org/api/states/all"
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
                payload = response.json()
                result["states_count"] = len(payload.get("states", []) or [])
                result["ok"] = True
                return result, None

            result["ok"] = False
            return result, f"http_{response.status_code}"
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout"}, "timeout"
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": "error", "detail": str(exc)}, str(exc)


