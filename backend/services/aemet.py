"""Cliente ligero para consumir datos de AEMET OpenData."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import httpx

from .config import get_api_key, read_config

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / "storage" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
BASE_URL = "https://opendata.aemet.es/opendata/api"
CACHE_TTL_SECONDS = 30 * 60


class AemetError(Exception):
    """Error base para el cliente de AEMET."""


class MissingApiKeyError(AemetError):
    """Señala que falta la API key en la configuración."""


class DatasetUnavailableError(AemetError):
    """Señala que AEMET no pudo entregar datos válidos."""


class AemetClient:
    """Cliente HTTP con caché local para peticiones a AEMET."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            timeout = httpx.Timeout(20.0, read=20.0)
            self._client = httpx.AsyncClient(timeout=timeout)
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def fetch_daily(self, municipio_id: str) -> Tuple[List[Dict[str, Any]], bool, float]:
        return await self._fetch_dataset(
            f"prediccion/especifica/municipio/diaria/{municipio_id}",
            f"aemet_daily_{municipio_id}.json",
        )

    async def fetch_hourly(self, municipio_id: str) -> Tuple[List[Dict[str, Any]], bool, float]:
        return await self._fetch_dataset(
            f"prediccion/especifica/municipio/horaria/{municipio_id}",
            f"aemet_hourly_{municipio_id}.json",
        )

    async def fetch_radar_summary(self) -> Tuple[Dict[str, Any], bool, float]:
        """Obtiene el último resumen de radar nacional."""
        return await self._fetch_dataset(
            "red/radar/nacional", "aemet_radar.json", allow_stale=True, ttl_seconds=10 * 60
        )

    async def _fetch_dataset(
        self,
        endpoint: str,
        cache_name: str,
        *,
        allow_stale: bool = True,
        ttl_seconds: int = CACHE_TTL_SECONDS,
    ) -> Tuple[Any, bool, float]:
        cache_path = CACHE_DIR / cache_name
        cached = self._load_cache(cache_path)
        now = time.time()
        if cached and now - cached[1] < ttl_seconds:
            return cached[0], True, cached[1]

        api_key = get_api_key()
        if not api_key:
            raise MissingApiKeyError("Falta la API key de AEMET en config")

        client = await self._get_client()
        url = f"{BASE_URL}/{endpoint}"
        try:
            response = await client.get(url, params={"api_key": api_key})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("Fallo solicitando recurso AEMET %s: %s", endpoint, exc)
            if cached and allow_stale:
                logger.warning("Usando caché antigua para %s", endpoint)
                return cached[0], True, cached[1]
            raise DatasetUnavailableError("AEMET no disponible") from exc

        try:
            descriptor = response.json()
        except json.JSONDecodeError as exc:
            raise DatasetUnavailableError("Respuesta inesperada de AEMET") from exc

        data_url = descriptor.get("datos")
        if not data_url:
            logger.error("Descriptor AEMET sin URL de datos: %s", descriptor)
            if cached and allow_stale:
                return cached[0], True, cached[1]
            raise DatasetUnavailableError("Descriptor de datos incompleto")

        try:
            data_response = await client.get(data_url)
            data_response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("No se pudo descargar dataset %s: %s", data_url, exc)
            if cached and allow_stale:
                return cached[0], True, cached[1]
            raise DatasetUnavailableError("No se pudo descargar datos") from exc

        payload: Any
        try:
            payload = data_response.json()
        except json.JSONDecodeError:
            payload = data_response.text

        self._save_cache(cache_path, payload, now)
        return payload, False, now

    def _load_cache(self, path: Path) -> Tuple[Any, float] | None:
        if not path.exists():
            return None
        try:
            with path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
            return raw.get("data"), float(raw.get("timestamp", 0))
        except (OSError, ValueError, TypeError) as exc:
            logger.warning("No se pudo leer caché %s: %s", path, exc)
            return None

    def _save_cache(self, path: Path, payload: Any, timestamp: float) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        data = {"timestamp": timestamp, "data": payload}
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(data, handle)
        tmp.replace(path)


def resolve_municipio_id() -> str:
    """Obtiene el municipio configurado actualmente."""
    config = read_config()
    if config.aemet and config.aemet.municipioId:
        return config.aemet.municipioId
    raise DatasetUnavailableError("Municipio AEMET no configurado")

