"""Background MQTT consumer for Blitzortung lightning feeds."""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

from .blitzortung_store import BlitzStore
from .config import AppConfig, BlitzortungConfig, read_config
from .location import get_location as get_location_override

try:  # pragma: no cover - optional dependency
    import paho.mqtt.client as mqtt
    from paho.mqtt.client import CallbackAPIVersion
except Exception:  # pragma: no cover - executed when dependency missing
    mqtt = None  # type: ignore[assignment]
    CallbackAPIVersion = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _ProxySettings:
    host: str
    port: int
    ssl: bool
    base_topic: str
    geohash: Optional[str]
    radius_km: int


@dataclass(frozen=True)
class _CustomBrokerSettings:
    host: str
    port: int
    ssl: bool
    username: Optional[str]
    password: Optional[str]
    base_topic: str
    geohash: Optional[str]
    radius_km: int


SettingsType = Union[_ProxySettings, _CustomBrokerSettings]


@dataclass(frozen=True)
class _ConsumerConfig:
    enabled: bool
    mode: str
    settings: Optional[SettingsType]
    location: Optional[Tuple[float, float]]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return 6371.0 * c


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360.0) % 360.0


class BlitzMQTTConsumer:
    """Manage a background MQTT client to consume Blitzortung events."""

    def __init__(self) -> None:
        self._store = BlitzStore()
        self._config: Optional[_ConsumerConfig] = None
        self._client: Optional["mqtt.Client"] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._lock = threading.Lock()
        self._status_lock = threading.Lock()
        self._status: Dict[str, Any] = {
            "enabled": False,
            "mode": "public_proxy",
            "connected": False,
            "last_event_at": None,
            "topic": None,
            "counters": {
                "received": 0,
                "errors": 0,
                "retries": 0,
                "last_distance_km": None,
                "last_azimuth_deg": None,
            },
            "retry_in": None,
            "last_error": None,
        }
        self._last_retry_delay = 1
        self._location: Optional[Tuple[float, float]] = None
        self._current_topic: Optional[str] = None

    # ------------------------------------------------------------------
    def configure(self, config: Optional[_ConsumerConfig]) -> None:
        with self._lock:
            self._config = config
            self._location = config.location if config else None
            self._wake_event.set()
            self._ensure_thread()

    def stop(self) -> None:
        self._stop_event.set()
        self._wake_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=5)
        self._thread = None
        self._disconnect_client()
        self._store.clear()

    def recent(self, limit: int = 500) -> List[Tuple[float, float]]:
        coords = self._store.recent()
        return coords[:limit] if limit >= 0 else coords

    def status(self) -> Dict[str, Any]:
        with self._status_lock:
            return json.loads(json.dumps(self._status))

    # ------------------------------------------------------------------
    def _ensure_thread(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="BlitzMQTTConsumer", daemon=True)
        self._thread.start()

    def _run_loop(self) -> None:
        backoff = 1
        while not self._stop_event.is_set():
            config = self._config
            if not config or not config.enabled or not config.settings:
                self._disconnect_client()
                self._update_status(
                    {
                        "enabled": bool(config.enabled if config else False),
                        "mode": config.mode if config else "public_proxy",
                        "connected": False,
                        "topic": None,
                        "retry_in": None,
                    }
                )
                self._wait_for_wakeup(timeout=1)
                backoff = 1
                continue

            if mqtt is None:
                self._update_status(
                    {
                        "enabled": True,
                        "mode": config.mode,
                        "connected": False,
                        "last_error": "paho-mqtt no disponible",
                    }
                )
                self._wait_for_wakeup(timeout=10)
                continue

            try:
                self._connect(config)
                backoff = 1
                self._wait_for_wakeup()
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Error Blitzortung MQTT (%s): %s", config.mode, exc)
                self._update_status(
                    {
                        "connected": False,
                        "last_error": str(exc),
                        "retry_in": backoff,
                    },
                    increment_retry=True,
                )
                self._disconnect_client()
                if self._stop_event.wait(timeout=backoff):
                    break
                backoff = min(backoff * 2, 60)
                continue

        self._disconnect_client()

    def _wait_for_wakeup(self, timeout: Optional[float] = None) -> None:
        if self._stop_event.is_set():
            return
        if timeout is None:
            while not self._stop_event.is_set():
                if self._wake_event.wait(timeout=1):
                    self._wake_event.clear()
                    break
        else:
            if self._wake_event.wait(timeout=timeout):
                self._wake_event.clear()

    def _connect(self, config: _ConsumerConfig) -> None:
        self._disconnect_client()
        settings = config.settings
        if settings is None:
            raise RuntimeError("Configuración MQTT incompleta")

        client = (
            mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2)
            if CallbackAPIVersion
            else mqtt.Client()
        )
        client.enable_logger(logger)
        client.on_connect = self._on_connect  # type: ignore[assignment]
        client.on_disconnect = self._on_disconnect  # type: ignore[assignment]
        client.on_message = self._on_message  # type: ignore[assignment]
        client.reconnect_delay_set(min_delay=1, max_delay=60)

        if isinstance(settings, _ProxySettings):
            host = settings.host
            port = settings.port
            use_ssl = settings.ssl
        else:
            host = settings.host
            port = settings.port
            use_ssl = settings.ssl
            if settings.username:
                password = settings.password or ""
                if password == "*****":
                    password = ""
                client.username_pw_set(settings.username, password)

        if use_ssl:
            try:
                client.tls_set()
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("No se pudo habilitar TLS para Blitzortung: %s", exc)

        client.connect(host, port, keepalive=30)
        topics = self._topics_for(settings)
        self._current_topic = topics[0] if topics else None
        with self._lock:
            self._client = client
        client.loop_start()
        for topic in topics:
            try:
                client.subscribe(topic, qos=0)
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug("No se pudo suscribir a %s: %s", topic, exc)
        self._update_status(
            {
                "enabled": True,
                "mode": config.mode,
                "topic": self._current_topic,
                "last_error": None,
                "retry_in": None,
            }
        )

    def _topics_for(self, settings: SettingsType) -> List[str]:
        base = settings.base_topic.rstrip("/") or "blitzortung"
        geohash = settings.geohash.strip("/") if settings.geohash else "auto"
        radius = settings.radius_km if settings.radius_km is not None else 100
        topic = f"{base}/{geohash}/{radius}"
        return [topic]

    def _disconnect_client(self) -> None:
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
        self._update_status({"connected": False})

    # ------------------------------------------------------------------
    def _update_status(self, changes: Dict[str, Any], *, increment_retry: bool = False) -> None:
        with self._status_lock:
            if increment_retry:
                counters = self._status.get("counters")
                if isinstance(counters, dict):
                    counters["retries"] = counters.get("retries", 0) + 1
            self._status.update(changes)

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):  # noqa: D401
        del client, userdata, flags, reason_code, properties
        self._update_status({"connected": True, "last_error": None})

    def _on_disconnect(self, client, userdata, reason_code, properties=None):  # noqa: D401
        del client, userdata, reason_code, properties
        self._update_status({"connected": False})

    def _on_message(self, client, userdata, message):  # noqa: D401
        del client, userdata
        payload = bytes(message.payload)
        try:
            data = json.loads(payload.decode("utf-8"))
        except Exception:  # pragma: no cover - defensivo
            data = None
            self._increment_error()
        self._handle_event(data)

    def _increment_error(self) -> None:
        with self._status_lock:
            counters = self._status.get("counters")
            if isinstance(counters, dict):
                counters["errors"] = counters.get("errors", 0) + 1

    def _handle_event(self, data: Any) -> None:
        timestamp = time.time()
        lat = None
        lon = None
        if isinstance(data, dict):
            lat = self._extract_float(data, ["lat", "latitude", "latitud"])
            lon = self._extract_float(data, ["lon", "longitude", "longitud"])
            if lat is None or lon is None:
                position = data.get("position") if isinstance(data.get("position"), dict) else None
                if isinstance(position, dict):
                    lat = self._extract_float(position, ["lat", "latitude"])
                    lon = self._extract_float(position, ["lon", "longitude"])
            ts_value = self._extract_float(
                data,
                ["timestamp", "time", "ts", "datetime", "epoch"],
            )
            if ts_value:
                if ts_value > 1e12:
                    ts_value /= 1000.0
                timestamp = ts_value

        if lat is not None and lon is not None:
            self._store.add(lat, lon, timestamp)

        iso_time = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
        distance_km = None
        azimuth_deg = None
        if lat is not None and lon is not None and self._location:
            try:
                distance_km = _haversine_km(self._location[0], self._location[1], lat, lon)
                azimuth_deg = _bearing_deg(self._location[0], self._location[1], lat, lon)
            except Exception:  # pragma: no cover - defensivo
                logger.debug("No se pudo calcular distancia/azimut", exc_info=True)
        with self._status_lock:
            counters = self._status.get("counters")
            if isinstance(counters, dict):
                counters["received"] = counters.get("received", 0) + 1
                counters["last_distance_km"] = distance_km
                counters["last_azimuth_deg"] = azimuth_deg
        self._update_status({"last_event_at": iso_time})

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


