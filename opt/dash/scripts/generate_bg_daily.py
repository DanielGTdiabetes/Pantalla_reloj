#!/usr/bin/env python3
"""Generador diario de fondos futuristas usando OpenAI."""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests
from openai import OpenAI
from PIL import Image

AUTO_BACKGROUND_DIR = Path("/opt/dash/assets/backgrounds/auto")
CONFIG_PATH = Path("/etc/pantalla-dash/config.json")
ENV_PATH = Path("/etc/pantalla-dash/env")
LOG_PATH = Path("/var/log/pantalla-dash/bg.log")
LOCK_PATH = Path("/tmp/pantalla-bg-generate.lock")
API_BASE_URL = "http://127.0.0.1:8787/api"
WEATHER_TODAY_ENDPOINT = f"{API_BASE_URL}/weather/today"
STORMS_STATUS_ENDPOINT = f"{API_BASE_URL}/storms/status"
CALENDAR_PEEK_ENDPOINT = f"{API_BASE_URL}/calendar/peek"

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

DAY_PERIOD_PROMPTS = {
    "dawn": "futuristic coastal city at dawn, soft pastel sky, gentle morning haze, warm sun glow touching skyscrapers",
    "day": "bright futuristic metropolis in daylight, polished architecture, floating vehicles, crisp atmosphere",
    "night": "cyberpunk skyline at night, neon reflections, deep contrast lighting, cinematic ambience",
}

