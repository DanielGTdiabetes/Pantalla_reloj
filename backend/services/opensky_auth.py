from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Optional

import httpx

from ..secret_store import SecretStore

DEFAULT_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
)


@dataclass
class TokenInfo:
    token: str
    expires_at: float
    obtained_at: float
    token_url: str
    scope: Optional[str]


class OpenSkyAuthError(Exception):
    """Raised when authentication with OpenSky fails."""

    def __init__(self, message: str, status: Optional[int] = None, retry_after: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class OpenSkyAuthenticator:
    """Handles OAuth client credential flow for OpenSky and caches tokens."""

    def __init__(
        self,
        secret_store: SecretStore,
        logger: Optional[logging.Logger] = None,
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        self._secret_store = secret_store
        self._logger = logger or logging.getLogger("pantalla.backend.opensky.auth")
        self._token_info: Optional[TokenInfo] = None
        self._lock = threading.Lock()
        self._backoff_until: float = 0.0
        self._backoff_step: int = 0
        self._last_error: Optional[str] = None
        self._last_error_at: Optional[float] = None
        timeout = httpx.Timeout(5.0, connect=5.0, read=5.0)
        self._http_client = http_client or httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._http_client.close()

    # Credentials
    def credentials_configured(self) -> bool:
        client_id = self._secret_store.get_secret("opensky_client_id")
        client_secret = self._secret_store.get_secret("opensky_client_secret")
        return bool(client_id and client_secret)

    def invalidate(self) -> None:
        with self._lock:
            self._token_info = None

    def _schedule_backoff(self, base: int = 5, multiplier: int = 3, max_delay: int = 300) -> None:
        self._backoff_step = min(self._backoff_step + 1, 4)
        delay = min(base * (multiplier ** (self._backoff_step - 1)), max_delay)
        self._backoff_until = time.time() + delay
        self._logger.warning("[opensky] auth backoff engaged for %ds", delay)

    def _reset_backoff(self) -> None:
        self._backoff_step = 0
        self._backoff_until = 0.0

    def get_token(
        self,
        *,
        token_url: Optional[str] = None,
        scope: Optional[str] = None,
        force_refresh: bool = False,
    ) -> Optional[str]:
        if not self.credentials_configured():
            return None
        now = time.time()
        if now < self._backoff_until:
            raise OpenSkyAuthError("backoff_active", retry_after=int(self._backoff_until - now))
        with self._lock:
            resolved_url = (token_url or DEFAULT_TOKEN_URL).strip() or DEFAULT_TOKEN_URL
            resolved_scope = scope.strip() if isinstance(scope, str) and scope.strip() else None
            if self._token_info and (
                self._token_info.token_url != resolved_url
                or self._token_info.scope != resolved_scope
            ):
                self._token_info = None
            if not force_refresh and self._token_info:
                if self._token_info.expires_at - 60 > now:
                    return self._token_info.token
            try:
                token = self._perform_token_request(resolved_url, resolved_scope)
            except OpenSkyAuthError:
                raise
            except Exception as exc:  # noqa: BLE001
                self._logger.warning("[opensky] token request failed: %s", exc)
                self._last_error = str(exc)
                self._last_error_at = now
                self._schedule_backoff()
                raise OpenSkyAuthError("token_request_failed") from exc
            self._last_error = None
            self._last_error_at = None
            self._reset_backoff()
            return token

    def _perform_token_request(self, token_url: str, scope: Optional[str]) -> str:
        client_id = self._secret_store.get_secret("opensky_client_id")
        client_secret = self._secret_store.get_secret("opensky_client_secret")
        if not client_id or not client_secret:
            raise OpenSkyAuthError("missing_credentials")
        data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
        if scope:
            data["scope"] = scope
        response = self._http_client.post(token_url, data=data)
        if response.status_code >= 500:
            self._logger.warning("[opensky] auth upstream error %s", response.status_code)
            self._schedule_backoff()
            raise OpenSkyAuthError("upstream_error", status=response.status_code)
        if response.status_code in {401, 403}:
            self._logger.warning("[opensky] invalid client credentials (status %s)", response.status_code)
            self._schedule_backoff(base=15)
            raise OpenSkyAuthError("invalid_credentials", status=response.status_code)
        if response.status_code >= 400:
            self._logger.warning("[opensky] auth rejected with status %s", response.status_code)
            self._schedule_backoff()
            raise OpenSkyAuthError("auth_error", status=response.status_code)
        payload = response.json()
        token = payload.get("access_token")
        expires_in = int(payload.get("expires_in", 0))
        if not token or expires_in <= 0:
            raise OpenSkyAuthError("invalid_token_response")
        now = time.time()
        self._token_info = TokenInfo(
            token=token,
            expires_at=now + expires_in,
            obtained_at=now,
            token_url=token_url,
            scope=scope,
        )
        self._logger.info("[opensky] obtained access token valid for %ds", expires_in)
        return token

    def describe(self) -> dict[str, Optional[float | bool | str]]:
        now = time.time()
        info = {
            "has_credentials": self.credentials_configured(),
            "token_cached": False,
            "expires_in_sec": None,
            "last_error": self._last_error,
            "last_error_at": self._last_error_at,
            "backoff_until": self._backoff_until if self._backoff_until > now else None,
        }
        if self._token_info:
            remaining = max(0, int(self._token_info.expires_at - now))
            info["token_cached"] = remaining > 0
            info["expires_in_sec"] = remaining if remaining > 0 else 0
        return info


__all__ = [
    "OpenSkyAuthenticator",
    "OpenSkyAuthError",
    "TokenInfo",
]
