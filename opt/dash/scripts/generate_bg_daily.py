#!/usr/bin/env python3
"""Generador diario de fondos futuristas usando OpenAI."""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional

import requests
from openai import OpenAI
from PIL import Image

AUTO_BACKGROUND_DIR = Path("/opt/dash/assets/backgrounds/auto")
CONFIG_PATH = Path("/etc/pantalla-dash/config.json")
ENV_PATH = Path("/etc/pantalla-dash/env")
LOG_PATH = Path("/var/log/pantalla-dash/bg.log")
LOCK_PATH = Path("/tmp/pantalla-bg-generate.lock")
WEATHER_ENDPOINT = "http://127.0.0.1:8787/api/weather/current"

NEGATIVE_PROMPT = "lowres, blurry, text, watermark, logo, deformed, oversaturated, cartoonish"
IMAGE_MODEL = "gpt-image-1"
IMAGE_SIZE = "1280x720"
TIMEOUT_SECONDS = 60
MAX_FILES = 30

ROTATING_PROMPTS = {
    0: "futuristic megacity at night, neon lights, rain, cinematic lighting, detailed cyberpunk skyline",
    1: "futuristic apartment interior, panoramic window to skyline, dusk, soft rim light, cinematic",
    2: "rainy cyberpunk alley, holograms, reflections, orange teal lights, volumetric fog",
    3: "bright utopian city, white towers, greenery, glass bridges, daylight, clean futuristic style",
    4: "sci-fi industrial complex, robots, energy reactors, volumetric light",
    5: "alien landscape, twin moons, aurora sky, surreal rock arches, vivid colors, cinematic",
    6: "retro-futuristic city at sunset, flying cars, holographic ads, cinematic lighting",
}

WEATHER_PROMPTS = {
    "clear": "bright utopian city, white architecture, clean daylight, greenery, futuristic serenity",
    "rain": "cyberpunk city under rain, neon reflections, puddles, volumetric fog, cinematic lighting",
    "clouds": "futuristic skyline with clouds and soft light, moody atmosphere, aerial view",
    "storm": "sci-fi industrial city during lightning storm, electric arcs, cinematic contrast",
    "snow": "futuristic city in snow, reflections, blue tones, serene, cinematic winter",
    "fog": "dense fog in cyberpunk streets, soft diffused lighting, neon silhouettes",
    "sunset": "retro-futuristic city at sunset, glowing horizon, flying cars, warm tones",
}


def setup_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)


def acquire_lock() -> Optional[int]:
    try:
        LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR)
        try:
            import fcntl  # type: ignore

            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError):
            os.close(fd)
            return None
        return fd
    except OSError:
        return None


def release_lock(fd: Optional[int]) -> None:
    if fd is None:
        return
    try:
        import fcntl  # type: ignore

        fcntl.flock(fd, fcntl.LOCK_UN)
    except OSError:
        pass
    finally:
        os.close(fd)


def read_env_file(path: Path) -> Dict[str, str]:
    data: Dict[str, str] = {}
    if not path.exists():
        return data
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip().strip('"')
    return data


def load_config(path: Path) -> Dict[str, Any]:
    if not path.exists():
        logging.info("Config %s no encontrado, usando valores por defecto", path)
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        logging.error("No se pudo leer config: %s", exc)
        return {}


def resolve_mode(config: Dict[str, Any]) -> str:
    background = config.get("background") or {}
    mode = background.get("mode") or config.get("backgroundMode")
    if isinstance(mode, str) and mode.lower() in {"daily", "weather"}:
        return mode.lower()
    return "daily"


def resolve_retain_days(config: Dict[str, Any]) -> int:
    background = config.get("background") or {}
    value = background.get("retainDays") or config.get("retainDays")
    try:
        retain = int(value)
    except (TypeError, ValueError):
        retain = 30
    return max(1, min(retain, 90))


def fetch_weather_summary() -> Optional[str]:
    try:
        response = requests.get(WEATHER_ENDPOINT, timeout=10)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        logging.warning("No se pudo obtener clima para prompt dinámico: %s", exc)
        return None
    icon = str(payload.get("icon") or "").lower()
    now = datetime.now()
    if icon == "sun":
        if 18 <= now.hour <= 21:
            return "sunset"
        return "clear"
    mapping = {
        "cloud": "clouds",
        "rain": "rain",
        "storm": "storm",
        "snow": "snow",
        "fog": "fog",
    }
    return mapping.get(icon)


