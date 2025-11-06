"""Rutas para RainViewer API v4."""
from __future__ import annotations

import logging
from typing import Any, Dict, List

import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..global_providers import RainViewerProvider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rainviewer", tags=["rainviewer"])

# Provider singleton
_rainviewer_provider = RainViewerProvider()


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
    # Cache se maneja en el provider si es necesario
    
    try:
        frames = _rainviewer_provider.get_available_frames(
            history_minutes=history_minutes,
            frame_step=frame_step
        )
        
        # Extraer solo timestamps para el endpoint público
        timestamps = [f["timestamp"] for f in frames]
        
        return timestamps
        
    except Exception as exc:
        logger.error("Error getting RainViewer frames: %s", exc, exc_info=True)
        # Retornar array vacío en lugar de error
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
    """
    # Cache se maneja a nivel de proxy si es necesario
    
    try:
        # Generar URL del tile
        tile_url = _rainviewer_provider.get_tile_url(timestamp, z, x, y)
        
        # Descargar tile con timeout y reintentos
        max_retries = 2
        for attempt in range(max_retries + 1):
            try:
                response = requests.get(tile_url, timeout=10, stream=True)
                response.raise_for_status()
                
                # Leer contenido
                content = response.content
                
                return Response(content=content, media_type="image/png")
                
            except requests.RequestException as e:
                if attempt < max_retries:
                    logger.warning(f"RainViewer tile download attempt {attempt + 1} failed: {e}, retrying...")
                    continue
                else:
                    raise
        
        # Si llegamos aquí, todos los reintentos fallaron
        raise HTTPException(status_code=404, detail="Tile not available")
        
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Error getting RainViewer tile: %s", exc)
        # Retornar 404 en lugar de error 500
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
        frames = _rainviewer_provider.get_available_frames(
            history_minutes=history_minutes,
            frame_step=frame_step
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

