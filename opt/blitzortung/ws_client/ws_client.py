#!/usr/bin/env python3
"""Blitzortung WebSocket → MQTT client."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time
from typing import Any, Dict, Optional

import aiohttp
import paho.mqtt.client as mqtt

LOG_LEVEL = os.getenv("BLITZ_LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s [%(levelname)s] %(message)s")


class BlitzWSClient:
    """Stream lightning strikes from Blitzortung proxy to MQTT."""

    def __init__(self) -> None:
        self.ws_url = os.getenv("BLITZ_WS_URL", "wss://blitzortung-proxy.fly.dev/ws")
        self.heartbeat = int(os.getenv("BLITZ_HEARTBEAT", "20"))
        self.mqtt_host = os.getenv("MQTT_HOST", "127.0.0.1")
        self.mqtt_port = int(os.getenv("MQTT_PORT", "1883"))
        self.mqtt_topic = os.getenv("MQTT_TOPIC", "blitzortung/1")
        self._session: Optional[aiohttp.ClientSession] = None
        self._stop = asyncio.Event()
        self._mqtt = self._create_mqtt_client()

    def _create_mqtt_client(self) -> mqtt.Client:
        client = mqtt.Client(client_id="pantalla-blitz-ws", protocol=mqtt.MQTTv311)
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        return client

    def _on_connect(self, client: mqtt.Client, userdata: Any, flags: Dict[str, Any], rc: int) -> None:
        if rc == 0:
            logging.info("MQTT conectado a %s:%s", self.mqtt_host, self.mqtt_port)
        else:
            logging.warning("MQTT conexión devuelta con rc=%s", rc)

    def _on_disconnect(self, client: mqtt.Client, userdata: Any, rc: int) -> None:
        if rc != 0:
            logging.warning("MQTT desconectado inesperadamente (rc=%s) — reintentando", rc)

    def _connect_mqtt(self) -> None:
        try:
            self._mqtt.connect(self.mqtt_host, self.mqtt_port, keepalive=self.heartbeat * 2)
        except Exception as exc:  # noqa: BLE001
            logging.error("No se pudo conectar a MQTT: %s", exc)
            raise
        self._mqtt.loop_start()

    def stop(self) -> None:
        self._stop.set()

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, self.stop)

        self._connect_mqtt()
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=None)

        while not self._stop.is_set():
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    self._session = session
                    logging.info("Conectando a %s", self.ws_url)
                    async with session.ws_connect(self.ws_url, heartbeat=self.heartbeat) as ws:
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                self._handle_message(msg.data)
                            elif msg.type == aiohttp.WSMsgType.ERROR:
                                logging.warning("Error de WebSocket: %s", ws.exception())
                                break
            except asyncio.CancelledError:  # pragma: no cover - handled by stop
                break
            except Exception as exc:  # noqa: BLE001
                if not self._stop.is_set():
                    logging.warning("Fallo en WS Blitzortung: %s", exc)
            await asyncio.sleep(5)

        self._mqtt.loop_stop()
        self._mqtt.disconnect()

    def _handle_message(self, payload: str) -> None:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return

        if isinstance(data, dict) and {"lat", "lon"}.issubset(data):
            strike_topic = f"{self.mqtt_topic}/{int(time.time())}"
            self._mqtt.publish(strike_topic, json.dumps(data))
            logging.info("⚡ %.4f, %.4f", data["lat"], data["lon"])


async def main() -> None:
    client = BlitzWSClient()
    await client.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
