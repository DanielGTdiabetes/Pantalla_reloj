from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from .cache import CacheStore
from .config_manager import ConfigManager
from .data_sources import (
    calculate_extended_astronomy,
    calculate_moon_phase,
    calculate_sun_times,
    fetch_google_calendar_events,
    get_astronomical_events,
    get_harvest_data,
    get_saints_today,
    parse_rss_feed,
)
from .focus_masks import check_point_in_focus, load_or_build_focus_mask
from .global_providers import GIBSProvider, RainViewerProvider
from .layer_providers import (
    AISHubProvider,
    AISStreamProvider,
    AviationStackFlightProvider,
    CustomFlightProvider,
    CustomShipProvider,
    FlightProvider,
    GenericAISProvider,
    OpenSkyFlightProvider,
    ShipProvider,
)
from .logging_utils import configure_logging
from .models import AppConfig
from .secret_store import SecretStore
from .services.opensky_auth import OpenSkyAuthError
from .services.opensky_client import OpenSkyClientError
from .services.opensky_service import OpenSkyService
from .services.opensky_auth import OpenSkyAuthenticator
from .services.ships_service import AISStreamService
from .rate_limiter import check_rate_limit

APP_START = datetime.now(timezone.utc)
logger = configure_logging()
config_manager = ConfigManager()
cache_store = CacheStore()
secret_store = SecretStore()
opensky_service = OpenSkyService(secret_store, logger)
ships_service = AISStreamService(cache_store=cache_store, secret_store=secret_store, logger=logger)

app = FastAPI(title="Pantalla Reloj Backend", version="2025.10.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
def _shutdown_services() -> None:
    opensky_service.close()
    ships_service.close()

def _ensure_directory(path: Path, description: str, fallback: Optional[Path] = None) -> Path:
    """Ensure *path* exists, optionally falling back if permissions are denied."""

    try:
        path.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        logger.warning(
            "Failed to create %s at %s due to permissions: %s",
            description,
            path,
            exc,
        )
        if fallback is not None:
            try:
                fallback.mkdir(parents=True, exist_ok=True)
            except Exception as fb_exc:  # noqa: BLE001
                logger.error(
                    "Could not create fallback %s at %s: %s",
                    description,
                    fallback,
                    fb_exc,
                )
            else:
                logger.warning(
                    "Using fallback %s at %s",
                    description,
                    fallback,
                )
                return fallback
        else:
            logger.warning("No fallback provided for %s", description)
    except OSError as exc:
        logger.error("Failed to ensure %s at %s: %s", description, path, exc)
    return path


_TEMP_STATIC_DIR = Path(tempfile.gettempdir()) / "pantalla-static"
STATIC_DIR = _ensure_directory(
    Path("/opt/pantalla-reloj/frontend/static"),
    "static assets directory",
    fallback=_TEMP_STATIC_DIR,
)

_TEMP_FRONTEND_DIR = Path(tempfile.gettempdir()) / "pantalla-frontend"
FRONTEND_DIST_DIR = _ensure_directory(
    Path(os.getenv("PANTALLA_UI_DIST", "/var/www/html")),
    "frontend distribution directory",
    fallback=_TEMP_FRONTEND_DIR,
)

if FRONTEND_DIST_DIR == _TEMP_FRONTEND_DIR:
    index_path = FRONTEND_DIST_DIR / "index.html"
    if not index_path.exists():
        index_path.write_text(
            """<!doctype html><html><head><meta charset='utf-8'><title>Pantalla Reloj</title></head><body><h1>Pantalla Reloj</h1><p>Frontend assets not available. Serving fallback placeholder.</p></body></html>""",
            encoding="utf-8",
        )


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        if response.status_code == 404:
            return await super().get_response("index.html", scope)
        return response


spa_static_files = SPAStaticFiles(directory=str(FRONTEND_DIST_DIR), html=True)

STYLE_PATH = STATIC_DIR / "style.json"
if not STYLE_PATH.exists():
    style = {
        "version": 8,
        "name": "OSM Basic Raster",
        "sources": {
            "osm": {
                "type": "raster",
                "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                "tileSize": 256,
                "attribution": "© OpenStreetMap contributors",
            }
        },
        "layers": [
            {"id": "osm", "type": "raster", "source": "osm"},
        ],
        "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    }
    STYLE_PATH.write_text(json.dumps(style))

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class AemetSecretRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, max_length=256)


class AemetTestRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, max_length=256)


class AISStreamSecretRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, max_length=256)


