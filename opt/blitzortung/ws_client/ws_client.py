#!/usr/bin/env python3
"""Blitzortung WebSocket client that republishes strokes to MQTT."""
from __future__ import annotations

import argparse
import json
import logging
import signal
import ssl
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional

import paho.mqtt.client as mqtt
from dateutil import parser as date_parser
import websocket

try:
    import yaml
except ImportError:  # pragma: no cover - PyYAML is optional at runtime
    yaml = None  # type: ignore

LOGGER = logging.getLogger("blitz_ws_client")
_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def configure_logging(log_path: Optional[Path]) -> None:
    """Configure logging either to stdout or to the provided file."""
    handlers: List[logging.Handler] = []
    log_format = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

    if log_path:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handlers.append(handler)
    else:
        handlers.append(logging.StreamHandler(sys.stdout))

    logging.basicConfig(level=logging.INFO, format=log_format, handlers=handlers, force=True)


@dataclass
class ClientSettings:
    ws_url: str = "wss://ws.blitzortung.org:3000"
    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = 1883
    topic_prefix: str = "blitzortung/1.1"
    geohash_precision: int = 4
    reconnect_delay: float = 10.0
    keepalive: int = 30
    client_id: str = "blitz-ws-client"
    station_filter: List[int] = field(default_factory=list)
    log_file: Optional[Path] = None
    raw_topic: Optional[str] = None
    ping_interval: Optional[int] = None


def load_settings(args: argparse.Namespace) -> ClientSettings:
    """Load settings from CLI arguments and optional YAML file."""
    settings = ClientSettings()

    config_path = Path(args.config).expanduser() if getattr(args, "config", None) else None
    if config_path and config_path.exists() and yaml is not None:
        with config_path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        for key, value in data.items():
            if hasattr(settings, key):
                setattr(settings, key, value)

    for key in ("ws_url", "mqtt_host", "mqtt_port", "topic_prefix", "geohash_precision",
                "reconnect_delay", "keepalive", "client_id", "raw_topic", "ping_interval"):
        if getattr(args, key, None) is not None:
            setattr(settings, key, getattr(args, key))

    if getattr(args, "station_filter", None):
        settings.station_filter = list({int(v) for v in args.station_filter})

    if getattr(args, "log", None):
        settings.log_file = Path(args.log).expanduser()

    if settings.raw_topic is None:
        settings.raw_topic = f"{settings.topic_prefix}/raw"

    return settings


class MQTTForwarder:
    """Wrapper around a paho MQTT client with auto reconnect."""

    def __init__(self, settings: ClientSettings) -> None:
        self._settings = settings
        self._client = mqtt.Client(client_id=settings.client_id, clean_session=True)
        self._client.enable_logger(LOGGER.getChild("mqtt"))
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._connected = threading.Event()
        self._lock = threading.Lock()

    def start(self) -> None:
        LOGGER.info("Connecting to MQTT broker %s:%s", self._settings.mqtt_host, self._settings.mqtt_port)
        try:
            self._client.connect(self._settings.mqtt_host, self._settings.mqtt_port, self._settings.keepalive)
            self._client.loop_start()
        except Exception:
            LOGGER.exception("Unable to connect to MQTT broker")
            raise

    def stop(self) -> None:
        with self._lock:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                LOGGER.debug("Ignoring MQTT shutdown error", exc_info=True)

    def publish(self, topic: str, payload: str, retain: bool = False) -> None:
        if not self._client.is_connected():
            LOGGER.debug("MQTT client not connected, skipping publish to %s", topic)
            return
        result = self._client.publish(topic, payload=payload, qos=0, retain=retain)
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            LOGGER.warning("MQTT publish failed (%s) for topic %s", result.rc, topic)

    # MQTT callbacks -----------------------------------------------------
    def _on_connect(self, client: mqtt.Client, userdata: Any, flags: Dict[str, Any], rc: int) -> None:  # noqa: D401
        if rc == 0:
            LOGGER.info("Connected to MQTT broker")
            self._connected.set()
        else:
            LOGGER.error("MQTT connection failed with rc=%s", rc)

    def _on_disconnect(self, client: mqtt.Client, userdata: Any, rc: int) -> None:  # noqa: D401
        if rc == 0:
            LOGGER.info("MQTT broker closed the connection")
        else:
            LOGGER.warning("MQTT disconnected unexpectedly (rc=%s)", rc)
        self._connected.clear()


