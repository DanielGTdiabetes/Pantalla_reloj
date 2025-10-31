"""Rate limiter simple para controlar frecuencia de requests."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple


class RateLimiter:
    """Rate limiter simple basado en tokens por ventana de tiempo."""
    
    def __init__(self):
        # Almacenar (count, window_start) por key
        self._counts: Dict[str, Tuple[int, datetime]] = {}
    
    def check(
        self,
        key: str,
        max_requests: int,
        window_seconds: int = 60
    ) -> Tuple[bool, Optional[int]]:
        """Verifica si se puede hacer un request.
        
        Args:
            key: Identificador único para el rate limit
            max_requests: Máximo número de requests permitidos
            window_seconds: Ventana de tiempo en segundos (default: 60)
            
        Returns:
            Tuple de (allowed: bool, remaining_seconds: int | None)
            - allowed: True si se puede hacer el request
            - remaining_seconds: Segundos hasta que se puede hacer el siguiente request (si no está permitido)
        """
        now = datetime.now(timezone.utc)
        
        if key not in self._counts:
            self._counts[key] = (1, now)
            return (True, None)
        
        count, window_start = self._counts[key]
        
        # Si la ventana ha expirado, reiniciar
        if (now - window_start).total_seconds() >= window_seconds:
            self._counts[key] = (1, now)
            return (True, None)
        
        # Si aún está en la ventana, verificar límite
        if count >= max_requests:
            # Calcular cuántos segundos faltan para la siguiente ventana
            next_window = window_start + timedelta(seconds=window_seconds)
            remaining = (next_window - now).total_seconds()
            return (False, int(max(0, remaining)))
        
        # Incrementar contador
        self._counts[key] = (count + 1, window_start)
        return (True, None)
    
    def cleanup_old_keys(self, max_age_hours: int = 24):
        """Limpia keys antiguas que ya no se usan."""
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=max_age_hours)
        
        keys_to_remove = [
            key for key, (_, window_start) in self._counts.items()
            if window_start < cutoff
        ]
        
        for key in keys_to_remove:
            del self._counts[key]


# Singleton global
_rate_limiter = RateLimiter()


def check_rate_limit(key: str, max_per_minute: int) -> Tuple[bool, Optional[int]]:
    """Helper para verificar rate limit por minuto."""
    return _rate_limiter.check(key, max_per_minute, window_seconds=60)

