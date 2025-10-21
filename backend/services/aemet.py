"""Cliente ligero para consumir datos de AEMET OpenData."""
from __future__ import annotations

import gzip
import io
import json
import logging
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from .config import get_api_key, read_config
from .metrics import record_latency
from .offline_state import record_provider_failure, record_provider_success

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / "storage" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
BASE_URL = "https://opendata.aemet.es/opendata/api"
CACHE_TTL_SECONDS = 30 * 60
MEMORY_CACHE_TTL_SECONDS = 5 * 60


@dataclass
class CacheEntry:
    data: Any
    timestamp: float


@dataclass
class DatasetResult:
    payload: Any
    from_cache: bool
    timestamp: float
    stale: bool = False
    error: Optional[str] = None


class AemetError(Exception):
    """Error base para el cliente de AEMET."""


class MissingApiKeyError(AemetError):
    """Señala que falta la API key en la configuración."""


class DatasetUnavailableError(AemetError):
    """Señala que AEMET no pudo entregar datos válidos."""


class AemetDecodeError(AemetError):
    """Señala que no se pudo decodificar un recurso de datos de AEMET."""


_MEMORY_CACHE: Dict[str, CacheEntry] = {}


def _decode_aemet_payload(url: str, headers: httpx.Headers, content: bytes) -> Dict[str, Any]:
    """Normaliza contenido AEMET, manejando compresión y codificación errónea."""

    content_type = headers.get("content-type", "")
    content_encoding = headers.get("content-encoding", "")
    size = len(content)
    applied_gzip = False
    applied_zip = False
    raw_bytes = content

    if content_encoding.lower() == "gzip" or raw_bytes.startswith(b"\x1f\x8b"):
        try:
            raw_bytes = gzip.decompress(raw_bytes)
            applied_gzip = True
        except OSError as exc:
            raise AemetDecodeError(
                f"No se pudo descomprimir contenido gzip de {url}"
            ) from exc

    if "zip" in content_type.lower() or raw_bytes.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zip_file:
                for name in zip_file.namelist():
                    if name.lower().endswith(".json"):
                        with zip_file.open(name) as member:
                            raw_bytes = member.read()
                            applied_zip = True
                            break
                else:
                    raise AemetDecodeError(
                        f"Archivo ZIP sin JSON utilizable en {url}"
                    )
        except (OSError, zipfile.BadZipFile) as exc:
            raise AemetDecodeError(
                f"No se pudo abrir ZIP devuelto por {url}"
            ) from exc

    try:
        decoded = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            decoded = raw_bytes.decode("latin-1")
        except UnicodeDecodeError:
            decoded = raw_bytes.decode("utf-8", errors="ignore")

    logger.debug(
        "AEMET fetch ok url=%s type=%s encoding=%s size=%d gzip=%s zip=%s",
        url,
        content_type,
        content_encoding,
        size,
        applied_gzip,
        applied_zip,
    )

    try:
        return json.loads(decoded)
    except json.JSONDecodeError as exc:
        sample = raw_bytes[:16].hex()
        raise AemetDecodeError(
            f"JSON inválido desde {url} (tipo={content_type}, bytes={sample})"
        ) from exc


def _fetch_aemet_json(url: str) -> Dict[str, Any]:
    """Descarga un JSON AEMET manejando compresiones problemáticas."""

    headers = {"Accept-Encoding": "gzip, deflate"}
    timeout = httpx.Timeout(15.0, read=15.0)
    with httpx.Client(timeout=timeout) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return _decode_aemet_payload(url, response.headers, response.content)