def encode_geohash(latitude: float, longitude: float, precision: int) -> str:
    if precision <= 0:
        raise ValueError("precision must be positive")

    lat_interval = [-90.0, 90.0]
    lon_interval = [-180.0, 180.0]
    geohash: List[str] = []
    bits = [16, 8, 4, 2, 1]
    bit = 0
    ch = 0
    even = True

    while len(geohash) < precision:
        if even:
            mid = (lon_interval[0] + lon_interval[1]) / 2
            if longitude > mid:
                ch |= bits[bit]
                lon_interval[0] = mid
            else:
                lon_interval[1] = mid
        else:
            mid = (lat_interval[0] + lat_interval[1]) / 2
            if latitude > mid:
                ch |= bits[bit]
                lat_interval[0] = mid
            else:
                lat_interval[1] = mid
        even = not even
        if bit < 4:
            bit += 1
        else:
            geohash.append(_BASE32[ch])
            bit = 0
            ch = 0

    return "".join(geohash)


def _extract_time(data: Dict[str, Any]) -> str:
    for key in ("time", "timestamp", "datetime", "created_at", "t"):
        if key in data and data[key]:
            value = data[key]
            if isinstance(value, (int, float)):
                dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
                return dt.isoformat()
            try:
                dt = date_parser.parse(str(value))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc).isoformat()
            except Exception:
                LOGGER.debug("Unable to parse time value %s", value, exc_info=True)
    return datetime.now(tz=timezone.utc).isoformat()


def _extract_stations(data: Dict[str, Any]) -> List[int]:
    for key in ("stations", "sta", "station", "s"):
        if key in data and data[key]:
            value = data[key]
            if isinstance(value, list):
                try:
                    return [int(v) for v in value]
                except Exception:
                    return []
            try:
                return [int(value)]
            except Exception:
                return []
    return []


def parse_events(message: str) -> Iterable[Dict[str, Any]]:
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        LOGGER.debug("Non JSON payload received: %s", message)
        return []

    return list(_walk_payload(payload))


def _walk_payload(payload: Any) -> Iterator[Dict[str, Any]]:
    if isinstance(payload, dict):
        lowered = {k.lower(): k for k in payload.keys()}
        if "lat" in lowered and "lon" in lowered:
            lat_key = lowered["lat"]
            lon_key = lowered["lon"]
            try:
                latitude = float(payload[lat_key])
                longitude = float(payload[lon_key])
            except (TypeError, ValueError):
                LOGGER.debug("Invalid coordinates in payload: %s", payload)
            else:
                event: Dict[str, Any] = {
                    "latitude": latitude,
                    "longitude": longitude,
                    "time": _extract_time(payload),
                    "polarity": payload.get(lowered.get("pol") or lowered.get("polarity")),
                    "amplitude": payload.get(lowered.get("amp") or lowered.get("amplitude")),
                    "station_ids": _extract_stations(payload),
                    "raw": payload,
                }
                if "id" in lowered:
                    event["id"] = payload[lowered["id"]]
                yield event
        for value in payload.values():
            yield from _walk_payload(value)
    elif isinstance(payload, list):
        for item in payload:
            yield from _walk_payload(item)


