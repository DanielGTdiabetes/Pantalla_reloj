from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Sequence

import httpx

from .config_store import read_google_secrets, write_google_refresh_token

logger = logging.getLogger(__name__)

DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
DEFAULT_SCOPES = ("https://www.googleapis.com/auth/calendar.readonly",)
HTTP_TIMEOUT = httpx.Timeout(10.0, connect=10.0, read=10.0)


class GoogleOAuthError(Exception):
    """Generic Google OAuth error."""


@dataclass
class DeviceFlowState:
    device_code: str
    user_code: str
    verification_url: str
    interval: int
    expires_at: float
    scopes: tuple[str, ...]
    created_at: float
    last_error: Optional[str] = None
    authorized: bool = False
    email: Optional[str] = None


@dataclass
class TokenBundle:
    access_token: str
    expires_in: int
    refresh_token: Optional[str]
    token_type: str
    scope: Optional[str]


class GoogleOAuthDeviceFlowManager:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
        self._lock = asyncio.Lock()
        self._state: DeviceFlowState | None = None
        self._poll_task: asyncio.Task[None] | None = None
        self._access_token: str | None = None
        self._access_token_expiry: float = 0.0
        self._token_type: str = "Bearer"
        self._refresh_token: str | None = None
        self._last_email: str | None = None
        self._client_id: str | None = None
        self._client_secret: str | None = None
        self._load_secrets()

    async def close(self) -> None:
        await self._client.aclose()

    def _load_secrets(self) -> None:
        secrets = read_google_secrets()
        self._client_id = secrets.get("client_id")
        self._client_secret = secrets.get("client_secret")
        refresh_token = secrets.get("refresh_token")
        if refresh_token:
            self._refresh_token = refresh_token

    async def start_device_flow(self, scopes: Sequence[str] | None = None) -> Dict[str, Any]:
        scope_values = tuple(scopes) if scopes else DEFAULT_SCOPES
        async with self._lock:
            self._load_secrets()
            if not self._client_id or not self._client_secret:
                raise GoogleOAuthError("Credenciales de Google no configuradas")

            if self._poll_task is not None:
                self._poll_task.cancel()
                self._poll_task = None

            data = {
                "client_id": self._client_id,
                "scope": " ".join(scope_values),
            }

        try:
            response = await self._client.post(DEVICE_CODE_URL, data=data)
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover - red externa
            logger.error("Google OAuth device: error iniciando flujo: %s", exc)
            raise GoogleOAuthError("No se pudo iniciar el flujo de dispositivo de Google") from exc

        payload = response.json()
        device_code = payload.get("device_code")
        user_code = payload.get("user_code")
        verification_url = payload.get("verification_uri") or payload.get("verification_url")
        interval = int(payload.get("interval", 5))
        expires_in = int(payload.get("expires_in", 1800))

        if not device_code or not user_code or not verification_url:
            raise GoogleOAuthError("Respuesta inválida al iniciar flujo de dispositivo")

        state = DeviceFlowState(
            device_code=str(device_code),
            user_code=str(user_code),
            verification_url=str(verification_url),
            interval=max(1, interval),
            expires_at=time.monotonic() + max(30, expires_in),
            scopes=scope_values,
            created_at=time.time(),
        )

        async with self._lock:
            self._state = state
            self._access_token = None
            self._access_token_expiry = 0.0
            self._token_type = "Bearer"
            self._last_email = None
            self._poll_task = asyncio.create_task(self._poll_device_code(state))

        logger.info(
            "Google OAuth device: started. user_code=%s url=%s",
            _mask_value(state.user_code),
            state.verification_url,
        )

        return {
            "user_code": state.user_code,
            "verification_url": state.verification_url,
            "device_code": state.device_code,
            "interval": state.interval,
            "expires_in": expires_in,
        }

    async def _poll_device_code(self, state: DeviceFlowState) -> None:
        interval = state.interval
        while True:
            await asyncio.sleep(interval)
            async with self._lock:
                if self._state is not state:
                    return
                if time.monotonic() >= state.expires_at:
                    logger.warning("Google OAuth device: código expirado")
                    self._state = None
                    self._poll_task = None
                    return
                client_id = self._client_id
                client_secret = self._client_secret
                device_code = state.device_code
            if not client_id or not client_secret:
                logger.error("Google OAuth device: credenciales ausentes durante polling")
                return

            data = {
                "client_id": client_id,
                "client_secret": client_secret,
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            }

            try:
                response = await self._client.post(TOKEN_URL, data=data)
            except httpx.HTTPError as exc:  # pragma: no cover - red externa
                logger.error("Google OAuth device: error en polling: %s", exc)
                continue

            if response.status_code == 200:
                token_bundle = self._parse_token_response(response.json())
                email = await self._maybe_fetch_user_email(token_bundle)
                async with self._lock:
                    if self._state is state:
                        self._apply_token_bundle(token_bundle, email=email)
                        state.authorized = True
                        state.email = email
                        self._state = None
                        self._poll_task = None
                logger.info("Google OAuth device: authorized. refresh_token stored.")
                return

            try:
                error_payload = response.json()
            except ValueError:  # pragma: no cover - defensivo
                error_payload = {}
            error_code = (error_payload.get("error") or "").lower()
            if error_code == "authorization_pending":
                continue
            if error_code == "slow_down":
                interval = min(interval + 5, 30)
                continue
            if error_code in {"access_denied", "expired_token"}:
                logger.warning("Google OAuth device: flujo cancelado (%s)", error_code)
                async with self._lock:
                    if self._state is state:
                        state.last_error = error_code
                        self._state = None
                        self._poll_task = None
                return
            logger.error("Google OAuth device: error inesperado %s", error_code or response.text)
            async with self._lock:
                if self._state is state:
                    state.last_error = error_code or "unexpected_error"
                    self._state = None
                    self._poll_task = None
            return

    def _parse_token_response(self, payload: Dict[str, Any]) -> TokenBundle:
        access_token = payload.get("access_token")
        expires_in = int(payload.get("expires_in", 3600))
        refresh_token = payload.get("refresh_token")
        token_type = payload.get("token_type", "Bearer")
        scope = payload.get("scope")
        if not isinstance(access_token, str) or not access_token:
            raise GoogleOAuthError("Respuesta de token inválida")
        return TokenBundle(
            access_token=access_token,
            expires_in=max(60, expires_in),
            refresh_token=refresh_token if isinstance(refresh_token, str) and refresh_token else None,
            token_type=_normalize_token_type(token_type if isinstance(token_type, str) else None),
            scope=scope if isinstance(scope, str) else None,
        )

    async def _maybe_fetch_user_email(self, bundle: TokenBundle) -> Optional[str]:
        headers = {"Authorization": f"{bundle.token_type} {bundle.access_token}"}
        try:
            response = await self._client.get(USERINFO_URL, headers=headers)
            if response.status_code != 200:
                return None
            data = response.json()
            email = data.get("email")
            if isinstance(email, str) and email:
                return email
        except httpx.HTTPError:
            return None
        except ValueError:  # pragma: no cover - defensivo
            return None
        return None

    async def get_access_token(self, *, scopes: Sequence[str] | None = None, force_refresh: bool = False) -> str:
        async with self._lock:
            self._load_secrets()
            if not force_refresh and self._access_token and time.monotonic() < self._access_token_expiry:
                return self._access_token
            refresh_token = self._refresh_token
            client_id = self._client_id
            client_secret = self._client_secret
            if not refresh_token or not client_id or not client_secret:
                raise GoogleOAuthError("No hay token de actualización disponible")

        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        try:
            response = await self._client.post(TOKEN_URL, data=data)
        except httpx.HTTPError as exc:  # pragma: no cover - red externa
            raise GoogleOAuthError("No se pudo refrescar el token de Google") from exc

        if response.status_code != 200:
            error = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            error_code = (error.get("error") or "").lower() if isinstance(error, dict) else ""
            if error_code == "invalid_grant":
                async with self._lock:
                    self._refresh_token = None
                    write_google_refresh_token(None)
                raise GoogleOAuthError("Token de actualización inválido")
            raise GoogleOAuthError("No se pudo refrescar el token de Google")

        token_bundle = self._parse_token_response(response.json())
        async with self._lock:
            self._apply_token_bundle(token_bundle)
            return self._access_token or ""

    async def cancel(self) -> bool:
        async with self._lock:
            state = self._state
            task = self._poll_task
            self._state = None
            self._poll_task = None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:  # pragma: no cover - esperado
                pass
        return state is not None

    async def status(self) -> Dict[str, Any]:
        async with self._lock:
            self._load_secrets()
            now = time.monotonic()
            state = self._state
            if state and now >= state.expires_at and not state.authorized:
                state = None
                self._state = None
                self._poll_task = None
            has_refresh = bool(self._refresh_token)
            authorized = has_refresh or (self._access_token and now < self._access_token_expiry)
            needs_action = bool(state and not authorized)
            user_code = state.user_code if needs_action else None
            verification_url = state.verification_url if needs_action else None
            email = state.email if state and state.authorized else self._last_email if authorized else None
            credentials_ready = bool(self._client_id and self._client_secret)
            return {
                "authorized": bool(authorized),
                "needs_action": needs_action,
                "user_code": user_code,
                "verification_url": verification_url,
                "email": email,
                "has_credentials": credentials_ready,
                "has_refresh_token": has_refresh,
            }

    def _apply_token_bundle(self, bundle: TokenBundle, *, email: Optional[str] = None) -> None:
        self._access_token = bundle.access_token
        self._access_token_expiry = time.monotonic() + max(30.0, bundle.expires_in - 10)
        self._token_type = _normalize_token_type(bundle.token_type)
        if bundle.refresh_token:
            self._refresh_token = bundle.refresh_token
            write_google_refresh_token(bundle.refresh_token)
        if email:
            self._last_email = email

    def authorization_header(self) -> Dict[str, str]:
        if not self._access_token:
            raise GoogleOAuthError("No hay token activo")
        token_type = _normalize_token_type(self._token_type)
        return {"Authorization": f"{token_type} {self._access_token}"}


def _mask_value(value: str) -> str:
    if len(value) <= 4:
        return "****"
    return f"{value[:2]}…{value[-2:]}"


def _normalize_token_type(value: Optional[str]) -> str:
    if not value:
        return "Bearer"
    token = value.strip()
    if not token:
        return "Bearer"
    if token.lower() == "bearer":
        return "Bearer"
    return token
