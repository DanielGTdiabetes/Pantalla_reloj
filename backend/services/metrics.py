from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional

@dataclass
class LatencySample:
  duration_ms: float
  timestamp: float

class LatencyRecorder:
  def __init__(self) -> None:
    self._lock = threading.Lock()
    self._data: Dict[str, LatencySample] = {}

  def record(self, key: str, duration_seconds: float) -> None:
    with self._lock:
      self._data[key] = LatencySample(duration_ms=duration_seconds * 1000.0, timestamp=time.time())

  def get(self, key: str) -> Optional[LatencySample]:
    with self._lock:
      return self._data.get(key)

_recorder = LatencyRecorder()


def record_latency(key: str, duration_seconds: float) -> None:
  _recorder.record(key, duration_seconds)


def get_latency(key: str) -> Optional[LatencySample]:
  return _recorder.get(key)
