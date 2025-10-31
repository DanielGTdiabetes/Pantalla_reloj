"""Proveedores de datos para capas de Flights y Ships."""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

logger_path = Path("/var/log/pantalla/backend.log")
if logger_path.exists():
    import logging
    logger = logging.getLogger(__name__)
else:
    import sys
    logger = logging.getLogger(__name__)
    logger.addHandler(logging.StreamHandler(sys.stdout))


class FlightProvider(ABC):
    """Interfaz abstracta para proveedores de datos de vuelos."""
    
    @abstractmethod
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene datos de vuelos en formato GeoJSON FeatureCollection.
        
        Args:
            bounds: (min_lon, min_lat, max_lon, max_lat) opcional
            since: Fecha desde la cual obtener datos (opcional)
            
        Returns:
            GeoJSON FeatureCollection con puntos de vuelos
        """
        pass


class ShipProvider(ABC):
    """Interfaz abstracta para proveedores de datos AIS."""
    
    @abstractmethod
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene datos de barcos en formato GeoJSON FeatureCollection.
        
        Args:
            bounds: (min_lon, min_lat, max_lon, max_lat) opcional
            since: Fecha desde la cual obtener datos (opcional)
            
        Returns:
            GeoJSON FeatureCollection con puntos de barcos
        """
        pass


