"""
Servicio para obtener datos de satélite desde NASA GIBS.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

logger = logging.getLogger(__name__)

BASE_URL = "https://gibs.earthdata.nasa.gov"
LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor"


def get_latest_image() -> Dict[str, Any]:
    """
    Obtiene el último frame disponible de satélite GIBS.
    
    Returns:
        Dict con ok, timestamp, url_template
    """
    try:
        # GIBS tiene frames cada hora aproximadamente
        # Usar la hora más reciente disponible (redondear hacia abajo)
        now = datetime.now(timezone.utc)
        
        # Redondear a la hora más reciente disponible
        # GIBS generalmente tiene datos con ~1 hora de retraso
        latest_time = now - timedelta(hours=1)
        latest_time = latest_time.replace(minute=0, second=0, microsecond=0)
        
        timestamp_iso = latest_time.strftime("%Y-%m-%dT%H:%M:%SZ")
        date_str = latest_time.strftime("%Y-%m-%d")
        
        # Construir URL template para tiles WMTS
        url_template = (
            f"{BASE_URL}/wmts/epsg3857/best/"
            f"{LAYER}/default/{date_str}/{{z}}/{{y}}/{{x}}.jpg"
        )
        
        return {
            "ok": True,
            "timestamp": int(latest_time.timestamp()),
            "timestamp_iso": timestamp_iso,
            "url_template": url_template,
            "layer": LAYER
        }
        
    except Exception as e:
        logger.error("Error generating GIBS URL: %s", e)
        return {"ok": False, "reason": "error", "error": str(e)}

