"""Gestión simple de overrides de geolocalización."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_PATH = PROJECT_ROOT / "storage" / "cache" / "location_override.json"


def set_location(lat: float, lon: float) -> None:
    payload = {
        "lat": lat,
        "lon": lon,
        "timestamp": int(time.time()),
    }
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    tmp.replace(CACHE_PATH)
    logger.info("Nueva geolocalización manual: lat=%s lon=%s", lat, lon)


def get_location() -> Optional[Tuple[float, float]]:
    if not CACHE_PATH.exists():
        return None
    try:
        with CACHE_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        lat = float(data.get("lat"))
        lon = float(data.get("lon"))
        return lat, lon
    except (OSError, ValueError, TypeError) as exc:
        logger.warning("No se pudo leer override de localización: %s", exc)
        return None


def clear_location() -> None:
    try:
        CACHE_PATH.unlink(missing_ok=True)
    except OSError as exc:
        logger.debug("No se pudo borrar override de localización: %s", exc)

