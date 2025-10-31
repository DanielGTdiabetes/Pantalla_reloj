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

