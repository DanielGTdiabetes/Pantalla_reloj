from __future__ import annotations

"""Estado compartido sobre la disponibilidad de proveedores externos."""

from dataclasses import dataclass
import threading
import time
from typing import Any, Dict, Optional


@dataclass
class ProviderStatus:
    ok: bool
    timestamp: float
    error: Optional[str] = None


_KNOWN_PROVIDERS = {"aemet", "openai", "nager"}
_status_lock = threading.Lock()
_provider_status: Dict[str, ProviderStatus] = {
    name: ProviderStatus(ok=True, timestamp=time.time(), error=None)
    for name in _KNOWN_PROVIDERS
}


def _normalize_provider(name: str) -> str:
    return name.lower().strip()


def record_provider_success(provider: str) -> None:
    """Marca un proveedor como disponible en el último intento."""

    normalized = _normalize_provider(provider)
    now = time.time()
    status = ProviderStatus(ok=True, timestamp=now, error=None)
    with _status_lock:
        _provider_status[normalized] = status


def record_provider_failure(provider: str, error: Optional[str] = None) -> None:
    """Marca un proveedor como fallido en el último intento."""

    normalized = _normalize_provider(provider)
    now = time.time()
    message = (error or "").strip()
    if message and len(message) > 300:
        message = message[:300] + "…"
    status = ProviderStatus(ok=False, timestamp=now, error=message or None)
    with _status_lock:
        _provider_status[normalized] = status


def get_offline_state() -> Dict[str, Any]:
    """Devuelve el estado combinado de conectividad externa."""

    with _status_lock:
        snapshot = dict(_provider_status)

    offline = bool(snapshot) and all(not state.ok for state in snapshot.values())
    since_ms: Optional[int] = None
    if offline:
        since = min(state.timestamp for state in snapshot.values() if not state.ok)
        since_ms = int(since * 1000)

    sources = {name: state.ok for name, state in snapshot.items()}
    result: Dict[str, Any] = {"offline": offline, "sources": sources}
    if since_ms is not None:
        result["since"] = since_ms
    errors = {name: state.error for name, state in snapshot.items() if state.error}
    if errors:
        result["errors"] = errors
    return result


__all__ = [
    "get_offline_state",
    "record_provider_failure",
    "record_provider_success",
    "ProviderStatus",
]