class OpenSkyFlightProvider(FlightProvider):
    """Proveedor de datos de vuelos usando OpenSky Network."""
    
    def __init__(self, username: Optional[str] = None, password: Optional[str] = None):
        self.username = username
        self.password = password
        self.base_url = "https://opensky-network.org/api"
        
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene vuelos de OpenSky Network."""
        try:
            url = f"{self.base_url}/states/all"
            params = {}
            auth = None
            
            if bounds:
                # OpenSky usa (min_lat, max_lat, min_lon, max_lon)
                min_lat, min_lon, max_lat, max_lon = bounds[1], bounds[0], bounds[3], bounds[2]
                params["lamin"] = min_lat
                params["lamax"] = max_lat
                params["lomin"] = min_lon
                params["lomax"] = max_lon
            
            # Si hay credenciales, usar autenticación
            if self.username and self.password:
                auth = (self.username, self.password)
            
            response = requests.get(url, params=params, auth=auth, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            if "states" not in data or not data["states"]:
                return {"type": "FeatureCollection", "features": []}
            
            features = []
            now = datetime.now(timezone.utc)
            
            for state in data["states"]:
                if len(state) < 17:
                    continue
                
                # Campos según OpenSky API:
                # 0: icao24, 1: callsign, 2: origin_country, 3: time_position
                # 4: last_contact, 5: longitude, 6: latitude, 7: baro_altitude
                # 8: on_ground, 9: velocity, 10: true_track, 11: vertical_rate
                # 12: sensors, 13: geo_altitude, 14: squawk, 15: spi, 16: position_source
                
                icao24 = state[0] or ""
                callsign = (state[1] or "").strip()
                longitude = state[5]
                latitude = state[6]
                baro_altitude = state[7]
                velocity = state[9]  # m/s
                true_track = state[10]  # grados
                last_contact = state[4]
                
                if not (latitude and longitude and abs(latitude) <= 90 and abs(longitude) <= 180):
                    continue
                
                # Calcular timestamp
                timestamp = last_contact if last_contact else int(now.timestamp())
                
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [longitude, latitude]
                    },
                    "properties": {
                        "icao24": icao24,
                        "callsign": callsign,
                        "alt_baro": baro_altitude if baro_altitude else None,
                        "track": true_track if true_track else 0,
                        "speed": velocity if velocity else 0,
                        "timestamp": timestamp
                    }
                })
            
            return {
                "type": "FeatureCollection",
                "features": features
            }
        except Exception as exc:
            logger.error("OpenSkyFlightProvider fetch failed: %s", exc)
            return {"type": "FeatureCollection", "features": []}


class AviationStackFlightProvider(FlightProvider):
    """Proveedor de datos de vuelos usando AviationStack API."""
    
    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None):
        self.base_url = base_url or "http://api.aviationstack.com/v1"
        self.api_key = api_key
        
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene vuelos de AviationStack API."""
        if not self.api_key:
            logger.warning("AviationStackFlightProvider: api_key not configured")
            return {"type": "FeatureCollection", "features": []}
        
        try:
            url = f"{self.base_url}/flights"
            params = {"access_key": self.api_key, "limit": 100}
            
            if bounds:
                # AviationStack acepta bbox como string "lat1,lon1,lat2,lon2"
                min_lon, min_lat, max_lon, max_lat = bounds
                params["bbox"] = f"{min_lat},{min_lon},{max_lat},{max_lon}"
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            if "data" not in data or not data["data"]:
                return {"type": "FeatureCollection", "features": []}
            
            features = []
            now = datetime.now(timezone.utc).timestamp()
            
            for flight in data["data"]:
                if not flight.get("live"):
                    continue
                
                latitude = flight.get("latitude")
                longitude = flight.get("longitude")
                
                if not (latitude and longitude and abs(latitude) <= 90 and abs(longitude) <= 180):
                    continue
                
                # Obtener información del vuelo
                flight_info = flight.get("flight", {})
                airline = flight_info.get("iata") or flight_info.get("icao") or ""
                number = flight_info.get("number", "")
                callsign = f"{airline}{number}" if airline and number else ""
                
                # Obtener dirección (track)
                direction = flight.get("direction") or 0
                
                # Obtener velocidad (en km/h, convertir a m/s)
                speed_kmh = flight.get("speed", {}).get("horizontal") or 0
                speed_ms = speed_kmh / 3.6  # km/h a m/s
                
                # Obtener altitud (en metros)
                altitude_m = flight.get("altitude", {}) or 0
                if isinstance(altitude_m, dict):
                    altitude_m = altitude_m.get("meters") or 0
                
                # Timestamp
                updated = flight.get("updated")
                if updated:
                    try:
                        # Intentar parsear timestamp ISO
                        if isinstance(updated, str):
                            try:
                                # Intentar fromisoformat (Python 3.7+)
                                dt = datetime.fromisoformat(updated.replace('Z', '+00:00'))
                                timestamp = int(dt.timestamp())
                            except:
                                # Si falla, usar timestamp actual
                                timestamp = int(now)
                        else:
                            timestamp = int(now)
                    except:
                        timestamp = int(now)
                else:
                    timestamp = int(now)
                
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(longitude), float(latitude)]
                    },
                    "properties": {
                        "icao24": flight.get("aircraft", {}).get("registration", ""),
                        "callsign": callsign,
                        "alt_baro": altitude_m if altitude_m else None,
                        "track": direction,
                        "speed": speed_ms,
                        "timestamp": timestamp
                    }
                })
            
            return {
                "type": "FeatureCollection",
                "features": features
            }
        except Exception as exc:
            logger.error("AviationStackFlightProvider fetch failed: %s", exc)
            return {"type": "FeatureCollection", "features": []}


