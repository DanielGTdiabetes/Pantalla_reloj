"""Servicio para conectar con Blitzortung vía MQTT o WebSocket."""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

try:
    import websocket
except ImportError:
    websocket = None

logger = logging.getLogger(__name__)


@dataclass
class LightningStrike:
    """Representa un rayo detectado."""
    
    timestamp: float  # Unix timestamp
    lat: float
    lon: float
    severity: Optional[str] = None  # Opcional: "weak", "medium", "strong"
    
    def to_geojson_feature(self) -> Dict[str, Any]:
        """Convierte el rayo a un Feature de GeoJSON."""
        return {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [self.lon, self.lat]
            },
            "properties": {
                "timestamp": self.timestamp,
                "timestamp_iso": datetime.fromtimestamp(self.timestamp, tz=timezone.utc).isoformat(),
                "severity": self.severity
            }
        }


class BlitzortungService:
    """Servicio para recibir datos de rayos desde Blitzortung vía MQTT o WebSocket."""
    
    def __init__(
        self,
        enabled: bool = False,
        mqtt_host: str = "127.0.0.1",
        mqtt_port: int = 1883,
        mqtt_topic: str = "blitzortung/1",
        ws_enabled: bool = False,
        ws_url: Optional[str] = None,
        callback: Optional[Callable[[List[LightningStrike]], None]] = None,
        buffer_max: int = 500,
        prune_seconds: int = 900
    ):
        """Inicializa el servicio Blitzortung.
        
        Args:
            enabled: Si el servicio está habilitado
            mqtt_host: Host MQTT
            mqtt_port: Puerto MQTT
            mqtt_topic: Tópico MQTT para suscribirse
            ws_enabled: Si WebSocket está habilitado
            ws_url: URL de WebSocket
            callback: Función a llamar cuando se reciben nuevos rayos
            buffer_max: Máximo número de eventos en memoria
            prune_seconds: TTL de eventos en segundos (edad máxima)
        """
        self.enabled = enabled
        self.mqtt_host = mqtt_host
        self.mqtt_port = mqtt_port
        self.mqtt_topic = mqtt_topic
        self.ws_enabled = ws_enabled
        self.ws_url = ws_url
        self.callback = callback
        self.buffer_max = buffer_max
        self.prune_seconds = prune_seconds
        
        self.strikes: List[LightningStrike] = []
        self.strikes_lock = threading.Lock()
        
        self.mqtt_client: Optional[Any] = None
        self.ws_client: Optional[Any] = None
        self.running = False
        self.thread: Optional[threading.Thread] = None
        
        # Cleanup thread para eliminar rayos antiguos
        self.cleanup_thread: Optional[threading.Thread] = None
        self.cleanup_interval = 60  # segundos
    
    def start(self) -> bool:
        """Inicia el servicio Blitzortung.
        
        Returns:
            True si se inició correctamente, False en caso contrario
        """
        if not self.enabled:
            logger.debug("[Blitzortung] Service disabled")
            return False
        
        if self.running:
            logger.warning("[Blitzortung] Service already running")
            return False
        
        if True: # Force test mode for debugging
             logger.warning("[Blitzortung] FORCE STARTING TEST MODE generator for debugging")
             self.running = True
             self._start_cleanup_thread()
             self._start_test_generator()
             return True
        
        # Original logic below (commented out for debug)
        # if mqtt and not self.ws_enabled:
        #     if self._start_mqtt():
        # ...
        # Si no hay conexión real, iniciar generador de pruebas
        logger.warning("[Blitzortung] Connection failed, STARTING TEST MODE generator")
        self.running = True
        self._start_cleanup_thread()
        self._start_test_generator()
        return True
        # --- TEST FALLBACK END ---
        
        # logger.warning("[Blitzortung] Failed to start: MQTT/WebSocket not available or misconfigured")
        # return False
    
    def stop(self) -> None:
        """Detiene el servicio Blitzortung."""
        if not self.running:
            return
        
        self.running = False
        
        if self.mqtt_client:
            try:
                self.mqtt_client.loop_stop()
                self.mqtt_client.disconnect()
            except Exception as exc:
                logger.error("[Blitzortung] Error stopping MQTT client: %s", exc)
            self.mqtt_client = None
        
        if self.ws_client:
            try:
                self.ws_client.close()
            except Exception as exc:
                logger.error("[Blitzortung] Error stopping WebSocket client: %s", exc)
            self.ws_client = None
        
        logger.info("[Blitzortung] Service stopped")
    
    def _start_mqtt(self) -> bool:
        """Inicia conexión MQTT.
        
        Returns:
            True si se conectó correctamente
        """
        if not mqtt:
            logger.error("[Blitzortung] paho-mqtt not installed")
            return False
        
        try:
            self.mqtt_client = mqtt.Client()
            self.mqtt_client.on_connect = self._on_mqtt_connect
            self.mqtt_client.on_message = self._on_mqtt_message
            self.mqtt_client.on_disconnect = self._on_mqtt_disconnect
            
            try:
                self.mqtt_client.connect(self.mqtt_host, self.mqtt_port, keepalive=60)
                self.mqtt_client.loop_start()
                return True
            except Exception as exc:
                logger.error("[Blitzortung] Failed to connect to MQTT broker %s:%d: %s", 
                           self.mqtt_host, self.mqtt_port, exc)
                return False
        except Exception as exc:
            logger.error("[Blitzortung] Failed to create MQTT client: %s", exc)
            return False
    
    def _start_websocket(self) -> bool:
        """Inicia conexión WebSocket.
        
        Returns:
            True si se conectó correctamente
        """
        if not websocket:
            logger.error("[Blitzortung] websocket-client not installed")
            return False
        
        if not self.ws_url:
            logger.error("[Blitzortung] WebSocket URL not provided")
            return False
        
        try:
            self.ws_client = websocket.WebSocketApp(
                self.ws_url,
                on_open=self._on_ws_open,
                on_message=self._on_ws_message,
                on_error=self._on_ws_error,
                on_close=self._on_ws_close
            )
            
            # Iniciar en thread separado
            self.thread = threading.Thread(target=self.ws_client.run_forever, daemon=True)
            self.thread.start()
            return True
        except Exception as exc:
            logger.error("[Blitzortung] Failed to create WebSocket client: %s", exc)
            return False
    
    def _on_mqtt_connect(self, client: Any, userdata: Any, flags: Any, rc: int) -> None:
        """Callback cuando se conecta MQTT."""
        if rc == 0:
            logger.info("[Blitzortung] Connected to MQTT broker")
            client.subscribe(self.mqtt_topic)
        else:
            logger.error("[Blitzortung] Failed to connect to MQTT broker, return code: %d", rc)
    
    def _on_mqtt_message(self, client: Any, userdata: Any, msg: Any) -> None:
        """Callback cuando llega un mensaje MQTT."""
        try:
            payload = msg.payload.decode("utf-8")
            data = json.loads(payload)
            self._process_lightning_data(data)
        except Exception as exc:
            logger.error("[Blitzortung] Failed to process MQTT message: %s", exc)
    
    def _on_mqtt_disconnect(self, client: Any, userdata: Any, rc: int) -> None:
        """Callback cuando se desconecta MQTT."""
        logger.warning("[Blitzortung] Disconnected from MQTT broker, return code: %d", rc)
    
    def _on_ws_open(self, ws: Any) -> None:
        """Callback cuando se abre WebSocket."""
        logger.info("[Blitzortung] WebSocket connection opened")
    
    def _on_ws_message(self, ws: Any, message: str) -> None:
        """Callback cuando llega un mensaje WebSocket."""
        try:
            data = json.loads(message)
            self._process_lightning_data(data)
        except Exception as exc:
            logger.error("[Blitzortung] Failed to process WebSocket message: %s", exc)
    
    def _on_ws_error(self, ws: Any, error: Exception) -> None:
        """Callback cuando hay error en WebSocket."""
        logger.error("[Blitzortung] WebSocket error: %s", error)
    
    def _on_ws_close(self, ws: Any, close_status_code: int, close_msg: str) -> None:
        """Callback cuando se cierra WebSocket."""
        logger.warning("[Blitzortung] WebSocket connection closed: %d - %s", close_status_code, close_msg)
    
    def _process_lightning_data(self, data: Dict[str, Any]) -> None:
        """Procesa datos de rayos recibidos.
        
        Args:
            data: Datos de rayos (formato puede variar según proveedor)
        """
        # Formato esperado de Blitzortung (puede variar):
        # {"time": timestamp, "lat": lat, "lon": lon}
        # O array de rayos: [{"time": ...}, ...]
        
        strikes_to_add: List[LightningStrike] = []
        
        if isinstance(data, list):
            # Array de rayos
            for item in data:
                strike = self._parse_lightning_strike(item)
                if strike:
                    strikes_to_add.append(strike)
        else:
            # Objeto único
            strike = self._parse_lightning_strike(data)
            if strike:
                strikes_to_add.append(strike)
        
        if strikes_to_add:
            with self.strikes_lock:
                # Añadir nuevos rayos
                self.strikes.extend(strikes_to_add)
                # Limpiar rayos antiguos y mantener buffer_max
                self._cleanup_old_strikes()
                # Limitar tamaño del buffer
                if len(self.strikes) > self.buffer_max:
                    # Ordenar por timestamp (más recientes primero) y mantener solo los más recientes
                    self.strikes.sort(key=lambda s: s.timestamp, reverse=True)
                    self.strikes = self.strikes[:self.buffer_max]
            
            # Llamar callback si existe
            if self.callback:
                try:
                    self.callback(strikes_to_add)
                except Exception as exc:
                    logger.error("[Blitzortung] Callback error: %s", exc)
    
    def _parse_lightning_strike(self, data: Dict[str, Any]) -> Optional[LightningStrike]:
        """Parsea un objeto de datos a LightningStrike.
        
        Args:
            data: Datos del rayo
            
        Returns:
            LightningStrike o None si no se puede parsear
        """
        try:
            # Intentar diferentes formatos comunes
            timestamp = data.get("time") or data.get("timestamp") or data.get("t")
            lat = data.get("lat") or data.get("latitude")
            lon = data.get("lon") or data.get("longitude") or data.get("lng")
            
            if timestamp is None or lat is None or lon is None:
                return None
            
            # Convertir timestamp a float si es necesario
            if isinstance(timestamp, str):
                timestamp = float(timestamp)
            
            return LightningStrike(
                timestamp=float(timestamp),
                lat=float(lat),
                lon=float(lon),
                severity=data.get("severity")
            )
        except (ValueError, TypeError, KeyError) as exc:
            logger.debug("[Blitzortung] Failed to parse lightning strike: %s", exc)
            return None
    
    def _cleanup_old_strikes(self) -> None:
        """Elimina rayos antiguos de la lista según prune_seconds."""
        if not self.strikes:
            return
        
        now = time.time()
        
        self.strikes = [
            strike for strike in self.strikes
            if (now - strike.timestamp) < self.prune_seconds
        ]
    
    def _start_cleanup_thread(self) -> None:
        """Inicia thread de limpieza periódica."""
        def cleanup_loop():
            while self.running:
                time.sleep(self.cleanup_interval)
                with self.strikes_lock:
                    self._cleanup_old_strikes()
        
        self.cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
        self.cleanup_thread.start()

    def _start_test_generator(self) -> None:
        """Inicia generador de rayos falsos para pruebas."""
        import random
        def test_loop():
            logger.info("TEST MODE: Generating fake lightning strikes around Vila-real")
            center_lat = 39.9378
            center_lon = -0.1014
            while self.running:
                time.sleep(1.0) # Un rayo cada segundo
                with self.strikes_lock:
                    # Generar cerca de Vila-real con algo de dispersión
                    lat = center_lat + (random.random() - 0.5) * 0.1
                    lon = center_lon + (random.random() - 0.5) * 0.1
                    
                    strike = LightningStrike(
                        timestamp=time.time(),
                        lat=lat,
                        lon=lon,
                        severity="strong" if random.random() > 0.5 else "medium"
                    )
                    self.strikes.append(strike)
                    self._cleanup_old_strikes()
                    
                    # Limitar
                    if len(self.strikes) > self.buffer_max:
                         self.strikes.sort(key=lambda s: s.timestamp, reverse=True)
                         self.strikes = self.strikes[:self.buffer_max]
        
        self.test_thread = threading.Thread(target=test_loop, daemon=True)
        self.test_thread.start()
    
    def get_strikes_in_bbox(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float
    ) -> List[LightningStrike]:
        """Obtiene rayos dentro de un bounding box.
        
        Args:
            min_lat: Latitud mínima
            max_lat: Latitud máxima
            min_lon: Longitud mínima
            max_lon: Longitud máxima
            
        Returns:
            Lista de rayos en el bbox
        """
        with self.strikes_lock:
            return [
                strike for strike in self.strikes
                if (min_lat <= strike.lat <= max_lat and
                    min_lon <= strike.lon <= max_lon)
            ]
    
    def get_all_strikes(self) -> List[LightningStrike]:
        """Obtiene todos los rayos actuales.
        
        Returns:
            Lista de todos los rayos
        """
        with self.strikes_lock:
            return list(self.strikes)
    
    def to_geojson(self, bbox: Optional[tuple] = None) -> Dict[str, Any]:
        """Convierte rayos a GeoJSON FeatureCollection.
        
        Args:
            bbox: Opcional (min_lat, max_lat, min_lon, max_lon) para filtrar
            
        Returns:
            GeoJSON FeatureCollection
        """
        if bbox:
            strikes = self.get_strikes_in_bbox(bbox[0], bbox[1], bbox[2], bbox[3])
        else:
            strikes = self.get_all_strikes()
        
        return {
            "type": "FeatureCollection",
            "features": [strike.to_geojson_feature() for strike in strikes]
        }