class BlitzWSClient:
    def __init__(self, settings: ClientSettings, forwarder: MQTTForwarder) -> None:
        self._settings = settings
        self._forwarder = forwarder
        self._ws: Optional[websocket.WebSocketApp] = None
        self._stop_event = threading.Event()

    def start(self, run_duration: Optional[float] = None) -> None:
        end_time = time.monotonic() + run_duration if run_duration else None
        while not self._stop_event.is_set():
            if end_time and time.monotonic() >= end_time:
                LOGGER.info("Run duration reached, stopping WebSocket client")
                break
            self._run_once()
            if self._stop_event.is_set():
                break
            LOGGER.info("Reconnecting in %.1f seconds", self._settings.reconnect_delay)
            time.sleep(self._settings.reconnect_delay)

    def stop(self) -> None:
        self._stop_event.set()
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                LOGGER.debug("Error closing websocket", exc_info=True)

    # Internal helpers --------------------------------------------------
    def _run_once(self) -> None:
        sslopt: Dict[str, Any] = {"cert_reqs": ssl.CERT_REQUIRED}
        self._ws = websocket.WebSocketApp(
            self._settings.ws_url,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
            on_open=self._on_open,
        )

        LOGGER.info("Connecting to Blitzortung WebSocket %s", self._settings.ws_url)
        try:
            self._ws.run_forever(
                sslopt=sslopt,
                ping_interval=self._settings.ping_interval,
                ping_timeout=10,
            )
        except Exception:
            LOGGER.exception("WebSocket connection crashed")

    # WebSocket callbacks -----------------------------------------------
    def _on_open(self, ws: websocket.WebSocketApp) -> None:  # noqa: D401
        LOGGER.info("WebSocket connection established")

    def _on_close(self, ws: websocket.WebSocketApp, status_code: int, msg: str) -> None:  # noqa: D401
        LOGGER.warning("WebSocket closed (code=%s, message=%s)", status_code, msg)

    def _on_error(self, ws: websocket.WebSocketApp, error: Exception) -> None:  # noqa: D401
        LOGGER.error("WebSocket error: %s", error)

    def _on_message(self, ws: websocket.WebSocketApp, message: str) -> None:  # noqa: D401
        events = parse_events(message)
        if not events:
            return
        for event in events:
            if self._settings.station_filter:
                if not event["station_ids"]:
                    LOGGER.debug("Skipping event without station info due to filter")
                    continue
                if not any(sta in self._settings.station_filter for sta in event["station_ids"]):
                    continue
            try:
                geohash = encode_geohash(event["latitude"], event["longitude"], self._settings.geohash_precision)
            except ValueError:
                LOGGER.debug("Skipping event with invalid coordinates: %s", event)
                continue
            topic = f"{self._settings.topic_prefix}/{geohash}/stroke"
            payload = json.dumps(event, ensure_ascii=False, sort_keys=True)
            self._forwarder.publish(topic, payload)
            if self._settings.raw_topic:
                self._forwarder.publish(self._settings.raw_topic, json.dumps(event["raw"], ensure_ascii=False))
            LOGGER.info("Published stroke to %s", topic)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Blitzortung WebSocket client -> MQTT forwarder")
    parser.add_argument("--config", help="YAML configuration file", default=None)
    parser.add_argument("--ws-url", dest="ws_url", help="WebSocket endpoint", default=None)
    parser.add_argument("--mqtt-host", dest="mqtt_host", help="MQTT host", default=None)
    parser.add_argument("--mqtt-port", dest="mqtt_port", type=int, help="MQTT port", default=None)
    parser.add_argument("--topic-prefix", dest="topic_prefix", help="MQTT topic prefix", default=None)
    parser.add_argument("--geohash-precision", dest="geohash_precision", type=int, help="Geohash precision", default=None)
    parser.add_argument("--log", dest="log", help="Log file path", default=None)
    parser.add_argument("--reconnect-delay", dest="reconnect_delay", type=float, default=None)
    parser.add_argument("--keepalive", dest="keepalive", type=int, default=None)
    parser.add_argument("--client-id", dest="client_id", default=None)
    parser.add_argument("--station-filter", dest="station_filter", action="append", help="Station IDs to include", default=None)
    parser.add_argument("--raw-topic", dest="raw_topic", default=None)
    parser.add_argument("--ping-interval", dest="ping_interval", type=int, default=None)
    parser.add_argument("--run-duration", dest="run_duration", type=float, default=None,
                        help="Optional duration (seconds) for foreground runs, useful for tests")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    settings = load_settings(args)
    configure_logging(settings.log_file)

    LOGGER.info("Starting Blitzortung WebSocket client")
    forwarder = MQTTForwarder(settings)
    try:
        forwarder.start()
    except Exception:
        LOGGER.error("Aborting due to MQTT connection failure")
        return 2

    client = BlitzWSClient(settings, forwarder)

    def _handle_signal(signum: int, _frame: Any) -> None:
        LOGGER.info("Received signal %s, shutting down", signum)
        client.stop()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, _handle_signal)

    try:
        client.start(run_duration=args.run_duration)
    finally:
        forwarder.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
