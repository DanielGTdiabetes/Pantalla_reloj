"""Utilidades para exponer fondos generados automáticamente."""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

AUTO_BACKGROUNDS_DIR = Path("/opt/dash/assets/backgrounds/auto")
METADATA_PATH = AUTO_BACKGROUNDS_DIR / "latest.json"


@dataclass
class BackgroundAsset:
    """Representa un fondo disponible."""

    filename: str
    generated_at: int
    url: str
    mode: Optional[str] = None
    prompt: Optional[str] = None
    weather_key: Optional[str] = None
    etag: Optional[str] = None
    last_modified: Optional[int] = None
    openai_latency_ms: Optional[float] = None
    context: Optional[Dict[str, Any]] = None


def _load_metadata() -> Optional[dict]:
    if not METADATA_PATH.exists():
        return None
    try:
        with METADATA_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("No se pudo leer metadata de fondos: %s", exc)
        return None
    if not isinstance(data, dict) or "filename" not in data:
        return None
    return data


def _iter_background_files(limit: Optional[int] = None) -> Iterable[Path]:
    if not AUTO_BACKGROUNDS_DIR.exists():
        return []
    files = sorted(
        AUTO_BACKGROUNDS_DIR.glob("*.webp"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    if limit is not None:
        return files[:limit]
    return files


def list_backgrounds(limit: int = 10) -> List[BackgroundAsset]:
    metadata = _load_metadata()
    assets: List[BackgroundAsset] = []
    for path in _iter_background_files(limit=limit):
        stat = path.stat()
        generated_at = int(stat.st_mtime)
        etag = f"W/\"{stat.st_mtime_ns:x}\""
        last_modified = int(stat.st_mtime)
        mode: Optional[str] = None
        prompt: Optional[str] = None
        weather_key: Optional[str] = None
        openai_latency: Optional[float] = None
        context: Optional[Dict[str, Any]] = None
        if metadata and metadata.get("filename") == path.name:
            generated_at = int(metadata.get("generatedAt", generated_at))
            mode = metadata.get("mode")
            prompt = metadata.get("prompt")
            weather_key = metadata.get("weatherKey")
            openai_latency = metadata.get("openaiLatencyMs")
            context = metadata.get("context") if isinstance(metadata.get("context"), dict) else None
        assets.append(
            BackgroundAsset(
                filename=path.name,
                generated_at=generated_at,
                url=f"/backgrounds/auto/{path.name}",
                mode=mode,
                prompt=prompt,
                weather_key=weather_key,
                etag=etag,
                last_modified=last_modified,
                openai_latency_ms=openai_latency,
                context=context,
            )
        )
    return assets


def latest_background() -> Optional[BackgroundAsset]:
    backgrounds = list_backgrounds(limit=1)
    if backgrounds:
        return backgrounds[0]
    return ensure_local_fallback()


def ensure_local_fallback(reason: str = "fallback") -> Optional[BackgroundAsset]:
    AUTO_BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = int(time.time())
    filename = f"{timestamp}_fallback_local.webp"
    target = AUTO_BACKGROUNDS_DIR / filename

    width, height = 1920, 1080
    try:
        _generate_gradient_image(target, width, height)
        os.chmod(target, 0o644)
    except Exception as exc:  # pragma: no cover - dependiente de Pillow/FS
        logger.error("No se pudo generar fondo de reserva local: %s", exc)
        return None

    metadata = {
        "filename": target.name,
        "url": f"/backgrounds/auto/{target.name}",
        "generatedAt": timestamp,
        "mode": "fallback",
        "prompt": f"Gradiente local ({reason})",
        "weatherKey": None,
    }

    try:
        tmp_path = METADATA_PATH.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(metadata, handle, ensure_ascii=False, indent=2)
        os.chmod(tmp_path, 0o644)
        tmp_path.replace(METADATA_PATH)
    except OSError as exc:  # pragma: no cover - E/S defensiva
        logger.warning("No se pudo actualizar metadata de fondos de reserva: %s", exc)

    stat = target.stat()
    return BackgroundAsset(
        filename=target.name,
        generated_at=timestamp,
        url=f"/backgrounds/auto/{target.name}",
        mode="fallback",
        prompt=metadata["prompt"],
        weather_key=None,
        etag=f"W/\"{stat.st_mtime_ns:x}\"",
        last_modified=int(stat.st_mtime),
    )


def _generate_gradient_image(path: Path, width: int, height: int) -> None:
    top = (16, 30, 54)
    bottom = (34, 60, 96)
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        blend = y / max(1, height - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * blend) for i in range(3))
        draw.line((0, y, width, y), fill=color)
    overlay = Image.new("RGBA", (width, height), (12, 24, 40, int(255 * 0.18)))
    gradient = Image.new("L", (width, height))
    grad_draw = ImageDraw.Draw(gradient)
    grad_draw.rectangle((0, 0, width, height), fill=180)
    overlay.putalpha(gradient)
    combined = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    combined.save(path, "WEBP", quality=88, method=6)


__all__ = ["BackgroundAsset", "ensure_local_fallback", "list_backgrounds", "latest_background"]
