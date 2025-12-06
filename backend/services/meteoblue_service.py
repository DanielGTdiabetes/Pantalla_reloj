"""
Servicio para integración con Meteoblue API.
Proporciona datos meteorológicos actuales y pronóstico a 7 días.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

# Mapeo de pictocodes de Meteoblue a iconos internos
# Fuente: https://content.meteoblue.com/en/specifications/standards/symbols-and-pictograms
PICTOCODE_TO_ICON = {
    1: "clear-day",              # Clear, cloudless sky
    2: "partly-cloudy-day",      # Clear, few cirrus
    3: "partly-cloudy-day",      # Clear with cirrus
    4: "partly-cloudy-day",      # Clear with few low clouds
    5: "partly-cloudy-day",      # Clear with few low clouds and cirrus
    6: "cloudy",                 # Partly cloudy
    7: "cloudy",                 # Partly cloudy and cirrus
    8: "cloudy",                 # Mostly cloudy
    9: "rain",                   # Rain
    10: "rain",                  # Light rain
    11: "rain",                  # Rain with thunderstorm
    12: "rain",                  # Heavy rain with thunderstorm
    13: "snow",                  # Sleet
    14: "snow",                  # Light sleet
    15: "snow",                  # Snow
    16: "snow",                  # Light snow
    17: "rain",                  # Rain shower
    18: "rain",                  # Light rain shower
    19: "rain",                  # Rain shower with thunderstorm
    20: "rain",                  # Heavy rain shower with thunderstorm
    21: "snow",                  # Sleet shower
    22: "snow",                  # Light sleet shower
    23: "snow",                  # Snow shower
    24: "snow",                  # Light snow shower
    25: "fog",                   # Fog
    26: "fog",                   # Fog depositing rime
    27: "partly-cloudy-day",     # Fair skies
    28: "rain",                  # Mostly fair
    29: "rain",                  # Mostly cloudy with rain
    30: "snow",                  # Mostly cloudy with sleet
    31: "snow",                  # Mostly cloudy with snow
    32: "rain",                  # Mostly cloudy with thunderstorm
    33: "cloudy",                # Cloudy, no precipitation
    34: "rain",                  # Mostly cloudy with rain shower
    35: "snow",                  # Mostly cloudy with snow shower
}


def map_pictocode_to_icon(pictocode: int, is_night: bool = False) -> str:
    """
    Mapea un pictocode de Meteoblue a un nombre de icono interno.
    
    Args:
        pictocode: Código de Meteoblue (1-35)
        is_night: Si es de noche (para variantes nocturnas)
    
    Returns:
        Nombre del icono (ej: "clear-day", "rain", etc.)
    """
    icon = PICTOCODE_TO_ICON.get(pictocode, "cloudy")
    
    # Convertir variantes diurnas a nocturnas si es necesario
    if is_night:
        icon = icon.replace("-day", "-night")
    
    return icon


def map_pictocode_to_condition(pictocode: int) -> str:
    """
    Mapea un pictocode a una descripción textual del clima.
    
    Args:
        pictocode: Código de Meteoblue (1-35)
    
    Returns:
        Descripción del clima en español
    """
    conditions = {
        1: "Despejado",
        2: "Despejado",
        3: "Despejado",
        4: "Despejado",
        5: "Despejado",
        6: "Parcialmente nublado",
        7: "Parcialmente nublado",
        8: "Mayormente nublado",
        9: "Lluvia",
        10: "Lluvia ligera",
        11: "Lluvia con tormenta",
        12: "Lluvia intensa con tormenta",
        13: "Aguanieve",
        14: "Aguanieve ligera",
        15: "Nieve",
        16: "Nieve ligera",
        17: "Chubasco",
        18: "Chubasco ligero",
        19: "Chubasco con tormenta",
        20: "Chubasco intenso con tormenta",
        21: "Chubasco de aguanieve",
        22: "Chubasco ligero de aguanieve",
        23: "Chubasco de nieve",
        24: "Chubasco ligero de nieve",
        25: "Niebla",
        26: "Niebla con escarcha",
        27: "Cielos despejados",
        28: "Mayormente despejado",
        29: "Mayormente nublado con lluvia",
        30: "Mayormente nublado con aguanieve",
        31: "Mayormente nublado con nieve",
        32: "Mayormente nublado con tormenta",
        33: "Nublado sin precipitación",
        34: "Mayormente nublado con chubascos",
        35: "Mayormente nublado con chubascos de nieve",
    }
    return conditions.get(pictocode, "Desconocido")


class MeteoblueService:
    """
    Servicio para obtener datos meteorológicos de Meteoblue API.
    
    API Docs: https://docs.meteoblue.com/en/weather-apis/packages-api/basic-packages
    """
    
    BASE_URL = "https://my.meteoblue.com/packages/basic-1h_basic-day"
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Inicializa el servicio de Meteoblue.
        
        Args:
            api_key: API key de Meteoblue (opcional, se puede pasar en cada llamada)
        """
        self.api_key = api_key
        self.logger = logger
    
    def set_api_key(self, api_key: Optional[str]) -> None:
        """Actualiza la API key."""
        self.api_key = api_key
    
    def fetch_weather(
        self,
        lat: float,
        lon: float,
        api_key: Optional[str] = None,
        timeout: int = 10
    ) -> Dict[str, Any]:
        """
        Obtiene datos meteorológicos de Meteoblue.
        
        Args:
            lat: Latitud
            lon: Longitud
            api_key: API key (opcional, usa self.api_key si no se proporciona)
            timeout: Timeout para la petición HTTP
        
        Returns:
            Diccionario con los datos meteorológicos en formato Meteoblue
        
        Raises:
            requests.RequestException: Si falla la petición HTTP
            ValueError: Si la API key no está disponible
        """
        key = api_key or self.api_key
        if not key:
            raise ValueError("Meteoblue API key is required")
        
        params = {
            "lat": lat,
            "lon": lon,
            "apikey": key,
            "format": "json"
        }
        
        self.logger.info(f"Fetching Meteoblue weather for lat={lat}, lon={lon}")
        
        response = requests.get(
            self.BASE_URL,
            params=params,
            timeout=timeout
        )
        response.raise_for_status()
        
        data = response.json()
        self.logger.debug(f"Meteoblue response keys: {list(data.keys())}")
        
        return data
    
    def parse_current_weather(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extrae el clima actual de la respuesta de Meteoblue.
        
        Args:
            data: Respuesta JSON de Meteoblue
        
        Returns:
            Diccionario con datos del clima actual normalizados
        """
        data_1h = data.get("data_1h", {})
        times = data_1h.get("time", [])
        
        # Encontrar el índice más cercano a la hora actual
        idx = 0
        now = datetime.now()
        best_diff = float("inf")
        
        for i, time_str in enumerate(times):
            try:
                # Format: "2023-11-30 12:00"
                # Meteoblue suele devolver hora local del lugar solicitado
                t = datetime.strptime(time_str, "%Y-%m-%d %H:%M")
                diff = abs((t - now).total_seconds())
                
                if diff < best_diff:
                    best_diff = diff
                    idx = i
            except (ValueError, TypeError):
                continue
        
        temperature = None
        pictocode = None
        windspeed = None
        humidity = None
        felt_temperature = None
        
        if "temperature" in data_1h and len(data_1h["temperature"]) > idx:
            temperature = data_1h["temperature"][idx]
        
        if "pictocode" in data_1h and len(data_1h["pictocode"]) > idx:
            pictocode = data_1h["pictocode"][idx]
        
        if "windspeed" in data_1h and len(data_1h["windspeed"]) > idx:
            windspeed = data_1h["windspeed"][idx]
        
        if "relativehumidity" in data_1h and len(data_1h["relativehumidity"]) > idx:
            humidity = data_1h["relativehumidity"][idx]
        
        if "felttemperature" in data_1h and len(data_1h["felttemperature"]) > idx:
            felt_temperature = data_1h["felttemperature"][idx]
        
        # Determinar si es de noche
        is_night = False
        if len(times) > idx:
            try:
                # Format: "2023-11-30 12:00"
                time_str = times[idx]
                hour = int(time_str.split()[1].split(":")[0])
                is_night = hour < 6 or hour >= 20
            except (IndexError, ValueError):
                pass
        
        icon = map_pictocode_to_icon(pictocode or 1, is_night)
        condition = map_pictocode_to_condition(pictocode or 1)
        
        return {
            "temperature": temperature,
            "temperature_unit": "C",
            "felt_temperature": felt_temperature,
            "humidity": humidity,
            "wind_speed": windspeed,
            "wind_speed_unit": "km/h",
            "condition": condition,
            "icon": icon,
            "pictocode": pictocode,
        }
    
    def parse_forecast(self, data: Dict[str, Any], days: int = 7) -> list[Dict[str, Any]]:
        """
        Extrae el pronóstico de varios días de la respuesta de Meteoblue.
        
        Args:
            data: Respuesta JSON de Meteoblue
            days: Número de días a incluir (máximo disponible)
        
        Returns:
            Lista de diccionarios con pronóstico diario
        """
        data_day = data.get("data_day", {})
        
        times = data_day.get("time", [])
        temp_max = data_day.get("temperature_max", [])
        temp_min = data_day.get("temperature_min", [])
        precip_prob = data_day.get("precipitation_probability", [])
        pictocodes = data_day.get("pictocode", [])
        
        forecast = []
        max_days = min(days, len(times))
        
        for i in range(max_days):
            day_data = {
                "date": times[i] if i < len(times) else None,
                "temp_max": temp_max[i] if i < len(temp_max) else None,
                "temp_min": temp_min[i] if i < len(temp_min) else None,
                "precipitation_probability": precip_prob[i] if i < len(precip_prob) else None,
                "pictocode": pictocodes[i] if i < len(pictocodes) else None,
            }
            
            # Añadir icono y condición
            if day_data["pictocode"] is not None:
                day_data["icon"] = map_pictocode_to_icon(day_data["pictocode"])
                day_data["condition"] = map_pictocode_to_condition(day_data["pictocode"])
            else:
                day_data["icon"] = "cloudy"
                day_data["condition"] = "Desconocido"
            
            forecast.append(day_data)
        
        return forecast
    
    def get_weather(
        self,
        lat: float,
        lon: float,
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Obtiene clima actual y pronóstico en un formato compatible con el frontend.
        
        Esta función devuelve exactamente el mismo formato que se usaba con OpenWeatherMap,
        permitiendo que el frontend siga funcionando sin cambios.
        
        Args:
            lat: Latitud
            lon: Longitud
            api_key: API key de Meteoblue (opcional)
        
        Returns:
            Diccionario con estructura compatible con el formato anterior:
            {
                "ok": bool,
                "provider": "meteoblue",
                "temperature": {"value": float, "unit": "C"},
                "humidity": int,
                "wind_speed": float,
                "felt_temperature": float,
                "condition": str,
                "icon": str,
                "daily": [{"date": str, "temp_max": float, "temp_min": float, ...}],
                "location": {"lat": float, "lon": float}
            }
        """
        try:
            data = self.fetch_weather(lat, lon, api_key)
            current = self.parse_current_weather(data)
            forecast = self.parse_forecast(data, days=7)
            
            return {
                "ok": True,
                "provider": "meteoblue",
                "temperature": {
                    "value": current["temperature"],
                    "unit": current["temperature_unit"]
                },
                "humidity": current["humidity"],
                "wind_speed": current["wind_speed"],
                "felt_temperature": current["felt_temperature"],
                "condition": current["condition"],
                "icon": current["icon"],
                "summary": current["condition"],
                "daily": forecast,
                "days": forecast,  # Alias para compatibilidad
                "location": {"lat": lat, "lon": lon}
            }
        
        except requests.RequestException as e:
            self.logger.error(f"Meteoblue API request failed: {e}")
            return {
                "ok": False,
                "reason": "api_request_failed",
                "error": str(e),
                "provider": "meteoblue"
            }
        
        except ValueError as e:
            self.logger.error(f"Meteoblue API configuration error: {e}")
            return {
                "ok": False,
                "reason": "missing_api_key",
                "error": str(e),
                "provider": "meteoblue"
            }
        
        except Exception as e:
            self.logger.error(f"Unexpected error in Meteoblue service: {e}")
            return {
                "ok": False,
                "reason": "internal_error",
                "error": str(e),
                "provider": "meteoblue"
            }


# Instancia global del servicio (se configurará en main.py)
meteoblue_service = MeteoblueService()
