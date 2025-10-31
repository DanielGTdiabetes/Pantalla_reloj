from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from ..models import AppConfig
from ..secret_store import SecretStore
from .cache import TTLCache
from .opensky_auth import OpenSkyAuthError, OpenSkyAuthenticator
from .opensky_client import OpenSkyClient, OpenSkyClientError


@dataclass
class Snapshot:
    payload: Dict[str, Any]
    fetched_at: float
    stale: bool = False
    remaining: Optional[str] = None
    polled: bool = False
    mode: str = "bbox"
    bbox: Optional[Tuple[float, float, float, float]] = None


class OpenSkyService:
    """Coordinates authentication, polling and caching of OpenSky data."""

    def __init__(
        self,
        secret_store: SecretStore,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self._logger = logger or logging.getLogger("pantalla.backend.opensky")
        self._secret_store = secret_store
        self._auth = OpenSkyAuthenticator(secret_store, self._logger)
        self._client = OpenSkyClient(self._logger)
        self._cache: TTLCache[Snapshot] = TTLCache()
        self._snapshots: Dict[str, Snapshot] = {}
        self._lock = threading.Lock()
        self._last_fetch_ok: Optional[bool] = None
        self._last_fetch_at: Optional[float] = None
        self._last_error: Optional[str] = None
        self._last_error_at: Optional[float] = None
        self._backoff_until: float = 0.0
        self._backoff_step: int = 0

    def _build_key(self, bbox: Optional[Tuple[float, float, float, float]], extended: int, max_aircraft: int) -> str:
        bbox_part = "global" if not bbox else ",".join(f"{value:.4f}" for value in bbox)
        return f"mode={bbox_part}|ext={extended}|max={max_aircraft}"

    def _compute_poll_seconds(self, config: AppConfig) -> Tuple[int, bool]:
        cfg = getattr(config, "opensky")
        has_token = self._auth.credentials_configured()
        minimum = 5 if has_token else 10
        raw = max(int(cfg.poll_seconds), minimum)
        if has_token and raw < 5:
            raw = 5
        if not has_token and raw < 10:
            raw = 10
        return raw, has_token

    def _ttl_for(self, poll_seconds: int, has_token: bool) -> int:
        if has_token and poll_seconds < 5:
            return 5
        return poll_seconds

    def _schedule_backoff(self, override: Optional[int] = None) -> None:
        if override is not None:
            delay = override
        else:
            self._backoff_step = min(self._backoff_step + 1, 4)
            delay = [5, 15, 30, 60, 120][self._backoff_step]
        self._backoff_until = time.time() + delay
        self._logger.warning("[opensky] data backoff engaged for %ds", delay)

    def _reset_backoff(self) -> None:
        self._backoff_step = 0
        self._backoff_until = 0.0

    def get_snapshot(
        self,
        config: AppConfig,
        bbox: Optional[Tuple[float, float, float, float]],
        extended_override: Optional[int] = None,
    ) -> Snapshot:
        opensky_cfg = getattr(config, "opensky")
        if not opensky_cfg.enabled:
            return Snapshot(payload={"count": 0, "disabled": True}, fetched_at=time.time(), stale=False)
        poll_seconds, has_token = self._compute_poll_seconds(config)
        extended = int(extended_override if extended_override is not None else opensky_cfg.extended)
        extended = 1 if extended else 0
        bbox_to_use = bbox
        mode = opensky_cfg.mode
        if mode == "bbox" and not bbox_to_use:
            area = opensky_cfg.bbox
            bbox_to_use = (
                float(area.lamin),
                float(area.lamax),
                float(area.lomin),
                float(area.lomax),
            )
        elif mode == "global":
            bbox_to_use = None
        effective_mode = "global" if bbox_to_use is None else "bbox"
        cache_key = self._build_key(bbox_to_use, extended, int(opensky_cfg.max_aircraft))
        cached = self._cache.get(cache_key)
        if cached:
            cached.stale = False
            cached.payload["stale"] = False
            cached.polled = False
            return cached
        now = time.time()
        if now < self._backoff_until:
            snapshot = self._snapshots.get(cache_key)
            if snapshot:
                snapshot.stale = True
                snapshot.polled = False
                snapshot.payload["stale"] = True
                return snapshot
            payload = {"count": 0, "items": [], "stale": True, "ts": int(now)}
            return Snapshot(payload=payload, fetched_at=now, stale=True, mode=effective_mode, bbox=bbox_to_use)
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached:
                cached.stale = False
                cached.payload["stale"] = False
                cached.polled = False
                return cached
            snapshot = self._snapshots.get(cache_key)
            try:
                token = None
                if has_token:
                    try:
                        token = self._auth.get_token()
                    except OpenSkyAuthError as exc:
                        self._last_error = f"auth:{exc}" if exc.status else str(exc)
                        self._last_error_at = now
                        self._schedule_backoff(override=15 if exc.status in {401, 403} else None)
                        if snapshot:
                            snapshot.stale = True
                            snapshot.polled = False
                            snapshot.payload["stale"] = True
                            return snapshot
                        raise
                payload, headers = self._client.fetch_states(bbox_to_use, extended, token)
            except OpenSkyClientError as exc:
                self._last_fetch_ok = False
                self._last_fetch_at = now
                self._last_error = f"client:{exc.status}" if exc.status else str(exc)
                self._last_error_at = now
                if exc.status == 429:
                    self._schedule_backoff(override=30)
                elif exc.status in {401, 403} and has_token:
                    self._auth.invalidate()
                    self._schedule_backoff(override=15)
                else:
                    self._schedule_backoff()
                if snapshot:
                    snapshot.stale = True
                    snapshot.polled = False
                    snapshot.payload["stale"] = True
                    if exc.status == 429:
                        snapshot.remaining = "0"
                    return snapshot
                raise
            except OpenSkyAuthError:
                raise
            except Exception as exc:  # noqa: BLE001
                self._last_fetch_ok = False
                self._last_fetch_at = now
                self._last_error = str(exc)
                self._last_error_at = now
                self._schedule_backoff()
                if snapshot:
                    snapshot.stale = True
                    snapshot.polled = False
                    snapshot.payload["stale"] = True
                    return snapshot
                raise
            ts, count, items = OpenSkyClient.sanitize_states(payload, int(opensky_cfg.max_aircraft))
            result_payload: Dict[str, object] = {
                "count": count,
                "items": items,
                "stale": False,
                "ts": ts,
            }
            ttl = self._ttl_for(poll_seconds, has_token)
            remaining = headers.get("X-Rate-Limit-Remaining")
            snapshot = Snapshot(
                payload=result_payload,
                fetched_at=now,
                stale=False,
                remaining=remaining,
                polled=True,
                mode=effective_mode,
                bbox=bbox_to_use,
            )
            self._cache.set(cache_key, snapshot, ttl)
            self._snapshots[cache_key] = snapshot
            self._last_fetch_ok = True
            self._last_fetch_at = now
            self._last_error = None
            self._last_error_at = None
            self._reset_backoff()
        self._logger.info(
            "[opensky] fetched %d aircraft (mode=%s, bbox=%s, ttl=%ds)",
            count,
            mode,
            "global" if bbox_to_use is None else bbox_to_use,
            ttl,
        )
        return snapshot

    def get_status(self, config: AppConfig) -> Dict[str, object]:
        now = time.time()
        status = self._auth.describe()
        poll_seconds, has_token = self._compute_poll_seconds(config)
        cfg = getattr(config, "opensky")
        snapshot = self.get_last_snapshot()
        status.update(
            {
                "enabled": cfg.enabled,
                "mode": cfg.mode,
                "configured_poll": int(cfg.poll_seconds),
                "effective_poll": poll_seconds,
                "has_credentials": has_token,
                "backoff_active": now < self._backoff_until,
                "backoff_seconds": max(0, int(self._backoff_until - now)) if now < self._backoff_until else 0,
                "last_fetch_ok": self._last_fetch_ok,
                "last_fetch_ts": self._last_fetch_at,
                "last_fetch_iso": datetime.fromtimestamp(self._last_fetch_at, tz=timezone.utc).isoformat() if self._last_fetch_at else None,
                "last_error": self._last_error,
                "last_error_at": self._last_error_at,
                "cluster": bool(getattr(cfg, "cluster", False)),
                "items_count": snapshot.payload.get("count") if snapshot else 0,
            }
        )
        return status

    def close(self) -> None:
        self._client.close()
        self._auth.close()

    def get_last_snapshot(self) -> Optional[Snapshot]:
        with self._lock:
            if not self._snapshots:
                return None
            latest = max(self._snapshots.values(), key=lambda snap: snap.fetched_at, default=None)
            return latest

    def reset(self) -> None:
        with self._lock:
            self._cache.clear()
            self._snapshots.clear()
        self._auth.invalidate()


__all__ = ["OpenSkyService", "Snapshot"]