class GenericAISProvider(ShipProvider):
    """Proveedor genérico de datos AIS (barcos).
    
    Por ahora devuelve datos de demo si no hay configuración.
    En producción, se puede conectar a un servicio AIS real.
    """
    
    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        demo_enabled: bool = True
    ):
        self.api_url = api_url
        self.api_key = api_key
        self.demo_enabled = demo_enabled
        
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene datos de barcos."""
        # Si hay URL configurada, intentar fetch real
        if self.api_url:
            try:
                headers = {}
                if self.api_key:
                    headers["Authorization"] = f"Bearer {self.api_key}"
                
                params = {}
                if bounds:
                    params["bbox"] = f"{bounds[0]},{bounds[1]},{bounds[2]},{bounds[3]}"
                
                response = requests.get(self.api_url, headers=headers, params=params, timeout=10)
                response.raise_for_status()
                
                data = response.json()
                
                # Esperar GeoJSON FeatureCollection
                if data.get("type") == "FeatureCollection":
                    return data
                    
            except Exception as exc:
                logger.warning("GenericAISProvider fetch failed: %s", exc)
        
        # Fallback: datos de demo (solo si está habilitado)
        if self.demo_enabled:
            return self._demo_data()
        
        return {"type": "FeatureCollection", "features": []}
    
    def _demo_data(self) -> Dict[str, Any]:
        """Datos de demostración de barcos cerca de Castellón/Vila-real."""
        # Zona del Mediterráneo cerca de Castellón
        base_lat = 39.986
        base_lng = -0.051
        
        # Generar algunos barcos de ejemplo en la zona
        import random
        now = int(datetime.now(timezone.utc).timestamp())
        
        features = []
        for i in range(3):
            # Posición aleatoria en un radio de ~50km
            offset_lat = random.uniform(-0.5, 0.5)
            offset_lng = random.uniform(-0.5, 0.5)
            
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [base_lng + offset_lng, base_lat + offset_lat]
                },
                "properties": {
                    "mmsi": f"24000{1000 + i}",
                    "name": f"SHIP_{i+1}",
                    "course": random.uniform(0, 360),
                    "speed": random.uniform(5, 25),  # knots
                    "timestamp": now,
                    "type": "Cargo"
                }
            })
        
        return {
            "type": "FeatureCollection",
            "features": features
        }


class AISStreamProvider(ShipProvider):
    """Proveedor de datos AIS usando AISStream API (WebSocket o REST)."""
    
    def __init__(self, ws_url: Optional[str] = None, api_key: Optional[str] = None):
        self.ws_url = ws_url
        self.api_key = api_key
        self.rest_url = None
        # Si ws_url es una URL REST, usarla directamente
        if ws_url and not ws_url.startswith("ws"):
            self.rest_url = ws_url
    
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene datos de barcos desde AISStream."""
        # Por ahora, solo soportamos REST (WebSocket requiere conexión persistente)
        if not self.rest_url and not self.ws_url:
            logger.warning("AISStreamProvider: no URL configured")
            return {"type": "FeatureCollection", "features": []}
        
        url = self.rest_url or self.ws_url.replace("ws://", "http://").replace("wss://", "https://")
        
        try:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            params = {}
            if bounds:
                params["bbox"] = f"{bounds[0]},{bounds[1]},{bounds[2]},{bounds[3]}"
            
            response = requests.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            # Esperar GeoJSON FeatureCollection
            if data.get("type") == "FeatureCollection":
                return data
            
            # Si devuelve otro formato, intentar convertir
            features = []
            if isinstance(data, dict) and "vessels" in data:
                # Formato alternativo de AISStream
                now = int(datetime.now(timezone.utc).timestamp())
                for vessel in data.get("vessels", []):
                    lat = vessel.get("lat")
                    lon = vessel.get("lon")
                    if lat and lon and abs(lat) <= 90 and abs(lon) <= 180:
                        features.append({
                            "type": "Feature",
                            "geometry": {
                                "type": "Point",
                                "coordinates": [float(lon), float(lat)]
                            },
                            "properties": {
                                "mmsi": str(vessel.get("mmsi", "")),
                                "name": vessel.get("name", ""),
                                "course": vessel.get("course", 0),
                                "speed": vessel.get("speed", 0),
                                "timestamp": vessel.get("timestamp", now),
                                "type": vessel.get("type", "Unknown")
                            }
                        })
                
                return {
                    "type": "FeatureCollection",
                    "features": features
                }
            
            return {"type": "FeatureCollection", "features": []}
        except Exception as exc:
            logger.error("AISStreamProvider fetch failed: %s", exc)
            return {"type": "FeatureCollection", "features": []}


