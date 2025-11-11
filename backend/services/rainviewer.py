"""
Servicio para obtener datos de radar desde RainViewer.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.rainviewer.com/public/weather-maps.json"
TIMEOUT = 10


def get_latest_frames() -> Dict[str, Any]:
    """
    Obtiene el último frame disponible de radar RainViewer.
    
    Returns:
        Dict con ok, timestamp, url_template o error
    """
    try:
        response = requests.get(BASE_URL, timeout=TIMEOUT)
        response.raise_for_status()
        
        data = response.json()
        radar_data = data.get("radar", {})
        
        # Obtener frames pasados y nowcast
        past_frames = radar_data.get("past", [])
        nowcast_frames = radar_data.get("nowcast", [])
        
        # Combinar todos los frames disponibles
        all_frames = []
        
        # Procesar frames pasados
        for frame in past_frames:
            if isinstance(frame, dict):
                timestamp = frame.get("time")
                path = frame.get("path")
            elif isinstance(frame, int):
                timestamp = frame
                path = None
            else:
                continue
            
            if timestamp:
                all_frames.append({
                    "timestamp": int(timestamp),
                    "path": path or str(timestamp)
                })
        
        # Procesar frames nowcast
        for frame in nowcast_frames:
            if isinstance(frame, dict):
                timestamp = frame.get("time")
                path = frame.get("path")
            elif isinstance(frame, int):
                timestamp = frame
                path = None
            else:
                continue
            
            if timestamp:
                all_frames.append({
                    "timestamp": int(timestamp),
                    "path": path or str(timestamp)
                })
        
        if not all_frames:
            return {"ok": False, "reason": "no_frames"}
        
        # Obtener el frame más reciente
        latest = max(all_frames, key=lambda f: f["timestamp"])
        
        # Construir URL template para tiles
        url_template = (
            f"https://tilecache.rainviewer.com/v2/radar/"
            f"{latest['path']}/256/{{z}}/{{x}}/{{y}}/2/1_1.png"
        )
        
        return {
            "ok": True,
            "timestamp": latest["timestamp"],
            "url_template": url_template,
            "frames_count": len(all_frames)
        }
        
    except requests.RequestException as e:
        logger.error("Error fetching RainViewer frames: %s", e)
        return {"ok": False, "reason": "network_error", "error": str(e)}
    except Exception as e:
        logger.error("Error processing RainViewer data: %s", e)
        return {"ok": False, "reason": "processing_error", "error": str(e)}

