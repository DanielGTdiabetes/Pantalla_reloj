"""Rutas para RainViewer API v4."""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List

import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..global_providers import RainViewerProvider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rainviewer", tags=["rainviewer"])

# Provider singleton
_rainviewer_provider = RainViewerProvider()

# Caché en memoria para frames y paths (para no pegar a RainViewer en cada tile)
_FRAMES_CACHE: Dict[str, Any] = {
    "ts": 0.0,
    "frames": [],       # lista de dicts con al menos { "timestamp": int, "path": str }
    "ttl": 120.0,       # segundos
}


def _get_cached_frames(
    history_minutes: int = 90,
    frame_step: int = 5,
) -> List[Dict[str, Any]]:
    """Devuelve frames de RainViewer con pequeño caché en memoria.

    Siempre que el caché tenga menos de ttl segundos se reutiliza.
    """
    now = time.time()
    ttl = float(_FRAMES_CACHE.get("ttl", 120.0))
    last_ts = float(_FRAMES_CACHE.get("ts", 0.0))

    if _FRAMES_CACHE.get("frames") and (now - last_ts) < ttl:
        return _FRAMES_CACHE["frames"]

    frames = _rainviewer_provider.get_available_frames(
        history_minutes=history_minutes,
        frame_step=frame_step,
    )

    _FRAMES_CACHE["frames"] = frames
    _FRAMES_CACHE["ts"] = now
    return frames


@router.get("/frames")
async def get_rainviewer_frames(
    history_minutes: int = Query(90, ge=1, le=1440, description="Minutos de historia a buscar"),
    frame_step: int = Query(5, ge=1, le=60, description="Intervalo entre frames en minutos"),
) -> List[int]:
    """
    Obtiene lista de frames disponibles de RainViewer.

    Returns:
        Array de timestamps Unix (ascendente) agregando radar.past + radar.nowcast.
    """
    try:
        frames = _get_cached_frames(
            history_minutes=history_minutes,
            frame_step=frame_step,
        )

        timestamps = []
        for f in frames:
            # Soportar tanto forma {"timestamp": ...} como {"ts": ...}
            ts = f.get("timestamp") or f.get("ts")
            if ts is not None:
                timestamps.append(int(ts))

        return timestamps
    except Exception as exc:
        logger.error("Error getting RainViewer frames: %s", exc, exc_info=True)
        return []


@router.get("/tiles/{timestamp}/{z}/{x}/{y}.png")
async def get_rainviewer_tile(
    timestamp: int,
    z: int,
    x: int,
    y: int,
) -> Response:
    """
    Proxy/cache de tiles de RainViewer.

    URL formato: https://tilecache.rainviewer.com/v2/radar/{timestamp}/256/{z}/{x}/{y}/2/1_1.png
    (para v4 se usa path dinámico si está disponible)
    """

    try:
        # Intentar resolver el path usando el caché de frames
        path = None
        try:
            frames = _get_cached_frames()
            for f in frames:
                ts = f.get("timestamp") or f.get("ts")
                if ts is not None and int(ts) == int(timestamp):
                    path = f.get("path")
                    break
            if path:
                logger.debug("RainViewer tile: resolved path '%s' for timestamp %s", path, timestamp)
            else:
                logger.debug("RainViewer tile: no path found for timestamp %s, falling back to legacy URL", timestamp)
        except Exception as e:
            logger.warning("RainViewer tile: error resolving path for timestamp %s: %s", timestamp, e)

        # Generar URL del tile (usando path si lo tenemos)
        tile_url = _rainviewer_provider.get_tile_url(timestamp, z, x, y, path=path)

        max_retries = 2
        for attempt in range(max_retries + 1):
            try:
                response = requests.get(tile_url, timeout=10, stream=True)
                response.raise_for_status()
                content = response.content
                return Response(content=content, media_type="image/png")
            except requests.RequestException as e:
                if attempt < max_retries:
                    logger.warning(
                        "RainViewer tile download attempt %d failed (ts=%s, z=%s, x=%s, y=%s, url=%s): %s, retrying...",
                        attempt + 1,
                        timestamp,
                        z,
                        x,
                        y,
                        tile_url,
                        e,
                    )
                    continue
                logger.warning(
                    "RainViewer tile failed after %d attempts (ts=%s, z=%s, x=%s, y=%s, url=%s): %s",
                    max_retries + 1,
                    timestamp,
                    z,
                    x,
                    y,
                    tile_url,
                    e,
                )
                raise HTTPException(status_code=404, detail="Tile not available")

    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Error getting RainViewer tile (ts=%s, z=%s, x=%s, y=%s): %s", timestamp, z, x, y, exc)
        raise HTTPException(status_code=404, detail="Tile not available")


@router.get("/test")
async def test_rainviewer(
    history_minutes: int = Query(90, ge=1, le=1440),
    frame_step: int = Query(5, ge=1, le=60),
) -> Dict[str, Any]:
    """
    Prueba la conexión con RainViewer API.
    
    Returns:
        { ok: boolean, frames_count: number }
        ok=false si la descarga/parsing falla.
    """
    try:
        frames = _get_cached_frames(
            history_minutes=history_minutes,
            frame_step=frame_step,
        )
        
        return {
            "ok": True,
            "frames_count": len(frames),
        }
        
    except Exception as exc:
        logger.error("RainViewer test failed: %s", exc, exc_info=True)
        return {
            "ok": False,
            "frames_count": 0,
            "reason": str(exc),
        }

