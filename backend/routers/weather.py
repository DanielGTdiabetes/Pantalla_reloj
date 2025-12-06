"""
Router para endpoints de capas meteorológicas unificadas.
Soporta múltiples proveedores: Meteoblue (recomendado) y OpenWeatherMap (legacy).
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional
from pydantic import BaseModel

import requests
from fastapi import APIRouter, Body

from ..config_manager import ConfigManager
from ..secret_store import SecretStore
from ..services import rainviewer as rainviewer_service
from ..services import gibs as gibs_service
from ..services import cap_warnings as cap_warnings_service
from ..services.weather_service import weather_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/weather", tags=["weather"])
config_manager = ConfigManager()
secret_store = SecretStore()


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


@router.get("/weekly")
@router.get("/")
def get_weekly_forecast(lat: float = None, lon: float = None) -> Dict[str, Any]:
    """
    Obtiene previsión meteorológica semanal.
    Soporta múltiples proveedores: Meteoblue (recomendado) y OpenWeatherMap (legacy).
    
    Si no se proporcionan lat/lon, se usan los de la configuración.
    El proveedor se determina según la configuración (por defecto: Meteoblue).
    """
    # Resolve location
    config = config_manager.read()
    if lat is None or lon is None:
        # 1. Try Ephemerides location (usually the main device location)
        if config.ephemerides:
            lat = config.ephemerides.latitude
            lon = config.ephemerides.longitude
        
        # 2. Try Map center
        if (lat is None or lon is None) and config.ui_map and config.ui_map.fixed and config.ui_map.fixed.center:
            lat = config.ui_map.fixed.center.lat
            lon = config.ui_map.fixed.center.lon

        # Fallback if still missing
        if lat is None or lon is None:
            # Default to Vila-real (Castellón) if absolutely nothing is configured
            lat = 39.9378
            lon = -0.1014
    
    # Determinar proveedor
    provider = "meteoblue"
    if config.panels and config.panels.weatherWeekly:
        provider = config.panels.weatherWeekly.provider
    
    # Si el proveedor es Meteoblue, intentar usarlo
    if provider == "meteoblue":
        meteoblue_key = secret_store.get_secret("meteoblue_api_key")
        if meteoblue_key:
            logger.info("Using Meteoblue as weather provider")
            try:
                result = weather_service.get_weather(lat, lon, meteoblue_key)
                if result.get("ok"):
                    return result
                logger.warning(f"Meteoblue failed: {result.get('reason')}, falling back to OpenWeatherMap")
            except Exception as e:
                logger.error(f"Meteoblue error: {e}, falling back to OpenWeatherMap")
        else:
            logger.warning("Meteoblue selected but no API key found, falling back to OpenWeatherMap")
    
    # Fallback a OpenWeatherMap (o si está seleccionado explícitamente)
    openweather_key = secret_store.get_secret("openweathermap_api_key")
    if not openweather_key:
        # Si falló Meteoblue y no hay key de OWM, devolver error
        return {
            "ok": False, 
            "reason": "missing_api_key",
            "temperature": {"value": 20, "unit": "C"},
            "condition": "Clear",
            "summary": "Sin datos (Falta API Key)",
            "days": [],
            "provider": "none"
        }
    
    logger.info("Using OpenWeatherMap as weather provider")
    
    # Try One Call 3.0
    url = f"https://api.openweathermap.org/data/3.0/onecall?lat={lat}&lon={lon}&exclude=minutely,hourly&units=metric&appid={openweather_key}"
    
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 401:
            # Fallback to 2.5 One Call if 3.0 fails (some keys are old)
            url = f"https://api.openweathermap.org/data/2.5/onecall?lat={lat}&lon={lon}&exclude=minutely,hourly&units=metric&appid={openweather_key}"
            resp = requests.get(url, timeout=10)
        
        if resp.status_code != 200:
            return {"ok": False, "reason": f"upstream_error_{resp.status_code}", "provider": "openweathermap"}
        
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
            "provider": "openweathermap",
            "temperature": {
                "value": current.get("temp"),
                "unit": "C"
            },
            "humidity": current.get("humidity"),
            "feels_like": current.get("feels_like"),
            "wind_speed": current.get("wind_speed"),
            "summary": current.get("weather", [{}])[0].get("description", ""),
            "condition": current.get("weather", [{}])[0].get("main", ""),
            "days": days,
            "daily": days,  # Alias para compatibilidad
            "location": {"lat": lat, "lon": lon}
        }

    except Exception as e:
        logger.error(f"Error fetching weather from OpenWeatherMap: {e}")
        return {"ok": False, "reason": "internal_error", "provider": "openweathermap"}


class TestWeatherRequest(BaseModel):
    api_key: Optional[str] = None


@router.post("/test_meteoblue")
def test_meteoblue(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Prueba la conexión con Meteoblue usando la API key proporcionada o la guardada.
    Si la prueba es exitosa y se proporcionó una API key nueva, la guarda automáticamente.
    """
    api_key = payload.get("api_key")
    auto_save = payload.get("auto_save", True)  # Por defecto, guardar si el test es exitoso
    key_from_input = bool(api_key and api_key.strip())
    
    if key_from_input:
        api_key = api_key.strip()
        logger.info(f"Test Meteoblue: API key received in request body (len={len(api_key)})")
    else:
        logger.info("Test Meteoblue: No API key in request, checking secret store")
        api_key = secret_store.get_secret("meteoblue_api_key")
        if api_key:
            logger.info(f"Test Meteoblue: API key found in secret store (len={len(api_key)})")
        else:
            logger.warning(f"Test Meteoblue: No API key found in secret store. Store file: {secret_store._file}")
    
    if not api_key:
        return {"ok": False, "reason": "missing_api_key", "message": "Falta API Key. Introduce una API key en el campo y vuelve a probar."}
    
    # Resolve location for test
    lat = 40.4168
    lon = -3.7038
    
    try:
        config = config_manager.read()
        if config.ephemerides:
            lat = config.ephemerides.latitude
            lon = config.ephemerides.longitude
        elif config.ui_map and config.ui_map.fixed and config.ui_map.fixed.center:
            lat = config.ui_map.fixed.center.lat
            lon = config.ui_map.fixed.center.lon
    except Exception as e:
        logger.warning(f"Could not resolve config location for test: {e}")
    
    try:
        result = weather_service.get_weather(lat, lon, api_key)
        
        if result.get("ok"):
            # Si el test fue exitoso y la API key vino del input, guardarla automáticamente
            saved = False
            if key_from_input and auto_save:
                try:
                    secret_store.set_secret("meteoblue_api_key", api_key)
                    saved = True
                    logger.info("Test Meteoblue: API key guardada automáticamente tras test exitoso")
                except Exception as save_error:
                    logger.error(f"Test Meteoblue: Error al guardar API key: {save_error}")
            
            return {
                "ok": True,
                "message": "Conexión exitosa" + (" y API key guardada" if saved else ""),
                "saved": saved,
                "data": {
                    "temp": result.get("temperature", {}).get("value"),
                    "condition": result.get("condition"),
                    "location": f"{lat}, {lon}"
                }
            }
        else:
            reason = result.get("reason", "unknown_error")
            error_msg = result.get("error", "")
            
            # Proporcionar mensajes más claros según el error
            if reason == "api_request_failed":
                if "401" in str(error_msg) or "Unauthorized" in str(error_msg):
                    message = "API key inválida o no autorizada. Verifica que la API key sea correcta."
                elif "403" in str(error_msg):
                    message = "Acceso denegado. Tu plan de Meteoblue puede no tener acceso a esta API."
                else:
                    message = f"Error de conexión con Meteoblue: {error_msg}"
            elif reason == "missing_api_key":
                message = "Falta la API key de Meteoblue"
            else:
                message = result.get("summary") or f"Error en la respuesta de Meteoblue: {reason}"
            
            return {
                "ok": False, 
                "reason": reason, 
                "message": message
            }
    except Exception as e:
        logger.error(f"Error testing Meteoblue: {e}", exc_info=True)
        return {"ok": False, "reason": "internal_error", "message": f"Error interno: {str(e)}"}


