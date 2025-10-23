"""In-memory store for Blitzortung lightning strikes."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from threading import Lock
from time import time
from typing import Deque, List, Optional, Tuple


@dataclass
class Strike:
    """Represents a lightning strike."""

    lat: float
    lon: float
    ts: float  # epoch seconds


class BlitzStore:
    """Thread-safe store with TTL-based eviction for lightning strikes."""

    def __init__(self, ttl_seconds: int = 1800, max_len: int = 2000) -> None:
        self.ttl = ttl_seconds
        self.max_len = max_len
        self._queue: Deque[Strike] = deque(maxlen=max_len)
        self._lock = Lock()

    def add(self, lat: float, lon: float, ts: Optional[float] = None) -> None:
        """Append a strike and evict stale entries."""

        timestamp = ts or time()
        with self._lock:
            self._queue.append(Strike(lat, lon, timestamp))
            self._gc_locked()

    def recent(self) -> List[Tuple[float, float]]:
        """Return recent strikes as (lat, lon) pairs, pruning stale entries."""

        with self._lock:
            self._gc_locked()
            return [(strike.lat, strike.lon) for strike in self._queue]

    def _gc_locked(self) -> None:
        cutoff = time() - self.ttl
        while self._queue and self._queue[0].ts < cutoff:
            self._queue.popleft()

    def clear(self) -> None:
        """Clear all stored strikes."""

        with self._lock:
            self._queue.clear()
