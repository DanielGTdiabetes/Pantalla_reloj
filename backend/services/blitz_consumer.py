"""Background MQTT consumer for Blitzortung lightning relays."""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .blitzortung_store import BlitzStore
from .config import AppConfig, BlitzortungConfig, read_config

try:  # pragma: no cover - optional dependency
    import paho.mqtt.client as mqtt
    from paho.mqtt.client import CallbackAPIVersion
except Exception:  # pragma: no cover - executed when dependency missing
    mqtt = None  # type: ignore[assignment]
    CallbackAPIVersion = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_RELAY_TOPIC_BASE = "blitzortung/relay"


@dataclass(frozen=True)
class _MQTTSettings:
    host: str
    port: int
    ssl: bool
    username: Optional[str]
    password: Optional[str]
    base_topic: str
    geohash: Optional[str]
    radius_km: Optional[int]


@dataclass(frozen=True)
class _ConsumerConfig:
    enabled: bool
    mode: str
    mqtt: Optional[_MQTTSettings]


class _LocalPublisher:
    """Lazy MQTT publisher towards the local Mosquitto instance."""

    def __init__(self, host: str = "127.0.0.1", port: int = 1883, base_topic: str = _RELAY_TOPIC_BASE) -> None:
        self._host = host
        self._port = port
        self._base_topic = base_topic.rstrip("/") or _RELAY_TOPIC_BASE
        self._client: Optional["mqtt.Client"] = None
        self._connected = False
        self._lock = threading.Lock()
        self._last_attempt = 0.0

    def publish(self, topic_suffix: str, payload: bytes) -> None:
        if mqtt is None:
            return
        topic = self._build_topic(topic_suffix)
        now = time.time()
        with self._lock:
            if not self._connected and now - self._last_attempt < 5:
                return
            if self._client is None:
                self._last_attempt = now
                try:
                    client = mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2) if CallbackAPIVersion else mqtt.Client()
                    client.enable_logger(logger)
                    client.connect(self._host, self._port, keepalive=30)
                    client.loop_start()
                    self._client = client
                    self._connected = True
                except Exception as exc:  # pragma: no cover - defensive
                    logger.debug("No se pudo conectar a Mosquitto local: %s", exc)
                    self._client = None
                    self._connected = False
                    return
            try:
                assert self._client is not None
                self._client.publish(topic, payload, qos=0, retain=False)
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug("Error publicando en Mosquitto local: %s", exc)
                self._teardown_locked()

    def stop(self) -> None:
        with self._lock:
            self._teardown_locked()

    def _teardown_locked(self) -> None:
        if self._client is not None:
            try:
                self._client.loop_stop()
            except Exception:  # pragma: no cover - defensive
                logger.debug("Error deteniendo loop del publicador", exc_info=True)
            try:
                self._client.disconnect()
            except Exception:  # pragma: no cover - defensive
                logger.debug("Error desconectando publicador local", exc_info=True)
        self._client = None
        self._connected = False
        self._last_attempt = time.time()

    def _build_topic(self, suffix: str) -> str:
        normalized = suffix.lstrip("/")
        if normalized:
            return f"{self._base_topic}/{normalized}"
        return self._base_topic


