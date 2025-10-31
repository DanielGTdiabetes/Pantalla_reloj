from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Generic, MutableMapping, Optional, TypeVar

T = TypeVar("T")


@dataclass
class CacheEntry(Generic[T]):
    value: T
    expires_at: float


class TTLCache(Generic[T]):
    """Simple in-memory TTL cache with thread safety."""

    def __init__(self) -> None:
        self._store: MutableMapping[str, CacheEntry[T]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[T]:
        with self._lock:
            entry = self._store.get(key)
            if not entry:
                return None
            if entry.expires_at <= time.time():
                self._store.pop(key, None)
                return None
            return entry.value

    def set(self, key: str, value: T, ttl_seconds: float) -> None:
        expires_at = time.time() + max(ttl_seconds, 0)
        with self._lock:
            self._store[key] = CacheEntry(value=value, expires_at=expires_at)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


__all__ = ["TTLCache", "CacheEntry"]
