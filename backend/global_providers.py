"""Proveedores de datos para capas globales (satélite y radar)."""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests

logger_path = Path("/var/log/pantalla/backend.log")
if logger_path.exists():
    import logging
    logger = logging.getLogger(__name__)
else:
    import sys
    logger = logging.getLogger(__name__)
    logger.addHandler(logging.StreamHandler(sys.stdout))


class GIBSProvider:
    """Proveedor de datos de satélite usando NASA GIBS (Global Imagery Browse Services)."""
    
    BASE_URL = "https://gibs.earthdata.nasa.gov"
    
    def __init__(self):
        self.base_url = self.BASE_URL
    
    def get_available_frames(
        self,
        history_minutes: int = 90,
        frame_step: int = 10
    ) -> List[Dict[str, Any]]:
        """Obtiene lista de frames disponibles de satélite.
        
        Args:
            history_minutes: Minutos de historia a buscar
            frame_step: Intervalo entre frames en minutos
            
        Returns:
            Lista de dicts con timestamp y URL base para tiles
        """
        frames = []
        now = datetime.now(timezone.utc)
        
        # GIBS tiene frames cada 10 minutos aproximadamente
        # Generar lista de timestamps disponibles
        start_time = now - timedelta(minutes=history_minutes)
        current = start_time
        
        # Redondear al frame más cercano (GIBS frames en horas:10, :20, :30, etc.)
        current_minute = current.minute
        rounded_minute = (current_minute // 10) * 10
        current = current.replace(minute=rounded_minute, second=0, microsecond=0)
        
        while current <= now:
            timestamp = int(current.timestamp())
            frames.append({
                "timestamp": timestamp,
                "iso": current.isoformat(),
                "url_base": f"{self.base_url}/wmts/epsg3857/best/Modis_Terra_TrueColor/default"
            })
            current += timedelta(minutes=frame_step)
        
        return frames
    
    def get_tile_url(
        self,
        timestamp: int,
        z: int,
        x: int,
        y: int,
        layer: str = "Modis_Terra_TrueColor"
    ) -> str:
        """Genera URL de tile para GIBS.
        
        Args:
            timestamp: Unix timestamp
            z: Zoom level
            x: Tile X
            y: Tile Y
            layer: Nombre de capa GIBS
            
        Returns:
            URL del tile
        """
        # GIBS usa WMTS con formato:
        # /wmts/epsg3857/best/{layer}/default/{timestamp}/{z}/{y}/{x}.jpg
        dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        date_str = dt.strftime("%Y-%m-%d")
        
        # Para simplicidad, usar el formato más común de GIBS
        return f"{self.base_url}/wmts/epsg3857/best/{layer}/default/{date_str}/{z}/{y}/{x}.jpg"


class RainViewerProvider:
    """Proveedor de datos de radar usando RainViewer API."""
    
    BASE_URL = "https://api.rainviewer.com"
    
    def __init__(self):
        self.base_url = self.BASE_URL
    
    def get_available_frames(
        self,
        history_minutes: int = 90,
        frame_step: int = 5
    ) -> List[Dict[str, Any]]:
        """Obtiene lista de frames disponibles de radar.
        
        Args:
            history_minutes: Minutos de historia a buscar
            frame_step: Intervalo entre frames en minutos
            
        Returns:
            Lista de dicts con timestamp y path para tiles
        """
        # Intentar con reintentos (2 reintentos)
        max_retries = 2
        for attempt in range(max_retries + 1):
            try:
                # RainViewer API: GET /public/weather-maps.json
                url = f"{self.base_url}/public/weather-maps.json"
                response = requests.get(url, timeout=10)
                response.raise_for_status()
                break
            except requests.RequestException as e:
                if attempt < max_retries:
                    logger.warning(f"RainViewer API attempt {attempt + 1} failed: {e}, retrying...")
                    time.sleep(0.5)  # Esperar medio segundo antes de reintentar
                    continue
                else:
                    logger.error(f"RainViewer API failed after {max_retries + 1} attempts: {e}")
                    return []
        
        try:
            data = response.json()
            
            # RainViewer v4: verificar estructura
            if "radar" not in data:
                logger.warning("RainViewer API: no 'radar' key found")
                return []
            
            radar_data = data["radar"]
            
            # Combinar past y nowcast (ambos pueden ser arrays de ints o arrays de dicts)
            past_frames = radar_data.get("past", [])
            nowcast_frames = radar_data.get("nowcast", [])
            
            # Extraer timestamps de ambos arrays
            all_timestamps = []
            
            # Procesar past
            for item in past_frames:
                if isinstance(item, (int, float)):
                    all_timestamps.append(int(item))
                elif isinstance(item, dict):
                    timestamp = item.get("time")
                    if timestamp is not None:
                        all_timestamps.append(int(timestamp))
            
            # Procesar nowcast
            for item in nowcast_frames:
                if isinstance(item, (int, float)):
                    all_timestamps.append(int(item))
                elif isinstance(item, dict):
                    timestamp = item.get("time")
                    if timestamp is not None:
                        all_timestamps.append(int(timestamp))
            
            if not all_timestamps:
                logger.warning("RainViewer API: no valid timestamps found")
                return []
            
            # Eliminar duplicados y ordenar
            all_timestamps = sorted(set(all_timestamps))
            
            # Filtrar por history_minutes y frame_step
            now = datetime.now(timezone.utc)
            cutoff_time = now - timedelta(minutes=history_minutes)
            
            frames = []
            for timestamp in all_timestamps:
                # timestamp es un Unix timestamp (int)
                frame_time = datetime.fromtimestamp(timestamp, tz=timezone.utc)
                
                # Filtrar por tiempo
                if frame_time < cutoff_time:
                    continue
                
                # Filtrar por frame_step (submuestreo)
                if frame_step > 1:
                    minutes_diff = (now - frame_time).total_seconds() / 60
                    # Redondear al frame_step más cercano
                    rounded_minutes = round(minutes_diff / frame_step) * frame_step
                    if abs(minutes_diff - rounded_minutes) > frame_step / 2:
                        continue
                
                frames.append({
                    "timestamp": timestamp,
                    "iso": frame_time.isoformat(),
                })
            
            # Ordenar por timestamp (ascendente)
            frames.sort(key=lambda f: f["timestamp"])
            
            return frames
        except Exception as exc:
            logger.error("RainViewerProvider get_available_frames failed: %s", exc)
            return []
    
    def get_tile_url(
        self,
        timestamp: int,
        z: int,
        x: int,
        y: int,
        color: int = 4,
        smooth: int = 1,
        snow: int = 0
    ) -> str:
        """Genera URL de tile para RainViewer.
        
        Args:
            timestamp: Unix timestamp del frame
            z: Zoom level
            x: Tile X
            y: Tile Y
            color: Esquema de color (1-12, default 4 = clásico)
            smooth: Suavizado (0 o 1)
            snow: Incluir nieve (0 o 1)
            
        Returns:
            URL del tile
        """
        # RainViewer v4 tile format:
        # https://tilecache.rainviewer.com/v2/radar/{timestamp}/256/{z}/{x}/{y}/2/1_1.png
        # Usamos el formato estándar de tilecache
        return f"https://tilecache.rainviewer.com/v2/radar/{timestamp}/256/{z}/{x}/{y}/2/1_1.png"
    
    def get_radar_data_for_focus(
        self,
        bounds: Optional[Tuple[float, float, float, float]] = None,
        threshold_dbz: float = 30.0
    ) -> Dict[str, Any]:
        """Obtiene datos de radar para construcción de máscara de foco.
        
        Nota: Por ahora retorna metadatos. El procesamiento real de tiles
        para generar contornos requiere procesamiento de imagen que se
        implementará en build_radar_mask.
        
        Args:
            bounds: (min_lon, min_lat, max_lon, max_lat) opcional
            threshold_dbz: Umbral de dBZ
            
        Returns:
            Dict con metadatos de radar para procesamiento
        """
        try:
            frames = self.get_available_frames(history_minutes=90, frame_step=5)
            if not frames:
                return {"type": "radar_metadata", "frames": []}
            
            # Obtener el frame más reciente
            latest_frame = frames[-1] if frames else None
            
            return {
                "type": "radar_metadata",
                "provider": "rainviewer",
                "latest_timestamp": latest_frame["timestamp"] if latest_frame else None,
                "frames_count": len(frames),
                "bounds": bounds,
                "threshold_dbz": threshold_dbz,
                "tile_base_url": self.base_url
            }
        except Exception as exc:
            logger.error("RainViewerProvider get_radar_data_for_focus failed: %s", exc)
            return {"type": "radar_metadata", "frames": []}


class OpenWeatherMapApiKeyError(RuntimeError):
    """Raised when an OpenWeatherMap operation requires an API key but it is missing."""


class OpenWeatherMapRadarProvider:
    """Proveedor de capas globales utilizando los tiles de OpenWeatherMap.
    
    Soporta múltiples tipos de capas meteorológicas:
    - precipitation_new: Precipitación (por defecto)
    - precipitation: Precipitación (legacy)
    - temp_new: Temperatura
    - clouds: Nubes
    - rain: Lluvia
    - wind: Viento
    - pressure: Presión
    """

    BASE_URL = "https://tile.openweathermap.org/map"
    DEFAULT_LAYER = "precipitation_new"
    
    # Capas disponibles según la documentación de OpenWeatherMap
    VALID_LAYERS = {
        "precipitation_new",
        "precipitation",
        "temp_new",
        "clouds",
        "rain",
        "wind",
        "pressure",
    }

    def __init__(
        self,
        api_key_resolver: Callable[[], Optional[str]],
        layer: Optional[str] = None,
    ) -> None:
        self._api_key_resolver = api_key_resolver
        candidate_layer = (layer or self.DEFAULT_LAYER).strip() or self.DEFAULT_LAYER
        # Validar que la capa esté en la lista de capas válidas
        if candidate_layer not in self.VALID_LAYERS:
            candidate_layer = self.DEFAULT_LAYER
        self._layer = candidate_layer

    def resolve_api_key(self) -> Optional[str]:
        value = self._api_key_resolver()
        if not value:
            return None
        trimmed = value.strip()
        return trimmed or None

    def get_available_frames(
        self,
        history_minutes: int = 90,
        frame_step: int = 5,
    ) -> List[Dict[str, Any]]:
        """Genera una lista sintética de frames disponibles.

        OpenWeatherMap no expone un timeline real, así que fabricamos timestamps
        estables basados en el `frame_step` configurado para favorecer el caché.
        """

        if frame_step <= 0:
            frame_step = 5
        step_seconds = max(frame_step * 60, 60)
        anchor_ts = int(time.time())
        anchor_ts -= anchor_ts % step_seconds
        anchor_dt = datetime.fromtimestamp(anchor_ts, tz=timezone.utc)

        # Aunque podríamos generar varios frames, mantener uno simplifica la integración
        return [
            {
                "timestamp": anchor_ts,
                "iso": anchor_dt.isoformat(),
            }
        ]

    def get_tile_url(self, timestamp: int, z: int, x: int, y: int) -> str:
        """Devuelve la URL del tile ignorando el timestamp solicitado."""

        api_key = self.resolve_api_key()
        if not api_key:
            raise OpenWeatherMapApiKeyError("OWM API key missing")
        return f"{self.BASE_URL}/{self._layer}/{z}/{x}/{y}.png?appid={api_key}"


class AEMETSatelliteProvider:
    """Proveedor placeholder para tiles de satélite AEMET.
    
    Nota: Por ahora es un placeholder. En el futuro se implementará
    la obtención de tiles de satélite desde AEMET OpenData.
    """
    
    BASE_URL = "https://opendata.aemet.es"  # URL base de AEMET OpenData
    
    def __init__(self):
        self.base_url = self.BASE_URL
    
    def get_available_frames(
        self,
        history_minutes: int = 90,
        frame_step: int = 10
    ) -> List[Dict[str, Any]]:
        """Placeholder: retorna lista vacía por ahora.
        
        Args:
            history_minutes: Minutos de historia a buscar
            frame_step: Intervalo entre frames en minutos
            
        Returns:
            Lista vacía (placeholder)
        """
        # TODO: Implementar obtención de frames desde AEMET OpenData
        logger.warning("AEMETSatelliteProvider: placeholder - not implemented yet")
        return []
    
    def get_tile_url(
        self,
        timestamp: int,
        z: int,
        x: int,
        y: int,
        layer: str = "satellite"
    ) -> str:
        """Placeholder: retorna URL vacía por ahora.
        
        Args:
            timestamp: Unix timestamp
            z: Zoom level
            x: Tile X
            y: Tile Y
            layer: Nombre de capa
            
        Returns:
            URL vacía (placeholder)
        """
        # TODO: Implementar generación de URL de tiles desde AEMET
        logger.warning("AEMETSatelliteProvider get_tile_url: placeholder - not implemented yet")
        return ""


__all__ = [
    "GIBSProvider",
    "RainViewerProvider",
    "OpenWeatherMapRadarProvider",
    "OpenWeatherMapApiKeyError",
    "AEMETSatelliteProvider",
]

