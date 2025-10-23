#!/usr/bin/env python3
"""Asynchronous Blitzortung WebSocket -> MQTT forwarder for Pantalla."""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp
import paho.mqtt.client as mqtt

DEFAULT_CONFIG_PATH = Path("/etc/pantalla-dash/config.json")


@dataclass
class Settings:
    """Runtime configuration for the WebSocket client."""

    ws_url: str
    mqtt_host: str
    mqtt_port: int
    mqtt_topic: str
    reconnect_initial: float = 5.0
    reconnect_max: float = 60.0
    heartbeat: float = 30.0


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Blitzortung WebSocket client")
    parser.add_argument("--config", help="Ruta al config.json", default=None)
    parser.add_argument("--ws-url", help="URL del WebSocket", default=None)
    parser.add_argument("--mqtt-host", help="Host MQTT", default=None)
    parser.add_argument("--mqtt-port", help="Puerto MQTT", default=None)
    parser.add_argument("--mqtt-topic", help="Topic MQTT", default=None)
    parser.add_argument("--debug", action="store_true", help="Activa logs DEBUG")
    return parser.parse_args(argv)


def load_json(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        logging.debug("Config file %s no encontrado", path)
    except json.JSONDecodeError as exc:
        logging.warning("Config file %s inválido: %s", path, exc)
    return {}


def resolve_settings(args: argparse.Namespace) -> Settings:
    config_path = Path(args.config).expanduser() if args.config else DEFAULT_CONFIG_PATH
    data = load_json(config_path)
    blitz_cfg = data.get("blitzortung", {})
    mqtt_cfg = data.get("mqtt", {})

    env = os.environ
    ws_url = (
        args.ws_url
        or env.get("BLITZ_WS_URL")
        or blitz_cfg.get("ws_url")
        or "wss://ws.blitzortung.org:3000"
    )
    mqtt_host = args.mqtt_host or env.get("MQTT_HOST") or mqtt_cfg.get("host") or "127.0.0.1"
    mqtt_port = int(args.mqtt_port or env.get("MQTT_PORT") or mqtt_cfg.get("port") or 1883)
    mqtt_topic = args.mqtt_topic or env.get("MQTT_TOPIC") or mqtt_cfg.get("topic") or "blitzortung/1"

    return Settings(ws_url=ws_url, mqtt_host=mqtt_host, mqtt_port=mqtt_port, mqtt_topic=mqtt_topic)


class MQTTBridge:
    """Thin wrapper around a Paho MQTT client."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = mqtt.Client(client_id="pantalla-blitz-ws")
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.enable_logger(logging.getLogger("mqtt"))
        self._connected = False

    def start(self) -> None:
        logging.info("Conectando MQTT %s:%s", self._settings.mqtt_host, self._settings.mqtt_port)
        try:
            self._client.connect(self._settings.mqtt_host, self._settings.mqtt_port, keepalive=60)
        except Exception as exc:  # pragma: no cover - dependencias externas
            logging.error("No se pudo conectar a MQTT: %s", exc)
            raise
        self._client.loop_start()

    def stop(self) -> None:
        self._client.loop_stop()
        try:
            self._client.disconnect()
        except Exception:  # pragma: no cover - mejor esfuerzo
            logging.debug("Ignorando error al desconectar MQTT", exc_info=True)

    # callbacks ---------------------------------------------------------
    def _on_connect(self, client: mqtt.Client, userdata: Any, flags: Dict[str, Any], rc: int) -> None:
        if rc == 0:
            self._connected = True
            logging.info("MQTT conectado")
        else:
            self._connected = False
            logging.warning("MQTT conexión falló (rc=%s)", rc)

    def _on_disconnect(self, client: mqtt.Client, userdata: Any, rc: int) -> None:
        self._connected = False
        if rc == 0:
            logging.info("MQTT desconectado")
        else:
            logging.warning("MQTT desconectado inesperadamente (rc=%s)", rc)

    def publish(self, payload: Dict[str, Any]) -> None:
        if not self._connected:
            logging.debug("MQTT no conectado, descartando evento")
            return
        try:
            result = self._client.publish(self._settings.mqtt_topic, json.dumps(payload), qos=0, retain=False)
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                logging.warning("Publicación MQTT falló rc=%s", result.rc)
        except Exception:  # pragma: no cover
            logging.exception("Error publicando en MQTT")


def parse_event(message: str) -> Optional[Dict[str, Any]]:
    """Intenta convertir la cadena recibida en evento JSON listo para MQTT."""

    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        logging.debug("Payload no JSON: %s", message)
        return None

    if isinstance(data, list) and data:
        data = data[0]
    if not isinstance(data, dict):
        logging.debug("Payload no soportado: %s", data)
        return None

    timestamp = _extract_timestamp(data)
    lat = _coerce_float(data.get("lat") or data.get("latitude"))
    lon = _coerce_float(data.get("lon") or data.get("longitude"))
    if lat is None or lon is None:
        logging.debug("Evento sin lat/lon: %s", data)
        return None

    payload: Dict[str, Any] = {
        "timestamp": timestamp,
        "lat": lat,
        "lon": lon,
    }
    intensity = _coerce_float(data.get("intensity") or data.get("ampere") or data.get("strength"))
    if intensity is not None:
        payload["intensity"] = intensity
    return payload


def _coerce_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_timestamp(data: Dict[str, Any]) -> str:
    for key in ("timestamp", "time", "datetime", "created_at"):
        raw = data.get(key)
        if raw is None:
            continue
        if isinstance(raw, (int, float)):
            return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(raw)))
        if isinstance(raw, str) and raw:
            return raw
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


async def consume_ws(settings: Settings, mqtt_bridge: MQTTBridge, stop_event: asyncio.Event) -> None:
    reconnect = settings.reconnect_initial
    timeout = aiohttp.ClientTimeout(total=None, sock_connect=30)

    while not stop_event.is_set():
        logging.info("Conectando WS %s", settings.ws_url)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.ws_connect(settings.ws_url, heartbeat=settings.heartbeat) as ws:
                    logging.info("WS conectado")
                    reconnect = settings.reconnect_initial
                    async for msg in ws:
                        if stop_event.is_set():
                            break
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            payload = parse_event(msg.data)
                            if payload:
                                mqtt_bridge.publish(payload)
                                logging.debug("Evento publicado: %s", payload)
                            else:
                                logging.debug("Evento descartado")
                        elif msg.type == aiohttp.WSMsgType.BINARY:
                            logging.debug("Evento binario ignorado (%d bytes)", len(msg.data))
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            raise msg.data
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.warning("Error en WS: %s", exc, exc_info=True)
        if stop_event.is_set():
            break
        logging.info("Reconectando WS en %.1f s", reconnect)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=reconnect)
        except asyncio.TimeoutError:
            pass
        reconnect = min(reconnect * 2, settings.reconnect_max)


async def amain(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    settings = resolve_settings(args)
    logging.info(
        "Iniciando Blitzortung WS client (ws=%s mqtt=%s:%s topic=%s)",
        settings.ws_url,
        settings.mqtt_host,
        settings.mqtt_port,
        settings.mqtt_topic,
    )

    mqtt_bridge = MQTTBridge(settings)
    mqtt_bridge.start()

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _stop() -> None:
        if not stop_event.is_set():
            logging.info("Recibida señal de parada")
            stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _stop)
        except NotImplementedError:  # pragma: no cover - Windows
            signal.signal(sig, lambda s, f: _stop())

    try:
        await consume_ws(settings, mqtt_bridge, stop_event)
    finally:
        mqtt_bridge.stop()
    return 0


def main() -> int:
    try:
        return asyncio.run(amain())
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