def select_prompt(mode: str, weather_key: Optional[str]) -> Dict[str, str]:
    today = datetime.now()
    prompt: str
    used_mode = mode
    if mode == "weather" and weather_key and weather_key in WEATHER_PROMPTS:
        prompt = WEATHER_PROMPTS[weather_key]
    else:
        used_mode = "daily"
        prompt = ROTATING_PROMPTS.get(today.weekday(), ROTATING_PROMPTS[0])
    final_prompt = f"{prompt}. Futuristic ultra-detailed concept art, hyperrealistic materials, cinematic composition. Negative prompt: {NEGATIVE_PROMPT}."
    return {"prompt": final_prompt, "mode": used_mode, "key": weather_key or today.strftime("day-%w")}


def generate_image_bytes(client: OpenAI, prompt: str, timeout: int) -> bytes:
    logging.info("Solicitando imagen a OpenAI con modelo %s", IMAGE_MODEL)
    result = client.images.generate(
        model=IMAGE_MODEL,
        prompt=prompt,
        size=IMAGE_SIZE,
        response_format="b64_json",
        timeout=timeout,
    )
    if not result.data:
        raise RuntimeError("Respuesta vacía de OpenAI")
    encoded = result.data[0].b64_json
    if not encoded:
        raise RuntimeError("Payload de imagen vacío")
    raw = base64.b64decode(encoded)
    with Image.open(BytesIO(raw)) as image:
        image = image.convert("RGB")
        buffer = BytesIO()
        image.save(buffer, format="WEBP", method=6, quality=90)
        return buffer.getvalue()


def persist_image(data: bytes, mode: str, descriptor: str) -> Path:
    AUTO_BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_descriptor = descriptor.replace("/", "-") if descriptor else "bg"
    filename = f"{timestamp}_{mode}_{safe_descriptor}.webp"
    target = AUTO_BACKGROUND_DIR / filename
    with target.open("wb") as handle:
        handle.write(data)
    os.chmod(target, 0o644)
    logging.info("Imagen guardada en %s", target)
    return target


def cleanup_old_files(retain_days: int) -> None:
    if not AUTO_BACKGROUND_DIR.exists():
        return
    files = sorted(AUTO_BACKGROUND_DIR.glob("*.webp"), key=lambda path: path.stat().st_mtime, reverse=True)
    cutoff = datetime.now() - timedelta(days=retain_days)
    for index, path in enumerate(files):
        if index >= MAX_FILES or datetime.fromtimestamp(path.stat().st_mtime) < cutoff:
            try:
                path.unlink()
                logging.info("Eliminado fondo antiguo %s", path)
            except OSError as exc:
                logging.warning("No se pudo eliminar %s: %s", path, exc)


def write_metadata(path: Path, info: Dict[str, Any]) -> None:
    metadata_path = AUTO_BACKGROUND_DIR / "latest.json"
    payload = {
        "filename": path.name,
        "generatedAt": int(datetime.now().timestamp()),
        **info,
    }
    tmp_path = metadata_path.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    os.chmod(tmp_path, 0o644)
    tmp_path.replace(metadata_path)


def main() -> int:
    setup_logging()
    lock_fd = acquire_lock()
    if lock_fd is None:
        logging.warning("Otro proceso de generación está en curso; se omite ejecución")
        return 0

    try:
        env = read_env_file(ENV_PATH)
        api_key = env.get("OPENAI_API_KEY")
        if not api_key:
            logging.error("OPENAI_API_KEY no configurada en %s", ENV_PATH)
            return 1

        config = load_config(CONFIG_PATH)
        mode = resolve_mode(config)
        retain_days = resolve_retain_days(config)

        weather_key = None
        if mode == "weather":
            weather_key = fetch_weather_summary()
            if not weather_key:
                logging.info("No se pudo derivar clima, se usará prompt diario")

        prompt_info = select_prompt(mode, weather_key)
        client = OpenAI(api_key=api_key)
        try:
            image_bytes = generate_image_bytes(client, prompt_info["prompt"], TIMEOUT_SECONDS)
        except Exception as exc:  # pylint: disable=broad-except
            logging.exception("Fallo al generar imagen: %s", exc)
            return 2

        target = persist_image(image_bytes, prompt_info["mode"], prompt_info.get("key", ""))
        write_metadata(target, {"mode": prompt_info["mode"], "prompt": prompt_info["prompt"], "weatherKey": weather_key})
        cleanup_old_files(retain_days)
        logging.info("Generación completada correctamente")
        return 0
    finally:
        release_lock(lock_fd)


if __name__ == "__main__":
    sys.exit(main())