async def _fetch_aemet_json_async(client: httpx.AsyncClient, url: str) -> Dict[str, Any]:
    headers = {"Accept-Encoding": "gzip, deflate"}
    response = await client.get(url, headers=headers)
    response.raise_for_status()
    return _decode_aemet_payload(url, response.headers, response.content)


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

    async def fetch_daily(self, municipio_id: str) -> DatasetResult:
        return await self._fetch_dataset(
            f"prediccion/especifica/municipio/diaria/{municipio_id}",
            f"aemet_daily_{municipio_id}.json",
        )

    async def fetch_hourly(self, municipio_id: str) -> DatasetResult:
        return await self._fetch_dataset(
            f"prediccion/especifica/municipio/horaria/{municipio_id}",
            f"aemet_hourly_{municipio_id}.json",
        )

    async def fetch_radar_summary(self) -> DatasetResult:
        """Obtiene el último resumen de radar nacional."""
        return await self._fetch_dataset(
            "red/radar/nacional",
            "aemet_radar.json",
            allow_stale=True,
            ttl_seconds=10 * 60,
            memory_ttl_seconds=10 * 60,
        )

    async def _fetch_dataset(
        self,
        endpoint: str,
        cache_name: str,
        *,
        allow_stale: bool = True,
        ttl_seconds: int = CACHE_TTL_SECONDS,
        memory_ttl_seconds: int = MEMORY_CACHE_TTL_SECONDS,
    ) -> DatasetResult:
        cache_path = CACHE_DIR / cache_name
        cached = self._load_cache(cache_path)
        mem_key = cache_name
        mem_cached = _MEMORY_CACHE.get(mem_key)
        now = time.time()
        if (
            mem_cached
            and memory_ttl_seconds > 0
            and now - mem_cached.timestamp < memory_ttl_seconds
        ):
            return DatasetResult(
                payload=mem_cached.data,
                from_cache=True,
                timestamp=mem_cached.timestamp,
            )

        if cached and now - cached.timestamp < ttl_seconds:
            _MEMORY_CACHE[mem_key] = CacheEntry(cached.data, cached.timestamp)
            return DatasetResult(
                payload=cached.data,
                from_cache=True,
                timestamp=cached.timestamp,
            )

        api_key = get_api_key()
        if not api_key:
            raise MissingApiKeyError("Falta la API key de AEMET en config")

        client = await self._get_client()
        url = f"{BASE_URL}/{endpoint}"
        start = time.perf_counter()
        try:
            response = await client.get(url, params={"api_key": api_key})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            duration = time.perf_counter() - start
            record_latency("aemet", duration)
            logger.error("Fallo solicitando recurso AEMET %s: %s", endpoint, exc)
            status_code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            if status_code == 429:
                fallback = mem_cached or cached
                if fallback:
                    logger.warning("AEMET rate limited para %s, usando caché", endpoint)
                    record_provider_failure("aemet", "rate limited")
                    return DatasetResult(
                        payload=fallback.data,
                        from_cache=True,
                        timestamp=fallback.timestamp,
                        stale=True,
                        error="rate limited",
                    )
                record_provider_failure("aemet", "rate limited")
                raise DatasetUnavailableError("AEMET rate limited") from exc

            if cached and allow_stale:
                logger.warning("Usando caché antigua para %s", endpoint)
                record_provider_failure("aemet", str(exc))
                return DatasetResult(
                    payload=cached.data,
                    from_cache=True,
                    timestamp=cached.timestamp,
                    stale=True,
                    error=str(exc),
                )
            record_provider_failure("aemet", str(exc))
            raise DatasetUnavailableError("AEMET no disponible") from exc

        try:
            descriptor = response.json()
        except json.JSONDecodeError as exc:
            duration = time.perf_counter() - start
            record_latency("aemet", duration)
            record_provider_failure("aemet", "descriptor json inválido")
            raise DatasetUnavailableError("Respuesta inesperada de AEMET") from exc

        data_url = descriptor.get("datos")
        if not data_url:
            logger.error("Descriptor AEMET sin URL de datos: %s", descriptor)
            duration = time.perf_counter() - start
            record_latency("aemet", duration)
            if cached and allow_stale:
                record_provider_failure("aemet", "descriptor sin datos")
                return DatasetResult(
                    payload=cached.data,
                    from_cache=True,
                    timestamp=cached.timestamp,
                    stale=True,
                    error="descriptor sin datos",
                )
            record_provider_failure("aemet", "descriptor sin datos")
            raise DatasetUnavailableError("Descriptor de datos incompleto")

        try:
            payload = await _fetch_aemet_json_async(client, data_url)
        except httpx.HTTPStatusError as exc:
            logger.error("No se pudo descargar dataset %s: %s", data_url, exc)
            duration = time.perf_counter() - start
            record_latency("aemet", duration)
            if exc.response.status_code == 429:
                fallback = mem_cached or cached
                if fallback:
                    logger.warning("AEMET datos rate limited para %s, usando caché", data_url)
                    record_provider_failure("aemet", "rate limited")
                    return DatasetResult(
                        payload=fallback.data,
                        from_cache=True,
                        timestamp=fallback.timestamp,
                        stale=True,
                        error="rate limited",
                    )
                record_provider_failure("aemet", "rate limited")
                raise DatasetUnavailableError("AEMET rate limited") from exc
            if cached and allow_stale:
                record_provider_failure("aemet", str(exc))
                return DatasetResult(
                    payload=cached.data,
                    from_cache=True,
                    timestamp=cached.timestamp,
                    stale=True,
                    error=str(exc),
                )
            record_provider_failure("aemet", str(exc))
            raise DatasetUnavailableError("No se pudo descargar datos") from exc
        except AemetDecodeError as exc:
            logger.error("No se pudo decodificar dataset %s: %s", data_url, exc)
            duration = time.perf_counter() - start
            record_latency("aemet", duration)
            if cached and allow_stale:
                record_provider_failure("aemet", str(exc))
                return DatasetResult(
                    payload=cached.data,
                    from_cache=True,
                    timestamp=cached.timestamp,
                    stale=True,
                    error=str(exc),
                )
            fallback = mem_cached
            if fallback:
                record_provider_failure("aemet", str(exc))
                return DatasetResult(
                    payload=fallback.data,
                    from_cache=True,
                    timestamp=fallback.timestamp,
                    stale=True,
                    error=str(exc),
                )
            record_provider_failure("aemet", str(exc))
            raise DatasetUnavailableError("AEMET no disponible temporalmente") from exc

        duration = time.perf_counter() - start
        record_latency("aemet", duration)
        record_provider_success("aemet")

        self._save_cache(cache_path, payload, now)
        _MEMORY_CACHE[mem_key] = CacheEntry(payload, now)
        return DatasetResult(payload=payload, from_cache=False, timestamp=now)

    def _load_cache(self, path: Path) -> CacheEntry | None:
        if not path.exists():
            return None
        try:
            with path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
            if isinstance(raw, dict) and "data" in raw and "timestamp" in raw:
                timestamp = float(raw.get("timestamp", 0))
                return CacheEntry(raw.get("data"), timestamp)
            stat = path.stat()
            return CacheEntry(raw, stat.st_mtime)
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

