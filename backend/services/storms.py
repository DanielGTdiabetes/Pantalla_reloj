"""Servicios relacionados con tormentas y radar."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from .config import read_config
from .weather import WeatherService

logger = logging.getLogger(__name__)


class StormServiceError(Exception):
    """Error genérico para la capa de tormentas."""


class StormService:
    """Evalúa la probabilidad de actividad eléctrica cercana."""

    def __init__(self, weather_service: WeatherService) -> None:
        self._weather_service = weather_service

    async def status(self) -> Dict[str, Any]:
        config = read_config()
        if not config.aemet:
            raise StormServiceError("Falta configuración de AEMET")
        municipio_id = config.aemet.municipioId
        storm_threshold = config.storm.threshold if config.storm else 0.6
        city_hint = config.weather.city if config.weather else None

        today, days, _ = await self._weather_service.get_forecast(municipio_id, city_hint=city_hint)
        storm_prob = days[0].storm_prob / 100 if days else 0.0
        radar_descriptor, _, radar_time = await self._weather_service.get_radar_descriptor()
        radar_url = resolve_radar_url(radar_descriptor)

        near_activity = bool(storm_prob >= storm_threshold and radar_url)
        updated_at = max(today.updated_at, radar_time)

        return {
            "storm_prob": round(storm_prob, 3),
            "near_activity": near_activity,
            "radar_url": radar_url,
            "updated_at": int(updated_at.timestamp() * 1000),
        }


def resolve_radar_url(payload: Any) -> Optional[str]:
    if isinstance(payload, str) and payload.strip():
        return payload
    if isinstance(payload, dict):
        for key in ("url", "path", "imagen", "image", "enlace"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value
    if isinstance(payload, list):
        # Intentar el último elemento válido
        for entry in reversed(payload):
            if isinstance(entry, dict):
                for key in ("url", "path", "imagen", "image", "enlace"):
                    value = entry.get(key)
                    if isinstance(value, str) and value.strip():
                        return value
            if isinstance(entry, str) and entry.strip():
                return entry
    return None

