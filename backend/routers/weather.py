"""
Router para endpoints de capas meteorológicas unificadas.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter

from ..services import rainviewer as rainviewer_service
from ..services import gibs as gibs_service
from ..services import cap_warnings as cap_warnings_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("/radar")
def get_radar_frames() -> Dict[str, Any]:
    """
    Obtiene el último frame disponible de radar RainViewer.
    
    Returns:
        Dict con ok, timestamp, url_template
    """
    return rainviewer_service.get_latest_frames()


@router.get("/satellite")
def get_satellite_frame() -> Dict[str, Any]:
    """
    Obtiene el último frame disponible de satélite GIBS.
    
    Returns:
        Dict con ok, timestamp, url_template
    """
    return gibs_service.get_latest_image()


@router.get("/alerts")
def get_weather_alerts() -> Dict[str, Any]:
    """
    Obtiene avisos CAP de AEMET en formato GeoJSON.
    
    Returns:
        GeoJSON FeatureCollection con los avisos
    """
    return cap_warnings_service.get_alerts_geojson()