class AISHubProvider(ShipProvider):
    """Proveedor de datos AIS usando AISHub API."""
    
    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None):
        self.base_url = base_url or "https://www.aishub.net/api"
        self.api_key = api_key
    
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene datos de barcos desde AISHub."""
        if not self.api_key:
            logger.warning("AISHubProvider: api_key not configured")
            return {"type": "FeatureCollection", "features": []}
        
        try:
            url = f"{self.base_url}/v2/latest"
            params = {"key": self.api_key, "format": "json"}
            
            if bounds:
                min_lon, min_lat, max_lon, max_lat = bounds
                params["lat1"] = min_lat
                params["lon1"] = min_lon
                params["lat2"] = max_lat
                params["lon2"] = max_lon
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            if "data" not in data or not data["data"]:
                return {"type": "FeatureCollection", "features": []}
            
            features = []
            now = int(datetime.now(timezone.utc).timestamp())
            
            for vessel in data["data"]:
                lat = vessel.get("LAT")
                lon = vessel.get("LON")
                
                if not (lat and lon and abs(lat) <= 90 and abs(lon) <= 180):
                    continue
                
                mmsi = str(vessel.get("MMSI", ""))
                name = vessel.get("NAME", "").strip()
                course = vessel.get("COURSE") or 0
                speed = vessel.get("SPEED") or 0  # knots
                timestamp = vessel.get("TIME") or now
                
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(lon), float(lat)]
                    },
                    "properties": {
                        "mmsi": mmsi,
                        "name": name,
                        "course": course,
                        "speed": speed,
                        "timestamp": timestamp,
                        "type": vessel.get("TYPE", "Unknown")
                    }
                })
            
            return {
                "type": "FeatureCollection",
                "features": features
            }
        except Exception as exc:
            logger.error("AISHubProvider fetch failed: %s", exc)
            return {"type": "FeatureCollection", "features": []}


class CustomFlightProvider(FlightProvider):
    """Proveedor custom de datos de vuelos (acepta URL externa)."""
    
    def __init__(self, api_url: Optional[str] = None, api_key: Optional[str] = None):
        self.api_url = api_url
        self.api_key = api_key
        
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene vuelos de una URL custom."""
        if not self.api_url:
            logger.warning("CustomFlightProvider: api_url not configured")
            return {"type": "FeatureCollection", "features": []}
        
        try:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            params = {}
            if bounds:
                # Pasar bbox como parámetros
                min_lon, min_lat, max_lon, max_lat = bounds
                params["bbox"] = f"{min_lon},{min_lat},{max_lon},{max_lat}"
                # También pasar como parámetros individuales para compatibilidad
                params["min_lon"] = min_lon
                params["min_lat"] = min_lat
                params["max_lon"] = max_lon
                params["max_lat"] = max_lat
            
            response = requests.get(self.api_url, headers=headers, params=params, timeout=15)
            response.raise_for_status()
            
            data = response.json()
            
            # Esperar GeoJSON FeatureCollection
            if data.get("type") == "FeatureCollection":
                return data
            
            # Si viene otro formato, intentar convertir (por ahora, devolver vacío)
            logger.warning("CustomFlightProvider: Response is not GeoJSON FeatureCollection")
            return {"type": "FeatureCollection", "features": []}
            
        except Exception as exc:
            logger.error("CustomFlightProvider fetch failed: %s", exc)
            return {"type": "FeatureCollection", "features": []}


class CustomShipProvider(ShipProvider):
    """Proveedor custom de datos de barcos (acepta URL externa)."""
    
    def __init__(self, api_url: Optional[str] = None, api_key: Optional[str] = None):
        self.api_url = api_url
        self.api_key = api_key
        
    def fetch(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        since: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Obtiene barcos de una URL custom."""
        if not self.api_url:
            logger.warning("CustomShipProvider: api_url not configured")
            return {"type": "FeatureCollection", "features": []}
        
        try:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            params = {}
            if bounds:
                # Pasar bbox como parámetros
                min_lon, min_lat, max_lon, max_lat = bounds
                params["bbox"] = f"{min_lon},{min_lat},{max_lon},{max_lat}"
                # También pasar como parámetros individuales para compatibilidad
                params["min_lon"] = min_lon
                params["min_lat"] = min_lat
                params["max_lon"] = max_lon
                params["max_lat"] = max_lat
            
            response = requests.get(self.api_url, headers=headers, params=params, timeout=15)
            response.raise_for_status()
            
            data = response.json()
            
            # Esperar GeoJSON FeatureCollection
            if data.get("type") == "FeatureCollection":
                return data
            
            # Si viene otro formato, intentar convertir (por ahora, devolver vacío)
            logger.warning("CustomShipProvider: Response is not GeoJSON FeatureCollection")
            return {"type": "FeatureCollection", "features": []}
            
        except Exception as exc:
            logger.error("CustomShipProvider fetch failed: %s", exc)
            return {"type": "FeatureCollection", "features": []}