def _sanitize_secret(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _mask_secret(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {"has_api_key": False, "api_key_last4": None}
    visible = value[-4:] if len(value) >= 4 else value
    return {"has_api_key": True, "api_key_last4": visible}


async def _read_secret_value(request: Request) -> Optional[str]:
    body = await request.body()
    if not body:
        return None
    text = body.decode("utf-8").strip()
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type.lower():
        try:
            parsed = json.loads(text or "null")
        except json.JSONDecodeError:
            return text or None
        if isinstance(parsed, dict):
            for key in ("value", "secret", "client_id", "client_secret"):
                candidate = parsed.get(key)
                if candidate is not None:
                    return str(candidate).strip() or None
            return None
        if isinstance(parsed, str):
            return parsed.strip() or None
        return None
    return text or None


def _build_public_config(config: AppConfig) -> Dict[str, Any]:
    payload = config.model_dump(mode="json", exclude_none=True, by_alias=True)
    aemet_info = payload.get("aemet", {})

    # Enmascarar AEMET usando SecretStore (fuente única)
    masked = _mask_secret(secret_store.get_secret("aemet_api_key"))
    aemet_info.pop("api_key", None)
    aemet_info.update(masked)
    payload["aemet"] = aemet_info

    layers_info = payload.get("layers")
    if isinstance(layers_info, dict):
        ships_info = layers_info.get("ships")
        if isinstance(ships_info, dict):
            aisstream_info = ships_info.get("aisstream")
            if isinstance(aisstream_info, dict):
                aisstream_public = dict(aisstream_info)
            else:
                aisstream_public = {}
            aisstream_public.pop("api_key", None)
            secret_meta = _mask_secret(secret_store.get_secret("aisstream_api_key"))
            aisstream_public.update(secret_meta)
            ships_info["aisstream"] = aisstream_public
            layers_info["ships"] = ships_info
            payload["layers"] = layers_info
    return payload


AEMET_TEST_ENDPOINT = (
    "https://opendata.aemet.es/opendata/api/observacion/convencional/todas"
)
# ------------------------ Secret endpoints (generic) ------------------------
_ALLOWED_SECRET_KEYS = {
    "aemet_api_key",
    "opensky_client_id",
    "opensky_client_secret",
    "aistream_api_key",
}


@app.get("/api/config/secret/{key}")
def get_secret_meta(key: str) -> Dict[str, bool]:
    if key not in _ALLOWED_SECRET_KEYS:
        raise HTTPException(status_code=404, detail="Unknown secret key")
    return {"exists": secret_store.has_secret(key)}


@app.post("/api/config/secret/{key}")
async def set_secret_value(key: str, request: Request) -> Dict[str, bool]:
    if key not in _ALLOWED_SECRET_KEYS:
        raise HTTPException(status_code=404, detail="Unknown secret key")
    value = await _read_secret_value(request)
    secret_store.set_secret(key, _sanitize_secret(value))
    logger.info("[secrets] updated key=%s (exists=%s)", key, secret_store.has_secret(key))
    return {"ok": True}



def _default_payload(endpoint: str) -> Dict[str, Any]:
    defaults: Dict[str, Dict[str, Any]] = {
        "weather": {
            "temperature": 20,
            "unit": "°C",
            "condition": "Despejado",
            "location": "Madrid",
            "updated_at": APP_START.isoformat(),
        },
        "news": {
            "headline": "Pantalla_reloj listo",
            "items": [
                {
                    "title": "Sistema inicializado",
                    "source": "Pantalla_reloj",
                    "published_at": APP_START.isoformat(),
                }
            ],
        },
        "astronomy": {
            "moon_phase": "Luna creciente",
            "sunrise": "07:45",
            "sunset": "20:52",
        },
        "calendar": {
            "upcoming": [],
            "generated_at": APP_START.isoformat(),
        },
        "storm_mode": {
            "enabled": False,
            "last_triggered": None,
        },
    }
    return defaults.get(endpoint, {"message": f"No data for {endpoint}"})


def _load_or_default(endpoint: str) -> Dict[str, Any]:
    cached = cache_store.load(endpoint, max_age_minutes=15)
    if cached:
        return cached.payload
    default_payload = _default_payload(endpoint)
    cache_store.store(endpoint, default_payload)
    return default_payload


def _migrate_public_secrets_to_store() -> None:
    """Migra secretos que pudieran estar en config pública al SecretStore.

    - aemet.api_key -> secret_store['aemet_api_key']
    - layers.ships.aisstream.api_key -> secret_store['aistream_api_key']
    """
    try:
        config = config_manager.read()
        mutated = False
        mutated_any = False

        # AEMET
        try:
            aemet_key = getattr(config.aemet, "api_key", None)
        except Exception:
            aemet_key = None
        if aemet_key:
            secret_store.set_secret("aemet_api_key", _sanitize_secret(aemet_key))
            # Limpiar de la config pública
            payload = config.model_dump(mode="python", by_alias=True)
            if isinstance(payload.get("aemet"), dict):
                payload["aemet"].pop("api_key", None)
                mutated = True
            if mutated:
                config = config_manager.write(payload)
        # Acumular estado de migración tras AEMET
        mutated_any = mutated_any or mutated

        # Resetear bandera de mutación antes de procesar AISStream
        mutated = False

        # AISStream
        ai_key = None
        try:
            ai_key = getattr(config.layers.ships.aisstream, "api_key", None)
        except Exception:
            ai_key = None
        if ai_key:
            secret_store.set_secret("aistream_api_key", _sanitize_secret(ai_key))
            payload = config.model_dump(mode="python", by_alias=True)
            try:
                if isinstance(payload.get("layers"), dict):
                    ships = payload["layers"].get("ships")
                    if isinstance(ships, dict) and isinstance(ships.get("aisstream"), dict):
                        ships["aisstream"].pop("api_key", None)
                        mutated = True
            except Exception:
                pass
            if mutated:
                config_manager.write(payload)
        # Acumular estado de migración tras AISStream
        mutated_any = mutated_any or mutated
        if mutated_any:
            logger.info("Secrets migrated from public config to SecretStore")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Secret migration skipped due to error: %s", exc)


def _health_payload() -> Dict[str, Any]:
    uptime = datetime.now(timezone.utc) - APP_START
    payload = {
        "status": "ok",
        "uptime_seconds": int(uptime.total_seconds()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    cache_store.store("health", payload)
    return payload


@app.get("/healthz")
def healthcheck_root() -> Dict[str, Any]:
    logger.debug("Healthz probe requested")
    return _health_payload()


@app.get("/ui-healthz", response_model=Dict[str, str])
def ui_healthcheck() -> Dict[str, str]:
    logger.debug("UI health probe requested")
    return {"ui": "ok"}


@app.get("/api/health")
def healthcheck() -> Dict[str, Any]:
    logger.debug("Health check requested")
    return _health_payload()


@app.get("/api/health/full")
def healthcheck_full() -> Dict[str, Any]:
    """Health check completo con información de todas las capas."""
    logger.debug("Full health check requested")
    payload = _health_payload()
    
    config = config_manager.read()
    
    opensky_cfg = config.opensky
    opensky_status = opensky_service.get_status(config)
    snapshot = opensky_service.get_last_snapshot()
    last_fetch_iso = opensky_status.get("last_fetch_iso")
    last_fetch_ts = opensky_status.get("last_fetch_ts")
    last_fetch_age = int(time.time() - last_fetch_ts) if last_fetch_ts else None
    items_count = 0
    if snapshot and isinstance(snapshot.payload.get("count"), int):
        items_count = int(snapshot.payload["count"])

    opensky_block = {
        "enabled": opensky_cfg.enabled,
        "mode": opensky_cfg.mode,
        "effective_poll": opensky_status.get("effective_poll"),
        "configured_poll": opensky_status.get("configured_poll"),
        "token_set": opensky_status.get("token_set"),
        "token_valid": opensky_status.get("token_valid"),
        "expires_in": opensky_status.get("expires_in"),
        "last_fetch_ok": opensky_status.get("last_fetch_ok"),
        "last_fetch": last_fetch_iso,
        "last_fetch_age": last_fetch_age,
        "last_error": opensky_status.get("last_error"),
        "backoff_active": opensky_status.get("backoff_active"),
        "backoff_seconds": opensky_status.get("backoff_seconds"),
        "items_count": items_count,
        "bbox": opensky_cfg.bbox.model_dump(),
        "max_aircraft": opensky_cfg.max_aircraft,
    }
    payload["opensky"] = opensky_block

    flights_status = "down"
    if opensky_cfg.enabled:
        if opensky_status.get("last_fetch_ok"):
            flights_status = "ok"
        elif snapshot:
            flights_status = "degraded"

    payload["flights"] = {
        "status": flights_status,
        "last_fetch": last_fetch_iso,
        "cache_age": last_fetch_age,
        "items_count": items_count,
    }
    
    # Información de ships
    ships_config = config.layers.ships
    ships_cached = cache_store.load("ships", max_age_minutes=None)
    ships_status = "down"
    ships_last_fetch = None
    ships_cache_age = None
    ships_items_count = 0
    
    if ships_config.enabled:
        if ships_cached:
            ships_status = "ok"
            ships_last_fetch = ships_cached.fetched_at.isoformat()
            age = datetime.now(timezone.utc) - ships_cached.fetched_at
            ships_cache_age = int(age.total_seconds())
            features = ships_cached.payload.get("features", [])
            ships_items_count = len(features)
        else:
            ships_status = "degraded"
    
    payload["ships"] = {
        "status": ships_status,
        "last_fetch": ships_last_fetch,
        "cache_age": ships_cache_age,
        "items_count": ships_items_count,
        "provider": ships_config.provider,
        "enabled": ships_config.enabled,
        "runtime": ships_service.get_status(),
    }

    # Resumen de integraciones
    runtime = ships_service.get_status()
    payload.setdefault("integrations", {})
    # AEMET integration
    payload["integrations"]["aemet"] = {
        "enabled": bool(config.aemet.enabled),
        "has_key": secret_store.has_secret("aemet_api_key"),
        "last_test_ok": _aemet_last_ok,
        "last_error": _aemet_last_error,
    }
    # OpenSky integration
    opensky_status = opensky_service.get_status(config)
    payload["integrations"]["opensky"] = {
        "enabled": bool(config.opensky.enabled),
        "token_set": bool(opensky_status.get("token_set")),
        "token_valid": opensky_status.get("token_valid"),
        "expires_in": opensky_status.get("expires_in"),
        "last_error": opensky_status.get("last_error") or _opensky_last_error,
    }
    payload["integrations"]["ships"] = {
        "enabled": bool(ships_config.enabled),
        "provider": ships_config.provider,
        "last_fetch_ok": bool(runtime.get("ws_connected") and runtime.get("buffer_size", 0) > 0)
        if ships_config.provider == "aisstream"
        else (ships_status == "ok"),
        "last_error": runtime.get("last_error"),
        "items_count": int(ships_items_count),
    }
    
    # Información de focus masks
    flights_config = config.layers.flights
    ships_config = config.layers.ships
    aemet_config = config.aemet
    
    focus_status = "down"
    focus_last_build = None
    focus_source = None
    focus_area_km2 = None
    focus_cache_age = None
    
    if (flights_config.cine_focus.enabled or ships_config.cine_focus.enabled) and aemet_config.enabled:
        try:
            # Usar el modo de flights como referencia (o ambos si está configurado)
            focus_mode = flights_config.cine_focus.mode if flights_config.cine_focus.enabled else ships_config.cine_focus.mode
            focus_config = flights_config.cine_focus if flights_config.cine_focus.enabled else ships_config.cine_focus
            
            mask, from_cache = load_or_build_focus_mask(
                cache_store,
                config,
                focus_config,
                focus_mode
            )
            
            if mask:
                focus_status = "ok"
                focus_source = focus_mode
                
                # Intentar obtener timestamp de construcción
                focus_cached = cache_store.load(f"focus_mask_{focus_mode}", max_age_minutes=None)
                if focus_cached:
                    focus_last_build = focus_cached.fetched_at.isoformat()
                    age = datetime.now(timezone.utc) - focus_cached.fetched_at
                    focus_cache_age = int(age.total_seconds())
                
                # Calcular área aproximada (simplificado)
                coords = mask.get("coordinates", [])
                if coords:
                    # Estimación simplificada del área (por ahora, usar número de polígonos)
                    num_polygons = len(coords) if mask.get("type") == "MultiPolygon" else 1
                    focus_area_km2 = num_polygons * 1000  # Estimación aproximada
            else:
                focus_status = "degraded"
        except Exception as exc:
            logger.warning("Failed to check focus mask in health: %s", exc)
            focus_status = "degraded"
    
    payload["focus"] = {
        "status": focus_status,
        "last_build": focus_last_build,
        "source": focus_source,
        "area_km2": focus_area_km2,
        "cache_age": focus_cache_age
    }
    
    # Información de global layers
    global_config = config.layers.global_layers
    
    # Global Satellite
    global_sat_status = "down"
    global_sat_frames_count = 0
    global_sat_last_fetch = None
    global_sat_cache_age = None
    
    if global_config.satellite.enabled:
        try:
            frames = _gibs_provider.get_available_frames(
                history_minutes=global_config.satellite.history_minutes,
                frame_step=global_config.satellite.frame_step
            )
            if frames:
                global_sat_status = "ok"
                global_sat_frames_count = len(frames)
                # Obtener timestamp del último frame
                if frames:
                    latest_frame = frames[-1]
                    global_sat_last_fetch = datetime.fromtimestamp(
                        latest_frame["timestamp"], tz=timezone.utc
                    ).isoformat()
        except Exception as exc:
            logger.warning("Failed to get global satellite status: %s", exc)
            global_sat_status = "degraded"
    
    payload["global_satellite"] = {
        "status": global_sat_status,
        "frames_count": global_sat_frames_count,
        "provider": global_config.satellite.provider,
        "last_fetch": global_sat_last_fetch,
        "cache_age": global_sat_cache_age
    }
    
    # Global Radar
    global_radar_status = "down"
    global_radar_frames_count = 0
    global_radar_last_fetch = None
    global_radar_cache_age = None
    
    if global_config.radar.enabled:
        try:
            frames = _rainviewer_provider.get_available_frames(
                history_minutes=global_config.radar.history_minutes,
                frame_step=global_config.radar.frame_step
            )
            if frames:
                global_radar_status = "ok"
                global_radar_frames_count = len(frames)
                # Obtener timestamp del último frame
                if frames:
                    latest_frame = frames[-1]
                    global_radar_last_fetch = datetime.fromtimestamp(
                        latest_frame["timestamp"], tz=timezone.utc
                    ).isoformat()
        except Exception as exc:
            logger.warning("Failed to get global radar status: %s", exc)
            global_radar_status = "degraded"
    
    payload["global_radar"] = {
        "status": global_radar_status,
        "frames_count": global_radar_frames_count,
        "provider": global_config.radar.provider,
        "last_fetch": global_radar_last_fetch,
        "cache_age": global_radar_cache_age
    }
    
    return payload


@app.get("/api/config")
def get_config(request: Request) -> JSONResponse:
    """Obtiene la configuración actual con headers anti-cache."""
    logger.info("Fetching configuration")
    config = config_manager.read()
    # Agregar headers anti-cache para evitar que el navegador cachee la configuración
    # Esto asegura que cuando se guarde desde otro PC, el frontend obtenga los cambios
    from datetime import datetime
    try:
        config_mtime = config_manager.config_file.stat().st_mtime
        config_etag = f'"{config_mtime}"'
    except OSError:
        # Si no se puede obtener el tiempo de modificación, usar timestamp actual
        config_mtime = datetime.now().timestamp()
        config_etag = f'"{config_mtime}"'
    
    # Verificar si el cliente tiene una versión en caché
    if_none_match = request.headers.get("if-none-match")
    if if_none_match == config_etag:
        return Response(status_code=304)  # Not Modified
    
    response = JSONResponse(content=_build_public_config(config))
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["ETag"] = config_etag
    response.headers["Last-Modified"] = datetime.fromtimestamp(config_mtime).strftime("%a, %d %b %Y %H:%M:%S GMT")
    
    return response


MAX_CONFIG_PAYLOAD_BYTES = 64 * 1024


@app.post("/api/config")
async def save_config(request: Request) -> JSONResponse:
    body = await request.body()
    if len(body) > MAX_CONFIG_PAYLOAD_BYTES:
        logger.warning("Configuration payload exceeds size limit")
        raise HTTPException(status_code=413, detail="Configuration payload too large")

    if not body:
        payload: Dict[str, Any] = {}
    else:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            logger.warning("Invalid JSON payload received: %s", exc)
            raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc
        if not isinstance(payload, dict):
            logger.warning("Configuration payload must be a JSON object")
            raise HTTPException(status_code=400, detail="Configuration payload must be a JSON object")
    try:
        current_config = config_manager.read()
        incoming_aemet = payload.get("aemet")
        if not isinstance(incoming_aemet, dict):
            incoming_aemet = {}
            payload["aemet"] = incoming_aemet
        if "api_key" not in incoming_aemet:
            incoming_aemet["api_key"] = current_config.aemet.api_key

        updated = config_manager.write(payload)
    except ValidationError as exc:
        logger.debug("Configuration validation error: %s", exc.errors())
        raise HTTPException(status_code=400, detail=exc.errors()) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to persist configuration: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to persist configuration") from exc
    logger.info("Configuration updated")
    ships_service.apply_config(updated.layers.ships)
    
    # Agregar headers anti-cache a la respuesta POST también
    from datetime import datetime
    
    # Obtener el tiempo de modificación del archivo de configuración
    try:
        config_mtime = config_manager.config_file.stat().st_mtime
        config_etag = f'"{config_mtime}"'
    except OSError:
        # Si no se puede obtener el tiempo de modificación, usar timestamp actual
        config_mtime = datetime.now().timestamp()
        config_etag = f'"{config_mtime}"'
    
    response = JSONResponse(content=_build_public_config(updated))
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["ETag"] = config_etag
    response.headers["Last-Modified"] = datetime.fromtimestamp(config_mtime).strftime("%a, %d %b %Y %H:%M:%S GMT")
    
    return response


@app.get("/api/config/schema")
def get_config_schema() -> Dict[str, Any]:
    """Devuelve el schema de configuración y el listado de secretos enmascarados.

    El bloque `.secrets` incluye únicamente claves que se gestionan vía endpoints de secreto
    y nunca se exponen en GET /api/config.
    """
    schema = AppConfig.model_json_schema()
    schema["secrets"] = [
        {"key": "aemet_api_key", "masked": True},
        {"key": "opensky_client_id", "masked": True},
        {"key": "opensky_client_secret", "masked": True},
        {"key": "aistream_api_key", "masked": True},
    ]
    return schema


@app.post("/api/config/secret/aemet_api_key", status_code=204)
async def update_aemet_secret(request: AemetSecretRequest) -> Response:
    """Guarda/elimina la API key de AEMET en el SecretStore (no en config pública)."""
    api_key = _sanitize_secret(request.api_key)
    masked = _mask_secret(api_key)
    logger.info(
        "Updating AEMET API key (present=%s, last4=%s)",
        masked.get("has_api_key", False),
        masked.get("api_key_last4", "****"),
    )
    secret_store.set_secret("aemet_api_key", api_key)
    return Response(status_code=204)


@app.post("/api/config/secret/aemet_api_key/raw", status_code=204)
async def update_aemet_secret_raw(request: Request) -> Response:
    """Alias alternativo que acepta text/plain, x-www-form-urlencoded o JSON {value}."""
    value = await _read_secret_value(request)
    secret_store.set_secret("aemet_api_key", _sanitize_secret(value))
    return Response(status_code=204)


@app.post("/api/config/secret/aisstream_api_key", status_code=204)
async def update_aisstream_secret(request: AISStreamSecretRequest) -> Response:
    api_key = _sanitize_secret(request.api_key)
    masked = _mask_secret(api_key)
    logger.info(
        "Updating AISStream API key (present=%s, last4=%s)",
        masked.get("has_api_key", False),
        masked.get("api_key_last4", "****"),
    )
    secret_store.set_secret("aisstream_api_key", api_key)
    current = config_manager.read()
    ships_service.apply_config(current.layers.ships)
    return Response(status_code=204)


@app.post("/api/config/secret/aisstream_api_key/raw", status_code=204)
async def update_aisstream_secret_raw(request: Request) -> Response:
    value = await _read_secret_value(request)
    secret_store.set_secret("aisstream_api_key", _sanitize_secret(value))
    current = config_manager.read()
    ships_service.apply_config(current.layers.ships)
    return Response(status_code=204)


async def _update_opensky_secret(name: str, request: Request) -> Response:
    value = await _read_secret_value(request)
    secret_store.set_secret(name, value)
    opensky_service.reset()
    logger.info("[opensky] secret %s updated (set=%s)", name, bool(value))
    return Response(status_code=204)


# Mantener PUT por compatibilidad; añadir POST por especificación
@app.put("/api/config/secret/opensky_client_id", status_code=204)
async def update_opensky_client_id(request: Request) -> Response:
    return await _update_opensky_secret("opensky_client_id", request)


@app.post("/api/config/secret/opensky_client_id", status_code=204)
async def update_opensky_client_id_post(request: Request) -> Response:
    return await _update_opensky_secret("opensky_client_id", request)


@app.put("/api/config/secret/opensky_client_secret", status_code=204)
async def update_opensky_client_secret(request: Request) -> Response:
    return await _update_opensky_secret("opensky_client_secret", request)


@app.post("/api/config/secret/opensky_client_secret", status_code=204)
async def update_opensky_client_secret_post(request: Request) -> Response:
    return await _update_opensky_secret("opensky_client_secret", request)


@app.get("/api/config/secret/opensky_client_id")
def get_opensky_client_id_meta() -> Dict[str, bool]:
    return {"set": secret_store.has_secret("opensky_client_id")}


@app.get("/api/config/secret/opensky_client_secret")
def get_opensky_client_secret_meta() -> Dict[str, bool]:
    return {"set": secret_store.has_secret("opensky_client_secret")}


@app.post("/api/aemet/test_key")
def test_aemet_key(payload: AemetTestRequest) -> Dict[str, Any]:
    """Compatibilidad: prueba una key candidata o la guardada si no se pasa ninguna."""
    candidate = _sanitize_secret(payload.api_key)
    stored = secret_store.get_secret("aemet_api_key")
    api_key = candidate or stored

    if not api_key:
        return {"ok": False, "reason": "missing_api_key"}

    headers = {
        "Accept": "application/json",
        "api_key": api_key,
    }

    try:
        response = requests.get(AEMET_TEST_ENDPOINT, headers=headers, timeout=6)
    except requests.RequestException as exc:  # noqa: PERF203
        logger.warning("AEMET test request failed: %s", exc)
        return {"ok": False, "reason": "network"}

    if response.status_code in {401, 403}:
        return {"ok": False, "reason": "unauthorized"}

    if response.status_code >= 500:
        return {"ok": False, "reason": "upstream"}

    try:
        payload_json = response.json()
    except ValueError:
        payload_json = None

    estado = None
    if isinstance(payload_json, dict):
        estado = payload_json.get("estado")

    if isinstance(estado, int) and estado in {401, 403}:
        return {"ok": False, "reason": "unauthorized"}

    return {"ok": True}


_aemet_last_ok: Optional[bool] = None
_aemet_last_error: Optional[str] = None


@app.get("/api/aemet/test")
def test_aemet_key_saved() -> Dict[str, Any]:
    """Prueba la key de AEMET guardada en el SecretStore."""
    stored = secret_store.get_secret("aemet_api_key")
    if not stored:
        _update_aemet_health(False, "missing_api_key")
        return {"ok": False, "reason": "missing_api_key"}
    result = test_aemet_key(AemetTestRequest(api_key=stored))
    if result.get("ok"):
        _update_aemet_health(True, None)
    else:
        _update_aemet_health(False, str(result.get("reason") or result.get("error") or "unknown"))
    return result


def _update_aemet_health(ok: bool, error: Optional[str]) -> None:
    global _aemet_last_ok, _aemet_last_error
    _aemet_last_ok = ok
    _aemet_last_error = error


@app.get("/api/opensky/status")
def get_opensky_status() -> Dict[str, Any]:
    config = config_manager.read()
    status = opensky_service.get_status(config)
    now = time.time()
    last_fetch_ts = status.get("last_fetch_ts")
    status["last_fetch_age"] = int(now - last_fetch_ts) if last_fetch_ts else None
    status["bbox"] = config.opensky.bbox.model_dump()
    status["max_aircraft"] = int(config.opensky.max_aircraft)
    status["extended"] = int(config.opensky.extended)
    status["cluster"] = bool(config.opensky.cluster)
    if not status.get("has_credentials") and status.get("effective_poll", 0) < 10:
        status["poll_warning"] = "anonymous_minimum_enforced"
    return status


_opensky_last_error: Optional[str] = None


@app.get("/api/opensky/test")
def test_opensky_credentials() -> Dict[str, Any]:
    """Intenta obtener un token OAuth2 con credenciales guardadas."""
    client_id = secret_store.get_secret("opensky_client_id")
    client_secret = secret_store.get_secret("opensky_client_secret")
    if not client_id or not client_secret:
        _set_opensky_error("missing_credentials")
        return {"ok": False, "reason": "missing_credentials"}

    # Usar autenticador directo para forzar solicitud de token
    authenticator = OpenSkyAuthenticator(secret_store=secret_store, logger=logger)
    try:
        token = authenticator.get_token(force_refresh=True)
    except Exception as exc:  # noqa: BLE001
        args = getattr(exc, "args", ())
        reason = str(args[0]) if isinstance(args, (list, tuple)) and len(args) > 0 else "auth_error"
        _set_opensky_error(reason)
        authenticator.close()
        return {"ok": False, "error": "auth_error"}
    info = authenticator.describe()
    authenticator.close()
    _set_opensky_error(None)
    return {
        "ok": True,
        "token_valid": bool(token),
        "expires_in": int(info.get("expires_in", 0)) if info else None,
    }


def _set_opensky_error(message: Optional[str]) -> None:
    global _opensky_last_error
    _opensky_last_error = message


@app.get("/api/weather")
def get_weather() -> Dict[str, Any]:
    return _load_or_default("weather")


@app.get("/api/news")
def get_news() -> Dict[str, Any]:
    """Obtiene noticias de feeds RSS configurados."""
    config = config_manager.read()
    news_config = config.news
    
    if not news_config.enabled:
        return _load_or_default("news")
    
    # Verificar caché
    cached = cache_store.load("news", max_age_minutes=news_config.refresh_minutes)
    if cached:
        return cached.payload
    
    # Obtener noticias de todos los feeds
    all_items: List[Dict[str, Any]] = []
    
    for feed_url in news_config.rss_feeds:
        if not feed_url or not feed_url.strip():
            continue
        
        try:
            items = parse_rss_feed(feed_url, max_items=news_config.max_items_per_feed)
            all_items.extend(items)
        except Exception as exc:
            logger.warning("Failed to fetch RSS feed %s: %s", feed_url, exc)
            continue
    
    # Ordenar por fecha (si está disponible)
    all_items.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    
    # Limitar total
    max_total = news_config.max_items_per_feed * len(news_config.rss_feeds)
    all_items = all_items[:max_total]
    
    payload = {
        "items": all_items,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    
    cache_store.store("news", payload)
    return payload


@app.get("/api/astronomy")
def get_astronomy() -> Dict[str, Any]:
    """Obtiene datos astronómicos ampliados (fases lunares, salida/puesta de sol, duración del día, crepúsculos).
    
    Retorna información extendida con próximas fases lunares, duración del día,
    mediodía solar y crepúsculos (dawn/dusk). Mantiene retrocompatibilidad con campos básicos.
    """
    config = config_manager.read()
    ephemerides_config = config.ephemerides
    
    if not ephemerides_config.enabled:
        return _load_or_default("astronomy")
    
    # Verificar caché (actualizar cada hora)
    cached = cache_store.load("astronomy", max_age_minutes=60)
    if cached:
        return cached.payload
    
    try:
        # Usar función extendida para obtener información completa
        extended_data = calculate_extended_astronomy(
            lat=ephemerides_config.latitude,
            lng=ephemerides_config.longitude,
            tz_str=ephemerides_config.timezone,
            days_ahead=7,
        )
        
        # Extraer datos para mantener retrocompatibilidad
        moon_data = extended_data["current_moon"]
        sun_data_dict = extended_data["sun_data"]
        
        # Eventos astronómicos básicos del día
        events = [
            f"Salida del sol: {sun_data_dict.get('sunrise', 'N/A')}",
            f"Puesta del sol: {sun_data_dict.get('sunset', 'N/A')}",
            f"Fase lunar: {moon_data['moon_phase']}",
        ]
        
        # Si hay mediodía solar, agregarlo
        if sun_data_dict.get("solar_noon"):
            events.append(f"Mediodía solar: {sun_data_dict['solar_noon']}")
        
        # Construir payload con retrocompatibilidad y datos extendidos
        payload: Dict[str, Any] = {
            # Campos básicos (retrocompatibilidad)
            "moon_phase": moon_data["moon_phase"],
            "moon_illumination": moon_data["moon_illumination"],
            "illumination": moon_data["illumination"],  # Alias para compatibilidad
            "sunrise": sun_data_dict.get("sunrise"),
            "sunset": sun_data_dict.get("sunset"),
            "events": events,
            "updated_at": extended_data["updated_at"],
            
            # Campos extendidos (nuevos)
            "day_duration_hours": extended_data.get("day_duration_hours"),
            "solar_noon": sun_data_dict.get("solar_noon"),
            "dawn": sun_data_dict.get("dawn"),
            "dusk": sun_data_dict.get("dusk"),
            "precision": sun_data_dict.get("precision", "unknown"),
            "next_phases": extended_data.get("next_phases", []),
        }
        
        cache_store.store("astronomy", payload)
        return payload
    
    except Exception as exc:
        logger.warning("Error calculando astronomía extendida, usando método básico: %s", exc)
        
        # Fallback al método básico en caso de error
        moon_data = calculate_moon_phase()
        sun_data = calculate_sun_times(
            lat=ephemerides_config.latitude,
            lng=ephemerides_config.longitude,
            tz_str=ephemerides_config.timezone,
        )
        
        events = [
            f"Salida del sol: {sun_data.get('sunrise', 'N/A')}",
            f"Puesta del sol: {sun_data.get('sunset', 'N/A')}",
            f"Fase lunar: {moon_data['moon_phase']}",
        ]
        
        payload = {
            "moon_phase": moon_data["moon_phase"],
            "moon_illumination": moon_data["moon_illumination"],
            "illumination": moon_data["illumination"],
            "sunrise": sun_data.get("sunrise"),
            "sunset": sun_data.get("sunset"),
            "events": events,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "error": "Extended calculation failed, using basic method",
        }
        
        cache_store.store("astronomy", payload)
        return payload


@app.get("/api/astronomy/events")
def get_astronomical_events_endpoint(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_ahead: int = 30
) -> Dict[str, Any]:
    """Obtiene eventos astronómicos en un rango de fechas.
    
    Endpoint opcional que calcula eventos astronómicos futuros:
    - Fases lunares significativas (nueva, llena, cuartos)
    - Solsticios y equinoccios
    
    Args (query parameters):
        start_date: Fecha de inicio (ISO format YYYY-MM-DD), por defecto: hoy
        end_date: Fecha de fin (ISO format YYYY-MM-DD), por defecto: hoy + days_ahead
        days_ahead: Días hacia adelante si no se especifica end_date (default: 30)
    
    Returns:
        Diccionario con lista de eventos astronómicos
    """
    config = config_manager.read()
    ephemerides_config = config.ephemerides
    
    if not ephemerides_config.enabled:
        return {
            "events": [],
            "message": "Ephemerides not enabled",
        }
    
    # Parsear fechas
    try:
        if start_date:
            start = datetime.strptime(start_date, "%Y-%m-%d").date()
        else:
            start = date.today()
        
        if end_date:
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
        else:
            end = start + timedelta(days=days_ahead)
        
        # Validar que end_date no sea anterior a start_date
        if end < start:
            logger.warning("end_date (%s) is earlier than start_date (%s)", end, start)
            return {
                "events": [],
                "error": f"Invalid date range: end_date ({end.isoformat()}) cannot be earlier than start_date ({start.isoformat()})",
            }
        
        # Validar rango (limitar a 1 año máximo)
        if (end - start).days > 365:
            end = start + timedelta(days=365)
            logger.warning("Date range limited to 365 days")
        
    except ValueError as exc:
        logger.warning("Invalid date format: %s", exc)
        return {
            "events": [],
            "error": f"Invalid date format: {exc}",
        }
    
    try:
        # Calcular eventos
        events = get_astronomical_events(
            start_date=start,
            end_date=end,
            lat=ephemerides_config.latitude,
            lng=ephemerides_config.longitude,
            tz_str=ephemerides_config.timezone,
        )
        
        return {
            "events": events,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "total": len(events),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    
    except Exception as exc:
        logger.error("Failed to calculate astronomical events: %s", exc)
        return {
            "events": [],
            "error": str(exc),
        }


@app.get("/api/calendar")
def get_calendar() -> Dict[str, Any]:
    """Obtiene datos del calendario (eventos, hortalizas, santoral)."""
    config = config_manager.read()
    calendar_config = config.calendar
    harvest_config = config.harvest
    saints_config = config.saints
    
    # Verificar caché
    cached = cache_store.load("calendar", max_age_minutes=60)
    if cached:
        return cached.payload
    
    payload: Dict[str, Any] = {
        "upcoming": [],
        "harvest": [],
        "saints": [],
        "namedays": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    
    # Eventos de Google Calendar (si está configurado)
    if calendar_config.enabled and calendar_config.google_api_key and calendar_config.google_calendar_id:
        try:
            events = fetch_google_calendar_events(
                api_key=calendar_config.google_api_key,
                calendar_id=calendar_config.google_calendar_id,
                days_ahead=calendar_config.days_ahead,
                max_results=20,
            )
            payload["upcoming"] = events
        except Exception as exc:
            logger.warning("Failed to fetch Google Calendar events: %s", exc)
            payload["upcoming"] = []
    else:
        payload["upcoming"] = []
    
    # Hortalizas estacionales (mejoradas con siembra y mantenimiento)
    if harvest_config.enabled:
        try:
            harvest_data = get_harvest_data(
                custom_items=harvest_config.custom_items,
                include_planting=True,
                include_maintenance=False  # Por defecto no incluir mantenimiento para no saturar
            )
            # Mantener retrocompatibilidad: harvest siempre presente
            payload["harvest"] = harvest_data.get("harvest", [])
            # Agregar información extendida si está disponible
            if "planting" in harvest_data:
                payload["planting"] = harvest_data["planting"]
            if "maintenance" in harvest_data:
                payload["maintenance"] = harvest_data["maintenance"]
        except Exception as exc:
            logger.warning("Failed to get harvest data: %s", exc)
            payload["harvest"] = []
            payload["planting"] = []
            payload["maintenance"] = []
    else:
        payload["harvest"] = []
        payload["planting"] = []
        payload["maintenance"] = []
    
    # Santoral (mejorado con información enriquecida)
    if saints_config.enabled:
        try:
            # Obtener información enriquecida
            saints_data = get_saints_today(
                include_namedays=saints_config.include_namedays,
                locale=saints_config.locale,
                include_info=True,  # Solicitar información enriquecida
            )
            
            # Verificar si es diccionario (enriquecido) o lista (simple)
            if isinstance(saints_data, dict):
                # Información enriquecida
                payload["saints"] = saints_data.get("saints", [])
                if saints_config.include_namedays:
                    payload["namedays"] = saints_data.get("namedays", [])
            else:
                # Retrocompatibilidad: lista simple
                payload["saints"] = saints_data
                if saints_config.include_namedays:
                    # Intentar extraer onomásticos de los nombres
                    namedays_set = set()
                    for saint_name in saints_data:
                        if isinstance(saint_name, str):
                            # Extraer primer nombre
                            base_name = saint_name.split(",")[0].split(" ")[0].strip()
                            namedays_set.add(base_name)
                    payload["namedays"] = sorted(list(namedays_set))
        except Exception as exc:
            logger.warning("Failed to get saints data: %s", exc)
            payload["saints"] = []
            payload["namedays"] = []
    
    cache_store.store("calendar", payload)
    return payload


@app.get("/api/storm_mode")
def get_storm_mode() -> Dict[str, Any]:
    """Obtiene el estado actual del modo tormenta desde la configuración."""
    config = config_manager.read()
    storm_config = config.storm
    
    # Verificar si hay un estado activo en caché
    cached = cache_store.load("storm_mode", max_age_minutes=storm_config.auto_disable_after_minutes)
    if cached:
        cached_enabled = cached.payload.get("enabled", False)
        # Si está activo en caché pero la configuración lo desactivó, actualizar
        if cached_enabled and not storm_config.enabled:
            cache_store.store("storm_mode", {"enabled": False, "last_triggered": cached.payload.get("last_triggered")})
            return {"enabled": False, "last_triggered": cached.payload.get("last_triggered")}
        # Si la configuración está activada, devolver el estado en caché
        if storm_config.enabled:
            return cached.payload
    
    return {
        "enabled": storm_config.enabled,
        "last_triggered": None,
        "center": {
            "lat": storm_config.center_lat,
            "lng": storm_config.center_lng
        },
        "zoom": storm_config.zoom
    }


@app.post("/api/storm_mode")
def update_storm_mode(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Actualiza el estado del modo tormenta."""
    config = config_manager.read()
    storm_config = config.storm
    
    enabled = payload.get("enabled", False)
    last_triggered = payload.get("last_triggered")
    
    # Guardar en caché
    cache_store.store("storm_mode", {
        "enabled": enabled,
        "last_triggered": last_triggered or (datetime.now(timezone.utc).isoformat() if enabled else None),
        "center": {
            "lat": storm_config.center_lat,
            "lng": storm_config.center_lng
        },
        "zoom": storm_config.zoom
    })
    
    logger.info("Storm mode updated: enabled=%s", enabled)
    
    return {
        "enabled": enabled,
        "last_triggered": last_triggered or (datetime.now(timezone.utc).isoformat() if enabled else None),
        "center": {
            "lat": storm_config.center_lat,
            "lng": storm_config.center_lng
        },
        "zoom": storm_config.zoom
    }


@app.get("/api/lightning")
def get_lightning() -> Dict[str, Any]:
    """Obtiene datos de rayos para mostrar en el mapa."""
    # Por ahora devolver datos vacíos, se conectará a MQTT más adelante
    cached = cache_store.load("lightning", max_age_minutes=1)
    if cached:
        return cached.payload
    
    default_data = {
        "type": "FeatureCollection",
        "features": []
    }
    cache_store.store("lightning", default_data)
    return default_data


# WiFi Configuration
WIFI_CONF_PATH = Path("/etc/pantalla-reloj/wifi.conf")
DEFAULT_WIFI_INTERFACE = "wlp2s0"


def _get_wifi_interface() -> str:
    """Read WiFi interface from config file or use default."""
    if WIFI_CONF_PATH.exists():
        try:
            content = WIFI_CONF_PATH.read_text(encoding="utf-8")
            match = re.search(r"^WIFI_INTERFACE=(.+)$", content, re.MULTILINE)
            if match:
                return match.group(1).strip()
        except Exception as exc:
            logger.warning("Failed to read WiFi config: %s", exc)
    return DEFAULT_WIFI_INTERFACE


def _validate_wifi_interface(interface: str) -> Tuple[bool, Optional[str]]:  # type: ignore[valid-type]
    """Valida que la interfaz WiFi existe y es accesible.
    
    Returns:
        Tuple de (existe, mensaje_error)
    """
    stdout, stderr, code = _run_nmcli(["device", "status"], timeout=10)
    if code != 0:
        error_detail = stderr or stdout or "Unknown error"
        return False, f"Cannot check device status: {error_detail}"
    
    # Verificar que la interfaz existe en la lista
    for line in stdout.strip().split("\n"):
        if interface in line:
            parts = line.split()
            if len(parts) >= 2:
                device_type = parts[1]
                if device_type != "wifi":
                    return False, f"Device {interface} is not a WiFi device (type: {device_type})"
                return True, None
    
    return False, f"WiFi device '{interface}' not found. Please check /etc/pantalla-reloj/wifi.conf"


def _build_nmcli_env() -> Dict[str, str]:
    """Prepare environment variables for nmcli ensuring DBus session access."""
    env = os.environ.copy()
    uid_env = os.getenv("PANTALLA_WIFI_UID")
    if uid_env and uid_env.isdigit():
        uid = uid_env
    else:
        try:
            uid = str(os.getuid())
        except Exception:
            uid = "1000"
    env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path=/run/user/{uid}/bus"
    return env


def _run_nmcli(args: List[str], timeout: int = 30) -> tuple[str, str, int]:  # type: ignore[valid-type]
    """Run nmcli command and return stdout, stderr, returncode."""
    try:
        result = subprocess.run(
            ["nmcli"] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=_build_nmcli_env(),
        )
        if result.returncode != 0:
            logger.debug(
                "nmcli command failed: args=%r, returncode=%d, stdout=%r, stderr=%r",
                args,
                result.returncode,
                result.stdout,
                result.stderr,
            )
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as exc:
        logger.error("nmcli command timed out: %s (args=%r)", exc, args)
        return "", f"Command timed out after {timeout} seconds", 124
    except FileNotFoundError:
        logger.error("nmcli not found, NetworkManager may not be installed")
        return "", "nmcli not found. NetworkManager may not be installed", 127
    except Exception as exc:
        logger.error("Failed to run nmcli: %s (args=%r)", exc, args)
        return "", str(exc), 1


class WiFiConnectRequest(BaseModel):
    ssid: str
    password: Optional[str] = None


@app.get("/api/wifi/scan")
def wifi_scan() -> Dict[str, Any]:
    """Scan for available WiFi networks."""
    interface = _get_wifi_interface()
    logger.info("Scanning WiFi networks on interface %s", interface)

    # Validar que la interfaz WiFi existe y es accesible
    interface_valid, error_msg = _validate_wifi_interface(interface)
    if not interface_valid:
        logger.error("WiFi interface validation failed: %s", error_msg)
        raise HTTPException(
            status_code=404 if error_msg and "not found" in error_msg.lower() else 400,
            detail=error_msg or f"WiFi device '{interface}' not found or invalid"
        )

    # Enable WiFi radio if needed (this might require root)
    _run_nmcli(["radio", "wifi", "on"], timeout=5)  # Ignore errors, might not have permission

    # Trigger scan using nmcli with proper syntax and fallback without interface
    attempts = [
        (["dev", "wifi", "rescan", "ifname", interface], "ifname"),
        (["dev", "wifi", "rescan"], "fallback"),
    ]

    last_stdout = ""
    last_stderr = ""
    last_label = "ifname"

    for args, label in attempts:
        stdout, stderr, code = _run_nmcli(args, timeout=8)
        last_stdout, last_stderr, last_label = stdout, stderr, label
        if code == 0:
            logger.info("Triggered WiFi scan on %s using nmcli (%s)", interface, label)
            return {
                "ok": True,
                "count": 0,
                "networks": [],
                "meta": {
                    "stdout": stdout.strip(),
                    "stderr": stderr.strip(),
                    "attempt": label,
                },
            }
        logger.warning(
            "nmcli rescan attempt failed (%s): stdout=%r, stderr=%r", label, stdout, stderr
        )

    error_detail = (last_stderr or last_stdout or "Unknown error").strip()
    logger.warning("Failed to trigger WiFi scan after retries: %s", error_detail)
    return {
        "ok": False,
        "count": 0,
        "networks": [],
        "meta": {
            "stderr": error_detail,
            "stdout": last_stdout.strip(),
            "reason": "scan_failed",
            "attempt": last_label,
        },
    }


@app.get("/api/wifi/status")
def wifi_status() -> Dict[str, Any]:
    """Get current WiFi connection status."""
    interface = _get_wifi_interface()
    interface_valid, error_msg = _validate_wifi_interface(interface)
    if not interface_valid:
        raise HTTPException(
            status_code=404 if error_msg and "not found" in error_msg.lower() else 400,
            detail=error_msg or f"WiFi device '{interface}' not found or invalid",
        )

    # Get connection info
    stdout, stderr, code = _run_nmcli(
        ["device", "status"], timeout=10
    )
    
    if code != 0:
        logger.error("Failed to get device status: %s", stderr)
        return {
            "interface": interface,
            "connected": False,
            "ssid": None,
            "ip_address": None,
            "signal": None,
            "error": stderr or "Unknown error",
        }
    
    # Check if WiFi device exists and is connected
    connected = False
    ssid: Optional[str] = None
    ip_address: Optional[str] = None
    signal: Optional[int] = None
    
    for line in stdout.strip().split("\n"):
        if interface in line:
            parts = line.split()
            if len(parts) >= 4:
                state = parts[2] if len(parts) > 2 else ""
                connection = parts[3] if len(parts) > 3 else ""
                connected = state == "connected" and connection != "--"
                if connected:
                    ssid = connection
                break
    
    # Get IP address if connected
    if connected:
        stdout, stderr, code = _run_nmcli(
            ["device", "show", interface], timeout=10
        )
        if code == 0:
            for line in stdout.strip().split("\n"):
                if "IP4.ADDRESS[1]:" in line:
                    ip_match = re.search(r"(\d+\.\d+\.\d+\.\d+)", line)
                    if ip_match:
                        ip_address = ip_match.group(1)
        
        # Get signal strength
        list_attempts = [
            (["device", "wifi", "list", "ifname", interface], "ifname"),
            (["device", "wifi", "list"], "fallback"),
        ]
        stdout = ""
        stderr = ""
        code = 0
        for args, label in list_attempts:
            stdout, stderr, code = _run_nmcli(args, timeout=10)
            if code == 0:
                logger.debug("Retrieved WiFi list for status using nmcli (%s)", label)
                break
            logger.debug(
                "nmcli wifi list for status failed (%s): stdout=%r, stderr=%r",
                label,
                stdout,
                stderr,
            )
        if code == 0:
            for line in stdout.strip().split("\n"):
                if ssid and ssid in line:
                    parts = line.split()
                    if len(parts) > 4:
                        try:
                            signal = int(parts[4])
                        except ValueError:
                            pass
                    break
    
    return {
        "interface": interface,
        "connected": connected,
        "ssid": ssid,
        "ip_address": ip_address,
        "signal": signal,
    }


@app.get("/api/wifi/networks")
def wifi_networks() -> Dict[str, Any]:
    """List available WiFi networks detected by NetworkManager."""
    interface = _get_wifi_interface()
    logger.info("Listing WiFi networks on interface %s", interface)

    interface_valid, error_msg = _validate_wifi_interface(interface)
    if not interface_valid:
        logger.error("WiFi interface validation failed: %s", error_msg)
        raise HTTPException(
            status_code=404 if error_msg and "not found" in (error_msg or "").lower() else 400,
            detail=error_msg or f"WiFi device '{interface}' not found or invalid",
        )

    attempts = [
        (
            [
                "-t",
                "-f",
                "SSID,SIGNAL,BARS,SECURITY,MODE",
                "device",
                "wifi",
                "list",
                "ifname",
                interface,
            ],
            "ifname",
        ),
        (
            ["-t", "-f", "SSID,SIGNAL,BARS,SECURITY,MODE", "device", "wifi", "list"],
            "fallback",
        ),
    ]

    stdout = ""
    stderr = ""
    code = 0
    used_label = "ifname"

    for args, label in attempts:
        stdout, stderr, code = _run_nmcli(args, timeout=12)
        used_label = label
        if code == 0:
            logger.info("Listed WiFi networks using nmcli (%s)", label)
            break
        logger.warning(
            "nmcli list networks attempt failed (%s): stdout=%r, stderr=%r", label, stdout, stderr
        )
    else:
        error_detail = (stderr or stdout or "Unknown error").strip()
        logger.error("Failed to list WiFi networks after retries: %s", error_detail)
        return {
            "interface": interface,
            "networks": [],
            "count": 0,
            "meta": {
                "stderr": error_detail,
                "reason": "list_failed",
                "attempt": used_label,
            },
        }

    lines = [line for line in stdout.strip().split("\n") if line.strip()]
    networks: List[Dict[str, Any]] = []

    for line in lines:
        parts = line.split(":")
        if len(parts) < 3:
            continue
        ssid = parts[0].replace("\\:", ":").strip()
        signal_raw = parts[1].strip() if len(parts) > 1 else ""
        bars = parts[2].strip() if len(parts) > 2 else ""
        security = parts[3].strip() if len(parts) > 3 else ""
        mode = parts[4].strip() if len(parts) > 4 else ""

        if not ssid or ssid == "--":
            continue

        try:
            signal = int(signal_raw) if signal_raw else 0
        except ValueError:
            signal = 0

        networks.append({
            "ssid": ssid,
            "signal": signal,
            "bars": bars,
            "security": security,
            "mode": mode,
        })

    networks.sort(key=lambda item: item.get("signal", 0), reverse=True)

    payload: Dict[str, Any] = {
        "interface": interface,
        "networks": networks,
        "count": len(networks),
    }
    if used_label:
        payload["meta"] = {"attempt": used_label}
    return payload


@app.post("/api/wifi/connect")
async def wifi_connect(request: WiFiConnectRequest) -> Dict[str, Any]:
    """Connect to a WiFi network."""
    # Validar SSID
    if not request.ssid or not request.ssid.strip():
        raise HTTPException(
            status_code=400,
            detail="SSID cannot be empty"
        )
    
    interface = _get_wifi_interface()
    logger.info("Connecting to WiFi network %s on interface %s", request.ssid, interface)
    
    # Validar que la interfaz WiFi existe
    interface_valid, error_msg = _validate_wifi_interface(interface)
    if not interface_valid:
        logger.error("WiFi interface validation failed: %s", error_msg)
        raise HTTPException(
            status_code=404 if error_msg and "not found" in error_msg.lower() else 400,
            detail=error_msg or f"WiFi device '{interface}' not found or invalid"
        )
    
    # Check if connection already exists
    stdout, stderr, code = _run_nmcli(
        ["connection", "show", "--active"], timeout=10
    )
    
    if code == 0 and request.ssid in stdout:
        logger.info("Already connected to %s", request.ssid)
        return {
            "success": True,
            "message": f"Already connected to {request.ssid}",
            "ssid": request.ssid,
        }
    
    # Try to connect
    args = [
        "device",
        "wifi",
        "connect",
        request.ssid,
        "ifname",
        interface,
    ]
    
    if request.password:
        args.extend(["--password", request.password])
    
    stdout, stderr, code = _run_nmcli(args, timeout=30)
    
    if code != 0:
        error_msg = stderr or stdout or "Unknown error"
        logger.error("Failed to connect to WiFi: %s", error_msg)
        
        # Mejorar mensaje de error según el tipo de fallo
        if "permission denied" in error_msg.lower() or "permission" in error_msg.lower():
            detail_msg = f"Permission denied. The backend may need elevated privileges to connect to WiFi: {error_msg}"
        elif "no secrets" in error_msg.lower() or "authentication" in error_msg.lower():
            detail_msg = f"Authentication failed. Please check the password: {error_msg}"
        else:
            detail_msg = f"Failed to connect to WiFi network: {error_msg}"
        
        raise HTTPException(
            status_code=502,
            detail={
                "error": detail_msg,
                "stderr": error_msg,
            },
        )
    
    logger.info("Successfully connected to %s", request.ssid)
    return {
        "success": True,
        "message": f"Successfully connected to {request.ssid}",
        "ssid": request.ssid,
    }


@app.post("/api/wifi/disconnect")
def wifi_disconnect() -> Dict[str, Any]:
    """Disconnect from current WiFi network."""
    interface = _get_wifi_interface()
    logger.info("Disconnecting WiFi on interface %s", interface)

    interface_valid, error_msg = _validate_wifi_interface(interface)
    if not interface_valid:
        raise HTTPException(
            status_code=404 if error_msg and "not found" in error_msg.lower() else 400,
            detail=error_msg or f"WiFi device '{interface}' not found or invalid",
        )
    
    stdout, stderr, code = _run_nmcli(
        ["device", "disconnect", interface], timeout=10
    )
    
    if code != 0:
        error_msg = stderr or stdout or "Unknown error"
        logger.error("Failed to disconnect WiFi: %s", error_msg)
        
        # Mejorar mensaje de error
        if "permission denied" in error_msg.lower():
            detail_msg = f"Permission denied. The backend may need elevated privileges: {error_msg}"
        else:
            detail_msg = f"Failed to disconnect WiFi: {error_msg}"
        
        raise HTTPException(
            status_code=502,
            detail={
                "error": detail_msg,
                "stderr": error_msg,
            },
        )
    
    logger.info("Successfully disconnected WiFi")
    return {
        "success": True,
        "message": "Successfully disconnected from WiFi",
    }


# Rate limiters y proveedores para layers
# Cache de proveedores por configuración (se recrean si cambia la config)
_flights_provider_cache: Dict[str, Any] = {}
_ships_provider_cache: Dict[str, Any] = {}


def _get_flights_provider(config: AppConfig) -> FlightProvider:
    """Obtiene o crea el proveedor de vuelos según la configuración."""
    flights_config = config.layers.flights
    provider_key = f"{flights_config.provider}"
    
    # Si ya existe y es del mismo tipo, reutilizar
    if provider_key in _flights_provider_cache:
        cached_provider = _flights_provider_cache[provider_key]
        # Verificar que sea del tipo correcto (podría haber cambiado la config)
        if flights_config.provider == "opensky" and isinstance(cached_provider, OpenSkyFlightProvider):
            return cached_provider
        elif flights_config.provider == "aviationstack" and isinstance(cached_provider, AviationStackFlightProvider):
            return cached_provider
        elif flights_config.provider == "custom" and isinstance(cached_provider, CustomFlightProvider):
            return cached_provider
    
    # Crear nuevo proveedor según configuración
    if flights_config.provider == "opensky":
        provider = OpenSkyFlightProvider(
            username=flights_config.opensky.username,
            password=flights_config.opensky.password
        )
    elif flights_config.provider == "aviationstack":
        provider = AviationStackFlightProvider(
            base_url=flights_config.aviationstack.base_url,
            api_key=flights_config.aviationstack.api_key
        )
    elif flights_config.provider == "custom":
        provider = CustomFlightProvider(
            api_url=flights_config.custom.api_url,
            api_key=flights_config.custom.api_key
        )
    else:
        # Fallback a OpenSky si no se reconoce
        logger.warning("Unknown flights provider: %s, using OpenSky", flights_config.provider)
        provider = OpenSkyFlightProvider()
    
    _flights_provider_cache[provider_key] = provider
    return provider


def _get_ships_provider(config: AppConfig) -> ShipProvider:
    """Obtiene o crea el proveedor de barcos según la configuración."""
    ships_config = config.layers.ships
    provider_key = f"{ships_config.provider}"
    
    # Si ya existe y es del mismo tipo, reutilizar
    if provider_key in _ships_provider_cache:
        cached_provider = _ships_provider_cache[provider_key]
        # Verificar que sea del tipo correcto
        if ships_config.provider == "ais_generic" and isinstance(cached_provider, GenericAISProvider):
            return cached_provider
        elif ships_config.provider == "aisstream" and isinstance(cached_provider, AISStreamProvider):
            return cached_provider
        elif ships_config.provider == "aishub" and isinstance(cached_provider, AISHubProvider):
            return cached_provider
        elif ships_config.provider == "custom" and isinstance(cached_provider, CustomShipProvider):
            return cached_provider
    
    # Crear nuevo proveedor según configuración
    if ships_config.provider == "ais_generic":
        provider = GenericAISProvider(
            api_url=ships_config.ais_generic.api_url,
            api_key=ships_config.ais_generic.api_key,
            demo_enabled=True  # Mantener demo como fallback
        )
    elif ships_config.provider == "aisstream":
        provider = AISStreamProvider(
            ws_url=ships_config.aisstream.ws_url,
            api_key=ships_config.aisstream.api_key
        )
    elif ships_config.provider == "aishub":
        provider = AISHubProvider(
            base_url=ships_config.aishub.base_url,
            api_key=ships_config.aishub.api_key
        )
    elif ships_config.provider == "custom":
        provider = CustomShipProvider(
            api_url=ships_config.custom.api_url,
            api_key=ships_config.custom.api_key
        )
    else:
        # Fallback a GenericAIS si no se reconoce
        logger.warning("Unknown ships provider: %s, using GenericAIS", ships_config.provider)
        provider = GenericAISProvider(demo_enabled=True)
    
    _ships_provider_cache[provider_key] = provider
    return provider


def _parse_bbox_param(raw: Optional[str]) -> Optional[Tuple[float, float, float, float]]:
    if not raw:
        return None
    try:
        parts = [float(part.strip()) for part in raw.split(",")]
    except (ValueError, AttributeError):
        logger.warning("[opensky] invalid bbox parameter: %s", raw)
        return None
    if len(parts) != 4:
        logger.warning("[opensky] bbox must contain 4 comma-separated numbers, got %s", raw)
        return None
    lamin, lamax, lomin, lomax = parts
    if lamax <= lamin or lomax <= lomin:
        logger.warning("[opensky] bbox has invalid bounds: %s", raw)
        return None
    return lamin, lamax, lomin, lomax


@app.get("/api/layers/flights")
def get_flights(request: Request, bbox: Optional[str] = None, extended: Optional[int] = None) -> JSONResponse:
    config = config_manager.read()
    opensky_cfg = config.opensky

    if not opensky_cfg.enabled:
        return JSONResponse({"count": 0, "disabled": True})

    bbox_override = _parse_bbox_param(bbox)
    extended_override = None
    if extended is not None:
        extended_override = 1 if int(extended) == 1 else 0

    try:
        snapshot = opensky_service.get_snapshot(config, bbox_override, extended_override)
    except OpenSkyAuthError as exc:
        logger.error("[opensky] auth error during fetch: %s", exc)
        payload = {"count": 0, "items": [], "stale": True, "ts": int(time.time()), "error": "auth"}
        response = JSONResponse(payload, status_code=200)
        response.headers["X-OpenSky-Polled"] = "false"
        response.headers["X-OpenSky-Mode"] = opensky_cfg.mode
        return response
    except OpenSkyClientError as exc:
        logger.error("[opensky] client error during fetch: %s", exc)
        payload = {"count": 0, "items": [], "stale": True, "ts": int(time.time()), "error": "client"}
        response = JSONResponse(payload, status_code=200)
        response.headers["X-OpenSky-Polled"] = "false"
        response.headers["X-OpenSky-Mode"] = opensky_cfg.mode
        return response
    except Exception as exc:  # noqa: BLE001
        logger.exception("[opensky] unexpected error during fetch: %s", exc)
        payload = {"count": 0, "items": [], "stale": True, "ts": int(time.time()), "error": "unexpected"}
        response = JSONResponse(payload, status_code=200)
        response.headers["X-OpenSky-Polled"] = "false"
        response.headers["X-OpenSky-Mode"] = opensky_cfg.mode
        return response

    payload = dict(snapshot.payload)
    if snapshot.stale:
        payload["stale"] = True

    response = JSONResponse(payload)
    response.headers["X-OpenSky-Polled"] = "true" if snapshot.polled else "false"
    response.headers["X-OpenSky-Mode"] = snapshot.mode
    if snapshot.remaining is not None:
        response.headers["X-OpenSky-Remaining"] = snapshot.remaining
    return response


@app.get("/api/layers/ships")
def get_ships(
    request: Request,
    bbox: Optional[str] = None,
    max_items_view: Optional[int] = None
) -> Dict[str, Any]:
    """Obtiene datos de barcos en formato GeoJSON."""
    config = config_manager.read()
    ships_config = config.layers.ships

    if not ships_config.enabled:
        return {
            "type": "FeatureCollection",
            "features": [],
            "meta": {"ok": False, "reason": "disabled", "provider": ships_config.provider},
        }

    # Verificar rate limit
    allowed, remaining = check_rate_limit("ships", ships_config.rate_limit_per_min)
    if not allowed:
        logger.warning("Rate limit exceeded for ships, remaining: %d seconds", remaining)
        # Servir caché si existe (stale)
        cached = cache_store.load("ships", max_age_minutes=None)
        if cached:
            result = dict(cached.payload)
            result["stale"] = True
            return result
        return {
            "type": "FeatureCollection",
            "features": [],
            "stale": True,
            "meta": {"ok": False, "reason": "rate_limited", "provider": ships_config.provider},
        }

    # Parsear bbox si está presente
    bounds = None
    if bbox:
        try:
            parts = [float(x.strip()) for x in bbox.split(",")]
            if len(parts) == 4:
                bounds = (parts[0], parts[1], parts[2], parts[3])
        except (ValueError, IndexError):
            logger.warning("Invalid bbox parameter: %s", bbox)

    stream_provider = ships_config.provider == "aisstream"
    data: Dict[str, Any]
    used_cache = False

    try:
        if stream_provider:
            snapshot = ships_service.get_snapshot()
            if snapshot is None:
                cached = cache_store.load("ships", max_age_minutes=None)
                if cached:
                    data = dict(cached.payload)
                    data["stale"] = True
                    used_cache = True
                else:
                    return {
                        "type": "FeatureCollection",
                        "features": [],
                        "meta": {"ok": False, "reason": "stream_inactive", "provider": ships_config.provider},
                    }
            else:
                data = snapshot
        else:
            cached = cache_store.load("ships", max_age_minutes=ships_config.refresh_seconds // 60)
            if cached:
                logger.debug("Cache hit for ships")
                return cached.payload

            provider = _get_ships_provider(config)
            data = provider.fetch(bounds=bounds)

        # Filtrar por edad (max_age_seconds), velocidad mínima y límites de densidad
        now = datetime.now(timezone.utc).timestamp()
        filtered_features = []

        for feature in data.get("features", []):
            props = feature.get("properties", {})
            timestamp = props.get("timestamp", 0)
            age = now - timestamp
            
            # Filtrar por edad
            if ships_config.max_age_seconds > 0 and age > ships_config.max_age_seconds:
                continue
            
            # Filtrar por velocidad mínima (ships)
            speed = props.get("speed", 0)  # knots
            if ships_config.min_speed_knots > 0 and speed < ships_config.min_speed_knots:
                continue
            
            filtered_features.append(feature)
        
        # Aplicar límite global (max_items_global)
        if ships_config.max_items_global > 0 and len(filtered_features) > ships_config.max_items_global:
            # Ordenar por timestamp (más recientes primero) y limitar
            filtered_features.sort(key=lambda f: f.get("properties", {}).get("timestamp", 0), reverse=True)
            filtered_features = filtered_features[:ships_config.max_items_global]
        
        # Si hay bbox, filtrar por viewport también
        if bounds:
            viewport_features = []
            for feature in filtered_features:
                geometry = feature.get("geometry", {})
                if geometry.get("type") == "Point":
                    coords = geometry.get("coordinates", [])
                    if len(coords) >= 2:
                        lon, lat = coords[0], coords[1]
                        # Verificar si está dentro del bbox
                        if (bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3]):
                            viewport_features.append(feature)
            
            # Aplicar límite de viewport (max_items_view, puede venir del query o de config)
            viewport_limit = max_items_view if max_items_view else ships_config.max_items_view
            if viewport_limit > 0 and len(viewport_features) > viewport_limit:
                # Ordenar por timestamp y limitar
                viewport_features.sort(key=lambda f: f.get("properties", {}).get("timestamp", 0), reverse=True)
                viewport_features = viewport_features[:viewport_limit]
            
            filtered_features = viewport_features
        
        # Aplicar máscara de foco y etiquetar in_focus
        focus_mask = None
        focus_unavailable = False
        
        if ships_config.cine_focus.enabled and config.aemet.enabled:
            try:
                mask, from_cache = load_or_build_focus_mask(
                    cache_store,
                    config,
                    ships_config.cine_focus,
                    ships_config.cine_focus.mode
                )
                focus_mask = mask
                if from_cache:
                    logger.debug("Focus mask loaded from cache for ships")
            except Exception as exc:
                logger.warning("Failed to load focus mask for ships: %s", exc)
                focus_unavailable = True
        
        # Etiquetar features con in_focus
        features_with_focus = []
        for feature in filtered_features:
            props = feature.get("properties", {})
            geometry = feature.get("geometry", {})
            
            in_focus = False
            if focus_mask and geometry.get("type") == "Point":
                coords = geometry.get("coordinates", [])
                if len(coords) >= 2:
                    lon, lat = coords[0], coords[1]
                    if abs(lat) <= 90 and abs(lon) <= 180:
                        in_focus = check_point_in_focus(lat, lon, focus_mask)
            
            features_with_focus.append({
                **feature,
                "properties": {
                    **props,
                    "in_focus": in_focus
                }
            })
        
        data["features"] = features_with_focus
        
        # Añadir metadata si focus no está disponible
        if focus_unavailable:
            data["properties"] = data.get("properties", {})
            data["properties"]["focus_unavailable"] = True

        # Guardar en caché
        meta = data.setdefault("meta", {})
        meta.setdefault("provider", ships_config.provider)
        if stream_provider and not meta.get("ok"):
            meta["ok"] = len(features_with_focus) > 0
        if not stream_provider:
            meta.setdefault("ok", True)
        if not used_cache:
            cache_store.store("ships", data)
        logger.info("Fetched %d ships (in_focus: %d)", len(features_with_focus),
                   sum(1 for f in features_with_focus if f.get("properties", {}).get("in_focus", False)))
        return data
    except Exception as exc:
        logger.error("Failed to fetch ships: %s", exc)
        # Fallback: servir caché stale si existe
        cached = cache_store.load("ships", max_age_minutes=None)
        if cached:
            result = dict(cached.payload)
            result["stale"] = True
            return result
        return {"type": "FeatureCollection", "features": [], "stale": True}


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend(full_path: str, request: Request):
    if full_path.startswith("api/") or full_path.startswith("static/"):
        raise HTTPException(status_code=404, detail="Not Found")
    path = full_path or "index.html"
    return await spa_static_files.get_response(path, request.scope)


# Proveedores globales
_gibs_provider = GIBSProvider()
_rainviewer_provider = RainViewerProvider()


@app.get("/api/global/satellite/frames")
def get_global_satellite_frames() -> Dict[str, Any]:
    """Obtiene lista de frames disponibles de satélite global."""
    config = config_manager.read()
    global_config = config.layers.global_layers.satellite
    
    if not global_config.enabled:
        return {"frames": []}
    
    try:
        frames = _gibs_provider.get_available_frames(
            history_minutes=global_config.history_minutes,
            frame_step=global_config.frame_step
        )
        return {
            "frames": frames,
            "count": len(frames),
            "provider": global_config.provider
        }
    except Exception as exc:
        logger.error("Failed to get global satellite frames: %s", exc)
        return {"frames": [], "error": str(exc)}


@app.get("/api/global/radar/frames")
def get_global_radar_frames() -> Dict[str, Any]:
    """Obtiene lista de frames disponibles de radar global."""
    config = config_manager.read()
    global_config = config.layers.global_layers.radar
    
    if not global_config.enabled:
        return {"frames": []}
    
    try:
        frames = _rainviewer_provider.get_available_frames(
            history_minutes=global_config.history_minutes,
            frame_step=global_config.frame_step
        )
        return {
            "frames": frames,
            "count": len(frames),
            "provider": global_config.provider
        }
    except Exception as exc:
        logger.error("Failed to get global radar frames: %s", exc)
        return {"frames": [], "error": str(exc)}


@app.get("/api/global/satellite/tiles/{timestamp:int}/{z:int}/{x:int}/{y:int}.png")
async def get_global_satellite_tile(
    timestamp: int,
    z: int,
    x: int,
    y: int,
    request: Request
) -> Response:
    """Proxy de tiles de satélite global con caché."""
    config = config_manager.read()
    global_config = config.layers.global_layers.satellite
    
    if not global_config.enabled:
        raise HTTPException(status_code=404, detail="Global satellite layer disabled")
    
    # Caché de tiles en disco
    cache_dir = Path("/var/cache/pantalla/global/satellite")
    cache_dir.mkdir(parents=True, exist_ok=True)
    tile_path = cache_dir / f"{timestamp}_{z}_{x}_{y}.png"
    
    # Verificar caché en disco
    if tile_path.exists():
        tile_age = datetime.now(timezone.utc).timestamp() - tile_path.stat().st_mtime
        if tile_age < global_config.refresh_minutes * 60:
            tile_data = tile_path.read_bytes()
            return Response(
                content=tile_data,
                media_type="image/png",
                headers={
                    "Cache-Control": "public, max-age=300",
                    "ETag": f'"{timestamp}_{z}_{x}_{y}"'
                }
            )
    
    # Descargar tile
    try:
        tile_url = _gibs_provider.get_tile_url(timestamp, z, x, y)
        response = requests.get(tile_url, timeout=10, stream=True)
        response.raise_for_status()
        
        tile_data = response.content
        
        # Guardar en caché en disco
        tile_path.write_bytes(tile_data)
        
        return Response(
            content=tile_data,
            media_type=response.headers.get("Content-Type", "image/png"),
            headers={
                "Cache-Control": "public, max-age=300",
                "ETag": f'"{timestamp}_{z}_{x}_{y}"'
            }
        )
    except Exception as exc:
        logger.error("Failed to fetch global satellite tile: %s", exc)
        # Intentar servir desde caché aunque sea stale
        if tile_path.exists():
            tile_data = tile_path.read_bytes()
            return Response(
                content=tile_data,
                media_type="image/png",
                headers={
                    "Cache-Control": "public, max-age=300",
                    "ETag": f'"{timestamp}_{z}_{x}_{y}"',
                    "X-Stale": "true"
                }
            )
        raise HTTPException(status_code=500, detail="Failed to fetch tile")


@app.get("/api/global/radar/tiles/{timestamp:int}/{z:int}/{x:int}/{y:int}.png")
async def get_global_radar_tile(
    timestamp: int,
    z: int,
    x: int,
    y: int,
    request: Request
) -> Response:
    """Proxy de tiles de radar global con caché."""
    config = config_manager.read()
    global_config = config.layers.global_layers.radar
    
    if not global_config.enabled:
        raise HTTPException(status_code=404, detail="Global radar layer disabled")
    
    # Caché de tiles en disco
    cache_dir = Path("/var/cache/pantalla/global/radar")
    cache_dir.mkdir(parents=True, exist_ok=True)
    tile_path = cache_dir / f"{timestamp}_{z}_{x}_{y}.png"
    
    # Verificar caché en disco
    if tile_path.exists():
        tile_age = datetime.now(timezone.utc).timestamp() - tile_path.stat().st_mtime
        if tile_age < global_config.refresh_minutes * 60:
            tile_data = tile_path.read_bytes()
            return Response(
                content=tile_data,
                media_type="image/png",
                headers={
                    "Cache-Control": "public, max-age=180",
                    "ETag": f'"{timestamp}_{z}_{x}_{y}"'
                }
            )
    
    # Descargar tile
    try:
        tile_url = _rainviewer_provider.get_tile_url(timestamp, z, x, y)
        response = requests.get(tile_url, timeout=10, stream=True)
        response.raise_for_status()
        
        tile_data = response.content
        
        # Guardar en caché en disco
        tile_path.write_bytes(tile_data)
        
        return Response(
            content=tile_data,
            media_type=response.headers.get("Content-Type", "image/png"),
            headers={
                "Cache-Control": "public, max-age=180",
                "ETag": f'"{timestamp}_{z}_{x}_{y}"'
            }
        )
    except Exception as exc:
        logger.error("Failed to fetch global radar tile: %s", exc)
        # Intentar servir desde caché aunque sea stale
        if tile_path.exists():
            tile_data = tile_path.read_bytes()
            return Response(
                content=tile_data,
                media_type="image/png",
                headers={
                    "Cache-Control": "public, max-age=180",
                    "ETag": f'"{timestamp}_{z}_{x}_{y}"',
                    "X-Stale": "true"
                }
            )
        raise HTTPException(status_code=500, detail="Failed to fetch tile")


@app.on_event("startup")
def on_startup() -> None:
    # Migrar secretos desde config pública si existieran
    _migrate_public_secrets_to_store()
    config = config_manager.read()
    logger.info(
        "Pantalla backend started (timezone=%s, rotation_panels=%s)",
        config.display.timezone,
        ",".join(config.ui.rotation.panels),
    )
    ships_service.apply_config(config.layers.ships)
    cache_store.store("health", {"started_at": APP_START.isoformat()})
    logger.info(
        "Configuration path %s (layout=%s, map_style=%s, map_provider=%s)",
        config_manager.config_file,
        config.ui.layout,
        config.ui.map.style,
        config.map.provider,
    )
    root = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
    for child in (root / "cache").glob("*.json"):
        child.touch(exist_ok=True)
