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


from ..config_manager import ConfigManager

config_manager = ConfigManager()

@router.get("/weekly")
@router.get("/")
def get_weekly_forecast(lat: float = None, lon: float = None) -> Dict[str, Any]:
    """
    Obtiene previsión meteorológica semanal (OpenWeatherMap).
    Si no se proporcionan lat/lon, se usan los de la configuración.
    """
    # Resolve location
    if lat is None or lon is None:
        config = config_manager.read()
        if config.location:
            lat = config.location.lat
            lon = config.location.lon
        
        # Fallback if still missing
        if lat is None or lon is None:
             # Default to Madrid/Spain center if absolutely nothing is configured
             lat = 40.4168
             lon = -3.7038

    api_key = secret_store.get_secret("openweathermap_api_key")
    if not api_key:
        # Fallback for dev/test without keys
        return {
            "ok": False, 
            "reason": "missing_api_key",
            "temperature": {"value": 20, "unit": "C"},
            "condition": "Clear",
            "summary": "Sin datos (Falta API Key)",
            "days": []
        }

    # Try One Call 3.0
    url = f"https://api.openweathermap.org/data/3.0/onecall?lat={lat}&lon={lon}&exclude=minutely,hourly&units=metric&appid={api_key}"
    
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 401:
             # Fallback to 2.5 One Call if 3.0 fails (some keys are old)
             url = f"https://api.openweathermap.org/data/2.5/onecall?lat={lat}&lon={lon}&exclude=minutely,hourly&units=metric&appid={api_key}"
             resp = requests.get(url, timeout=10)
        
        if resp.status_code != 200:
             return {"ok": False, "reason": f"upstream_error_{resp.status_code}"}
        
        data = resp.json()
        
        # Transform to expected format
        current = data.get("current", {})
        daily = data.get("daily", [])
        
        days = []
        for d in daily:
             days.append({
                 "date": time.strftime("%Y-%m-%d", time.localtime(d.get("dt"))),
                 "dayName": time.strftime("%A", time.localtime(d.get("dt"))),
                 "condition": d.get("weather", [{}])[0].get("description", ""),
                 "temperature": {
                     "min": d.get("temp", {}).get("min"),
                     "max": d.get("temp", {}).get("max")
                 },
                 "precipitation": d.get("rain", 0) or (d.get("pop", 0) * 100)
             })

        return {
            "ok": True,
            "temperature": {
                "value": current.get("temp"),
                "unit": "C"
            },
            "humidity": current.get("humidity"),
            "wind_speed": current.get("wind_speed"),
            "summary": current.get("weather", [{}])[0].get("description", ""),
            "condition": current.get("weather", [{}])[0].get("main", ""),
            "days": days
        }

    except Exception as e:
        logger.error(f"Error fetching weather: {e}")
        return {"ok": False, "reason": "internal_error"}

