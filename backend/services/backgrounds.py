"""Utilidades para exponer fondos generados automáticamente."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

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
    return backgrounds[0] if backgrounds else None


__all__ = ["BackgroundAsset", "list_backgrounds", "latest_background"]
