#!/usr/bin/env python3
"""
Blitzortung Relay WS→MQTT (Real feed)
Autor: Codex + Dani
Obtiene strikes de fuentes públicas (LightningMaps o Blitzortung) y los reenvía a Mosquitto local.
"""
import asyncio
import json
import logging
import time

import aiohttp
import paho.mqtt.client as mqtt

WS_SOURCES = [
    "wss://ws.lightningmaps.org/realtime",
    "wss://blitzortung.net/ws",
]
MQTT_HOST = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC = "blitzortung/1.1"
RETRY_DELAY = 15

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)


def publish_strike(mqttc: mqtt.Client, data: dict) -> None:
    if all(k in data for k in ("lat", "lon")):
        topic = f"{MQTT_TOPIC}/{int(time.time())}"
        payload = json.dumps(data)
        mqttc.publish(topic, payload)
        logging.info("⚡ %.3f,%.3f", data["lat"], data["lon"])


async def relay_loop() -> None:
    mqttc = mqtt.Client(client_id="pantalla-blitz-relay")
    mqttc.connect(MQTT_HOST, MQTT_PORT, 60)
    mqttc.loop_start()

    session_timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=None)

    while True:
        for src in WS_SOURCES:
            try:
                logging.info("Conectando a %s", src)
                async with aiohttp.ClientSession(timeout=session_timeout) as session:
                    async with session.ws_connect(src, heartbeat=30) as ws:
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                try:
                                    data = json.loads(msg.data)
                                except json.JSONDecodeError:
                                    continue
                                publish_strike(mqttc, data)
                            elif msg.type == aiohttp.WSMsgType.ERROR:
                                break
            except Exception as exc:  # noqa: BLE001
                logging.warning("Error WS %s: %s", src, exc)
            await asyncio.sleep(RETRY_DELAY)


def main() -> None:
    try:
        asyncio.run(relay_loop())
    except KeyboardInterrupt:
        logging.info("Detenido por usuario")


if __name__ == "__main__":
    main()