def _resolve_location(app_config: Optional[AppConfig]) -> Optional[Tuple[float, float]]:
    override = get_location_override()
    if override:
        return override
    return None


def _to_consumer_config(app_config: Optional[AppConfig]) -> Optional[_ConsumerConfig]:
    if app_config is None:
        return None
    blitz_cfg: Optional[BlitzortungConfig] = getattr(app_config, "blitzortung", None)
    if blitz_cfg is None:
        return None
    enabled = bool(getattr(blitz_cfg, "enabled", False))
    mqtt_cfg = getattr(blitz_cfg, "mqtt", None)
    if mqtt_cfg is None:
        return _ConsumerConfig(enabled=False, mode="public_proxy", settings=None, location=None)

    mode = getattr(mqtt_cfg, "mode", getattr(blitz_cfg, "mode", "public_proxy")) or "public_proxy"
    mode = str(mode).strip().lower()
    base_topic = getattr(mqtt_cfg, "proxy_baseTopic", None) or "blitzortung"
    geohash = getattr(mqtt_cfg, "geohash", None)
    radius = getattr(mqtt_cfg, "radius_km", None)
    radius_int = int(radius) if isinstance(radius, (int, float)) else 100

    settings: Optional[SettingsType]
    if mode == "custom_broker":
        host = getattr(mqtt_cfg, "host", None)
        if not host:
            settings = None
        else:
            settings = _CustomBrokerSettings(
                host=str(host),
                port=int(getattr(mqtt_cfg, "port", 1883) or 1883),
                ssl=bool(getattr(mqtt_cfg, "ssl", False)),
                username=getattr(mqtt_cfg, "username", None),
                password=getattr(mqtt_cfg, "password", None),
                base_topic=str(base_topic),
                geohash=str(geohash) if geohash else None,
                radius_km=radius_int,
            )
    else:
        mode = "public_proxy"
        settings = _ProxySettings(
            host=str(getattr(mqtt_cfg, "proxy_host", getattr(mqtt_cfg, "host", "mqtt.blitzortung.org"))),
            port=int(getattr(mqtt_cfg, "proxy_port", getattr(mqtt_cfg, "port", 8883)) or 8883),
            ssl=bool(getattr(mqtt_cfg, "proxy_ssl", True)),
            base_topic=str(base_topic),
            geohash=str(geohash) if geohash else None,
            radius_km=radius_int,
        )

    location = _resolve_location(app_config)
    return _ConsumerConfig(enabled=enabled and settings is not None, mode=mode, settings=settings, location=location)


def configure_from_app_config(app_config: Optional[AppConfig]) -> None:
    _CONSUMER.configure(_to_consumer_config(app_config))


def configure_from_disk() -> None:
    try:
        app_config = read_config()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("No se pudo cargar configuración Blitzortung: %s", exc)
        app_config = None
    configure_from_app_config(app_config)


def shutdown() -> None:
    _CONSUMER.stop()


def recent_strikes(limit: int = 500) -> List[Tuple[float, float]]:
    return _CONSUMER.recent(limit)


def consumer_status() -> Dict[str, Any]:
    status = _CONSUMER.status()
    return status


def main() -> None:  # pragma: no cover - manual execution
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
    configure_from_disk()
    try:
        while True:
            time.sleep(30)
    except KeyboardInterrupt:
        logger.info("Blitzortung consumer detenido por usuario")
        shutdown()

