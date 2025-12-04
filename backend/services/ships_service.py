from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import ssl
from copy import deepcopy
from typing import Any, Dict, Optional

from ..cache import CacheStore
from ..models import ShipsLayerConfig
from ..secret_store import SecretStore

try:  # pragma: no cover - optional dependency provided by uvicorn[standard]
    import websockets
    from websockets.client import WebSocketClientProtocol
    from websockets.exceptions import ConnectionClosed, WebSocketException
except Exception:  # pragma: no cover - fallback when websockets is unavailable
    websockets = None  # type: ignore[assignment]
    WebSocketClientProtocol = Any  # type: ignore[assignment]
    ConnectionClosed = Exception  # type: ignore[assignment]
    WebSocketException = Exception  # type: ignore[assignment]


DEFAULT_STREAM_URL = "wss://stream.aisstream.io/v0/stream"
SECRET_NAME = "aisstream_api_key"


class AISStreamService:
    """Mantiene una conexión WebSocket con AISstream y expone los mensajes recientes."""

    def __init__(
        self,
        *,
        cache_store: CacheStore,
        secret_store: SecretStore,
        logger: logging.Logger,
    ) -> None:
        self._cache_store = cache_store
        self._secret_store = secret_store
        self._logger = logger.getChild("ships.aisstream")
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._thread_stop: Optional[threading.Event] = None

        self._provider_enabled = False
        self._ws_url = DEFAULT_STREAM_URL
        self._update_interval = 10
        self._ttl_seconds = 180
        self._last_snapshot = 0.0
        self._snapshot: Dict[str, Any] = {"type": "FeatureCollection", "features": []}
        self._vessels: Dict[str, Dict[str, Any]] = {}
        self._ws_connected = False
        self._last_message_ts: Optional[float] = None
        self._last_error: Optional[str] = None
        # Default BBox (Spain/Iberian Peninsula)
        self._bbox = [[[36.0, -10.0], [44.0, 5.0]]]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def apply_config(self, ships_config: ShipsLayerConfig) -> None:
        """Aplica la configuración actual y gestiona la vida del hilo."""

        with self._lock:
            self._provider_enabled = ships_config.enabled and ships_config.provider == "aisstream"
            self._update_interval = max(1, int(ships_config.refresh_seconds))
            ttl_from_config = max(ships_config.max_age_seconds, self._update_interval * 6)
            self._ttl_seconds = max(60, ttl_from_config)

            ws_url = (ships_config.aisstream.ws_url or "").strip()
            self._ws_url = ws_url or DEFAULT_STREAM_URL

            # Update BBox from config
            # CRÍTICO: Formato [[[Lat1, Lon1], [Lat2, Lon2]]]
            if ships_config.aisstream and ships_config.aisstream.bbox:
                bbox = ships_config.aisstream.bbox
                # Asegurar que son floats y estructura correcta
                p1 = [float(bbox.lamin), float(bbox.lomin)]
                p2 = [float(bbox.lamax), float(bbox.lomax)]
                self._bbox = [[p1, p2]]
            else:
                # Fallback to Spain defaults
                self._bbox = [[[36.0, -10.0], [44.0, 5.0]]]

            if not self._provider_enabled:
                self._stop_thread_locked()
                self._reset_state_locked()
                return

            if websockets is None:
                self._last_error = "websockets-library-missing"
                self._logger.warning("AISStream disabled: websockets library is not available")
                self._stop_thread_locked()
                return

            if not self._secret_store.has_secret(SECRET_NAME):
                # Fallback: Check config for API key
                config_key = None
                if ships_config.aisstream and ships_config.aisstream.api_key:
                    config_key = ships_config.aisstream.api_key
                
                if config_key:
                    self._logger.info("Using AISStream API key from config and migrating to secret store")
                    self._secret_store.set_secret(SECRET_NAME, config_key)
                else:
                    self._logger.debug("AISStream secret not configured yet")
                    self._stop_thread_locked()
                    self._reset_state_locked()
                    return

            self._start_thread_locked()

    def close(self) -> None:
        """Detiene el hilo y limpia el estado."""

        with self._lock:
            self._stop_thread_locked()
            self._reset_state_locked()

    def get_snapshot(self) -> Optional[Dict[str, Any]]:
        """Devuelve un FeatureCollection con los barcos en memoria."""

        with self._lock:
            if not self._provider_enabled:
                return None
            if websockets is None:
                return None
            now = time.time()
            if now - self._last_snapshot >= max(1, self._update_interval):
                self._build_snapshot_locked(now)

            snapshot = deepcopy(self._snapshot)
            meta = snapshot.setdefault("meta", {})
            meta.update(
                {
                    "provider": "aisstream",
                    "ws_connected": self._ws_connected,
                    "buffer_size": len(self._vessels),
                    "last_message_ts": self._last_message_ts,
                    "update_interval": self._update_interval,
                    "ok": self._ws_connected and len(self._vessels) > 0,
                }
            )
            self._logger.info(f"get_snapshot: {len(self._vessels)} vessels, connected={self._ws_connected}")
            return snapshot

    def get_status(self) -> Dict[str, Any]:
        """Información de estado para healthcheck."""

        with self._lock:
            return {
                "enabled": self._provider_enabled,
                "ws_connected": self._ws_connected,
                "buffer_size": len(self._vessels),
                "last_message_ts": self._last_message_ts,
                "update_interval": self._update_interval,
                "ttl_seconds": self._ttl_seconds,
                "has_api_key": self._secret_store.has_secret(SECRET_NAME),
                "last_error": self._last_error,
            }

    # ------------------------------------------------------------------
    # Thread lifecycle
    # ------------------------------------------------------------------
    def _start_thread_locked(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        stop_event = threading.Event()
        thread = threading.Thread(
            target=self._run_thread,
            args=(stop_event,),
            name="AISStreamService",
            daemon=True,
        )
        self._thread = thread
        self._thread_stop = stop_event
        self._logger.info("Starting AISStream background service")
        thread.start()

    def _stop_thread_locked(self) -> None:
        if not self._thread:
            return
        stop_event = self._thread_stop
        thread = self._thread
        self._thread = None
        self._thread_stop = None
        if stop_event:
            stop_event.set()
        if thread.is_alive():
            thread.join(timeout=5)
        self._ws_connected = False

    # ------------------------------------------------------------------
    # Background thread
    # ------------------------------------------------------------------
    def _run_thread(self, stop_event: threading.Event) -> None:
        try:
            asyncio.run(self._run_async(stop_event))
        except Exception:  # noqa: BLE001 - log unexpected errors
            self._logger.exception("AISStream background thread failed")
            with self._lock:
                self._last_error = "thread-crashed"
                self._ws_connected = False

    async def _run_async(self, stop_event: threading.Event) -> None:
        backoff = 1.0
        while not stop_event.is_set():
            if not self._provider_enabled:
                await asyncio.sleep(2)
                continue

            api_key = self._secret_store.get_secret(SECRET_NAME)
            if not api_key:
                await asyncio.sleep(5)
                continue

            if websockets is None:
                await asyncio.sleep(10)
                continue

            # Configuración SSL permisiva (Verified Script Logic)
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

            try:
                async with websockets.connect(  # type: ignore[call-arg]
                    self._ws_url,
                    ping_interval=30,
                    ping_timeout=30,
                    close_timeout=10,
                    ssl=ssl_context
                ) as ws:
                    await self._handle_connection(ws, api_key, stop_event)
                    backoff = 1.0
            except ConnectionClosed as exc:  # type: ignore[misc]
                self._logger.warning("AISStream connection closed: %s", exc)
                with self._lock:
                    self._ws_connected = False
                    self._last_error = f"connection-closed:{exc.code}" if hasattr(exc, "code") else "connection-closed"
            except WebSocketException as exc:  # type: ignore[misc]
                self._logger.warning("AISStream websocket error: %s", exc)
                with self._lock:
                    self._ws_connected = False
                    self._last_error = "websocket-error"
            except Exception as exc:  # noqa: BLE001
                self._logger.error("AISStream connection failed: %s", exc)
                with self._lock:
                    self._ws_connected = False
                    self._last_error = "connection-error"
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    async def _handle_connection(
        self,
        ws: WebSocketClientProtocol,
        api_key: str,
        stop_event: threading.Event,
    ) -> None:
        # Construcción de suscripción simplificada y robusta (Verified Script Logic)
        subscription = {
            "APIKey": api_key,
            "BoundingBoxes": self._bbox, # Formato [[[lat,lon], [lat,lon]]]
            "FilterMessageTypes": ["PositionReport", "StandardClassBPositionReport"]
        }
        
        payload_str = json.dumps(subscription)
        await ws.send(payload_str)
        self._logger.info("Subscribed to AISStream with bbox: %s", self._bbox)

        with self._lock:
            self._ws_connected = True
            self._last_error = None

        while not stop_event.is_set():
            try:
                message = await asyncio.wait_for(ws.recv(), timeout=60)
                if isinstance(message, bytes):
                    message = message.decode("utf-8", errors="ignore")
                
                self._handle_message(message)
                
            except asyncio.TimeoutError:
                self._logger.warning("AISStream read timeout")
                break
            except Exception as e:
                self._logger.error("AISStream read error: %s", e)
                break
        
        with self._lock:
            self._ws_connected = False

    # ------------------------------------------------------------------
    # Message handling
    # ------------------------------------------------------------------
    def _handle_message(self, payload: str) -> None:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return

        # Estructura esperada: {"Message": {"PositionReport": {...}}}
        msg_container = data.get("Message")
        if not isinstance(msg_container, dict):
            return

        # Buscar reporte de posición (Class A o B)
        report = msg_container.get("PositionReport")
        if not report:
            report = msg_container.get("StandardClassBPositionReport")
        
        if not isinstance(report, dict):
            return

        # Extraer datos usando claves PascalCase (Verified Script Logic)
        try:
            # Coordenadas
            lat = float(report.get("Latitude", 0))
            lon = float(report.get("Longitude", 0))
            
            # Validar coordenadas
            if lat == 0 and lon == 0:
                return
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                return

            # Identificación
            user_id = report.get("UserID")
            mmsi = str(user_id) if user_id else None
            
            # Si no hay UserID en el reporte, buscar en MetaData
            if not mmsi:
                meta = data.get("MetaData", {})
                if isinstance(meta, dict):
                    mmsi = str(meta.get("MMSI", ""))
            
            if not mmsi or mmsi == "0":
                return

            # Datos de navegación
            sog = float(report.get("Sog", 0))
            cog = float(report.get("Cog", 0))
            heading = float(report.get("TrueHeading", 0))
            
            # Construir feature
            properties = {
                "mmsi": mmsi,
                "speed": sog,
                "course": cog,
                "heading": heading,
                "source": "aisstream",
                "timestamp": int(time.time())
            }

            # Enriquecer con MetaData si existe
            meta = data.get("MetaData")
            if isinstance(meta, dict):
                if "ShipName" in meta:
                    properties["name"] = str(meta["ShipName"]).strip()
                if "ShipTypeName" in meta:
                    properties["shipType"] = str(meta["ShipTypeName"])

            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat]
                },
                "properties": properties
            }

            # Actualizar estado
            now = time.time()
            with self._lock:
                self._vessels[mmsi] = {
                    "feature": feature, 
                    "received_at": now
                }
                self._last_message_ts = now

        except (ValueError, TypeError):
            # Ignorar errores de conversión
            return

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _reset_state_locked(self) -> None:
        self._vessels.clear()
        self._snapshot = {"type": "FeatureCollection", "features": []}
        self._last_snapshot = 0.0
        self._ws_connected = False
        self._last_message_ts = None

    def _build_snapshot_locked(self, now: float) -> None:
        expire_before = now - self._ttl_seconds
        features = []
        to_remove = []
        for key, entry in self._vessels.items():
            feature = entry.get("feature")
            received_at = float(entry.get("received_at", now))
            props = feature.get("properties", {}) if isinstance(feature, dict) else {}
            ts_value = props.get("timestamp")
            if isinstance(ts_value, (int, float)):
                received_at = float(ts_value)
            if received_at < expire_before:
                to_remove.append(key)
                continue
            features.append(feature)

        for key in to_remove:
            self._vessels.pop(key, None)

        snapshot = {"type": "FeatureCollection", "features": features}
        self._snapshot = snapshot
        self._last_snapshot = now
        try:
            self._cache_store.store("ships_stream", snapshot)
        except Exception:  # noqa: BLE001 - errores de escritura no deben interrumpir el servicio
            self._logger.debug("Failed to persist AISStream snapshot", exc_info=True)


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


__all__ = ["AISStreamService"]