SIGNAL_DETAILS = {
    "rain": "wet reflective streets with light rain streaks and floating mist",
    "storm": "dramatic storm clouds with distant lightning illuminating the skyline",
    "wind": "dynamic banners and holograms bending in strong wind, particles flowing",
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


def fetch_json(url: str, timeout: float = 8.0) -> Tuple[Optional[Any], int]:
    try:
        response = requests.get(url, timeout=timeout)
    except requests.RequestException as exc:
        logging.warning("No se pudo contactar %s: %s", url, exc)
        return None, 0
    if response.status_code in (204, 404):
        return None, response.status_code
    try:
        response.raise_for_status()
    except requests.RequestException as exc:
        logging.warning("Respuesta inesperada de %s: %s", url, exc)
        return None, response.status_code
    try:
        return response.json(), response.status_code
    except ValueError as exc:
        logging.warning("JSON inválido en %s: %s", url, exc)
        return None, response.status_code


def collect_weather_context() -> Dict[str, Any]:
    today, _ = fetch_json(WEATHER_TODAY_ENDPOINT)
    storm, _ = fetch_json(STORMS_STATUS_ENDPOINT)
    event, status = fetch_json(CALENDAR_PEEK_ENDPOINT)
    if status == 404:
        logging.debug("Calendario no configurado; se omite contexto de agenda")
    return {"today": today, "storm": storm, "event": event}


def determine_day_period(now: datetime) -> str:
    hour = now.hour
    if 5 <= hour < 9:
        return "dawn"
    if 9 <= hour < 19:
        return "day"
    return "night"


def detect_signals(today: Optional[Dict[str, Any]], storm: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    rain_prob = float(today.get("rain_prob", 0)) if isinstance(today, dict) else 0.0
    condition = str(today.get("condition", "")).lower() if isinstance(today, dict) else ""
    rain = rain_prob >= 50 or "lluv" in condition or "precip" in condition
    wind = "viento" in condition or "rach" in condition
    storm_active = False
    if isinstance(storm, dict):
        storm_active = bool(storm.get("near_activity")) or float(storm.get("storm_prob", 0)) >= 0.6
    if "tormenta" in condition:
        storm_active = True
    return {"rain": rain, "wind": wind, "storm": storm_active}


def _format_event_time(value: Any) -> Tuple[str, Optional[str]]:
    if not value:
        return "", None
    tz = datetime.now().astimezone().tzinfo
    try:
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(float(value) / 1000.0, tz=tz)
        elif isinstance(value, str):
            cleaned = value.replace("Z", "+00:00")
            dt = datetime.fromisoformat(cleaned)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=tz)
            dt = dt.astimezone(tz)
        else:
            return str(value), None
        label = dt.strftime("%H:%M")
        return label, dt.isoformat()
    except (ValueError, TypeError):
        return str(value), None


def build_contextual_prompt(context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    today = context.get("today") if isinstance(context, dict) else None
    if not isinstance(today, dict):
        return None

    storm = context.get("storm") if isinstance(context, dict) else None
    event = context.get("event") if isinstance(context, dict) else None

    now = datetime.now()
    day_period = determine_day_period(now)
    base_prompt = DAY_PERIOD_PROMPTS.get(day_period)
    if not base_prompt:
        base_prompt = ROTATING_PROMPTS.get(now.weekday(), next(iter(ROTATING_PROMPTS.values())))

    signals = detect_signals(today, storm)
    condition = str(today.get("condition") or "stable weather").lower()
    temp = today.get("temp")
    rain_prob = today.get("rain_prob")

    descriptors = [base_prompt]
    climate_bits = []
    if isinstance(temp, (int, float)):
        climate_bits.append(f"ambient temperature around {float(temp):.0f}°C")
    if rain_prob not in (None, ""):
        try:
            prob = float(rain_prob)
            climate_bits.append(f"rain probability {prob:.0f}%")
        except (TypeError, ValueError):
            pass
    if condition:
        climate_bits.append(f"conditions described as {condition}")
    if climate_bits:
        descriptors.append("Weather context: " + ", ".join(climate_bits) + ".")

    for key, detail in SIGNAL_DETAILS.items():
        if signals.get(key):
            descriptors.append(detail + ".")

    event_meta: Optional[Dict[str, Any]] = None
    if isinstance(event, dict) and event.get("title"):
        event_title = str(event["title"])
        label, iso_value = _format_event_time(event.get("start"))
        if event_title and label:
            descriptors.append(f"Subtle reference to upcoming event '{event_title}' around {label}.")
        elif event_title:
            descriptors.append(f"Hint of upcoming event '{event_title}'.")
        if event_title:
            event_meta = {"title": event_title}
            if iso_value:
                event_meta["start"] = iso_value

    prompt_body = " ".join(descriptors)
    final_prompt = (
        f"{prompt_body} Hyper-detailed cinematic concept art, volumetric lighting, ultra realistic materials. "
        f"Negative prompt: {NEGATIVE_PROMPT}."
    )

    primary = "storm" if signals.get("storm") else "rain" if signals.get("rain") else "wind" if signals.get("wind") else str(today.get("icon") or "clear")
    key_descriptor = f"{day_period}-{primary}".replace(" ", "-")
    context_meta: Dict[str, Any] = {"dayPeriod": day_period, "storm": bool(signals.get("storm"))}
    if event_meta:
        context_meta["event"] = event_meta

    return {"prompt": final_prompt, "mode": "weather", "key": key_descriptor, "context": context_meta}


def build_daily_prompt() -> Dict[str, Any]:
    today = datetime.now()
    base = ROTATING_PROMPTS.get(today.weekday(), next(iter(ROTATING_PROMPTS.values())))
    final_prompt = (
        f"{base}. Futuristic ultra-detailed concept art, hyperrealistic materials, cinematic composition. Negative prompt: {NEGATIVE_PROMPT}."
    )
    return {"prompt": final_prompt, "mode": "daily", "key": today.strftime("day-%w")}


def select_prompt(mode: str) -> Dict[str, Any]:
    if mode == "weather":
        context = collect_weather_context()
        prompt = build_contextual_prompt(context)
        if prompt:
            return prompt
        logging.info("Fallo usando contexto meteorológico; se usará prompt diario")
    return build_daily_prompt()


def generate_image_bytes(client: OpenAI, prompt: str, timeout: int) -> bytes:
    logging.info("Solicitando imagen a OpenAI con modelo %s", IMAGE_MODEL)
    result = client.images.generate(
        model=IMAGE_MODEL,
        prompt=prompt,
        size=IMAGE_SIZE,
        response_format="b64_json",
        timeout=timeout
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

        prompt_info = select_prompt(mode)
        client = OpenAI(api_key=api_key)
        latency_ms = None
        try:
            started = time.perf_counter()
            image_bytes = generate_image_bytes(client, prompt_info["prompt"], TIMEOUT_SECONDS)
            latency_ms = (time.perf_counter() - started) * 1000.0
        except Exception as exc:  # pylint: disable=broad-except
            logging.exception("Fallo al generar imagen: %s", exc)
            return 2

        target = persist_image(image_bytes, prompt_info["mode"], prompt_info.get("key", ""))
        metadata = {
            "mode": prompt_info["mode"],
            "prompt": prompt_info["prompt"],
            "weatherKey": prompt_info.get("key"),
        }
        if prompt_info.get("context"):
            metadata["context"] = prompt_info["context"]
        if latency_ms is not None:
            metadata["openaiLatencyMs"] = round(latency_ms, 2)
        write_metadata(target, metadata)
        cleanup_old_files(retain_days)
        logging.info("Generación completada correctamente")
        return 0
    finally:
        release_lock(lock_fd)


if __name__ == "__main__":
    sys.exit(main())