class BlitzMQTTConsumer:
    """Background MQTT consumer for Blitzortung relay feeds."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._status_lock = threading.Lock()
        self._client: Optional["mqtt.Client"] = None
        self._config: Optional[_ConsumerConfig] = None
        self._store = BlitzStore()
        self._status: Dict[str, Any] = {
            "mode": "disabled",
            "enabled": False,
            "connected": False,
            "subscribed_topics": [],
            "last_message_at": None,
            "last_error": None,
        }
        self._local_publisher = _LocalPublisher()
        self._base_topic = ""

    # Public API -----------------------------------------------------
    def configure(self, config: Optional[_ConsumerConfig]) -> None:
        if config == self._config:
            return
        if config is None or not config.enabled or config.mode != "mqtt" or config.mqtt is None:
            self.stop()
            self._update_status(
                {
                    "mode": config.mode if config else "disabled",
                    "enabled": bool(config.enabled if config else False),
                    "connected": False,
                    "subscribed_topics": [],
                    "last_error": None,
                    "remote_base_topic": None,
                    "geohash": None,
                    "radius_km": None,
                }
            )
            self._config = config
            return
        if mqtt is None:
            self._update_status(
                {
                    "mode": config.mode,
                    "enabled": True,
                    "connected": False,
                    "last_error": "paho-mqtt no disponible",
                    "subscribed_topics": [],
                    "remote_base_topic": None,
                    "geohash": None,
                    "radius_km": None,
                }
            )
            self._config = config
            return
        self.stop()
        self._config = config
        settings = config.mqtt
        assert settings is not None
        try:
            client = mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2) if CallbackAPIVersion else mqtt.Client()
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("No se pudo crear cliente MQTT: %s", exc)
            self._update_status(
                {
                    "mode": config.mode,
                    "enabled": True,
                    "connected": False,
                    "last_error": str(exc),
                    "subscribed_topics": [],
                    "remote_base_topic": settings.base_topic,
                    "geohash": settings.geohash,
                    "radius_km": settings.radius_km,
                }
            )
            return
        client.enable_logger(logger)
        client.on_connect = self._on_connect  # type: ignore[assignment]
        client.on_disconnect = self._on_disconnect  # type: ignore[assignment]
        client.on_message = self._on_message  # type: ignore[assignment]
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        if settings.ssl:
            try:
                client.tls_set()
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("No se pudo habilitar TLS para MQTT Blitzortung: %s", exc)
        if settings.username:
            client.username_pw_set(settings.username, settings.password)
        self._base_topic = settings.base_topic.rstrip("/") or "blitzortung"
        try:
            client.connect(settings.host, settings.port, keepalive=30)
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("No se pudo conectar a %s:%s: %s", settings.host, settings.port, exc)
            self._update_status(
                {
                    "mode": config.mode,
                    "enabled": True,
                    "connected": False,
                    "last_error": str(exc),
                    "subscribed_topics": [],
                    "remote_base_topic": settings.base_topic,
                    "geohash": settings.geohash,
                    "radius_km": settings.radius_km,
                }
            )
            return
        with self._lock:
            self._client = client
        client.loop_start()
        topics = self._topics_from(settings)
        self._update_status(
            {
                "mode": config.mode,
                "enabled": True,
                "connected": False,
                "last_error": None,
                "subscribed_topics": topics,
                "remote_base_topic": self._base_topic,
                "geohash": settings.geohash,
                "radius_km": settings.radius_km,
            }
        )

    def stop(self) -> None:
        with self._lock:
            client = self._client
            self._client = None
        if client is not None:
            try:
                client.loop_stop()
            except Exception:  # pragma: no cover - defensive
                logger.debug("Error deteniendo loop MQTT Blitzortung", exc_info=True)
            try:
                client.disconnect()
            except Exception:  # pragma: no cover - defensive
                logger.debug("Error desconectando MQTT Blitzortung", exc_info=True)
        self._local_publisher.stop()
        self._store.clear()
        self._update_status({"connected": False})

    def recent(self, limit: int = 500) -> list[tuple[float, float]]:
        coords = self._store.recent()
        if limit >= 0:
            return coords[:limit]
        return coords

    def status(self) -> Dict[str, Any]:
        with self._status_lock:
            return dict(self._status)

    # Internal helpers ------------------------------------------------
    def _topics_from(self, settings: _MQTTSettings) -> List[str]:
        base = settings.base_topic.rstrip("/")
        if settings.geohash:
            geohash = settings.geohash.strip("/")
            return [f"{base}/{geohash}/#"]
        return [f"{base}/#"]

    def _update_status(self, changes: Dict[str, Any]) -> None:
        with self._status_lock:
            self._status.update(changes)

    # MQTT callbacks --------------------------------------------------
    def _on_connect(self, client, userdata, flags, reason_code, properties=None):  # noqa: D401
        del userdata, flags, reason_code, properties
        config = self._config
        settings = config.mqtt if config else None
        if not settings:
            return
        topics = self._topics_from(settings)
        for topic in topics:
            try:
                client.subscribe(topic, qos=0)
            except Exception:  # pragma: no cover - defensive
                logger.debug("No se pudo suscribir a %s", topic, exc_info=True)
        self._update_status({"connected": True, "subscribed_topics": topics, "last_error": None})

    def _on_disconnect(self, client, userdata, reason_code, properties=None):  # noqa: D401
        del client, userdata, reason_code, properties
        self._update_status({"connected": False})

    def _on_message(self, client, userdata, message):  # noqa: D401
        del client, userdata
        payload = bytes(message.payload)
        suffix = self._extract_suffix(message.topic)
        self._local_publisher.publish(suffix, payload)
        try:
            data = json.loads(payload.decode("utf-8"))
        except Exception:  # pragma: no cover - defensivo
            data = None
        if isinstance(data, dict):
            lat = self._extract_float(data, ["lat", "latitude", "latitud"])
            lon = self._extract_float(data, ["lon", "longitude", "longitud"])
            if lat is None or lon is None:
                position = data.get("position")
                if isinstance(position, dict):
                    lat = self._extract_float(position, ["lat", "latitude"])
                    lon = self._extract_float(position, ["lon", "longitude"])
            if lat is not None and lon is not None:
                ts = self._extract_float(data, ["time", "timestamp", "ts", "datetime"])
                if ts and ts > 1e12:
                    ts /= 1000.0
                self._store.add(lat, lon, ts)
        self._update_status({"last_message_at": time.time()})

    def _extract_suffix(self, topic: str) -> str:
        base = self._base_topic
        if base and topic.startswith(base.rstrip("/") + "/"):
            return topic[len(base.rstrip("/")) + 1 :]
        return topic

    @staticmethod
    def _extract_float(data: Dict[str, Any], keys: List[str]) -> Optional[float]:
        for key in keys:
            value = data.get(key)
            if value is None:
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return None


_CONSUMER = BlitzMQTTConsumer()


def _to_consumer_config(app_config: Optional[AppConfig]) -> Optional[_ConsumerConfig]:
    if app_config is None:
        return None
    blitz_cfg: Optional[BlitzortungConfig] = getattr(app_config, "blitzortung", None)
    if blitz_cfg is None:
        return None
    enabled = bool(getattr(blitz_cfg, "enabled", True))
    mode = str(getattr(blitz_cfg, "mode", "mqtt") or "mqtt").lower()
    mqtt_cfg = getattr(blitz_cfg, "mqtt", None)
    if mqtt_cfg is None:
        mqtt_settings = None
    else:
        base_topic = str(getattr(mqtt_cfg, "baseTopic", "blitzortung/1.1") or "blitzortung/1.1")
        mqtt_settings = _MQTTSettings(
            host=str(getattr(mqtt_cfg, "host", "127.0.0.1") or "127.0.0.1"),
            port=int(getattr(mqtt_cfg, "port", 1883) or 1883),
            ssl=bool(getattr(mqtt_cfg, "ssl", False)),
            username=getattr(mqtt_cfg, "username", None),
            password=getattr(mqtt_cfg, "password", None),
            base_topic=base_topic,
            geohash=getattr(mqtt_cfg, "geohash", None),
            radius_km=getattr(mqtt_cfg, "radius_km", None),
        )
    return _ConsumerConfig(enabled=enabled, mode=mode, mqtt=mqtt_settings)


def configure_from_app_config(app_config: Optional[AppConfig]) -> None:
    _CONSUMER.configure(_to_consumer_config(app_config))


def configure_from_disk() -> None:
    try:
        app_config = read_config()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("No se pudo cargar configuración Blitzortung: %s", exc)
        configure_from_app_config(None)
        return
    configure_from_app_config(app_config)


def shutdown() -> None:
    _CONSUMER.stop()


def recent_strikes(limit: int = 500) -> list[tuple[float, float]]:
    return _CONSUMER.recent(limit)


def consumer_status() -> Dict[str, Any]:
    status = _CONSUMER.status()
    status.setdefault("relay_topic", _RELAY_TOPIC_BASE)
    return status


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
    configure_from_disk()
    try:
        while True:
            time.sleep(30)
    except KeyboardInterrupt:
        logger.info("Blitzortung consumer detenido por usuario")
    finally:
        shutdown()


if __name__ == "__main__":
    main()
