"""Servicio de predicción basado en datos de AEMET."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Sequence, Tuple

from .aemet import AemetClient, DatasetResult, DatasetUnavailableError, MissingApiKeyError
from .offline_state import record_provider_failure, record_provider_success

logger = logging.getLogger(__name__)
UTC = timezone.utc


@dataclass
class DailyForecast:
    date: datetime
    min_temp: float
    max_temp: float
    rain_prob: float
    storm_prob: float
    condition: str
    icon: str

    def as_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date.date().isoformat(),
            "day": self.date.strftime("%a").title(),
            "min": round(self.min_temp, 1),
            "max": round(self.max_temp, 1),
            "rain_prob": round(self.rain_prob, 1),
            "storm_prob": round(self.storm_prob, 1),
            "condition": self.condition,
            "icon": self.icon,
        }


@dataclass
class WeatherToday:
    temperature: float
    minimum: float
    maximum: float
    rain_prob: float
    condition: str
    icon: str
    city: str
    updated_at: datetime

    def as_dict(self) -> Dict[str, Any]:
        return {
            "temp": round(self.temperature, 1),
            "min": round(self.minimum, 1),
            "max": round(self.maximum, 1),
            "rain_prob": round(self.rain_prob, 1),
            "condition": self.condition,
            "icon": self.icon,
            "city": self.city,
            "updated_at": int(self.updated_at.timestamp() * 1000),
        }


class WeatherServiceError(Exception):
    """Error genérico de la capa de clima."""


@dataclass
class WeatherForecastMeta:
    cached: bool
    source: str
    fetched_at: datetime
    cached_at: datetime | None
    provider_ok: bool
    provider_error: str | None = None


class WeatherService:
    """Agregador de datos diarios y horarios."""

    def __init__(self) -> None:
        self._client = AemetClient()

    async def close(self) -> None:
        await self._client.close()

    async def get_forecast(
        self,
        municipio_id: str,
        *,
        city_hint: str | None = None,
    ) -> Tuple[WeatherToday, List[DailyForecast], WeatherForecastMeta]:
        try:
            daily_result = await self._client.fetch_daily(municipio_id)
            hourly_result = await self._client.fetch_hourly(municipio_id)
        except MissingApiKeyError as exc:
            raise MissingApiKeyError(str(exc)) from exc
        except DatasetUnavailableError as exc:
            raise WeatherServiceError(str(exc)) from exc

        fetched_at = datetime.fromtimestamp(
            max(daily_result.timestamp, hourly_result.timestamp), tz=UTC
        )
        daily_section = _extract_prediccion(daily_result.payload)
        hourly_section = _extract_prediccion(hourly_result.payload)
        if not daily_section:
            raise WeatherServiceError("Datos de predicción diarios vacíos")

        city_name = city_hint or _extract_city_name(daily_result.payload) or "Municipio"
        days = _build_daily_forecast(daily_section)
        if not days:
            raise WeatherServiceError("Sin datos diarios procesables")

        current_temp = _estimate_current_temperature(hourly_section or daily_section)
        today = days[0]
        summary = WeatherToday(
            temperature=current_temp if current_temp is not None else (today.max_temp + today.min_temp) / 2,
            minimum=today.min_temp,
            maximum=today.max_temp,
            rain_prob=today.rain_prob,
            condition=today.condition,
            icon=today.icon,
            city=city_name,
            updated_at=fetched_at,
        )
        cached = daily_result.from_cache and hourly_result.from_cache
        cached_at: datetime | None = None
        if cached:
            cached_at = datetime.fromtimestamp(
                max(daily_result.timestamp, hourly_result.timestamp), tz=UTC
            )

        source = "cache" if cached else "live"
        error_parts = [
            part
            for part in (daily_result.error, hourly_result.error)
            if part
        ]
        provider_ok = not error_parts and not (daily_result.stale or hourly_result.stale)
        provider_error = "; ".join(error_parts) or None

        meta = WeatherForecastMeta(
            cached=cached,
            source=source,
            fetched_at=fetched_at,
            cached_at=cached_at,
            provider_ok=provider_ok,
            provider_error=provider_error,
        )

        if provider_ok:
            record_provider_success("aemet")
        else:
            record_provider_failure("aemet", provider_error)

        return summary, days, meta

    async def get_radar_descriptor(self) -> Tuple[Dict[str, Any], bool, datetime]:
        try:
            result: DatasetResult = await self._client.fetch_radar_summary()
        except MissingApiKeyError as exc:
            raise MissingApiKeyError(str(exc)) from exc
        except DatasetUnavailableError as exc:
            raise WeatherServiceError(str(exc)) from exc
        fetched_at = datetime.fromtimestamp(result.timestamp, tz=UTC)
        data = result.payload if isinstance(result.payload, dict) else {"url": result.payload}
        return data, result.from_cache, fetched_at


def _extract_prediccion(raw: Any) -> Sequence[Dict[str, Any]]:
    if isinstance(raw, list) and raw:
        entry = raw[0]
        prediccion = entry.get("prediccion") if isinstance(entry, dict) else None
        if isinstance(prediccion, dict):
            dias = prediccion.get("dia")
            if isinstance(dias, list):
                return dias
    return []


def _extract_city_name(raw: Any) -> str | None:
    if isinstance(raw, list) and raw:
        entry = raw[0]
        if isinstance(entry, dict):
            nombre = entry.get("nombre") or entry.get("municipio")
            if isinstance(nombre, str) and nombre.strip():
                return nombre.strip()
    return None


def _build_daily_forecast(days_raw: Sequence[Dict[str, Any]]) -> List[DailyForecast]:
    days: List[DailyForecast] = []
    for raw in days_raw:
        date = _parse_date(raw.get("fecha"))
        temperatura = raw.get("temperatura") or {}
        min_temp = _safe_float(temperatura.get("minima"))
        max_temp = _safe_float(temperatura.get("maxima"))
        rain_prob = _extract_probability(raw.get("probPrecipitacion"))
        storm_prob = _extract_probability(raw.get("probTormenta"))
        condition = _extract_condition(raw.get("estadoCielo"))
        icon = _map_condition_to_icon(condition)
        if date is None or min_temp is None or max_temp is None:
            continue
        days.append(
            DailyForecast(
                date=date,
                min_temp=min_temp,
                max_temp=max_temp,
                rain_prob=rain_prob,
                storm_prob=storm_prob,
                condition=condition,
                icon=icon,
            )
        )
    return days


def _parse_date(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        if isinstance(value, str):
            # Algunas respuestas incluyen hora en ISO y otras solo fecha
            if len(value) == 10:
                return datetime.fromisoformat(value).replace(tzinfo=UTC)
            return datetime.fromisoformat(value).astimezone(UTC)
    except ValueError:
        logger.debug("No se pudo parsear fecha AEMET: %s", value)
    return None


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_probability(items: Any) -> float:
    if not isinstance(items, list):
        return 0.0
    prob = 0.0
    for entry in items:
        if not isinstance(entry, dict):
            continue
        value = entry.get("value") or entry.get("valor")
        num = _safe_float(value)
        if num is None:
            continue
        prob = max(prob, num)
    return prob


def _extract_condition(items: Any) -> str:
    if isinstance(items, list):
        for entry in items:
            if not isinstance(entry, dict):
                continue
            descripcion = entry.get("descripcion") or entry.get("value")
            if isinstance(descripcion, str) and descripcion.strip():
                text = descripcion.strip().capitalize()
                return text
    return "Sin datos"


def _map_condition_to_icon(condition: str) -> str:
    text = condition.lower()
    if any(token in text for token in ("tormenta", "elect", "ray")):
        return "storm"
    if any(token in text for token in ("nieve", "helada")):
        return "snow"
    if any(token in text for token in ("lluv", "chub", "aguac", "precip")):
        return "rain"
    if any(token in text for token in ("niebla", "bruma", "nubosidad baja")):
        return "fog"
    if any(token in text for token in ("despejado", "soleado", "poco nuboso")):
        return "sun"
    if any(token in text for token in ("nub", "nublado", "intervalos")):
        return "cloud"
    return "cloud"


def _estimate_current_temperature(days: Sequence[Dict[str, Any]]) -> float | None:
    if not days:
        return None
    now = datetime.now(tz=UTC)
    today_raw = days[0]
    temp_section = today_raw.get("temperatura") if isinstance(today_raw, dict) else None
    if not isinstance(temp_section, dict):
        return None
    datos = temp_section.get("dato")
    if not isinstance(datos, list):
        return None
    closest = None
    best_delta = timedelta(days=999)
    for entry in datos:
        if not isinstance(entry, dict):
            continue
        hour_raw = entry.get("hora")
        value = _safe_float(entry.get("value") or entry.get("valor"))
        if value is None:
            continue
        try:
            hour = int(hour_raw)
        except (TypeError, ValueError):
            continue
        target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        delta = abs(target - now)
        if delta < best_delta:
            best_delta = delta
            closest = value
    return closest

