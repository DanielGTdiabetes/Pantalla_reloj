from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

from ..models import AppConfig, OpenSkyProviderConfig
from ..secret_store import SecretStore
from .cache import TTLCache
from .opensky_auth import DEFAULT_TOKEN_URL, OpenSkyAuthError, OpenSkyAuthenticator
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
        self._last_rate_limit_hint: Optional[str] = None

    def _build_key(self, bbox: Optional[Tuple[float, float, float, float]], extended: int, max_aircraft: int) -> str:
        bbox_part = "global" if not bbox else ",".join(f"{value:.4f}" for value in bbox)
        return f"mode={bbox_part}|ext={extended}|max={max_aircraft}"

    def _compute_poll_seconds(self, config: AppConfigV2) -> Tuple[int, bool]:
        cfg = getattr(config, "opensky", None)
        has_token = self._auth.credentials_configured()
        minimum = 5 if has_token else 10
        poll_seconds = getattr(cfg, "poll_seconds", 10) if cfg else 10
        raw = max(int(poll_seconds), minimum)
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
        config: AppConfigV2,
        bbox: Optional[Tuple[float, float, float, float]],
        extended_override: Optional[int] = None,
    ) -> Snapshot:
        layers = getattr(config, "layers", None)
        flights_config = getattr(layers, "flights", None) if layers else None
        if not flights_config or not flights_config.enabled or flights_config.provider != "opensky":
            return Snapshot(payload={"count": 0, "disabled": True}, fetched_at=time.time(), stale=False)
        opensky_cfg = flights_config.opensky or OpenSkyProviderConfig()
        max_aircraft = getattr(flights_config, "max_items_global", 2000)
        poll_seconds, has_token = self._compute_poll_seconds(config)
        extended_default = getattr(opensky_cfg, "extended", 0)
        extended = int(extended_override if extended_override is not None else extended_default)
        extended = 1 if extended else 0
        bbox_to_use = bbox
        mode = getattr(opensky_cfg, "mode", "bbox")
        if mode == "bbox" and not bbox_to_use:
            area = getattr(opensky_cfg, "bbox", None)
            if area:
                bbox_to_use = (
                    float(area.lamin),
                    float(area.lamax),
                    float(area.lomin),
                    float(area.lomax),
                )
            else:
                bbox_to_use = (36.0, 44.0, -10.0, 5.0)
        elif mode == "global":
            bbox_to_use = None
        effective_mode = "global" if bbox_to_use is None else "bbox"
        cache_key = self._build_key(bbox_to_use, extended, int(max_aircraft))
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
                oauth_cfg = getattr(getattr(config, "opensky", None), "oauth2", None)
                token_endpoint = getattr(oauth_cfg, "token_url", None) if oauth_cfg else None
                scope_value = getattr(oauth_cfg, "scope", None) if oauth_cfg else None
                if has_token:
                    try:
                        token = self._auth.get_token(
                            token_url=token_endpoint,
                            scope=scope_value,
                        )
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
                    self._last_rate_limit_hint = "0"
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
            ts, count, items = OpenSkyClient.sanitize_states(payload, int(max_aircraft))
            result_payload: Dict[str, object] = {
                "count": count,
                "items": items,
                "stale": False,
                "ts": ts,
            }
            ttl = self._ttl_for(poll_seconds, has_token)
            remaining = headers.get("X-Rate-Limit-Remaining")
            self._last_rate_limit_hint = remaining or self._last_rate_limit_hint
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

    def get_status(self, config: AppConfigV2) -> Dict[str, object]:
        now = time.time()
        auth_info = self._auth.describe()
        poll_seconds, has_token = self._compute_poll_seconds(config)
        top_level = getattr(config, "opensky", None)
        flights_layer = getattr(getattr(config, "layers", None), "flights", None)
        flights_provider = getattr(flights_layer, "opensky", None) if flights_layer else None
        enabled = bool(
            (flights_layer.enabled if flights_layer else False)
            and (getattr(top_level, "enabled", True) if top_level else True)
        )
        snapshot = self.get_last_snapshot()
        items_count: Optional[int] = None
        if snapshot and isinstance(snapshot.payload.get("count"), int):
            items_count = int(snapshot.payload["count"])
        last_iso = (
            datetime.fromtimestamp(self._last_fetch_at, tz=timezone.utc).isoformat()
            if self._last_fetch_at
            else None
        )
        status_value = "stale"
        if enabled:
            if self._last_fetch_ok is False:
                # Si falta auth, usar "stale" en lugar de "error"
                if not has_token and not bool(auth_info.get("has_credentials")):
                    status_value = "stale"
                else:
                    status_value = "error"
            elif snapshot and self._last_fetch_at:
                freshness = now - self._last_fetch_at
                freshness_limit = max(poll_seconds * 2, poll_seconds + 30)
                status_value = "ok" if freshness <= freshness_limit else "stale"
        has_credentials = bool(auth_info.get("has_credentials")) or has_token
        auth_block = {
            "has_credentials": has_credentials,
            "token_cached": bool(auth_info.get("token_cached")),
            "expires_in_sec": auth_info.get("expires_in_sec"),
        }
        configured_poll = getattr(top_level, "poll_seconds", poll_seconds) if top_level else poll_seconds
        mode = getattr(flights_provider, "mode", None) or getattr(top_level, "mode", "bbox") if top_level else "bbox"
        return {
            "enabled": enabled,
            "mode": mode,
            "configured_poll": int(configured_poll),
            "effective_poll": poll_seconds,
            "auth": auth_block,
            "status": status_value,
            "last_fetch_ok": self._last_fetch_ok,
            "last_fetch_ts": self._last_fetch_at,
            "last_fetch_iso": last_iso,
            "last_error": self._last_error,
            "last_error_at": self._last_error_at,
            "backoff_active": now < self._backoff_until,
            "backoff_seconds": max(0, int(self._backoff_until - now)) if now < self._backoff_until else 0,
            "items": items_count,
            "items_count": items_count,
            "rate_limit_hint": self._last_rate_limit_hint,
            "cluster": False,
            "has_credentials": has_credentials,
            "token_cached": bool(auth_info.get("token_cached")),
            "expires_in": auth_block.get("expires_in_sec"),
        }

    def close(self) -> None:
        self._client.close()
        self._auth.close()

    @staticmethod
    def _format_auth_error(exc: OpenSkyAuthError) -> str:
        base = exc.args[0] if exc.args else "auth_error"
        if exc.status:
            return f"{base}:{exc.status}"
        if exc.retry_after:
            return f"{base}:retry"
        return str(base)

    @staticmethod
    def _format_client_error(exc: OpenSkyClientError) -> str:
        base = exc.args[0] if exc.args else "client_error"
        if exc.status:
            return f"{base}:{exc.status}"
        return str(base)

    def force_refresh(self, config: AppConfig) -> Dict[str, Any]:
        layers = getattr(config, "layers", None)
        flights_layer = getattr(layers, "flights", None) if layers else None
        if not flights_layer or not flights_layer.enabled or flights_layer.provider != "opensky":
            return {
                "auth": {"token_cached": False, "expires_in_sec": None},
                "fetch": {
                    "status": "disabled",
                    "items": 0,
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "mode": "bbox",
                },
            }

        provider_cfg = flights_layer.opensky or OpenSkyProviderConfig()
        poll_seconds, has_token = self._compute_poll_seconds(config)

        if provider_cfg.mode == "bbox":
            area = provider_cfg.bbox
            if area:
                bbox_to_use: Optional[Tuple[float, float, float, float]] = (
                    float(area.lamin),
                    float(area.lamax),
                    float(area.lomin),
                    float(area.lomax),
                )
            else:
                bbox_to_use = (36.0, 44.0, -10.0, 5.0)
        else:
            bbox_to_use = None

        effective_mode = "global" if bbox_to_use is None else "bbox"
        extended = 1 if int(getattr(provider_cfg, "extended", 0)) else 0
        max_aircraft = getattr(flights_layer, "max_items_global", 2000)
        cache_key = self._build_key(bbox_to_use, extended, int(max_aircraft))

        oauth_cfg = getattr(getattr(config, "opensky", None), "oauth2", None)
        raw_token_url = getattr(oauth_cfg, "token_url", None) if oauth_cfg else None
        scope_value = getattr(oauth_cfg, "scope", None) if oauth_cfg else None
        resolved_token_url = (raw_token_url or DEFAULT_TOKEN_URL).strip() or DEFAULT_TOKEN_URL
        parsed_url = urlparse(resolved_token_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            self._logger.warning(
                "[opensky] invalid token_url configured (%s); falling back to default",
                resolved_token_url,
            )
            resolved_token_url = DEFAULT_TOKEN_URL
        token: Optional[str] = None
        auth_error: Optional[str] = None
        if has_token:
            try:
                token = self._auth.get_token(
                    token_url=resolved_token_url,
                    scope=scope_value,
                    force_refresh=True,
                )
            except OpenSkyAuthError as exc:
                auth_error = self._format_auth_error(exc)
                self._logger.warning("[opensky] manual token refresh failed: %s", auth_error)
            except Exception as exc:  # noqa: BLE001
                auth_error = "auth_unexpected"
                self._logger.warning("[opensky] unexpected token refresh error: %s", exc)
        fetch_summary: Dict[str, Any] = {
            "status": "error",
            "items": 0,
            "ts": None,
            "mode": effective_mode,
        }
        fetch_error: Optional[str] = None
        payload: Optional[Dict[str, Any]] = None
        headers: Dict[str, str] = {}
        delays = [0.0, 0.5, 2.0, 5.0]
        now = time.time()
        for attempt, delay in enumerate(delays):
            if delay:
                time.sleep(delay)
            try:
                payload, headers = self._client.fetch_states(bbox_to_use, extended, token)
            except OpenSkyClientError as exc:
                fetch_error = self._format_client_error(exc)
                if exc.status == 429:
                    self._last_rate_limit_hint = "0"
                if exc.status in {401, 403} and has_token:
                    self._auth.invalidate()
                self._logger.warning(
                    "[opensky] manual fetch failed (attempt %d/%d): %s",
                    attempt + 1,
                    len(delays),
                    fetch_error,
                )
            except Exception as exc:  # noqa: BLE001
                fetch_error = "unexpected_fetch_error"
                self._logger.warning(
                    "[opensky] manual fetch encountered unexpected error (attempt %d/%d): %s",
                    attempt + 1,
                    len(delays),
                    exc,
                )
            else:
                fetch_error = None
                break
            if attempt == len(delays) - 1:
                payload = None
        auth_error = auth_error or None
        if payload is not None:
            ts, count, items = OpenSkyClient.sanitize_states(payload, int(max_aircraft))
            iso_ts = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            remaining = headers.get("X-Rate-Limit-Remaining")
            snapshot = Snapshot(
                payload={"count": count, "items": items, "stale": False, "ts": ts},
                fetched_at=now,
                stale=False,
                remaining=remaining,
                polled=True,
                mode=effective_mode,
                bbox=bbox_to_use,
            )
            ttl = self._ttl_for(poll_seconds, has_token)
            with self._lock:
                self._cache.set(cache_key, snapshot, ttl)
                self._snapshots[cache_key] = snapshot
                self._last_fetch_ok = True
                self._last_fetch_at = now
                self._last_error = None
                self._last_error_at = None
                if remaining:
                    self._last_rate_limit_hint = remaining
                self._reset_backoff()
            fetch_summary.update({
                "status": "ok",
                "items": count,
                "ts": iso_ts,
            })
        else:
            error_to_store = fetch_error or auth_error or "refresh_failed"
            iso_now = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()
            with self._lock:
                snapshot = self._snapshots.get(cache_key)
                if snapshot:
                    snapshot.stale = True
                    snapshot.payload["stale"] = True
                    snapshot.polled = False
                self._last_fetch_ok = False
                self._last_fetch_at = now
                self._last_error = error_to_store
                self._last_error_at = now
            fetch_summary.update({
                "status": "error",
                "items": 0,
                "ts": iso_now,
            })
        auth_info = self._auth.describe() or {}
        auth_summary = {
            "token_cached": bool(auth_info.get("token_cached")),
            "expires_in_sec": auth_info.get("expires_in_sec"),
        }
        response_error = fetch_error or auth_error
        return {
            "auth": auth_summary,
            "fetch": fetch_summary,
            "error": response_error,
        }

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
            self._last_rate_limit_hint = None
        self._auth.invalidate()

    def force_refresh_token(
        self,
        token_url: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> Dict[str, Optional[int | bool]]:
        """Fuerza la obtención/renovación del token en el autenticador compartido.

        Devuelve un dict resumido con el resultado y el TTL restante.
        """
        try:
            token = self._auth.get_token(token_url=token_url, scope=scope, force_refresh=True)
            info = self._auth.describe() or {}
            expires_in = int(info.get("expires_in_sec", 0)) if info else 0
            return {
                "ok": bool(token),
                "token_valid": bool(token),
                "expires_in": expires_in if expires_in > 0 else None,
            }
        except Exception as exc:  # noqa: BLE001
            self._logger.warning("[opensky] force_refresh_token failed: %s", exc)
            return {"ok": False, "token_valid": False, "expires_in": None}


__all__ = ["OpenSkyService", "Snapshot"]
