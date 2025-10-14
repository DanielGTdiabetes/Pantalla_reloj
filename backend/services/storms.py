"""Servicios relacionados con tormentas y radar."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import httpx

from .config import get_api_key, read_config
from .metrics import record_latency
from .offline_state import record_provider_failure, record_provider_success

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parents[1] / "storage" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = "https://opendata.aemet.es/opendata/api"
TTL_PROB = 15 * 60
TTL_RADAR = 10 * 60


def _cache_path(name: str) -> Path:
    return CACHE_DIR / f"storms_{name}.json"


def _cache_read(name: str, ttl: int, *, allow_stale: bool = False) -> Optional[Dict[str, Any]]:
    path = _cache_path(name)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        logger.debug("No se pudo leer caché %s: %s", path, exc)
        return None

    updated_at_ms = int(payload.get("updated_at") or payload.get("timestamp", 0))
    if updated_at_ms:
        age = time.time() - (updated_at_ms / 1000)
    else:
        age = time.time() - path.stat().st_mtime
    if not allow_stale and ttl > 0 and age > ttl:
        return None
    return payload


def _cache_write(name: str, data: Dict[str, Any]) -> None:
    path = _cache_path(name)
    tmp = path.with_suffix(".tmp")
    try:
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
        tmp.replace(path)
    except OSError as exc:
        logger.debug("No se pudo escribir caché %s: %s", path, exc)


def _request_dataset(endpoint: str) -> Any:
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("Falta API key de AEMET en la configuración")

    url = f"{BASE_URL}/{endpoint}"
    timeout = httpx.Timeout(20.0, read=20.0)
    with httpx.Client(timeout=timeout) as client:
        start = time.perf_counter()
        try:
            descriptor = client.get(url, params={"api_key": api_key})
            descriptor.raise_for_status()
        except httpx.HTTPError as exc:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", str(exc))
            raise RuntimeError(f"No se pudo obtener descriptor {endpoint}") from exc

        try:
            payload = descriptor.json()
        except json.JSONDecodeError as exc:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", "descriptor json inválido")
            raise RuntimeError("Descriptor AEMET inválido") from exc

        data_url = payload.get("datos") if isinstance(payload, dict) else None
        if not data_url:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", "descriptor sin datos")
            raise RuntimeError("Descriptor AEMET sin URL de datos")

        try:
            data_resp = client.get(data_url)
            data_resp.raise_for_status()
        except httpx.HTTPError as exc:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", str(exc))
            raise RuntimeError("No se pudo descargar datos de AEMET") from exc

        record_latency('aemet', time.perf_counter() - start)
        record_provider_success("aemet")

        try:
            return data_resp.json()
        except json.JSONDecodeError:
            return data_resp.text


def _extract_daily(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, list) and payload:
        entry = payload[0]
        if isinstance(entry, dict):
            prediction = entry.get("prediccion")
            if isinstance(prediction, dict):
                days = prediction.get("dia")
                if isinstance(days, list) and days:
                    return days[0]
    return {}


def _extract_probability(items: Any) -> float:
    if not isinstance(items, Iterable):
        return 0.0
    prob = 0.0
    for entry in items:
        if isinstance(entry, dict):
            value = entry.get("value") or entry.get("valor")
            try:
                prob = max(prob, float(value))
            except (TypeError, ValueError):
                continue
    return max(0.0, min(prob, 100.0)) / 100.0


def _extract_states(items: Any) -> list[str]:
    states: list[str] = []
    if isinstance(items, Iterable):
        for entry in items:
            if isinstance(entry, dict):
                text = entry.get("descripcion") or entry.get("value")
                if isinstance(text, str) and text.strip():
                    states.append(text.strip())
    return states


def get_storm_probability() -> Dict[str, Any]:
    cached = _cache_read("prob", TTL_PROB)
    if cached:
        if isinstance(cached, dict):
            cached.setdefault("source", "cache")
            cached.setdefault("cached_at", cached.get("updated_at"))
        return cached
    stale = _cache_read("prob", 24 * 3600, allow_stale=True)

    try:
        config = read_config()
        if not config.aemet or not config.aemet.municipioId:
            raise RuntimeError("Falta configuración de municipio AEMET")

        daily_payload = _request_dataset(
            f"prediccion/especifica/municipio/diaria/{config.aemet.municipioId}"
        )
        today = _extract_daily(daily_payload)

        storm_prob = _extract_probability(today.get("probTormenta"))
        rain_prob = _extract_probability(today.get("probPrecipitacion"))
        states = [state.lower() for state in _extract_states(today.get("estadoCielo"))]
        has_storm_state = any(
            token in state
            for state in states
            for token in ("tormenta", "chubasco", "nube convectiva", "granizo")
        )

        prob = storm_prob
        if prob == 0.0 and rain_prob > 0.0:
            prob = min(1.0, rain_prob * 0.75)
        prob = max(prob, rain_prob * 0.6)
        if has_storm_state:
            prob = max(prob, 0.7)

        detail = {
            "storm_prob_raw": storm_prob,
            "rain_prob_raw": rain_prob,
            "has_storm_state": has_storm_state,
            "states": states[:5],
        }
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Fallo calculando probabilidad de tormenta: %s", exc)
        if stale:
            if isinstance(stale, dict):
                stale.setdefault("source", "cache")
                stale.setdefault("cached_at", stale.get("updated_at"))
            return stale
        prob = 0.0
        detail = {"error": str(exc)}

    result = {
        "storm_prob": round(prob, 3),
        "detail": detail,
        "updated_at": int(time.time() * 1000),
        "source": "live",
        "cached_at": None,
    }
    _cache_write("prob", result)
    return result


def _extract_radar_url(payload: Any) -> Optional[str]:
    candidates = []
    if isinstance(payload, dict):
        candidates.extend(
            str(payload[key])
            for key in ("url", "datos", "path", "enlace", "image")
            if isinstance(payload.get(key), str)
        )
        for value in payload.values():
            if isinstance(value, (list, dict)):
                nested = _extract_radar_url(value)
                if nested:
                    return nested
    elif isinstance(payload, list):
        for entry in reversed(payload):
            nested = _extract_radar_url(entry)
            if nested:
                return nested
    elif isinstance(payload, str):
        candidates.append(payload)

    for candidate in reversed(candidates):
        text = candidate.strip()
        if text.lower().startswith("http"):
            return text
    return None


def _extract_radar_frames(payload: Any) -> list[str]:
    frames: list[str] = []
    if isinstance(payload, dict):
        for value in payload.values():
            frames.extend(_extract_radar_frames(value))
    elif isinstance(payload, list):
        for entry in payload:
            frames.extend(_extract_radar_frames(entry))
    elif isinstance(payload, str):
        lines = [line.strip() for line in payload.splitlines() if line.strip()]
        frames.extend([line for line in lines if line.lower().startswith("http")])
    return frames


def _fetch_radar_data() -> tuple[Optional[str], list[str]]:
    try:
        payload = _request_dataset("red/radar/nacional")
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("No se pudo obtener radar AEMET: %s", exc)
        return None, []

    frames = _extract_radar_frames(payload)
    if frames:
        return frames[-1], frames[-12:]
    url = _extract_radar_url(payload)
    if url:
        return url, [url]
    return None, []


def _ensure_radar_cache() -> Dict[str, Any]:
    cached = _cache_read("radar", TTL_RADAR)
    if cached:
        return cached
    stale = _cache_read("radar", 24 * 3600, allow_stale=True)

    url, frames = _fetch_radar_data()
    if url is None and stale:
        if isinstance(stale, dict):
            stale.setdefault("source", "cache")
            stale.setdefault("cached_at", stale.get("updated_at"))
        return stale

    result = {
        "url": url,
        "frames": frames,
        "updated_at": int(time.time() * 1000),
        "source": "live",
        "cached_at": None,
    }
    _cache_write("radar", result)
    return result


def get_radar_url() -> Optional[str]:
    return _ensure_radar_cache().get("url")


def get_radar_animation(limit: int = 8) -> Dict[str, Any]:
    data = _ensure_radar_cache()
    frames = data.get("frames") or []
    if not isinstance(frames, list):
        frames = []
    ordered = [frame for frame in frames if isinstance(frame, str)]
    trimmed = ordered[-limit:] if limit else ordered
    updated_at = int(data.get("updated_at", int(time.time() * 1000)))
    return {"frames": trimmed, "updated_at": updated_at}


def get_lightning_strikes(bounds: Dict[str, float], since_epoch_ms: int) -> Dict[str, Any]:
    """Stub para futura integración de rayos en tiempo real."""
    _ = bounds, since_epoch_ms
    return {"count": 0, "items": []}


def get_storm_status() -> Dict[str, Any]:
    config = read_config()
    threshold = float(getattr(config.storm, "threshold", 0.6) or 0.6)
    lightning_enabled = bool(getattr(config.storm, "enableExperimentalLightning", False))

    prob_data = get_storm_probability()
    radar_data = _ensure_radar_cache()

    storm_prob = float(prob_data.get("storm_prob", 0.0))
    radar_url = radar_data.get("url")

    near_activity = storm_prob >= threshold
    if not near_activity and radar_url and storm_prob >= max(0.4, threshold * 0.8):
        near_activity = True

    if lightning_enabled:
        strikes = get_lightning_strikes({}, int(time.time() * 1000) - 30 * 60 * 1000)
        if strikes.get("count"):
            near_activity = True

    updated_at = max(prob_data.get("updated_at", 0), radar_data.get("updated_at", 0))
    if not updated_at:
        updated_at = int(time.time() * 1000)

    response = {
        "storm_prob": round(storm_prob, 3),
        "near_activity": bool(near_activity),
        "radar_url": radar_url,
        "updated_at": int(updated_at),
        "source": prob_data.get("source") or radar_data.get("source") or "live",
        "cached_at": prob_data.get("cached_at") or radar_data.get("cached_at"),
    }
    return response

