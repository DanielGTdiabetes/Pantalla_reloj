from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from .models import CachedPayload


class CacheStore:
    """Simple JSON cache backed by files in /var/lib/pantalla/cache."""

    def __init__(self, cache_dir: Path | None = None) -> None:
        state_path = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
        self.cache_dir = cache_dir or Path(
            os.getenv("PANTALLA_CACHE_DIR", state_path / "cache")
        )
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.json"

    def load(self, key: str, max_age_minutes: int | None = None) -> Optional[CachedPayload]:
        path = self._path(key)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            payload = CachedPayload.model_validate(data)
        except Exception:
            path.unlink(missing_ok=True)
            return None
        if max_age_minutes is not None:
            age = datetime.now(timezone.utc) - payload.fetched_at
            if age > timedelta(minutes=max_age_minutes):
                return None
        return payload

    def store(self, key: str, payload: Dict[str, Any]) -> CachedPayload:
        cached = CachedPayload(source=key, fetched_at=datetime.now(timezone.utc), payload=payload)
        path = self._path(key)
        path.write_text(cached.model_dump_json(indent=2, exclude_none=True), encoding="utf-8")
        return cached


__all__ = ["CacheStore"]
