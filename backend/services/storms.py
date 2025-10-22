"""Servicios relacionados con tormentas y radar."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import httpx

from .aemet import AemetDecodeError, CacheEntry, _decode_aemet_payload
from .config import get_api_key, read_config
from .metrics import record_latency
from .offline_state import record_provider_failure, record_provider_success

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parents[1] / "storage" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = "https://opendata.aemet.es/opendata/api"
TTL_PROB = 15 * 60
MEMORY_TTL_DEFAULT = 5 * 60

RADAR_ENDPOINT = "red/radar/nacional"
RADAR_CACHE_DIR = Path("/var/cache/pantalla-dash/radar")
RADAR_CACHE_PATH = RADAR_CACHE_DIR / "aemet_nacional.gif"
RADAR_META_PATH = RADAR_CACHE_DIR / "aemet_nacional.json"
RADAR_MEMORY_KEY = "radar:aemet:nacional"
MAX_RADAR_SIZE = 10 * 1024 * 1024

RADAR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
try:
    RADAR_CACHE_DIR.chmod(0o755)
except OSError:
    pass


_MEMORY_CACHE: Dict[str, CacheEntry] = {}


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


def _memory_read(key: str, ttl: int) -> CacheEntry | None:
    entry = _MEMORY_CACHE.get(key)
    if not entry:
        return None
    if ttl > 0 and time.time() - entry.timestamp > ttl:
        return None
    return entry


def _memory_write(key: str, data: Any, timestamp: Optional[float] = None) -> None:
    _MEMORY_CACHE[key] = CacheEntry(data, timestamp or time.time())


def _get_radar_cache_ttl() -> int:
    config = read_config()
    storm_cfg = getattr(config, "storm", None)
    value = getattr(storm_cfg, "radarCacheSeconds", None) if storm_cfg else None
    try:
        ttl = int(value) if value is not None else 180
    except (TypeError, ValueError):
        ttl = 180
    if ttl <= 0:
        ttl = 180
    return ttl


def _normalize_content_type(raw: Optional[str]) -> str:
    if not raw:
        return "image/gif"
    content_type = raw.split(";", 1)[0].strip()
    if not content_type:
        return "image/gif"
    if not content_type.lower().startswith("image/"):
        return "image/gif"
    return content_type


def _read_radar_meta() -> Dict[str, Any]:
    if not RADAR_META_PATH.exists():
        return {}
    try:
        with RADAR_META_PATH.open("r", encoding="utf-8") as handle:
            payload: Dict[str, Any] = json.load(handle)
            return payload
    except (OSError, json.JSONDecodeError) as exc:
        logger.debug("Radar AEMET: metadatos de caché ilegibles: %s", exc)
        return {}


def _write_radar_cache(content: bytes, *, content_type: str, url: Optional[str], fetched_at_ms: int) -> None:
    size = len(content)
    try:
        RADAR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        RADAR_CACHE_DIR.chmod(0o755)
    except OSError as exc:
        logger.debug("Radar AEMET: no se pudo asegurar directorio de caché: %s", exc)
    try:
        RADAR_CACHE_PATH.write_bytes(content)
    except OSError as exc:
        logger.warning("Radar AEMET: fallo guardando binario en disco: %s", exc)
    meta = {
        "url": url,
        "content_type": content_type,
        "fetched_at": int(fetched_at_ms),
        "size": size,
    }
    try:
        with RADAR_META_PATH.open("w", encoding="utf-8") as handle:
            json.dump(meta, handle, indent=2, ensure_ascii=False)
    except OSError as exc:
        logger.warning("Radar AEMET: fallo guardando metadatos de caché: %s", exc)


def _load_radar_cache_from_disk(ttl: int) -> Optional[Dict[str, Any]]:
    if not RADAR_CACHE_PATH.exists():
        return None
    meta = _read_radar_meta()
    try:
        file_mtime = RADAR_CACHE_PATH.stat().st_mtime
    except OSError as exc:
        logger.debug("Radar AEMET: no se pudo obtener mtime de caché: %s", exc)
        return None
    fetched_at_ms = int(meta.get("fetched_at") or int(file_mtime * 1000))
    age = time.time() - (fetched_at_ms / 1000)
    if ttl > 0 and age > ttl:
        return None
    try:
        content = RADAR_CACHE_PATH.read_bytes()
    except OSError as exc:
        logger.debug("Radar AEMET: no se pudo leer caché binaria: %s", exc)
        return None
    if not content:
        return None
    content_type = _normalize_content_type(meta.get("content_type"))
    size = len(content)
    return {
        "content": content,
        "content_type": content_type,
        "url": meta.get("url"),
        "updated_at": fetched_at_ms,
        "size": size,
        "source": "cache",
        "cached_at": fetched_at_ms,
    }


def _http_get_with_retry(
    client: httpx.Client,
    url: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    attempts: int = 2,
) -> httpx.Response:
    last_exc: Optional[httpx.HTTPError] = None
    for attempt in range(attempts):
        try:
            response = client.get(url, params=params, headers=headers)
            response.raise_for_status()
            return response
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt + 1 >= attempts:
                raise
            time.sleep(0.5)
    assert last_exc is not None
    raise last_exc


def _download_radar_resource() -> Optional[Dict[str, Any]]:
    api_key = get_api_key()
    if not api_key:
        logger.warning("Radar AEMET: sin API key configurada, devolviendo 204…")
        return None

    descriptor_url = f"{BASE_URL}/{RADAR_ENDPOINT}"
    timeout = httpx.Timeout(8.0, connect=5.0, read=8.0)
    start = time.perf_counter()
    with httpx.Client(timeout=timeout) as client:
        try:
            descriptor = _http_get_with_retry(
                client,
                descriptor_url,
                params={"api_key": api_key},
            )
        except httpx.HTTPError as exc:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", str(exc))
            logger.warning("Radar AEMET: sin datos/descarga fallida, devolviendo 204… (%s)", exc)
            return None

        try:
            payload = descriptor.json()
        except json.JSONDecodeError as exc:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", "descriptor json inválido")
            logger.warning(
                "Radar AEMET: sin datos/descarga fallida, devolviendo 204… (descriptor inválido: %s)",
                exc,
            )
            return None

        data_url = payload.get("datos") if isinstance(payload, dict) else None
        if not data_url:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", "descriptor sin datos")
            logger.warning("Radar AEMET: sin datos/descarga fallida, devolviendo 204… (descriptor sin URL)")
            return None

        try:
            data_response = _http_get_with_retry(
                client,
                data_url,
                headers={"Accept": "image/*", "Accept-Encoding": "gzip, deflate"},
            )
        except httpx.HTTPError as exc:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", str(exc))
            logger.warning("Radar AEMET: sin datos/descarga fallida, devolviendo 204… (%s)", exc)
            return None

    content_type_raw = data_response.headers.get("content-type")
    content_type = _normalize_content_type(content_type_raw)
    if not content_type.lower().startswith("image/"):
        record_latency('aemet', time.perf_counter() - start)
        record_provider_failure("aemet", f"tipo inválido: {content_type_raw}")
        logger.warning(
            "Radar AEMET: sin datos/descarga fallida, devolviendo 204… (content-type=%s)",
            content_type_raw,
        )
        return None

    content = data_response.content
    size = len(content)
    if not content:
        record_latency('aemet', time.perf_counter() - start)
        record_provider_failure("aemet", "contenido vacío")
        logger.warning("Radar AEMET: sin datos/descarga fallida, devolviendo 204… (contenido vacío)")
        return None
    if size > MAX_RADAR_SIZE:
        record_latency('aemet', time.perf_counter() - start)
        record_provider_failure("aemet", f"contenido demasiado grande: {size}")
        logger.warning(
            "Radar AEMET: sin datos/descarga fallida, devolviendo 204… (tamaño=%d)",
            size,
        )
        return None

    record_latency('aemet', time.perf_counter() - start)
    record_provider_success("aemet")

    fetched_at_ms = int(time.time() * 1000)
    logger.info(
        "Radar AEMET: obtenido datos → content-type=%s, guardando binario en cache (%d bytes)",
        content_type,
        size,
    )
    _write_radar_cache(content, content_type=content_type, url=data_url, fetched_at_ms=fetched_at_ms)
    return {
        "content": content,
        "content_type": content_type,
        "url": data_url,
        "updated_at": fetched_at_ms,
        "size": size,
        "source": "live",
        "cached_at": None,
    }


def _ensure_radar_resource() -> Optional[Dict[str, Any]]:
    ttl = _get_radar_cache_ttl()
    memory_entry = _memory_read(RADAR_MEMORY_KEY, ttl)
    if memory_entry:
        return memory_entry.data

    disk_data = _load_radar_cache_from_disk(ttl)
    if disk_data:
        timestamp = disk_data.get("updated_at", int(time.time() * 1000)) / 1000
        _memory_write(RADAR_MEMORY_KEY, disk_data, timestamp=timestamp)
        return disk_data

    fresh_data = _download_radar_resource()
    if fresh_data:
        timestamp = fresh_data.get("updated_at", int(time.time() * 1000)) / 1000
        _memory_write(RADAR_MEMORY_KEY, fresh_data, timestamp=timestamp)
        return fresh_data

    return None


def get_radar_image() -> Optional[Dict[str, Any]]:
    return _ensure_radar_resource()


def get_radar_url() -> Optional[str]:
    data = get_radar_image()
    if not data:
        return None
    url = data.get("url")
    if isinstance(url, str) and url.strip():
        return url
    return None


def _request_dataset(endpoint: str, *, cache_key: str, memory_ttl: int) -> Any:
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("Falta API key de AEMET en la configuración")

    url = f"{BASE_URL}/{endpoint}"
    timeout = httpx.Timeout(20.0, read=20.0)
    mem_entry_raw = _MEMORY_CACHE.get(cache_key)
    mem_entry = _memory_read(cache_key, memory_ttl)
    if mem_entry:
        return mem_entry.data
    with httpx.Client(timeout=timeout) as client:
        start = time.perf_counter()
        try:
            descriptor = client.get(url, params={"api_key": api_key})
            descriptor.raise_for_status()
        except httpx.HTTPError as exc:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", str(exc))
            status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            if status == 429 and mem_entry_raw:
                logger.warning("AEMET rate limited para %s, sirviendo caché", endpoint)
                return mem_entry_raw.data
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
            data_resp = client.get(data_url, headers={"Accept-Encoding": "gzip, deflate"})
            data_resp.raise_for_status()
        except httpx.HTTPError as exc:
            record_latency('aemet', time.perf_counter() - start)
            record_provider_failure("aemet", str(exc))
            status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            if status == 429 and mem_entry_raw:
                logger.warning("AEMET datos rate limited para %s, usando caché", data_url)
                return mem_entry_raw.data
            raise RuntimeError("No se pudo descargar datos de AEMET") from exc

        record_latency('aemet', time.perf_counter() - start)
        record_provider_success("aemet")

        try:
            data = _decode_aemet_payload(data_url, data_resp.headers, data_resp.content)
        except AemetDecodeError as exc:
            if mem_entry_raw:
                logger.warning("Fallo decodificando %s, devolviendo caché", data_url)
                return mem_entry_raw.data
            raise RuntimeError(str(exc)) from exc

        _memory_write(cache_key, data)
        return data


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
            f"prediccion/especifica/municipio/diaria/{config.aemet.municipioId}",
            cache_key=f"prediccion:municipio:{config.aemet.municipioId}",
            memory_ttl=MEMORY_TTL_DEFAULT,
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

        # Start with explicit storm probability from API
        prob = storm_prob
        
        # If no explicit storm data, estimate from rain probability
        if prob == 0.0 and rain_prob > 0.0:
            prob = rain_prob * 0.75
        
        # Apply state-based boost if storm conditions mentioned
        if has_storm_state:
            prob = max(prob, 0.7)
        
        # Ensure final probability doesn't exceed 1.0
        prob = min(1.0, prob)

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


def get_lightning_strikes(bounds: Dict[str, float], since_epoch_ms: int) -> Dict[str, Any]:
    """Stub para futura integración de rayos en tiempo real."""
    _ = bounds, since_epoch_ms
    return {"count": 0, "items": []}


def get_storm_status() -> Dict[str, Any]:
    config = read_config()
    threshold = float(getattr(config.storm, "threshold", 0.6) or 0.6)
    lightning_enabled = bool(getattr(config.storm, "enableExperimentalLightning", False))

    prob_data = get_storm_probability()
    radar_data = get_radar_image()

    storm_prob = float(prob_data.get("storm_prob", 0.0))
    radar_url = radar_data.get("url") if radar_data else None

    near_activity = storm_prob >= threshold
    # Lower threshold if radar data is available (visual confirmation of activity)
    if not near_activity and radar_url:
        # Use 80% of configured threshold, but not less than 0.3
        radar_threshold = max(0.3, threshold * 0.8)
        if storm_prob >= radar_threshold:
            near_activity = True

    if lightning_enabled:
        strikes = get_lightning_strikes({}, int(time.time() * 1000) - 30 * 60 * 1000)
        if strikes.get("count"):
            near_activity = True

    radar_updated_at = int(radar_data.get("updated_at", 0)) if radar_data else 0
    updated_at = max(int(prob_data.get("updated_at", 0)), radar_updated_at)
    if not updated_at:
        updated_at = int(time.time() * 1000)

    response = {
        "storm_prob": round(storm_prob, 3),
        "near_activity": bool(near_activity),
        "radar_url": radar_url,
        "updated_at": int(updated_at),
        "source": prob_data.get("source")
        or (radar_data.get("source") if radar_data else None)
        or "live",
        "cached_at": prob_data.get("cached_at")
        or (radar_data.get("cached_at") if radar_data else None),
    }
    return response

