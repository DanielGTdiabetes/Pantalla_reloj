"""Simple MQTT client wrapper for Blitzortung lightning events."""
from __future__ import annotations

import json
import logging
import threading
from typing import Callable, Optional

try:  # pragma: no cover - optional dependency
    import paho.mqtt.client as mqtt
except Exception:  # pragma: no cover - executed when dependency missing
    mqtt = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


def _coerce_float(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_timestamp(value) -> Optional[float]:
    if value is None:
        return None
    try:
        ts = float(value)
    except (TypeError, ValueError):
        return None
    if ts > 1e12:
        ts /= 1000.0
    return ts


class MQTTClient:
    """Background MQTT consumer that forwards Blitzortung strikes."""

    def __init__(
        self,
        host: str,
        port: int,
        topic_base: str,
        on_strike: Callable[[float, float, Optional[float]], None],
    ) -> None:
        self.host = host
        self.port = port
        self.topic_base = topic_base.rstrip("/") or "blitzortung/1.1"
        self._topic = f"{self.topic_base}/#"
        self._on_strike = on_strike
        self._client: Optional["mqtt.Client"] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._lock = threading.Lock()

    @staticmethod
    def is_supported() -> bool:
        """Return ``True`` if paho-mqtt is available."""

        return mqtt is not None

    def matches(self, host: str, port: int, topic_base: str) -> bool:
        return (
            self.host == host
            and self.port == port
            and self.topic_base.rstrip("/") == topic_base.rstrip("/")
        )

    def start(self) -> None:
        """Start the MQTT background loop if possible."""

        if mqtt is None:
            logger.warning("paho-mqtt no disponible; no se inicia el cliente MQTT")
            return

        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="BlitzMQTT", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        """Stop the background loop and disconnect."""

        with self._lock:
            self._stop.set()
            thread = self._thread
            client = self._client
        if thread and thread.is_alive():
            thread.join(timeout=5)
        if client is not None:
            try:
                client.disconnect()
            except Exception:  # pragma: no cover - defensive
                logger.debug("Error al desconectar MQTT", exc_info=True)
        with self._lock:
            self._thread = None
            self._client = None

    # Internal API -----------------------------------------------------
    def _run(self) -> None:
        if mqtt is None:
            return
        try:
            callback_api_version = getattr(mqtt, "CallbackAPIVersion", None)
            if callback_api_version is not None:
                client = mqtt.Client(callback_api_version=callback_api_version.VERSION2)
            else:  # pragma: no cover - legacy fallback
                client = mqtt.Client()
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("No se pudo crear cliente MQTT: %s", exc)
            return

        client.enable_logger(logger)
        client.on_connect = self._on_connect  # type: ignore[assignment]
        client.on_message = self._on_message  # type: ignore[assignment]
        try:
            client.connect(self.host, self.port, keepalive=30)
        except Exception as exc:  # pragma: no cover - conexión fallida
            logger.error("No se pudo conectar a MQTT %s:%s: %s", self.host, self.port, exc)
            return

        with self._lock:
            self._client = client

        while not self._stop.is_set():
            try:
                client.loop(timeout=1.0)
            except Exception:  # pragma: no cover - defensivo
                logger.debug("Error en loop MQTT", exc_info=True)
                break

        try:
            client.disconnect()
        except Exception:  # pragma: no cover - defensivo
            logger.debug("Error al desconectar MQTT", exc_info=True)

    # Callbacks --------------------------------------------------------
    def _on_connect(self, client, userdata, flags, reason_code, properties=None):  # noqa: D401
        del userdata, flags, reason_code, properties
        try:
            client.subscribe(self._topic, qos=0)
        except Exception:  # pragma: no cover - defensivo
            logger.debug("No se pudo suscribir a %s", self._topic, exc_info=True)

    def _on_message(self, client, userdata, message):  # noqa: D401
        del client, userdata
        try:
            payload = message.payload.decode("utf-8", "ignore")
            data = json.loads(payload)
        except Exception:
            logger.debug("Mensaje MQTT inválido en %s", message.topic, exc_info=True)
            return

        lat = self._extract_lat(data)
        lon = self._extract_lon(data)
        if lat is None or lon is None:
            return
        timestamp = self._extract_timestamp(data)
        self._on_strike(lat, lon, timestamp)

    # Parsing helpers --------------------------------------------------
    @staticmethod
    def _extract_lat(data) -> Optional[float]:
        for key in ("lat", "latitude", "latitud"):
            if key in data:
                return _coerce_float(data[key])
        position = data.get("position") if isinstance(data, dict) else None
        if isinstance(position, dict):
            return _coerce_float(position.get("lat"))
        return None

    @staticmethod
    def _extract_lon(data) -> Optional[float]:
        for key in ("lon", "longitude", "longitud"):
            if key in data:
                return _coerce_float(data[key])
        position = data.get("position") if isinstance(data, dict) else None
        if isinstance(position, dict):
            return _coerce_float(position.get("lon"))
        return None

    @staticmethod
    def _extract_timestamp(data) -> Optional[float]:
        for key in ("time", "timestamp", "ts", "datetime"):
            if key in data:
                return _coerce_timestamp(data[key])
        return None
