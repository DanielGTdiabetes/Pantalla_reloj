"""Background MQTT consumer for Blitzortung lightning feeds."""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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
class _RuntimeConfig:
    enabled: bool
    host: str
    port: int
    topic: str
    radius_km: int
    window_minutes: int
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


def _coerce_float(value: Any) -> Optional[float]:
    try:
        candidate = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(candidate):
        return None
    return candidate


def _coerce_timestamp(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        ts = float(value)
    except (TypeError, ValueError):
        return None
    if ts > 1e12:
        ts /= 1000.0
    if not math.isfinite(ts):
        return None
    return ts


def _extract_lat(data: Dict[str, Any]) -> Optional[float]:
    for key in ("lat", "latitude", "latitud"):
        if key in data:
            candidate = _coerce_float(data[key])
            if candidate is not None:
                return candidate
    position = data.get("position") if isinstance(data.get("position"), dict) else None
    if isinstance(position, dict):
        return _coerce_float(position.get("lat"))
    return None


def _extract_lon(data: Dict[str, Any]) -> Optional[float]:
    for key in ("lon", "longitude", "longitud"):
        if key in data:
            candidate = _coerce_float(data[key])
            if candidate is not None:
                return candidate
    position = data.get("position") if isinstance(data.get("position"), dict) else None
    if isinstance(position, dict):
        return _coerce_float(position.get("lon"))
    return None


def _extract_timestamp(data: Dict[str, Any]) -> Optional[float]:
    for key in ("time", "timestamp", "ts", "datetime"):
        if key in data:
            candidate = _coerce_timestamp(data[key])
            if candidate is not None:
                return candidate
    return None


def _normalize_topic(base: str) -> str:
    cleaned = (base or "blitzortung/").replace("#", "").strip()
    if not cleaned:
        cleaned = "blitzortung"
    cleaned = cleaned.strip("/")
    return f"{cleaned}/#"


def _resolve_location(app_config: Optional[AppConfig]) -> Optional[Tuple[float, float]]:
    override = get_location_override()
    if override:
        return override
    if app_config and app_config.weather:
        lat = getattr(app_config.weather, "lat", None)
        lon = getattr(app_config.weather, "lon", None)
        lat_f = _coerce_float(lat)
        lon_f = _coerce_float(lon)
        if lat_f is not None and lon_f is not None:
            return lat_f, lon_f
    return None


def _build_runtime_config(app_config: Optional[AppConfig]) -> Optional[_RuntimeConfig]:
    if app_config is None:
        return None
    blitz_cfg: Optional[BlitzortungConfig] = getattr(app_config, "blitzortung", None)
    if blitz_cfg is None or not getattr(blitz_cfg, "enabled", False):
        return None
    raw_host = getattr(blitz_cfg, "mqtt_host", None)
    raw_port = getattr(blitz_cfg, "mqtt_port", None)
    raw_topic = getattr(blitz_cfg, "topic_base", None)
    raw_radius = getattr(blitz_cfg, "radius_km", None)
    raw_window = getattr(blitz_cfg, "time_window_min", None)

    extra = getattr(blitz_cfg, "model_extra", {}) if hasattr(blitz_cfg, "model_extra") else {}
    mqtt_extra = extra.get("mqtt") if isinstance(extra, dict) else None
    if isinstance(mqtt_extra, dict):
        raw_host = raw_host or mqtt_extra.get("host") or mqtt_extra.get("proxy_host")
        raw_port = raw_port or mqtt_extra.get("port") or mqtt_extra.get("proxy_port")
        raw_topic = raw_topic or mqtt_extra.get("proxy_baseTopic") or mqtt_extra.get("baseTopic")
        raw_radius = raw_radius or mqtt_extra.get("radius_km")

    host = (raw_host or "").strip()
    if not host:
        return None
    try:
        port = int(raw_port or 1883)
    except (TypeError, ValueError):  # pragma: no cover - defensive fallback
        port = 1883
    topic = _normalize_topic(raw_topic or "blitzortung/")
    radius = int(raw_radius or 0)
    window = int(raw_window or 30)
    location = _resolve_location(app_config)
    return _RuntimeConfig(
        enabled=True,
        host=host,
        port=port,
        topic=topic,
        radius_km=max(0, radius),
        window_minutes=max(1, window),
        location=location,
    )


class BlitzMQTTConsumer:
    """Manage a background MQTT client to consume Blitzortung events."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._client: Optional["mqtt.Client"] = None
        self._config: Optional[_RuntimeConfig] = None
        self._store = BlitzStore()
        self._status_lock = threading.Lock()
        self._status: Dict[str, Any] = {
            "source": "disabled",
            "connected": False,
            "topic": None,
            "nearest_distance_km": None,
            "azimuth_deg": None,
            "count_recent": 0,
            "last_ts": None,
            "radius_km": None,
            "time_window_min": None,
            "last_error": None,
        }
        self._location: Optional[Tuple[float, float]] = None
        self._current_topic: Optional[str] = None

    def configure(self, config: Optional[_RuntimeConfig]) -> None:
        with self._lock:
            self._config = config
            self._location = config.location if config else None
            if config and config.window_minutes > 0:
                self._store = BlitzStore(ttl_seconds=config.window_minutes * 60)
            else:
                self._store.clear()
            if config:
                self._update_status(
                    {
                        "radius_km": config.radius_km,
                        "time_window_min": config.window_minutes,
                    }
                )
            else:
                self._update_status(
                    {
                        "radius_km": None,
                        "time_window_min": None,
                    }
                )
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
        self._update_status(
            {
                "source": "disabled",
                "connected": False,
                "topic": None,
                "nearest_distance_km": None,
                "azimuth_deg": None,
                "count_recent": 0,
                "last_ts": None,
                "radius_km": None,
                "time_window_min": None,
                "last_error": None,
            }
        )

    def recent(self, limit: int = 500) -> List[Tuple[float, float]]:
        coords = self._store.recent()
        return coords[:limit] if limit >= 0 else coords

    def status(self) -> Dict[str, Any]:
        with self._status_lock:
            return json.loads(json.dumps(self._status))

    def _ensure_thread(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="BlitzMQTTConsumer", daemon=True)
        self._thread.start()

    def _disconnect_client(self) -> None:
        client = self._client
        if client is None:
            return
        try:
            client.disconnect()
        except Exception:  # pragma: no cover - defensive
            logger.debug("Error desconectando MQTT Blitzortung", exc_info=True)
        self._client = None

    def _wait_for_wakeup(self, timeout: Optional[float] = None) -> bool:
        triggered = self._wake_event.wait(timeout)
        if triggered:
            self._wake_event.clear()
        return triggered

    def _update_status(self, updates: Dict[str, Any]) -> None:
        with self._status_lock:
            self._status.update(updates)

    def _run_loop(self) -> None:
        backoff = 1
        while not self._stop_event.is_set():
            config = self._config
            if not config or not config.enabled:
                self._disconnect_client()
                self._store.clear()
                self._update_status(
                    {
                        "source": "disabled",
                        "connected": False,
                        "topic": None,
                        "nearest_distance_km": None,
                        "azimuth_deg": None,
                        "count_recent": 0,
                        "last_ts": None,
                        "last_error": None,
                    }
                )
                self._wait_for_wakeup(timeout=1)
                backoff = 1
                continue

            if mqtt is None:
                self._update_status(
                    {
                        "source": "mqtt",
                        "connected": False,
                        "topic": config.topic,
                        "radius_km": config.radius_km,
                        "time_window_min": config.window_minutes,
                        "last_error": "paho-mqtt no disponible",
                    }
                )
                self._wait_for_wakeup(timeout=10)
                continue

            try:
                self._connect_and_loop(config)
                backoff = 1
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Error Blitzortung MQTT: %s", exc)
                self._update_status(
                    {
                        "source": "mqtt",
                        "connected": False,
                        "last_error": str(exc),
                    }
                )
                self._disconnect_client()
                if self._stop_event.wait(timeout=backoff):
                    break
                backoff = min(backoff * 2, 60)

    def _connect_and_loop(self, config: _RuntimeConfig) -> None:
        client = self._create_client()
        client.enable_logger(logger)
        client.on_connect = self._on_connect  # type: ignore[assignment]
        client.on_disconnect = self._on_disconnect  # type: ignore[assignment]
        client.on_message = self._on_message  # type: ignore[assignment]

        self._current_topic = config.topic
        self._update_status(
            {
                "source": "mqtt",
                "connected": False,
                "topic": config.topic,
                "radius_km": config.radius_km,
                "time_window_min": config.window_minutes,
                "last_error": None,
            }
        )

        client.connect(config.host, config.port, keepalive=30)

        with self._lock:
            self._client = client

        while not self._stop_event.is_set():
            if self._wake_event.is_set():
                self._wake_event.clear()
                break
            client.loop(timeout=1.0)

        try:
            client.disconnect()
        except Exception:  # pragma: no cover - defensive
            logger.debug("Error al desconectar MQTT Blitzortung", exc_info=True)
        finally:
            with self._lock:
                self._client = None

    def _create_client(self) -> "mqtt.Client":
        if mqtt is None:  # pragma: no cover - defensive
            raise RuntimeError("paho-mqtt no disponible")
        if CallbackAPIVersion is not None:
            return mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2)
        return mqtt.Client()

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):  # noqa: D401
        del userdata, flags, properties
        if reason_code != 0:
            self._update_status({"connected": False, "last_error": f"MQTT rc={reason_code}"})
            return
        topic = self._current_topic
        if topic:
            try:
                client.subscribe(topic, qos=0)
            except Exception:  # pragma: no cover - defensive
                logger.debug("No se pudo suscribir a %s", topic, exc_info=True)
        self._update_status({"connected": True, "last_error": None})

    def _on_disconnect(self, client, userdata, reason_code, properties=None):  # noqa: D401
        del client, userdata, reason_code, properties
        self._update_status({"connected": False})

    def _on_message(self, client, userdata, message):  # noqa: D401
        del client, userdata
        try:
            payload = message.payload.decode("utf-8", "ignore")
            data = json.loads(payload)
        except Exception:
            logger.debug("Mensaje MQTT inválido en %s", message.topic, exc_info=True)
            return

        if not isinstance(data, dict):
            return

        lat = _extract_lat(data)
        lon = _extract_lon(data)
        if lat is None or lon is None:
            return

        timestamp = _extract_timestamp(data)
        self._store.add(lat, lon, timestamp)
        self._refresh_summary()

    def _refresh_summary(self) -> None:
        config = self._config
        if not config or not config.enabled:
            self._store.clear()
            self._update_status(
                {
                    "count_recent": 0,
                    "nearest_distance_km": None,
                    "azimuth_deg": None,
                    "last_ts": None,
                }
            )
            return

        entries = self._store.strikes()
        radius = max(0, config.radius_km)
        location = self._location
        count = 0
        nearest_distance: Optional[float] = None
        nearest_coords: Optional[Tuple[float, float]] = None
        last_ts: Optional[float] = None

        for strike in entries:
            ts = strike.ts
            if last_ts is None or ts > last_ts:
                last_ts = ts
            include = True
            distance = None
            if location:
                distance = _haversine_km(location[0], location[1], strike.lat, strike.lon)
                if radius > 0 and distance is not None and distance > radius:
                    include = False
                if include and distance is not None:
                    if nearest_distance is None or distance < nearest_distance:
                        nearest_distance = distance
                        nearest_coords = (strike.lat, strike.lon)
            if include:
                count += 1

        if location is None:
            count = len(entries)

        azimuth = None
        if location and nearest_coords and nearest_distance is not None:
            azimuth = _bearing_deg(location[0], location[1], nearest_coords[0], nearest_coords[1])

        iso_ts = None
        if last_ts is not None:
            try:
                iso_ts = datetime.fromtimestamp(last_ts, tz=timezone.utc).isoformat()
            except (OSError, OverflowError, ValueError):  # pragma: no cover - defensive
                iso_ts = None

        self._update_status(
            {
                "count_recent": count,
                "nearest_distance_km": round(nearest_distance, 2) if nearest_distance is not None else None,
                "azimuth_deg": round(azimuth, 1) if azimuth is not None else None,
                "last_ts": iso_ts,
            }
        )


_CONSUMER = BlitzMQTTConsumer()


def configure_from_app_config(app_config: Optional[AppConfig]) -> None:
    runtime = _build_runtime_config(app_config)
    _CONSUMER.configure(runtime)


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
    return _CONSUMER.status()


def main() -> None:  # pragma: no cover - manual execution
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
    configure_from_disk()
    try:
        while True:
            time.sleep(30)
    except KeyboardInterrupt:
        logger.info("Blitzortung consumer detenido por usuario")
        shutdown()


__all__ = [
    "configure_from_app_config",
    "configure_from_disk",
    "consumer_status",
    "recent_strikes",
    "shutdown",
]
