from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx

from .config import read_config

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_PATH = PROJECT_ROOT / "storage" / "cache" / "weather_cache.json"
OWM_ENDPOINT = "https://api.openweathermap.org/data/2.5/weather"


class WeatherService:
    def __init__(self) -> None:
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=10.0))
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def fetch_current(self, lat: float, lon: float) -> Tuple[Dict[str, Any], bool]:
        config = read_config()
        api_key = config.weather.apiKey if config.weather else None
        units = config.weather.units if config.weather and config.weather.units else "metric"

        if not api_key:
            logger.warning("Weather request rejected: OpenWeatherMap API key missing")
            raise MissingApiKeyError("OPENWEATHER_API_KEY is missing")

        params = {
            "lat": lat,
            "lon": lon,
            "appid": api_key,
            "units": units,
            "lang": "es",
        }

        client = await self._get_client()
        try:
            response = await client.get(OWM_ENDPOINT, params=params)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("OpenWeatherMap request failed: %s", exc)
            cached = load_cache()
            if cached:
                return cached, True
            raise WeatherServiceError("No weather data available") from exc

        data = response.json()
        payload = transform_current_payload(data)
        save_cache(payload)
        return payload, False


class MissingApiKeyError(Exception):
    """Raised when no API key is configured."""


class WeatherServiceError(Exception):
    """Raised when the weather service cannot return data."""


def transform_current_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    weather = (data.get("weather") or [{}])[0]
    main = data.get("main") or {}
    rain = data.get("rain") or {}
    snow = data.get("snow") or {}
    clouds = data.get("clouds") or {}

    condition = weather.get("description") or ""
    if condition:
        condition = condition[:1].upper() + condition[1:]
    icon = normalize_icon(weather.get("id"))

    precipitation = 0.0
    for key in ("1h", "3h"):
        if key in rain:
            precipitation = max(precipitation, float(rain[key]) * 10)
        if key in snow:
            precipitation = max(precipitation, float(snow[key]) * 10)
    precip_prob = max(precipitation, float(clouds.get("all", 0)))
    precip_prob = max(0.0, min(100.0, precip_prob))

    payload = {
        "temp": float(main.get("temp", 0.0)),
        "condition": condition or "Sin datos",
        "icon": icon,
        "precipProb": round(precip_prob, 1),
        "humidity": int(main.get("humidity", 0)),
        "updatedAt": int(time.time() * 1000),
    }
    return payload


def normalize_icon(code: Optional[int]) -> str:
    if not code:
        return "cloud"
    if 200 <= code < 300:
        return "storm"
    if 300 <= code < 600:
        return "rain"
    if 600 <= code < 700:
        return "snow"
    if 700 <= code < 800:
        return "fog"
    if code == 800:
        return "sun"
    if 801 <= code <= 804:
        return "cloud"
    return "cloud"


def load_cache() -> Optional[Dict[str, Any]]:
    if not CACHE_PATH.exists():
        return None
    try:
        with CACHE_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read weather cache: %s", exc)
        return None


def save_cache(payload: Dict[str, Any]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = CACHE_PATH.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f)
    tmp_path.replace(CACHE_PATH)