@router.post("/test_openweathermap")
def test_openweathermap(request: TestWeatherRequest) -> Dict[str, Any]:
    """
    Prueba la conexión con OpenWeatherMap usando la API key proporcionada o la guardada.
    """
    api_key = request.api_key
    if not api_key:
        api_key = secret_store.get_secret("openweathermap_api_key")
    
    if not api_key:
        return {"ok": False, "reason": "missing_api_key", "message": "Falta API Key"}
    
    # Usar coordenadas por defecto (Madrid) para el test
    lat = 40.4168
    lon = -3.7038
    
    try:
        # Try One Call 3.0
        url = f"https://api.openweathermap.org/data/3.0/onecall?lat={lat}&lon={lon}&exclude=minutely,hourly&units=metric&appid={api_key}"
        
        resp = requests.get(url, timeout=10)
        if resp.status_code == 401:
            # Fallback to 2.5 One Call
            url = f"https://api.openweathermap.org/data/2.5/onecall?lat={lat}&lon={lon}&exclude=minutely,hourly&units=metric&appid={api_key}"
            resp = requests.get(url, timeout=10)
        
        if resp.status_code == 200:
            data = resp.json()
            current = data.get("current", {})
            weather = current.get("weather", [{}])[0]
            return {
                "ok": True,
                "message": "Conexión exitosa",
                "data": {
                    "temp": current.get("temp"),
                    "condition": weather.get("main"),
                    "location": f"{lat}, {lon}"
                }
            }
        else:
            return {
                "ok": False,
                "reason": f"upstream_error_{resp.status_code}",
                "message": f"Error {resp.status_code} de OpenWeatherMap"
            }
            
    except Exception as e:
        logger.error(f"Error testing OpenWeatherMap: {e}")
        return {"ok": False, "reason": "internal_error", "message": str(e)}
