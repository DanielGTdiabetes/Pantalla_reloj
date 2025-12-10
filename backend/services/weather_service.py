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
    1: "clear_day",              # Clear, cloudless sky
    2: "clear_day",              # Clear, few cirrus
    3: "clear_day",              # Clear with cirrus
    4: "clear_day",              # Clear with few low clouds
    5: "clear_day",              # Clear with few low clouds and cirrus
    6: "partly_cloudy",          # Partly cloudy
    7: "partly_cloudy",          # Partly cloudy and cirrus
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
    27: "clear_day",             # Fair skies
    28: "partly_cloudy",         # Mostly fair
    29: "rain",                  # Mostly cloudy with rain
    30: "snow",                  # Mostly cloudy with sleet
    31: "snow",                  # Mostly cloudy with snow
    32: "rain",                  # Mostly cloudy with thunderstorm
    33: "cloudy",                # Cloudy, no precipitation
    34: "rain",                  # Mostly cloudy with rain shower
    35: "snow",                  # Mostly cloudy with snow shower
}

conditions = {
    1: "Soleado",
    2: "Soleado",
    3: "Soleado",
    4: "Soleado",
    5: "Soleado",
    6: "Parcialmente nublado",
    7: "Parcialmente nublado",
    8: "Nublado",
    9: "Lluvia",
    10: "Lluvia ligera",
    11: "Lluvia con tormenta",
    12: "Lluvia intensa",
    13: "Nieve",
    14: "Nieve",
    15: "Nieve",
    16: "Nieve",
    17: "Chubasco",
    18: "Chubasco ligero",
    19: "Chubasco con tormenta",
    20: "Chubasco intenso con tormenta",
    21: "Nieve",
    22: "Nieve",
    23: "Nieve",
    24: "Nieve ligera",
    25: "Niebla",
    26: "Niebla",
    27: "Soleado",
    28: "Claro",
    29: "Lluvia",
    30: "Nieve",
    31: "Nieve",
    32: "Tormenta",
    33: "Nublado",
    34: "Lluvia",
    35: "Nieve",
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
    icon = PICTOCODE_TO_ICON.get(pictocode, "unknown")

    # Convertir variantes diurnas a nocturnas si es necesario
    if is_night:
        if icon == "clear_day":
            icon = "clear_night"
        elif icon == "partly_cloudy":
            icon = "partly_cloudy_night"

    return icon


def map_pictocode_to_condition(pictocode: int) -> str:
    """
    Mapea un pictocode a una descripción textual del clima.
    
    Args:
        pictocode: Código de Meteoblue (1-35)
    
    Returns:
        Descripción del clima en español
    """
    return conditions.get(pictocode, "Desconocido")


class WeatherService:
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
        
        # Seleccionar el índice horario más cercano a la hora actual (evita usar siempre el slot de medianoche)
        idx = 0
        times = data_1h.get("time") or []
        if times:
            try:
                tzinfo = None
                metadata = data.get("metadata") or {}
                tz_name = metadata.get("timezone")
                if tz_name:
                    try:
                        from zoneinfo import ZoneInfo
                        tzinfo = ZoneInfo(tz_name)
                    except Exception:
                        tzinfo = None

                now = datetime.now(tzinfo) if tzinfo else datetime.now()
                parsed_times = []
                for i, time_str in enumerate(times):
                    try:
                        dt = datetime.strptime(time_str, "%Y-%m-%d %H:%M")
                        if tzinfo:
                            dt = dt.replace(tzinfo=tzinfo)
                        parsed_times.append((i, dt))
                    except Exception:
                        continue

                if parsed_times:
                    # Filter for times that are in the future or very recent past (within last hour)
                    # This prevents showing "snow" from 3 AM when it's now 12 PM and sunny
                    filtered_times = [
                        (i, dt) for i, dt in parsed_times
                        if (dt - now).total_seconds() > -3600  # Allow up to 1 hour in the past
                    ]
                    
                    if filtered_times:
                        # Find the earliest time in the future/recent past
                        idx = min(filtered_times, key=lambda pair: pair[1])[0]
                    else:
                        # Fallback: if no future times, take the last available time
                        idx = parsed_times[-1][0]
                else:
                    # Fallback logic if parsing fails
                    current_hour = now.hour
                    idx = min(current_hour, len(times) - 1) if times else 0
            except Exception as err:  # noqa: BLE001
                self.logger.debug(f"Could not resolve current Meteoblue hour index: {err}")
        
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
        
        # Determinar si es de noche (simplificado: asumimos día)
        is_night = False
        if "time" in data_1h and len(data_1h["time"]) > idx:
            time_str = data_1h["time"][idx]
            try:
                # Format: "2023-11-30 12:00"
                hour = int(time_str.split()[1].split(":")[0])
                is_night = hour < 6 or hour >= 20
            except (IndexError, ValueError):
                pass
        
        icon = map_pictocode_to_icon(pictocode or 1, is_night)
        condition = map_pictocode_to_condition(pictocode or 1)

        # Normalizar valores numéricos
        temperature = round(temperature, 1) if isinstance(temperature, (int, float)) else temperature
        felt_temperature = round(felt_temperature, 1) if isinstance(felt_temperature, (int, float)) else felt_temperature
        windspeed = round(windspeed, 1) if isinstance(windspeed, (int, float)) else windspeed
        humidity = round(humidity) if isinstance(humidity, (int, float)) else humidity
        
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
            
            # Añadir nombre del día en español
            if day_data["date"]:
                try:
                    dt = datetime.fromisoformat(day_data["date"])
                    days_es = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
                    day_data["day_name"] = days_es[dt.weekday()]
                    day_data["dayName"] = days_es[dt.weekday()] # Frontend compatibility
                    day_data["day"] = days_es[dt.weekday()] # Alias requested
                except ValueError:
                    pass

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
                "pictocode": current.get("pictocode"),
                "summary": current["condition"],
                "daily": forecast,
                "days": forecast,  # Alias para compatibilidad
                "forecast": forecast, # Alias solicitado
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
weather_service = WeatherService()
