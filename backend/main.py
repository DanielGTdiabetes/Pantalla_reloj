from __future__ import annotations

import asyncio
try:
    import grp
except ImportError:
    grp = None

import hashlib
import json
import os

try:
    import pwd
except ImportError:
    pwd = None
import re
import subprocess
import tempfile
import time
import traceback
import uuid
from dataclasses import dataclass
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Literal, TypeVar, Union

import html
import math
import requests
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

# Imports condicionales para MQTT y WebSocket
try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

try:
    import websocket
except ImportError:
    websocket = None

try:
    import httpx
except ImportError:
    httpx = None

from fastapi import Body, FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from threading import Lock, Thread
import threading

from .cache import CacheStore
from .config_manager import ConfigManager
from .services.config_loader import read_json, write_json
from .services.config_sanitize import sanitize_config
from .services.config_events import (
    subscribe,
    unsubscribe,
    publish_config_changed_async,
    publish_config_changed_sync,
    send_heartbeat
)
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
from .config_store import (
    ICS_STORAGE_DIR,
    ICS_STORAGE_PATH,
    CalendarValidationError,
    ConfigWriteError,
    deep_merge,
    default_layers_if_missing,
    default_panels_if_missing,
    load_raw_config,
    reload_runtime_config,
    resolve_calendar_provider,
    validate_calendar_provider,
    write_config_atomic,
)
from .data_sources_ics import (
    ICSCalendarError,
    ICSFileError,
    ICSParseError,
    fetch_ics_calendar_events,
    get_last_error as get_last_ics_error,
)
from .constants import (
    GIBS_DEFAULT_DEFAULT_ZOOM,
    GIBS_DEFAULT_EPSG,
    GIBS_DEFAULT_FORMAT_EXT,
    GIBS_DEFAULT_FRAME_STEP,
    GIBS_DEFAULT_HISTORY_MINUTES,
    GIBS_DEFAULT_LAYER,
    GIBS_DEFAULT_MAX_ZOOM,
    GIBS_DEFAULT_MIN_ZOOM,
    GIBS_DEFAULT_TILE_MATRIX_SET,
    GIBS_DEFAULT_TIME_MODE,
    GIBS_DEFAULT_TIME_VALUE,
)
from .global_providers import (
    GIBSProvider,
    OpenWeatherMapApiKeyError,
    OpenWeatherMapRadarProvider,
    RainViewerProvider,
)
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
from .models_global_satellite import (
    GlobalSatelliteFrame,
    GlobalSatelliteFramesResponse,
)
from .models import AppConfig
from .routes.efemerides import (
    get_efemerides_for_date,
    load_efemerides_data,
    save_efemerides_data,
    upload_efemerides_file,
    fetch_wikimedia_onthisday,
)
from .routes import rainviewer
from .routers import layers, weather
from .secret_store import SecretStore
from .services.opensky_auth import DEFAULT_TOKEN_URL, OpenSkyAuthError
from .services.opensky_client import OpenSkyClientError
from .services.opensky_service import OpenSkyService
from .services.ships_service import AISStreamService
from .services.blitzortung_service import BlitzortungService, LightningStrike
from .services import ephemerides
from .services.tests import TEST_FUNCTIONS
from .services.kiosk import refresh_ui_if_possible
from .config_migrator import migrate_config_to_v2, migrate_v1_to_v2, apply_postal_geocoding
from .rate_limiter import check_rate_limit
from .utils.config_upgrade import clean_aemet_keys
from .services.maptiler import normalize_maptiler_style_url

APP_START = datetime.now(timezone.utc)
logger = configure_logging()

# Auto-refresh helpers
def _auto_refresh_disabled() -> bool:
    value = os.getenv("PANTALLA_AUTOREFRESH_ENABLED", "1").strip().lower()
    return value in {"0", "false", "no", "off"}


def _schedule_kiosk_refresh(reason: str = "config_saved") -> None:
    if _auto_refresh_disabled():
        return

    flag_path = Path(
        os.getenv(
            "PANTALLA_KIOSK_REFRESH_FLAG",
            "/var/lib/pantalla-reloj/state/kiosk-refresh.flag",
        )
    )

    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "nonce": uuid.uuid4().hex,
    }

    try:
        flag_path.parent.mkdir(parents=True, exist_ok=True)
        flag_path.write_text(json.dumps(payload), encoding="utf-8")
        logger.info("[kiosk] refresh solicitado (%s)", reason)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[kiosk] No se pudo programar el refresh automático (%s): %s",
            reason,
            exc,
        )


def _persist_config(config_data: Dict[str, Any], *, reason: str) -> None:
    config_manager._atomic_write(config_data)
    _schedule_kiosk_refresh(reason)

# Configuración de ruta
CONFIG_PATH = os.getenv("PANTALLA_CONFIG", "/var/lib/pantalla-reloj/config.json")
config_manager = ConfigManager()

# Limpiar configuración obsoleta de AEMET al inicio
clean_aemet_keys(CONFIG_PATH)


def load_effective_config() -> AppConfig:
    """Carga la configuración efectiva (siempre en esquema v2)."""
    config = config_manager.read()
    ui_map = config.ui_map
    maptiler_cfg = ui_map.maptiler
    satellite_cfg = ui_map.satellite
    logger.debug(
        "[config] ui_map provider=%s style=%s styleUrl=%s satellite.enabled=%s labels_overlay.enabled=%s",
        ui_map.provider,
        maptiler_cfg.style if maptiler_cfg else None,
        maptiler_cfg.styleUrl if maptiler_cfg else None,
        satellite_cfg.enabled if satellite_cfg else None,
        satellite_cfg.labels_overlay.enabled if satellite_cfg and satellite_cfg.labels_overlay else None,
    )
    return config


# Cargar configuración efectiva al inicio
global_config = load_effective_config()
cache_store = CacheStore()
secret_store = SecretStore()
opensky_service = OpenSkyService(secret_store, logger)
ships_service = AISStreamService(cache_store=cache_store, secret_store=secret_store, logger=logger)
blitzortung_service: Optional[BlitzortungService] = None
_blitzortung_lock = Lock()
map_reset_counter = 0

CINEMA_TELEMETRY_TTL = timedelta(seconds=45)
_cinema_runtime_state: Dict[str, Any] | None = None
_cinema_runtime_expires_at: datetime | None = None
_cinema_state_lock = Lock()

_calendar_runtime_state: Dict[str, Any] = {
    "provider": "none",
    "enabled": False,
    "status": "stale",
    "last_error": None,
    "ics_path": None,
    "updated_at": None,
}
_calendar_state_lock = Lock()


class CinemaTelemetryPayload(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    state: Literal[
        "IDLE",
        "LOADING_STYLE",
        "READY",
        "PANNING",
        "PAUSED",
        "ERROR",
        "DISABLED",
    ]
    last_pan_tick_iso: datetime = Field(alias="lastPanTickIso")
    reduced_motion: Optional[bool] = Field(default=None, alias="reducedMotion")


def _normalize_timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _set_cinema_runtime_state(payload: CinemaTelemetryPayload) -> None:
    global _cinema_runtime_state, _cinema_runtime_expires_at
    normalized = {
        "state": payload.state,
        "lastPanTickIso": _normalize_timestamp(payload.last_pan_tick_iso),
        "reducedMotion": payload.reduced_motion,
    }
    with _cinema_state_lock:
        _cinema_runtime_state = normalized
        _cinema_runtime_expires_at = datetime.now(timezone.utc) + CINEMA_TELEMETRY_TTL


def _get_cinema_runtime_state() -> Dict[str, Any]:
    global _cinema_runtime_state, _cinema_runtime_expires_at
    with _cinema_state_lock:
        if (
            _cinema_runtime_state is not None
            and _cinema_runtime_expires_at is not None
            and datetime.now(timezone.utc) <= _cinema_runtime_expires_at
        ):
            return dict(_cinema_runtime_state)
        _cinema_runtime_state = None
        _cinema_runtime_expires_at = None
    return {}


def _update_calendar_runtime_state(
    provider: str,
    enabled: bool,
    status: str,
    last_error: Optional[str] = None,
    ics_path: Optional[str] = None,
) -> None:
    global _calendar_runtime_state
    snapshot = {
        "provider": provider,
        "enabled": enabled,
        "status": status,
        "last_error": last_error,
        "ics_path": ics_path,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    with _calendar_state_lock:
        _calendar_runtime_state = snapshot


def _get_calendar_runtime_state() -> Dict[str, Any]:
    with _calendar_state_lock:
        return dict(_calendar_runtime_state)


# 1. MEJORA CORS: Configurable por variable de entorno
ALLOWED_ORIGINS = os.getenv("PANTALLA_CORS_ORIGINS", "*").split(",")

app = FastAPI(title="Pantalla Reloj Backend", version="2025.10.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrar routers
app.include_router(ephemerides.router)
app.include_router(rainviewer.router)
app.include_router(layers.router)
app.include_router(weather.router)


@app.post("/api/kiosk/refresh")
def kiosk_refresh(payload: Optional[Dict[str, Any]] = Body(default=None)) -> Dict[str, Any]:
    """
    Programa un refresco inmediato del kiosk via flag local.
    """

    default_reason = "manual_api"
    reason = default_reason
    if isinstance(payload, dict):
        reason_candidate = payload.get("reason")
        if isinstance(reason_candidate, str) and reason_candidate.strip():
            reason = reason_candidate.strip()

    _schedule_kiosk_refresh(reason)
    return {"ok": True, "scheduled": True, "reason": reason}


def _ensure_ics_storage_directory() -> None:
    """Asegurar que el directorio de almacenamiento ICS existe con permisos adecuados."""
    try:
        uid = gid = None
        try:
            stat_info = config_manager.config_file.stat()
            uid, gid = stat_info.st_uid, stat_info.st_gid
        except FileNotFoundError:
            try:
                parent_stat = config_manager.config_file.parent.stat()
                uid, gid = parent_stat.st_uid, parent_stat.st_gid
            except OSError:
                pass
        except OSError:
            pass

        if not ICS_STORAGE_DIR.exists():
            ICS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
            if uid is not None and gid is not None:
                try:
                    os.chown(ICS_STORAGE_DIR, uid, gid)
                except OSError:
                    pass
            try:
                os.chmod(ICS_STORAGE_DIR, 0o755)
            except OSError:
                pass
            logger.info("[config] Created ICS storage directory: %s", ICS_STORAGE_DIR)
        else:
            # Verificar permisos existentes
            if not os.access(ICS_STORAGE_DIR, os.W_OK):
                logger.warning("[config] ICS storage directory exists but is not writable: %s", ICS_STORAGE_DIR)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[config] Could not ensure ICS storage directory: %s", exc)


@app.on_event("startup")
def _startup_services() -> None:
    """Inicializar servicios y directorios al inicio."""
    _ensure_ics_storage_directory()
    # Inicializar caché del servicio de efemérides
    ephemerides.init_cache(cache_store)
    # Otros servicios se inicializan en otro evento startup más abajo
    
    # Inicializar Blitzortung si está habilitado en config
    global blitzortung_service
    try:
        config = config_manager.read()
        lightning_config = config.layers.lightning if config.layers else None
        
        if lightning_config and lightning_config.enabled:
            logger.info("[startup] Initializing Blitzortung service")
            with _blitzortung_lock:
                blitzortung_service = BlitzortungService(
                    enabled=True,
                    mqtt_host=lightning_config.mqtt_host,
                    mqtt_port=lightning_config.mqtt_port,
                    mqtt_topic=lightning_config.mqtt_topic,
                    ws_enabled=lightning_config.ws_enabled,
                    ws_url=lightning_config.ws_url,
                    buffer_max=lightning_config.buffer_max,
                    prune_seconds=lightning_config.prune_seconds
                )
                blitzortung_service.start()
    except Exception as exc:
        logger.error("[startup] Failed to initialize Blitzortung service: %s", exc)


@app.on_event("shutdown")
def _shutdown_services() -> None:
    opensky_service.close()
    ships_service.close()
    # Detener Blitzortung al cerrar
    global blitzortung_service
    if blitzortung_service:
        with _blitzortung_lock:
            blitzortung_service.stop()
            blitzortung_service = None

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


class LightningMqttTestRequest(BaseModel):
    mqtt_host: str = Field(default="127.0.0.1", min_length=1)
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_topic: str = Field(default="blitzortung/1", min_length=1)
    timeout_sec: int = Field(default=3, ge=1, le=10)


class LightningWsTestRequest(BaseModel):
    ws_url: str = Field(min_length=1, max_length=512)
    timeout_sec: int = Field(default=3, ge=1, le=10)


class MapTilerTestRequest(BaseModel):
    """Modelo para test de MapTiler. Soporta dos formatos:
    - A) styleUrl completo (modo preferido)
    - B) style + provider (construye styleUrl internamente usando api_key de config)
    """
    styleUrl: Optional[str] = Field(default=None, max_length=512)
    style: Optional[str] = Field(default=None, max_length=64)
    provider: Optional[Literal["maptiler"]] = Field(default=None)
    
    @model_validator(mode="after")
    def validate_request(self) -> "MapTilerTestRequest":
        """Valida que se proporcione styleUrl o (style + provider)."""
        if self.styleUrl:
            # Modo A: styleUrl completo
            if not self.styleUrl.strip():
                raise ValueError("styleUrl cannot be empty")
            return self
        
        # Modo B: style + provider
        if not self.style or not self.provider:
            raise ValueError("Either styleUrl must be provided, or both style and provider='maptiler'")
        
        if self.provider != "maptiler":
            raise ValueError("provider must be 'maptiler' when using style parameter")
        
        return self


class RainViewerTestRequest(BaseModel):
    """Modelo para test de RainViewer."""
    provider: Literal["rainviewer"] = "rainviewer"
    layer_type: Optional[str] = Field(default="precipitation_new", max_length=64)
    opacity: Optional[float] = Field(default=0.7, ge=0.0, le=1.0)


class XyzTestRequest(BaseModel):
    tileUrl: str = Field(min_length=1, max_length=512)


class NewsTestFeedsRequest(BaseModel):
    feeds: List[str] = Field(min_length=1, max_length=20)


class CalendarTestRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, max_length=512)
    calendar_id: Optional[str] = Field(default=None, max_length=512)
    
    @classmethod
    def empty(cls) -> "CalendarTestRequest":
        """Crea un request vacío para usar el origen activo."""
        return cls(api_key=None, calendar_id=None)


class CalendarICSUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class CalendarConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    source: Optional[Literal["google", "ics"]] = None
    days_ahead: Optional[int] = Field(default=None, ge=1, le=60)
    ics: Optional[Dict[str, Any]] = None  # mode, url (no file_path)


class AISStreamSecretRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, max_length=256)


class OpenWeatherMapSecretRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, max_length=256)


class MapTilerSecretRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, max_length=256)


class MapResetResponse(BaseModel):
    status: Literal["ok"] = "ok"
    reset_counter: int
    reset_at: datetime


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


def _mask_maptiler_url(value: Optional[str]) -> Optional[str]:
    """Oculta el parámetro key= de una URL de MapTiler para logs."""

    if not value:
        return None

    trimmed = value.strip()
    if not trimmed:
        return None

    try:
        parsed = urlparse(trimmed)
    except ValueError:
        return trimmed

    query_items = parse_qsl(parsed.query, keep_blank_values=True)
    masked = False
    sanitized_items: List[Tuple[str, str]] = []
    for key, current_value in query_items:
        if key.lower() == "key":
            sanitized_items.append((key, "***"))
            masked = True
        else:
            sanitized_items.append((key, current_value))

    if masked:
        sanitized_query = urlencode(sanitized_items, doseq=True)
        return urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                sanitized_query,
                parsed.fragment,
            )
        )

    return trimmed


def _extract_maptiler_key_from_url(value: Optional[str]) -> Optional[str]:
    """Extrae el parámetro key= de una URL, si está presente."""

    if not value:
        return None

    trimmed = value.strip()
    if not trimmed:
        return None

    try:
        parsed = urlparse(trimmed)
    except ValueError:
        parsed = None

    if parsed:
        for key, current_value in parse_qsl(parsed.query, keep_blank_values=True):
            if key.lower() == "key":
                candidate = current_value.strip()
                if candidate and candidate != "***":
                    return candidate

    # Fallback: expresión regular si la URL no es parseable
    match = re.search(r"[?&]key=([^&#]+)", trimmed)
    if match:
        candidate = match.group(1).strip()
        if candidate and candidate != "***":
            return candidate

    return None


def _validate_maptiler_style(style_url: str) -> Dict[str, Any]:
    """Valida un estilo de MapTiler haciendo una petición HTTP.
    
    Args:
        style_url: URL del estilo de MapTiler
        
    Returns:
        Diccionario con:
        - ok: bool - True si el estilo es válido
        - status: int - Código HTTP
        - error: str | None - Mensaje de error si falla
        - name: str | None - Nombre del estilo si está disponible
        - bytes: int | None - Tamaño en bytes del estilo si está disponible
    """
    try:
        response = requests.get(style_url, timeout=5)
        if response.status_code == 200:
            try:
                style_json = response.json()
                # Verificar que tiene la estructura básica de un estilo MapLibre
                if isinstance(style_json, dict) and ("glyphs" in style_json or "sources" in style_json):
                    name = style_json.get("name", "Unknown")
                    return {
                        "ok": True,
                        "status": 200,
                        "error": None,
                        "name": str(name) if name else None,
                        "bytes": len(response.content)
                    }
                else:
                    return {
                        "ok": False,
                        "status": 200,
                        "error": "Style JSON missing required fields (glyphs or sources)",
                        "name": None,
                        "bytes": None
                    }
            except (ValueError, KeyError) as e:
                return {
                    "ok": False,
                    "status": 200,
                    "error": f"Invalid JSON or missing required fields: {e}",
                    "name": None,
                    "bytes": None
                }
        else:
            return {
                "ok": False,
                "status": response.status_code,
                "error": f"HTTP {response.status_code}",
                "name": None,
                "bytes": None
            }
    except requests.RequestException as e:
        return {
            "ok": False,
            "status": 0,
            "error": str(e),
            "name": None,
            "bytes": None
        }



def _check_v1_keys(payload: Dict[str, Any]) -> List[str]:
    """Verifica si el payload contiene claves v1. Devuelve lista de claves v1 encontradas."""
    v1_keys = []
    v1_patterns = [
        "ui.map", "ui_map" if "ui" in payload and "map" in payload.get("ui", {}) else None,
        "maptiler",
        "cinema",
        "global.satellite",
        "global.radar",
    ]
    
    # Check top-level v1 keys
    if "ui" in payload and isinstance(payload["ui"], dict) and "map" in payload["ui"]:
        v1_keys.append("ui.map")
    if any(k for k in payload.keys() if "maptiler" in k.lower()):
        v1_keys.append("maptiler")
    if "global" in payload:
        v1_keys.append("global")
    
    return v1_keys




# Flag para evitar logs repetitivos de migración
_maps_defaults_applied = False
_radar_migration_applied = False

def _ensure_maps_defaults(config_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Asegura que el bloque 'maps' existe y tiene valores válidos.
    
    Si maps es null o no existe, crea un bloque por defecto usando la API key de MapTiler
    desde secrets o config.
    """
    global _maps_defaults_applied
    if "maps" not in config_dict or config_dict["maps"] is None:
        if not _maps_defaults_applied:
            logger.info("[Config] maps was null or missing; applying defaults")
            _maps_defaults_applied = True
        config_dict["maps"] = {}
    
    maps = config_dict["maps"]
    if not isinstance(maps, dict):
        logger.warning("[Config] maps was not a dict, resetting to defaults")
        maps = {}
        config_dict["maps"] = maps
    
    # Obtener API key de MapTiler
    api_key = None
    try:
        # Intentar desde secrets.maptiler.api_key
        secrets = config_dict.get("secrets", {})
        if isinstance(secrets, dict):
            maptiler_secrets = secrets.get("maptiler", {})
            if isinstance(maptiler_secrets, dict):
                api_key = maptiler_secrets.get("api_key")
        
        # Fallback a secret_store
        if not api_key or not api_key.strip():
            api_key = secret_store.get_secret("maptiler_api_key")
        
        # Fallback a ui_map.maptiler.api_key
        if not api_key or not api_key.strip():
            ui_map = config_dict.get("ui_map", {})
            if isinstance(ui_map, dict):
                maptiler = ui_map.get("maptiler", {})
                if isinstance(maptiler, dict):
                    api_key = maptiler.get("api_key")
    except Exception as e:
        logger.warning("[Config] Error extracting MapTiler API key: %s", e)
    
    # Construir style_url con la API key
    style_id = maps.get("style_id") or maps.get("style") or "streets-v4"
    if api_key and api_key.strip():
        style_url = f"https://api.maptiler.com/maps/{style_id}/style.json?key={api_key.strip()}"
    else:
        # Si no hay API key, usar placeholder
        style_url = f"https://api.maptiler.com/maps/{style_id}/style.json?key=TU_API_KEY_AQUI"
        logger.warning("[Config] No MapTiler API key found, using placeholder in style_url")
    
    # Asegurar campos mínimos en maps
    maps.setdefault("provider", "maptiler")
    maps.setdefault("style_id", style_id)
    maps.setdefault("style_url", style_url)
    maps.setdefault("min_zoom", 0)
    maps.setdefault("max_zoom", 18)
    maps.setdefault("initial_zoom", 9.0)
    maps.setdefault("center", {"lat": 39.98, "lon": 0.20})
    
    return config_dict


def _ensure_layers_global_defaults(config_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Asegura que el bloque 'layers.global' existe y tiene valores válidos.
    
    Si layers.global es null o no existe, crea un bloque por defecto con radar desactivado.
    Migra automáticamente desde ui_global.radar si layers.global.radar es null.
    La migración es idempotente: no sobreescribe layers.global.radar si ya está configurado.
    """
    if "layers" not in config_dict:
        config_dict["layers"] = {}
    
    layers = config_dict["layers"]
    if not isinstance(layers, dict):
        layers = {}
        config_dict["layers"] = layers
    
    # Asegurar que global existe en layers
    if "global" not in layers or layers["global"] is None:
        layers["global"] = {}
    
    layers_global = layers["global"]
    if not isinstance(layers_global, dict):
        layers_global = {}
        layers["global"] = layers_global
    
    # Asegurar que radar existe en layers.global
    global _radar_migration_applied
    if "radar" not in layers_global or layers_global["radar"] is None:
        # Intentar migrar desde ui_global.radar si existe
        ui_global = config_dict.get("ui_global", {})
        if isinstance(ui_global, dict):
            ui_radar = ui_global.get("radar")
            if isinstance(ui_radar, dict) and ui_radar:
                # Migrar desde ui_global.radar (solo loguear una vez)
                if not _radar_migration_applied:
                    logger.info("[Config] Migrating radar config from ui_global.radar to layers.global.radar")
                    _radar_migration_applied = True
                layers_global["radar"] = {
                    "enabled": ui_radar.get("enabled", False),
                    "provider": ui_radar.get("provider", "rainviewer"),
                    "opacity": ui_radar.get("opacity", 0.7),
                    "layer_type": ui_radar.get("layer_type") or "precipitation_new",
                    "refresh_minutes": ui_radar.get("refresh_minutes", 5),
                    "history_minutes": ui_radar.get("history_minutes", 90),
                    "frame_step": ui_radar.get("frame_step", 5),
                }
                # Si layer_type es null pero provider es rainviewer, usar precipitation_new
                if layers_global["radar"].get("layer_type") is None and layers_global["radar"].get("provider") == "rainviewer":
                    layers_global["radar"]["layer_type"] = "precipitation_new"
            else:
                # No hay ui_global.radar, crear con valores por defecto
                layers_global["radar"] = {}
        else:
            # No hay ui_global, crear con valores por defecto
            layers_global["radar"] = {}
    
    radar = layers_global["radar"]
    if not isinstance(radar, dict):
        radar = {}
        layers_global["radar"] = radar
    
    # Valores por defecto para radar (solo si no existen)
    radar.setdefault("enabled", False)
    radar.setdefault("provider", "rainviewer")
    radar.setdefault("opacity", 0.7)
    # Si layer_type es null o no existe, usar precipitation_new para rainviewer
    if radar.get("layer_type") is None or radar.get("layer_type") == "":
        if radar.get("provider") == "rainviewer":
            radar["layer_type"] = "precipitation_new"
        else:
            radar["layer_type"] = "precipitation_new"
    radar.setdefault("refresh_minutes", 5)
    radar.setdefault("history_minutes", 90)
    radar.setdefault("frame_step", 5)
    
    return config_dict


def _build_public_config(config: AppConfig) -> Dict[str, Any]:
    """Construye configuración pública v2 (sin secrets ni rutas internas).
    
    Oculta todos los valores sensibles de secrets.* pero mantiene la estructura
    para que el frontend sepa qué secretos están configurados.
    """
    payload = config.model_dump(mode="json", exclude_none=True, by_alias=True)
    
    # Ocultar todos los secretos pero mantener estructura
    # Solo metadata, nunca valores reales (EXCEPTO maptiler para alinear api_key con ui_map)
    if "secrets" in payload:
        secrets_public = {}
        
        # MapTiler: alinear secrets.maptiler.api_key con ui_map.maptiler.api_key para coherencia en /api/config
        if "maptiler" in payload.get("secrets", {}):
            # Intentar obtener api_key efectiva desde ui_map o secret_store
            effective_key: Optional[str] = None
            try:
                ui_map_block = payload.get("ui_map") or {}
                maptiler_block = ui_map_block.get("maptiler") or {}
                if isinstance(maptiler_block, dict):
                    candidate = maptiler_block.get("api_key")
                    if isinstance(candidate, str) and candidate.strip():
                        effective_key = candidate.strip()
                if not effective_key:
                    # Fallback a secret store si existe
                    secret_key = secret_store.get_secret("maptiler_api_key")
                    if isinstance(secret_key, str) and secret_key.strip():
                        effective_key = secret_key.strip()
            except Exception:
                effective_key = None
            secrets_public["maptiler"] = {"api_key": effective_key or None}
        
        # OpenSky
        if "opensky" in payload.get("secrets", {}):
            opensky_secrets = payload["secrets"].get("opensky", {})
            secrets_public["opensky"] = {
                "oauth2": {
                    "client_id": None,
                    "client_secret": None,
                    "token_url": opensky_secrets.get("oauth2", {}).get(
                        "token_url",
                        "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
                    ),
                    "scope": None
                } if opensky_secrets.get("oauth2") else {},
                "basic": {
                    "username": None,
                    "password": None
                } if opensky_secrets.get("basic") else {}
            }
            # Añadir indicadores de si hay credenciales (sin exponer valores)
            stored_id = secret_store.get_secret("opensky_client_id")
            stored_secret = secret_store.get_secret("opensky_client_secret")
            stored_username = secret_store.get_secret("opensky_username")
            stored_password = secret_store.get_secret("opensky_password")
            if secrets_public["opensky"].get("oauth2"):
                secrets_public["opensky"]["oauth2"]["has_credentials"] = bool(stored_id and stored_secret)
                if stored_id and len(stored_id) >= 4:
                    secrets_public["opensky"]["oauth2"]["client_id_last4"] = stored_id[-4:]
            if secrets_public["opensky"].get("basic"):
                secrets_public["opensky"]["basic"]["has_credentials"] = bool(stored_username and stored_password)
        
        # Google Calendar
        if "google" in payload.get("secrets", {}):
            secrets_public["google"] = {"api_key": None, "calendar_id": None}
        
        # Calendar ICS
        if "calendar_ics" in payload.get("secrets", {}):
            secrets_public["calendar_ics"] = {"url": None, "path": None}
        
        # AviationStack
        if "aviationstack" in payload.get("secrets", {}):
            secrets_public["aviationstack"] = {"api_key": None}
        
        # AISStream
        if "aisstream" in payload.get("secrets", {}):
            secrets_public["aisstream"] = {"api_key": None}
            # Inject status into secrets block as well
            stored_key = secret_store.get_secret("aisstream_api_key")
            secrets_public["aisstream"]["has_api_key"] = bool(stored_key)
            if stored_key and len(stored_key) >= 4:
                secrets_public["aisstream"]["api_key_last4"] = stored_key[-4:]
        
        # AISHub
        if "aishub" in payload.get("secrets", {}):
            secrets_public["aishub"] = {"api_key": None}
        
        payload["secrets"] = secrets_public

    # Inyectar estado de secretos en capas (para compatibilidad con frontend y tests)
    # Global Radar (OpenWeatherMap o MapTiler Weather)
    if "layers" in payload and "global" in payload["layers"]:
        radar = payload["layers"]["global"].get("radar", {})
        provider = radar.get("provider", "maptiler_weather")
        
        if provider == "maptiler_weather":
            # Para MapTiler Weather, verificar API key de MapTiler
            maptiler_key = secret_store.get_secret("maptiler_api_key")
            # También intentar extraer de URLs de estilo si no está en secrets
            if not maptiler_key:
                ui_map = payload.get("ui_map", {})
                maptiler_config = ui_map.get("maptiler", {})
                style_url = maptiler_config.get("styleUrl") or maptiler_config.get("style_url")
                if style_url:
                    maptiler_key = _extract_maptiler_key_from_url(style_url)
            radar["has_api_key"] = bool(maptiler_key)
            if maptiler_key and len(maptiler_key) >= 4:
                radar["api_key_last4"] = maptiler_key[-4:]
        elif provider == "openweathermap":
            # Para OpenWeatherMap, usar la API key de OpenWeatherMap
            stored_owm = secret_store.get_secret("openweathermap_api_key")
            radar["has_api_key"] = bool(stored_owm)
            if stored_owm and len(stored_owm) >= 4:
                radar["api_key_last4"] = stored_owm[-4:]
        else:
            # Para rainviewer u otros providers, no requiere API key
            radar["has_api_key"] = None
        
        payload["layers"]["global"]["radar"] = radar

    # Ships AISStream
    if "layers" in payload and "ships" in payload["layers"]:
        ships = payload["layers"]["ships"]
        if "aisstream" in ships:
            stored_ais = secret_store.get_secret("aisstream_api_key")
            ships["aisstream"]["has_api_key"] = bool(stored_ais)
            if stored_ais and len(stored_ais) >= 4:
                ships["aisstream"]["api_key_last4"] = stored_ais[-4:]

    
    # Filtrar stored_path del calendar.ics (no exponer rutas internas)
    if "calendar" in payload and isinstance(payload["calendar"], dict):
        calendar = payload["calendar"]
        if "ics" in calendar and isinstance(calendar["ics"], dict):
            ics = calendar["ics"]
            # Eliminar stored_path y file_path (rutas internas)
            ics.pop("stored_path", None)
            ics.pop("file_path", None)
    
    # Asegurar que ui_map.maptiler.styleUrl esté presente y api_key esté alineada
    # Esto evita estados inconsistentes donde el frontend no puede construir el styleUrl
    if "ui_map" in payload and isinstance(payload["ui_map"], dict):
        ui_map = payload["ui_map"]
        if "maptiler" in ui_map and isinstance(ui_map["maptiler"], dict):
            maptiler = ui_map["maptiler"]
            style_url = maptiler.get("styleUrl")
            
            # Intentar extraer key del styleUrl
            extracted_key = None
            if isinstance(style_url, str) and style_url:
                extracted_key = _extract_maptiler_key_from_url(style_url)
            
            # Si no hay key en styleUrl, intentar desde secrets o api_key existente
            if not extracted_key:
                api_key_from_secrets = secret_store.get_secret("maptiler_api_key")
                if api_key_from_secrets and api_key_from_secrets.strip():
                    extracted_key = api_key_from_secrets.strip()
                elif isinstance(maptiler.get("api_key"), str) and maptiler["api_key"].strip():
                    extracted_key = maptiler["api_key"].strip()
            
            # Establecer api_key si se encontró
            if extracted_key:
                maptiler["api_key"] = extracted_key
            
            # Si falta styleUrl pero hay style + api_key, construir styleUrl automáticamente
            if (not style_url or not style_url.strip()) and extracted_key:
                style_name = maptiler.get("style", "streets-v4")
                if isinstance(style_name, str):
                    style_name = style_name.strip()
                    # Normalizar nombres de estilo
                    if style_name in {"hybrid", "satellite", "vector-bright"}:
                        style_name = "streets-v4"
                    # Construir styleUrl
                    maptiler["styleUrl"] = f"https://api.maptiler.com/maps/{style_name}/style.json?key={extracted_key}"
                    logger.info("[config] Auto-constructed styleUrl for MapTiler: %s", _mask_maptiler_url(maptiler["styleUrl"]))
        
        # Desactivar explícitamente overlays satélite en respuesta pública (modo base-map simple)
        # Evita que el frontend active satélite global por confusiones previas
        satellite_block = ui_map.get("satellite")
        if isinstance(satellite_block, dict):
            satellite_block["enabled"] = False
    
    # Ocultar cualquier api_key o secret que pueda estar en otros lugares
    # (por seguridad adicional), pero NO tocar la estructura de secrets que ya construimos
    def _sanitize_secrets_recursive(obj: Any, path: str = "") -> Any:
        """Recursivamente sanitiza secretos en el objeto, excluyendo secrets.*."""
        if path.startswith("secrets"):
            # No sanitizar dentro de secrets (ya lo hicimos arriba)
            return obj
        
        if isinstance(obj, dict):
            result = {}
            for key, value in obj.items():
                new_path = f"{path}.{key}" if path else key
                # Ocultar campos sensibles fuera de secrets
                # EXCEPCIÓN: No ocultar api_key en ui_map.maptiler si ya la extrajimos del styleUrl
                if key in ["api_key", "apiKey", "client_id", "client_secret", "clientId", "clientSecret", 
                          "username", "password", "token", "secret", "key"] and not new_path.startswith("secrets"):
                    # Mantener api_key en ui_map.maptiler si existe (ya la extrajimos arriba)
                    if new_path == "ui_map.maptiler.api_key" and obj.get("api_key"):
                        result[key] = obj.get("api_key")
                    else:
                        result[key] = None
                else:
                    result[key] = _sanitize_secrets_recursive(value, new_path)
            return result
        elif isinstance(obj, list):
            return [_sanitize_secrets_recursive(item, path) for item in obj]
        else:
            return obj
    
    # Aplicar sanitización adicional (por si acaso) pero proteger secrets
    secrets_backup = payload.get("secrets")
    payload = _sanitize_secrets_recursive(payload)
    # Restaurar secrets después de sanitización
    if secrets_backup:
        payload["secrets"] = secrets_backup
    
    # Migrar labels_style_url (deprecated) a labels_overlay.style_url si existe
    # y eliminar labels_style_url de la respuesta pública
    if "ui_map" in payload and isinstance(payload["ui_map"], dict):
        ui_map = payload["ui_map"]
        if "satellite" in ui_map and isinstance(ui_map["satellite"], dict):
            satellite = ui_map["satellite"]
            
            # Si existe labels_style_url, migrarlo a labels_overlay si no está ya presente
            if "labels_style_url" in satellite and satellite["labels_style_url"]:
                labels_style_url_value = satellite["labels_style_url"]
                
                # Asegurar que labels_overlay existe como objeto
                if "labels_overlay" not in satellite:
                    satellite["labels_overlay"] = {}
                elif not isinstance(satellite["labels_overlay"], dict):
                    # Si es bool, convertir a objeto
                    if isinstance(satellite["labels_overlay"], bool):
                        satellite["labels_overlay"] = {"enabled": satellite["labels_overlay"]}
                    else:
                        satellite["labels_overlay"] = {}
                
                # Copiar labels_style_url a labels_overlay.style_url si no existe
                if "style_url" not in satellite["labels_overlay"] or not satellite["labels_overlay"]["style_url"]:
                    satellite["labels_overlay"]["style_url"] = labels_style_url_value
            
            # Eliminar labels_style_url de la respuesta pública (deprecated)
            satellite.pop("labels_style_url", None)
    
    # Asegurar que todas las flags satélite global estén en false en respuesta pública
    try:
        ui_global_block = payload.get("ui_global")
        if isinstance(ui_global_block, dict):
            sat = ui_global_block.get("satellite")
            if isinstance(sat, dict):
                sat["enabled"] = False
            wl = ui_global_block.get("weather_layers")
            if isinstance(wl, dict):
                sat_w = wl.get("satellite")
                if isinstance(sat_w, dict):
                    sat_w["enabled"] = False
        layers_block = payload.get("layers")
        if isinstance(layers_block, dict):
            global__block = layers_block.get("global_")
            if isinstance(global__block, dict):
                gl_sat = global__block.get("satellite")
                if isinstance(gl_sat, dict):
                    gl_sat["enabled"] = False
            gl_sat2 = layers_block.get("global_satellite")
            if isinstance(gl_sat2, dict):
                gl_sat2["enabled"] = False
    except Exception:
        # No impedir respuesta si hay cualquier error no crítico
        pass
    
    return payload


def _refresh_opensky_oauth_metadata() -> None:
    try:
        config = config_manager.read()
        payload = config.model_dump(mode="json", by_alias=True)
        opensky_info = payload.get("opensky")
        if not isinstance(opensky_info, dict):
            return
        oauth_info = opensky_info.get("oauth2")
        if isinstance(oauth_info, dict):
            oauth_public = dict(oauth_info)
        else:
            oauth_public = {}
        oauth_public.pop("client_id", None)
        oauth_public.pop("client_secret", None)
        if not isinstance(oauth_public.get("token_url"), str) or not oauth_public["token_url"].strip():
            oauth_public["token_url"] = DEFAULT_TOKEN_URL
        if "scope" not in oauth_public:
            oauth_public["scope"] = None
        stored_id = secret_store.get_secret("opensky_client_id")
        stored_secret = secret_store.get_secret("opensky_client_secret")
        has_credentials = bool(stored_id and stored_secret)
        oauth_public["has_credentials"] = has_credentials
        oauth_public["client_id_last4"] = (
            stored_id[-4:] if stored_id and len(stored_id) >= 4 else stored_id
        )
        opensky_info["oauth2"] = oauth_public
        payload["opensky"] = opensky_info
        config_manager.write(payload)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Skipping OpenSky OAuth metadata refresh: %s", exc)


# ------------------------ Secret endpoints (generic) ------------------------
_ALLOWED_SECRET_KEYS = {
    "opensky_client_id",
    "opensky_client_secret",
    "opensky_username",
    "opensky_password",
    # Compat (schema usa una sola 's')
    "aistream_api_key",
    # Canónica utilizada por servicios internos
    "aisstream_api_key",
    "openweathermap_api_key",
    "aviationstack_api_key",
    "aishub_api_key",
    "maptiler_api_key",
}

def _canonical_secret_key(key: str) -> str:
    # Alias: aceptar 'aistream_api_key' pero guardar en 'aisstream_api_key'
    return "aisstream_api_key" if key == "aistream_api_key" else key


@app.get("/api/config/secret/{key}")
def get_secret_meta(key: str) -> Dict[str, bool]:
    if key not in _ALLOWED_SECRET_KEYS:
        raise HTTPException(status_code=404, detail="Unknown secret key")
    canonical = _canonical_secret_key(key)
    return {"exists": secret_store.has_secret(canonical)}


@app.post("/api/config/secret/{key}")
async def set_secret_value(key: str, request: Request) -> Dict[str, bool]:
    if key not in _ALLOWED_SECRET_KEYS:
        raise HTTPException(status_code=404, detail="Unknown secret key")
    value = await _read_secret_value(request)
    canonical = _canonical_secret_key(key)
    secret_store.set_secret(canonical, _sanitize_secret(value))
    logger.info("[secrets] updated key=%s (exists=%s)", canonical, secret_store.has_secret(canonical))
    # Efectos colaterales para servicios que dependen de secretos
    try:
        if canonical in ("opensky_client_id", "opensky_client_secret"):
            opensky_service.reset()
            logger.info("[opensky] credentials updated -> token cache reset")
        elif canonical == "aisstream_api_key":
            current = config_manager.read()
            ships_service.apply_config(current.layers.ships)
            logger.info("[ships] AISStream key updated -> service reconfigured")
    except Exception:  # noqa: BLE001
        logger.debug("post-secret side effects failed", exc_info=True)
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

    - layers.ships.aisstream.api_key -> secret_store['aistream_api_key']
    """
    try:
        config = config_manager.read()
        mutated = False
        mutated_any = False

        # AEMET - Ya no se usa, eliminado completamente
        # Usar /api/weather/alerts para avisos CAP públicos

        # Resetear bandera de mutación antes de procesar AISStream
        mutated = False

        # AISStream
        ai_key = None
        try:
            ai_key = getattr(config.layers.ships.aisstream, "api_key", None)
        except Exception:
            ai_key = None
        if ai_key:
            # Usar clave canónica para AISStream
            secret_store.set_secret("aisstream_api_key", _sanitize_secret(ai_key))
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


def _get_tz() -> ZoneInfo:
    """Retorna ZoneInfo para el timezone del config o fallback a Europe/Madrid."""
    config = config_manager.read()
    tz_str = getattr(config.display, "timezone", None) if hasattr(config, "display") else None
    if not tz_str or not isinstance(tz_str, str) or not tz_str.strip():
        tz_str = "Europe/Madrid"
    try:
        return ZoneInfo(tz_str.strip())
    except Exception:  # noqa: BLE001
        logger.warning("[timezone] Invalid timezone '%s', falling back to Europe/Madrid", tz_str)
        return ZoneInfo("Europe/Madrid")


def _get_local_day_range() -> Tuple[datetime, datetime]:
    """Construye el rango del día local actual [00:00, 23:59:59] y convierte a UTC ISO."""
    tz = _get_tz()
    now_local = datetime.now(tz)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    return start_utc, end_utc


def _health_payload() -> Dict[str, Any]:
    config = config_manager.read()
    uptime = datetime.now(timezone.utc) - APP_START

    # Metadatos de configuración
    config_metadata = config_manager.get_config_metadata()
    
    # Timezone y hora local
    tz = _get_tz()
    tz_str = str(tz)
    now_local = datetime.now(tz)
    now_local_iso = now_local.isoformat()

    payload = {
        "status": "ok",
        "uptime_seconds": int(uptime.total_seconds()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "config_path": config_metadata["config_path"],
        "config_source": config_metadata["config_source"],
        "has_timezone": config_metadata["has_timezone"],
        "config_loaded_at": config_metadata.get("config_loaded_at"),
        "config_version": map_reset_counter,
        "timezone": tz_str,
        "now_local_iso": now_local_iso,
        "storm": {
            "enabled": config.storm.enabled,
            "center_lat": config.storm.center_lat,
            "center_lng": config.storm.center_lng,
            "zoom": config.storm.zoom,
        },
    }
    flights_layer = {"items": None, "stale": False}
    ships_layer = {"items": None, "stale": False}

    try:
        flights_cfg = config.layers.flights
        snapshot = opensky_service.get_last_snapshot()
        if snapshot:
            processed_items, stats = _prepare_flights_items(
                snapshot.payload.get("items", []),
                flights_cfg,
                snapshot.bbox,
            )
            flights_layer["items"] = len(processed_items)
            flights_layer["stale"] = bool(snapshot.payload.get("stale")) or bool(stats.get("stale_features"))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Unable to summarize flights layer for health: %s", exc)

    try:
        cached_ships = cache_store.load("ships", max_age_minutes=None)
        if cached_ships:
            payload_cached = cached_ships.payload
            features = payload_cached.get("features", [])
            ships_layer["items"] = len(features)
            stale_features = sum(
                1
                for feature in features
                if isinstance(feature, dict)
                and isinstance(feature.get("properties"), dict)
                and feature["properties"].get("stale")
            )
            ships_layer["stale"] = bool(payload_cached.get("stale")) or stale_features > 0
        else:
            ships_layer["items"] = None
            ships_layer["stale"] = False
    except Exception as exc:  # noqa: BLE001
        logger.debug("Unable to summarize ships layer for health: %s", exc)

    payload["layers"] = {"flights": flights_layer, "ships": ships_layer}

    try:
        opensky_status = opensky_service.get_status(config)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Unable to gather OpenSky status for health: %s", exc)
        opensky_status = {
            "enabled": config.opensky.enabled,
            "status": "stale",
        }
    auth_block = opensky_status.get("auth")
    if not isinstance(auth_block, dict):
        auth_block = {
            "has_credentials": opensky_status.get("has_credentials", False),
            "token_cached": opensky_status.get("token_cached", False),
            "expires_in_sec": opensky_status.get("expires_in"),
        }
    # Si falta auth, usar "stale" en lugar de "error"
    status_value = opensky_status.get("status", "stale")
    if status_value == "error" and not bool(auth_block.get("has_credentials", False)):
        status_value = "stale"
    providers = {
        "opensky": {
            "enabled": bool(opensky_status.get("enabled", False)),
            "auth": {
                "has_credentials": bool(auth_block.get("has_credentials", False)),
                "token_cached": bool(auth_block.get("token_cached", False)),
                "expires_in_sec": auth_block.get("expires_in_sec"),
            },
            "status": status_value,
            "last_fetch_iso": opensky_status.get("last_fetch_iso"),
            "items": opensky_status.get("items"),
            "rate_limit_hint": opensky_status.get("rate_limit_hint"),
        }
    }
    payload["providers"] = providers
    
    # Bloque de MapTiler
    try:
        # config_v2, _ = _read_config_v2()
        ui_map = config.ui_map
        
        provider_str = ui_map.provider or "unknown"
        
        if provider_str.startswith("maptiler_"):
            # Obtener API key del secret store o del objeto config
            api_key = secret_store.get_secret("maptiler_api_key")
            if not api_key and ui_map.maptiler:
                api_key = ui_map.maptiler.api_key

            style_url = ui_map.maptiler.styleUrl if ui_map.maptiler else None
            labels_style_url = None
            labels_overlay_present = False

            satellite_style_url = None
            if ui_map.satellite:
                satellite_style_url = getattr(ui_map.satellite, "style_url", None) or getattr(
                    ui_map.satellite, "style_raster", None
                )
                # Obtener style_url desde labels_overlay (nuevo formato unificado)
                if ui_map.satellite.labels_overlay:
                    labels_overlay_present = True
                    if hasattr(ui_map.satellite.labels_overlay, "style_url"):
                        labels_style_url = ui_map.satellite.labels_overlay.style_url
                    elif isinstance(ui_map.satellite.labels_overlay, dict):
                        labels_style_url = ui_map.satellite.labels_overlay.get("style_url")
                # Fallback a labels_style_url legacy si existe
                if not labels_style_url:
                    legacy_labels = getattr(ui_map.satellite, "labels_style_url", None)
                    if legacy_labels:
                        labels_style_url = legacy_labels
                        labels_overlay_present = True

            # Determinar si tenemos API key (ya sea explícita o embebida en la URL)
            maptiler_key_candidate = api_key.strip() if isinstance(api_key, str) else None
            if not maptiler_key_candidate:
                maptiler_key_candidate = (
                    _extract_maptiler_key_from_url(style_url)
                    or _extract_maptiler_key_from_url(labels_style_url)
                    or _extract_maptiler_key_from_url(satellite_style_url)
                )

            has_api_key = bool(maptiler_key_candidate)

            # Validar el estilo (cacheado en caché global)
            validation_result = None
            cached_validation_entry = None
            if style_url:
                style_hash = hashlib.sha256(style_url.encode("utf-8")).hexdigest()
                cache_key = f"maptiler_validation::{style_hash[:12]}"
                cached_validation = cache_store.load(cache_key, max_age_minutes=60)
                if cached_validation and cached_validation.payload.get("style_hash") == style_hash:
                    validation_result = cached_validation.payload
                    cached_validation_entry = cached_validation
                else:
                    if cached_validation:
                        cache_store.invalidate(cache_key)
                    validation_payload = _validate_maptiler_style(style_url)
                    validation_result = {**validation_payload, "style_hash": style_hash}
                    cached_validation_entry = cache_store.store(cache_key, validation_result)

            # Determinar provider específico
            if provider_str == "maptiler_vector":
                provider_reported = "maptiler_vector"
            elif provider_str == "maptiler_raster":
                provider_reported = "maptiler_raster"
            else:
                provider_reported = provider_str

            # Verificar si las URLs están firmadas (presencia de key)
            style_signed = bool(_extract_maptiler_key_from_url(style_url))
            labels_signed = bool(_extract_maptiler_key_from_url(labels_style_url))

            # Determinar status
            if not has_api_key:
                status_value = "error"
            elif validation_result and validation_result.get("ok"):
                status_value = "ok"
            elif validation_result:
                status_value = "error"
            else:
                status_value = "ok"

            # Determinar nombre del estilo desde style (fuente de verdad) o inferir desde styleUrl
            style_name = None
            if ui_map.maptiler:
                style_from_config = ui_map.maptiler.style
                if style_from_config:
                    # Mapear nombres de estilo a nombres legibles
                    style_name_map = {
                        "hybrid": "Hybrid",
                        "satellite": "Satellite",
                        "streets-v4": "Streets v4",
                        "vector-dark": "Basic Dark",
                        "vector-bright": "Basic",
                        "vector-light": "Basic Light",
                        "basic": "Basic",
                        "basic-dark": "Basic Dark",
                    }
                    style_name = style_name_map.get(style_from_config, style_from_config)
                elif style_url:
                    # Fallback: intentar inferir desde URL solo si no hay style configurado
                    if "hybrid" in style_url:
                        style_name = "Hybrid"
                    elif "satellite" in style_url:
                        style_name = "Satellite"
                    elif "streets-v4" in style_url:
                        style_name = "Streets v4"
                    elif "basic-dark" in style_url:
                        style_name = "Basic Dark"
                    elif "basic" in style_url:
                        style_name = "Basic"

            if validation_result and not validation_result.get("ok"):
                logger.debug(
                    "[health] MapTiler validation failed url=%s status=%s error=%s",
                    _mask_maptiler_url(style_url),
                    validation_result.get("status"),
                    validation_result.get("error"),
                )

            payload["maptiler"] = {
                "provider": provider_reported,
                "status": status_value,
                "has_api_key": has_api_key,
                "style_signed": style_signed,
                "labels_signed": labels_signed,
                "labels_overlay": {
                    "present": labels_overlay_present,
                    "style_signed": labels_signed
                },
                "styleUrl": style_url,
                "name": validation_result.get("name") if validation_result else style_name,
                "last_check_iso": cached_validation_entry.fetched_at.isoformat() if cached_validation_entry else None,
                "error": validation_result.get("error") if validation_result else (None if style_url else "Missing styleUrl"),
            }
        else:
            payload["maptiler"] = {
                "provider": provider_str,
                "status": "error",
                "has_api_key": False,
                "style_signed": False,
                "labels_signed": False,
                "labels_overlay": {
                    "present": False,
                    "style_signed": False
                },
                "message": f"MapTiler not enabled (provider is {provider_str})"
            }
    except Exception as exc:  # noqa: BLE001
        logger.debug("Unable to gather MapTiler status for health: %s", exc)
        payload["maptiler"] = {
            "provider": "unknown",
            "status": "error",
            "has_api_key": False,
            "style_signed": False,
            "labels_signed": False,
            "labels_overlay": {
                "present": False,
                "style_signed": False
            },
            "error": str(exc)
        }
    
    # Bloque de efemérides históricas
    try:
        config = config_manager.read()
        historical_events_config = None
        enabled = False
        provider = "local"
        data_path = "/var/lib/pantalla-reloj/data/efemerides.json"
        
        if config.panels and config.panels.historicalEvents:
            historical_events_config = config.panels.historicalEvents
            enabled = historical_events_config.enabled
            provider = historical_events_config.provider or "local"
            if historical_events_config.local:
                data_path = historical_events_config.local.data_path
        
        # Verificar estado según el proveedor
        status = "ok"
        last_load_iso = None
        
        if provider == "local":
            # Verificar estado del archivo
            path = Path(data_path)
            if not path.exists():
                status = "missing"
            else:
                try:
                    from .routes.efemerides import load_efemerides_data
                    data = load_efemerides_data(data_path)
                    if data:
                        mtime = path.stat().st_mtime
                        last_load_iso = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                    else:
                        status = "empty"
                except Exception as e:
                    logger.debug("Error loading efemerides for health: %s", e)
                    status = "error"
        elif provider == "wikimedia":
            # Para Wikimedia, verificar conectividad
            try:
                # Hacer una petición de prueba (hoy)
                today = date.today()
                test_config = {
                    "language": "es",
                    "event_type": "all",
                    "api_user_agent": "PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)",
                    "max_items": 1,
                    "timeout_seconds": 5
                }
                if historical_events_config and historical_events_config.wikimedia:
                    test_config = {
                        "language": historical_events_config.wikimedia.language,
                        "event_type": historical_events_config.wikimedia.event_type,
                        "api_user_agent": historical_events_config.wikimedia.api_user_agent,
                        "max_items": 1,
                        "timeout_seconds": historical_events_config.wikimedia.timeout_seconds
                    }
                
                test_result = fetch_wikimedia_onthisday(
                    month=today.month,
                    day=today.day,
                    **test_config
                )
                
                if test_result and (test_result.get("events") or test_result.get("births")):
                    status = "ok"
                    last_load_iso = datetime.now(timezone.utc).isoformat()
                else:
                    status = "empty"
            except Exception as e:
                logger.debug("Error checking Wikimedia API status for health: %s", e)
                status = "error"
        
        payload["historicalEvents"] = {
            "enabled": enabled,
            "provider": provider,
            "status": status,
            "last_load_iso": last_load_iso
        }
    except Exception as exc:  # noqa: BLE001
        logger.debug("Unable to gather historicalEvents status for health: %s", exc)
        payload["historicalEvents"] = {
            "enabled": False,
            "provider": "local",
            "status": "error",
            "last_load_iso": None
        }
    
    # Bloque de calendario
    try:
        # Intentar leer como v2
        try:
            config = config_manager.read()
            calendar_provider, enabled, ics_path = _resolve_calendar_settings(config)
        except Exception:  # noqa: BLE001
            # Fallback a v1
            calendar_config = config.calendar
            enabled = calendar_config.enabled
            calendar_provider = "google"
            ics_path = None

        calendar_state = _get_calendar_runtime_state()
        credentials_present = False
        last_fetch_iso = None
        calendar_status = "stale"
        last_error: Optional[str] = None

        if calendar_provider == "google":
            api_key = secret_store.get_secret("google_calendar_api_key") or secret_store.get_secret("google_api_key")
            calendar_id = secret_store.get_secret("google_calendar_id")
            credentials_present = bool(api_key and calendar_id)
            if enabled and credentials_present:
                calendar_status = "ok"
            elif enabled:
                calendar_status = "error"
                last_error = "Google Calendar API key or calendar ID missing"
        elif calendar_provider == "ics":
            credentials_present = _ics_path_is_readable(ics_path)
            if not enabled:
                calendar_status = "stale"
                last_error = None
            elif not credentials_present:
                calendar_status = "error"
                last_error = f"ICS calendar path missing or unreadable: {ics_path}"
                _update_calendar_runtime_state("ics", enabled, calendar_status, last_error, ics_path)
            else:
                state_matches = (
                    calendar_state.get("provider") == "ics"
                    and calendar_state.get("ics_path") == (ics_path or calendar_state.get("ics_path"))
                )
                if state_matches:
                    calendar_status = calendar_state.get("status", "ok") or "ok"
                    last_error = calendar_state.get("last_error")
                else:
                    calendar_status = "stale"
                    last_error = None
        else:
            credentials_present = False
            calendar_status = "stale"
            last_error = None

        payload["calendar"] = {
            "enabled": enabled,
            "provider": calendar_provider,
            "credentials_present": credentials_present,
            "last_fetch_iso": last_fetch_iso,
            "status": calendar_status,
            "last_error": last_error,
        }
        if calendar_provider == "ics" and ics_path:
            payload["calendar"]["ics_path"] = ics_path
    except Exception as exc:  # noqa: BLE001
        logger.debug("Unable to gather calendar status for health: %s", exc)
        payload["calendar"] = {
            "enabled": False,
            "provider": "unknown",
            "credentials_present": False,
            "last_fetch_iso": None,
            "status": "error",
            "last_error": str(exc),
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
def healthcheck_full() -> JSONResponse:
    """Health check completo con información de todas las capas."""
    logger.debug("Full health check requested")
    payload = _health_payload_full_helper()
    
    # Crear respuesta con headers anti-cache
    response = JSONResponse(content=payload)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/api/config/meta")
def config_metadata() -> Dict[str, Any]:
    """Retorna metadatos sobre la configuración cargada."""
    logger.debug("Config metadata requested")
    return config_manager.get_config_metadata()


@app.get("/api/debug/maptiler-style")
def debug_maptiler_style() -> Dict[str, Any]:
    """Endpoint de diagnóstico para verificar la configuración de MapTiler.
    
    Retorna información detallada sobre:
    - provider, style, styleUrl desde ui_map.maptiler
    - satellite.enabled, satellite.style_url, labels_overlay desde ui_map.satellite
    - Estado de validación y URLs firmadas
    """
    try:
        config = config_manager.read()
        ui_map = config.ui_map
        
        provider = ui_map.provider or "unknown"
        maptiler_config = ui_map.maptiler
        
        # Obtener API key
        api_key = secret_store.get_secret("maptiler_api_key")
        if not api_key and maptiler_config:
            api_key = maptiler_config.api_key
        
        # Información básica de maptiler
        ui_map_style = maptiler_config.style if maptiler_config else None
        ui_map_styleUrl = maptiler_config.styleUrl if maptiler_config else None
        
        # Información de satellite
        satellite_config = ui_map.satellite
        satellite_enabled = satellite_config.enabled if satellite_config else False
        satellite_style_url = satellite_config.style_url if satellite_config else None
        
        # Información de labels_overlay
        labels_overlay_enabled = False
        labels_overlay_style_url = None
        if satellite_config and satellite_config.labels_overlay:
            labels_overlay_enabled = satellite_config.labels_overlay.enabled
            labels_overlay_style_url = satellite_config.labels_overlay.style_url
        
        # Determinar estilo efectivo usado
        effective_style_used = ui_map_style or "unknown"
        if effective_style_used == "hybrid" and satellite_enabled:
            effective_style_used = "hybrid (satellite + labels overlay)"
        elif effective_style_used == "satellite" and satellite_enabled:
            effective_style_used = "satellite (with labels overlay)"
        
        # Validar styleUrl si existe
        validation_result = None
        if ui_map_styleUrl:
            validation_result = _validate_maptiler_style(ui_map_styleUrl)
        
        # Verificar si URLs están firmadas
        style_signed = bool(ui_map_styleUrl and ("?key=" in ui_map_styleUrl or "&key=" in ui_map_styleUrl))
        satellite_signed = bool(satellite_style_url and ("?key=" in satellite_style_url or "&key=" in satellite_style_url))
        labels_signed = bool(labels_overlay_style_url and ("?key=" in labels_overlay_style_url or "&key=" in labels_overlay_style_url))
        
        # Determinar status
        status = "ok"
        error = None
        if not api_key:
            status = "error"
            error = "No API key found"
        elif validation_result and not validation_result.get("ok"):
            status = "error"
            error = validation_result.get("error", "Style validation failed")
        
        return {
            "provider": provider,
            "ui_map_style": ui_map_style,
            "ui_map_styleUrl": ui_map_styleUrl,
            "satellite_enabled": satellite_enabled,
            "satellite_style_url": satellite_style_url,
            "labels_overlay_enabled": labels_overlay_enabled,
            "labels_overlay_style_url": labels_overlay_style_url,
            "effective_style_used": effective_style_used,
            "style_signed": style_signed,
            "satellite_signed": satellite_signed,
            "labels_signed": labels_signed,
            "has_api_key": bool(api_key),
            "validation": validation_result,
            "status": status,
            "error": error
        }
    except Exception as e:
        logger.exception("Error in debug_maptiler_style")
        return {
            "status": "error",
            "error": str(e)
        }


@app.get("/api/map/validate")
def validate_map_config() -> Dict[str, Any]:
    """Valida la configuración de MapTiler y devuelve el estado del estilo."""
    logger.debug("Map validation requested")
    
    try:
        config = config_manager.read()
        ui_map = config.ui_map
        
        # Si el proveedor no es maptiler_vector, devolver ok
        if ui_map.provider != "maptiler_vector":
            return {
                "ok": True,
                "provider": ui_map.provider,
                "message": f"Provider {ui_map.provider} does not require MapTiler validation"
            }
        
        maptiler_config = ui_map.maptiler
        if not maptiler_config:
            return {
                "ok": False,
                "provider": "maptiler_vector",
                "error": "No MapTiler configuration found"
            }
        
        style_url = maptiler_config.styleUrl
        # Obtener API key del secret store o del objeto config
        api_key = secret_store.get_secret("maptiler_api_key")
        if not api_key and maptiler_config:
            api_key = maptiler_config.api_key
        
        if not style_url:
            return {
                "ok": False,
                "provider": "maptiler_vector",
                "error": "Missing styleUrl"
            }
        
        # Validar el estilo
        result = _validate_maptiler_style(style_url)
        
        return {
            "ok": result["ok"],
            "provider": "maptiler_vector",
            "styleUrl": style_url,
            "triedFallback": False,
            "status": result["status"],
            "error": result.get("error"),
            "name": result.get("name")
        }
        
    except Exception as exc:
        logger.error("Error validating map config: %s", exc)
        return {
            "ok": False,
            "error": str(exc)
        }


@app.post("/api/maps/test_maptiler")
async def test_maptiler(request: MapTilerTestRequest) -> Dict[str, Any]:
    """Prueba una URL de estilo de MapTiler.
    
    Soporta dos formatos:
    - A) styleUrl completo: {"styleUrl": "https://api.maptiler.com/maps/streets-v4/style.json?key=..."}
    - B) style + provider: {"style": "streets-v4", "provider": "maptiler"} (construye styleUrl usando api_key de config)
    
    Descarga el JSON del estilo y verifica que sea válido.
    """
    try:
        # Determinar styleUrl a usar
        style_url_to_test = request.styleUrl
        
        # Si no hay styleUrl pero hay style + provider, construir desde config
        if not style_url_to_test and request.style and request.provider == "maptiler":
            # Obtener api_key desde secrets o config
            api_key = secret_store.get_secret("maptiler_api_key")
            if not api_key:
                # Intentar desde config v2
                try:
                    config = config_manager.read()
                    if config and config.ui_map and config.ui_map.maptiler:
                        api_key = config.ui_map.maptiler.api_key
                except Exception:
                    pass
            
            if not api_key or not api_key.strip():
                return {
                    "ok": False,
                    "status": 0,
                    "error": "missing_maptiler_api_key",
                    "message": "MapTiler API key is required but not found in secrets or config"
                }
            
            # Normalizar style name (hybrid/satellite → streets-v4)
            style_name = request.style.strip()
            if style_name in {"hybrid", "satellite", "vector-bright"}:
                style_name = "streets-v4"
            
            # Construir styleUrl
            style_url_to_test = f"https://api.maptiler.com/maps/{style_name}/style.json?key={api_key.strip()}"
        
        if not style_url_to_test:
            return {
                "ok": False,
                "status": 0,
                "error": "missing_style_url",
                "message": "Either styleUrl or (style + provider) must be provided"
            }
        
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(style_url_to_test)
            
            if response.status_code == 200:
                try:
                    style_json = response.json()
                    return {"ok": True, "bytes": len(response.content)}
                except ValueError:
                    return {"ok": False, "status": 200, "error": "Not valid JSON"}
            else:
                return {"ok": False, "status": response.status_code, "error": f"HTTP {response.status_code}"}
        except httpx.RequestError as exc:
            return {"ok": False, "status": 0, "error": str(exc)}
    except Exception as exc:
        logger.error("[maps] Error testing MapTiler: %s", exc)
        return {
            "ok": False,
            "status": 0,
            "error": "internal_error"
        }


@app.post("/api/maps/test_rainviewer")
async def test_rainviewer(request: RainViewerTestRequest) -> Dict[str, Any]:
    """Prueba la conexión con RainViewer descargando un tile de referencia.
    
    Obtiene un timestamp reciente de RainViewer y prueba descargar un tile
    de ejemplo (zoom 3, x 4, y 2) para validar que el servicio responde.
    """
    try:
        from .global_providers import RainViewerProvider
        
        provider = RainViewerProvider()
        
        # Obtener frames disponibles (solo necesitamos uno reciente)
        frames = provider.get_available_frames(history_minutes=30, frame_step=5)
        
        if not frames:
            return {
                "ok": False,
                "status": 0,
                "error": "no_frames_available",
                "message": "RainViewer API returned no available frames"
            }
        
        # Usar el frame más reciente
        latest_frame = frames[-1]
        timestamp = latest_frame["timestamp"]
        
        # Construir URL de tile de prueba (zoom 3, x 4, y 2)
        test_z = 3
        test_x = 4
        test_y = 2
        tile_url = provider.get_tile_url(timestamp, test_z, test_x, test_y)
        
        # CAMBIO: httpx para test
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.head(tile_url, follow_redirects=True)
                # Si HEAD no está disponible, intentar GET
                if response.status_code == 405:
                    response = await client.get(tile_url, follow_redirects=True)
                    if response.status_code == 200:
                        # Verificar content type
                        content_type = response.headers.get("content-type", "").lower()
                        if "image" not in content_type:
                            return {
                                "ok": False,
                                "status": 200,
                                "error": "invalid_content_type",
                                "message": f"Expected image, got {content_type}"
                            }
            
            if response.status_code == 200:
                return {
                    "ok": True,
                    "status": 200,
                    "provider": "rainviewer",
                    "timestamp": timestamp,
                    "test_tile": f"{test_z}/{test_x}/{test_y}"
                }
            else:
                return {
                    "ok": False,
                    "status": response.status_code,
                    "error": f"http_{response.status_code}",
                    "message": f"Tile request returned HTTP {response.status_code}"
                }
        except httpx.RequestError as exc:
            return {
                "ok": False,
                "status": 0,
                "error": "network_error",
                "message": str(exc)
            }
            
    except Exception as exc:
        logger.error("[maps] Error testing RainViewer: %s", exc, exc_info=True)
        return {
            "ok": False,
            "status": 0,
            "error": "internal_error",
            "message": str(exc)
        }


@app.post("/api/maps/test_xyz")
async def test_xyz(request: XyzTestRequest) -> Dict[str, Any]:
    """Prueba una URL de tiles XYZ descargando una muestra.
    
    Descarga un tile de ejemplo (z=2, x=1, y=1) y verifica que sea una imagen.
    """
    try:
        # Reemplazar placeholders en la URL
        test_url = request.tileUrl.replace("{z}", "2").replace("{x}", "1").replace("{y}", "1")
        
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            response = await client.get(test_url)
        
        if response.status_code == 200:
            content_type = response.headers.get("content-type", "").lower()
            if "image" in content_type:
                return {
                    "ok": True,
                    "bytes": len(response.content),
                    "contentType": content_type
                }
            else:
                return {
                    "ok": False,
                    "error": f"Not an image (content-type: {content_type})"
                }
        else:
            return {
                "ok": False,
                "status": response.status_code,
                "error": f"HTTP {response.status_code}"
            }
    except httpx.RequestError as exc:
        return {
            "ok": False,
            "error": str(exc)
        }
    except Exception as exc:
        logger.error("[maps] Error testing XYZ: %s", exc)
        return {
            "ok": False,
            "error": "internal_error"
        }


@app.get("/api/maps")
def get_maps_status() -> Dict[str, Any]:
    """
    Devuelve el estado de mapas para el frontend.

    Reutiliza el payload de /api/health/full pero limitado
    a la parte de mapas y radar global, que es lo que usa la UI.
    """
    # Importante: usamos el mismo helper que /api/health/full
    health = _health_payload_full_helper()

    maps = health.get("maps") or {}
    global_radar = health.get("global_radar") or {}
    global_satellite = health.get("global_satellite") or {}

    providers = health.get("providers") or {}
    rainviewer = providers.get("rainviewer") or {}
    gibs = providers.get("gibs") or {}

    return {
        "maps": maps,
        "global_radar": global_radar,
        "global_satellite": global_satellite,
        "rainviewer": rainviewer,
        "gibs": gibs,
    }


@app.get("/api/map/satellite/test")
async def test_satellite_layer() -> Dict[str, Any]:
    """Verifica acceso al tile de satélite de MapTiler."""
    try:
        config = config_manager.read()
        
        if not config.ui_map.satellite.enabled:
            return {"ok": False, "reason": "satellite_disabled"}
        
        # Obtener API key de MapTiler desde secret_store o del objeto config
        api_key = secret_store.get_secret("maptiler_api_key")
        if not api_key and config.ui_map.maptiler:
            api_key = config.ui_map.maptiler.api_key
        
        if not api_key:
            return {"ok": False, "reason": "missing_api_key"}
        
        url = f"https://api.maptiler.com/tiles/satellite/15/17000/12000.jpg?key={api_key}"
        
        if httpx is None:
            # Fallback a requests si httpx no está disponible
            response = requests.head(url, timeout=5)
            return {"ok": response.status_code == 200, "status": response.status_code}
        
        async with httpx.AsyncClient() as client:
            r = await client.head(url, timeout=5.0)
        return {"ok": r.status_code == 200, "status": r.status_code}
    except Exception as exc:
        logger.error("[map] Error testing satellite layer: %s", exc)
        return {"ok": False, "error": str(exc)}


@app.post("/api/config/upload/ics")
async def upload_ics_file(
    file: UploadFile = File(..., description="ICS calendar file"),
    filename: Optional[str] = None,
) -> JSONResponse:
    """Upload an ICS file, persist it to disk and enable the local calendar."""

    MAX_ICS_SIZE = 2 * 1024 * 1024  # 2 MB

    original_filename = filename or file.filename or "calendar.ics"
    if not original_filename.lower().endswith(".ics"):
        raise HTTPException(
            status_code=400,
            detail={"error": "File must have .ics extension", "missing": ["file.extension"]},
        )

    content = await file.read()
    if len(content) > MAX_ICS_SIZE:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"File size exceeds maximum ({MAX_ICS_SIZE} bytes)",
                "missing": ["file.size"],
            },
        )
    
    # Validar formato ICS en thread (CPU bound)
    try:
        await asyncio.to_thread(_validate_ics_basic, content)
    except HTTPException:
        raise

    # Obtener UID/GID del propietario del config antes de crear directorios
    uid = gid = None
    try:
        stat_info = config_manager.config_file.stat()
        uid, gid = stat_info.st_uid, stat_info.st_gid
    except FileNotFoundError:
        # Si el config no existe, intentar obtener del directorio padre
        try:
            parent_stat = config_manager.config_file.parent.stat()
            uid, gid = parent_stat.st_uid, parent_stat.st_gid
        except OSError:
            pass
    except OSError as exc:
        logger.debug("[config] Could not stat config file for ownership: %s", exc)

    # Operaciones de disco bloqueantes en thread (I/O bound)
    async def save_file_securely():
        if not ICS_STORAGE_DIR.exists():
            ICS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
            if uid is not None and gid is not None:
                try:
                    os.chown(ICS_STORAGE_DIR, uid, gid)
                except OSError as exc:
                    logger.debug("[config] Could not chown ICS directory: %s", exc)
            try:
                os.chmod(ICS_STORAGE_DIR, 0o755)
            except OSError as exc:
                logger.debug("[config] Could not chmod ICS directory: %s", exc)
        else:
            # Verificar que el directorio sea escribible
            if not os.access(ICS_STORAGE_DIR, os.W_OK):
                logger.error("[config] ICS directory exists but is not writable: %s", ICS_STORAGE_DIR)
                raise HTTPException(
                    status_code=400,
                    detail={"error": f"ICS directory is not writable: {ICS_STORAGE_DIR}", "missing": ["storage.dir"]},
                )
        
        with ICS_STORAGE_PATH.open("wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        
        # Asegurar permisos correctos del archivo después de escribirlo
        if uid is not None and gid is not None:
            try:
                os.chown(ICS_STORAGE_PATH, uid, gid)
            except OSError as exc:
                logger.debug("[config] Could not chown ICS file after writing: %s", exc)
        
        try:
            os.chmod(ICS_STORAGE_PATH, 0o644)
        except OSError as exc:
            logger.debug("[config] Could not chmod ICS file: %s", exc)
        
        return str(ICS_STORAGE_PATH)
    
    try:
        saved_path = await asyncio.to_thread(save_file_securely)
    except (PermissionError, OSError) as exc:
        logger.error("[config] IO Error: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="File save error"
        )
    except HTTPException:
        raise

    # Parsing en thread
    try:
        preview_events = await asyncio.to_thread(fetch_ics_calendar_events, path=saved_path)
    except ICSCalendarError as exc:
        logger.warning("[config] Uploaded ICS file is not parseable: %s", exc)
        raise HTTPException(
            status_code=400,
            detail={"error": f"ICS file is not parseable: {str(exc)}", "missing": ["file.format"]},
        ) from exc

    try:
        current_raw = load_raw_config(config_manager.config_file)
    except json.JSONDecodeError as exc:
        logger.error("[config] Current config is not valid JSON: %s", exc)
        raise HTTPException(
            status_code=400,
            detail={"error": f"Current configuration file is not valid JSON: {str(exc)}", "missing": ["config.json"]},
        ) from exc
    except OSError as exc:
        logger.error("[config] Could not read current config %s: %s", config_manager.config_file, exc)
        raise HTTPException(
            status_code=400,
            detail={"error": f"Unable to read current configuration: {str(exc)}", "missing": ["config.read"]},
        ) from exc

    incoming = {
        "panels": {
            "calendar": {
                "enabled": True,
                "provider": "ics",
                "ics_path": str(ICS_STORAGE_PATH),
            }
        },
    }

    merged = deep_merge(current_raw, incoming)
    # Sanitizar antes de validar (migra valores legacy/inválidos)
    sanitized_ics = sanitize_config(merged)
    # NO aplicar defaults aquí - mantener solo lo que está en disco y payload
    provider_final, enabled_final, final_ics_path = resolve_calendar_provider(sanitized_ics)
    try:
        validate_calendar_provider(provider_final, enabled_final, final_ics_path)
    except CalendarValidationError as exc:
        logger.warning("[config] Calendar validation error after ICS upload: %s", exc)
        raise HTTPException(
            status_code=400,
            detail={"error": str(exc), "missing": exc.missing if exc.missing else []},
        ) from exc

    # Lógica de configuración usando await asyncio.to_thread(write_config_atomic, ...)
    try:
        await asyncio.to_thread(write_config_atomic, sanitized_ics, config_manager.config_file)
        logger.info("[config] ICS file uploaded and configuration updated: %s", ICS_STORAGE_PATH)
        _schedule_kiosk_refresh("calendar_ics_upload_manual")
    except (PermissionError, OSError) as exc:
        logger.error("[config] Failed to persist configuration after ICS upload: %s", exc)
        raise HTTPException(
            status_code=400,
            detail={"error": f"Failed to persist configuration: {str(exc)}", "missing": ["config.write"]},
        ) from exc

    secret_store.set_secret("calendar_ics_path", str(ICS_STORAGE_PATH))

    reloaded = reload_runtime_config(config_manager)
    if reloaded:
        global map_reset_counter
        map_reset_counter += 1
    _update_calendar_runtime_state("ics", True, "stale", None, str(ICS_STORAGE_PATH))
    calendar_state = _get_calendar_runtime_state()
    
    # Contar eventos en el archivo
    try:
        events = fetch_ics_calendar_events(path=str(ICS_STORAGE_PATH))
        events_count = len(events)
    except Exception:
        events_count = 0
    
    # Obtener metadatos del archivo guardado
    try:
        stat_info = ICS_STORAGE_PATH.stat()
        mtime_iso = datetime.fromtimestamp(stat_info.st_mtime, tz=timezone.utc).isoformat()
        file_size = stat_info.st_size
    except OSError:
        mtime_iso = datetime.now(timezone.utc).isoformat()
        file_size = len(content)

    response_payload = {
        "ok": True,
        "ics_path": str(ICS_STORAGE_PATH),
        "size": file_size,
    }

    return JSONResponse(content=response_payload, status_code=200)


@app.post("/api/calendar/ics/upload")
async def upload_calendar_ics_file(
    file: UploadFile = File(..., description="ICS calendar file"),
) -> Dict[str, Any]:
    """Sube un archivo ICS y lo guarda en disco de forma transaccional.
    
    Pasos:
    1. Guardar a tmp (/var/lib/pantalla-reloj/calendar/tmp/<uuid>.ics)
    2. Parsear con icalendar/ics para validar
    3. Mover a /var/lib/pantalla-reloj/calendar/current.ics de forma atómica
    4. Hacer PATCH merge seguro de config (calendar.enabled=true, source="ics", etc.)
    
    Returns:
        {ok: true, events_parsed: N, range_days: 14}
    """
    MAX_ICS_SIZE = 2 * 1024 * 1024  # 2 MB (configurable)
    
    # Validar extensión
    if file.filename and not file.filename.lower().endswith(".ics"):
        return {
            "ok": False,
            "error": "invalid_extension",
            "detail": "File must have .ics extension"
        }
    
    # Leer contenido
    try:
        content = await file.read()
    except Exception as exc:
        return {
            "ok": False,
            "error": "read_error",
            "detail": f"Cannot read file: {str(exc)}"
        }
    
    # Validar tamaño
    if len(content) == 0:
        return {
            "ok": False,
            "error": "empty_file",
            "detail": "File is empty"
        }
    
    if len(content) > MAX_ICS_SIZE:
        return {
            "ok": False,
            "error": "file_too_large",
            "detail": f"File size exceeds maximum ({MAX_ICS_SIZE} bytes)"
        }
    
    # Validar formato ICS básico
    try:
        _validate_ics_basic(content)
    except HTTPException as exc:
        return {
            "ok": False,
            "error": "invalid_ics",
            "detail": exc.detail.get("error", "Invalid ICS format") if isinstance(exc.detail, dict) else str(exc.detail)
        }
    
    # Crear directorio si no existe
    _ensure_ics_storage_directory()
    tmp_dir = ICS_STORAGE_DIR / "tmp"
    tmp_dir.mkdir(exist_ok=True)
    
    # Obtener UID/GID del propietario del config
    uid = gid = None
    try:
        stat_info = config_manager.config_file.stat()
        uid, gid = stat_info.st_uid, stat_info.st_gid
    except (FileNotFoundError, OSError):
        try:
            parent_stat = config_manager.config_file.parent.stat()
            uid, gid = parent_stat.st_uid, parent_stat.st_gid
        except OSError:
            pass
    
    # Paso 1: Guardar a tmp/<uuid>.ics
    tmp_file = tmp_dir / f"{uuid.uuid4().hex}.ics"
    try:
        with tmp_file.open("wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        
        # Ajustar permisos
        if uid is not None and gid is not None:
            try:
                os.chown(tmp_file, uid, gid)
            except OSError:
                pass
        try:
            os.chmod(tmp_file, 0o640)
        except OSError:
            pass
    except (OSError, PermissionError) as exc:
        return {
            "ok": False,
            "error": "io_error",
            "detail": f"Cannot write temporary ICS file: {str(exc)}"
        }
    
    # Paso 2: Parsear y validar ICS
    try:
        events = fetch_ics_calendar_events(path=str(tmp_file))
        events_count = len(events)
    except ICSCalendarError as exc:
        # Limpiar tmp file
        try:
            tmp_file.unlink()
        except OSError:
            pass
        return {
            "ok": False,
            "error": "invalid_ics",
            "detail": f"Invalid ICS file: {str(exc)}"
        }
    except Exception as exc:
        # Limpiar tmp file
        try:
            tmp_file.unlink()
        except OSError:
            pass
        return {
            "ok": False,
            "error": "parse_error",
            "detail": f"Cannot parse ICS file: {str(exc)}"
        }
    
    # Paso 3: Mover a current.ics de forma atómica
    current_ics_path = ICS_STORAGE_DIR / "current.ics"
    try:
        # Reemplazar atómicamente
        tmp_file.replace(current_ics_path)
        # Ajustar permisos del archivo final
        if uid is not None and gid is not None:
            try:
                os.chown(current_ics_path, uid, gid)
            except OSError:
                pass
        try:
            os.chmod(current_ics_path, 0o640)
        except OSError:
            pass
    except (OSError, PermissionError) as exc:
        # Limpiar tmp file si todavía existe
        try:
            if tmp_file.exists():
                tmp_file.unlink()
        except OSError:
            pass
        return {
            "ok": False,
            "error": "io_error",
            "detail": f"Cannot move ICS file to final location: {str(exc)}"
        }
    
    # Paso 4: PATCH merge seguro de config
    try:
        config = config_manager.read()
        config_data = config.model_dump(mode="json", exclude_unset=False)
        
        # Asegurar que calendar existe
        if "calendar" not in config_data:
            config_data["calendar"] = {}
        
        calendar_data = config_data["calendar"]
        
        # Merge seguro: solo actualizar campos específicos sin borrar otros
        calendar_data["enabled"] = True
        calendar_data["source"] = "ics"
        
        # Asegurar que ics existe
        if "ics" not in calendar_data:
            calendar_data["ics"] = {}
        
        ics_data = calendar_data["ics"]
        
        # Actualizar campos ICS sin borrar otros (merge seguro)
        ics_data["filename"] = "current.ics"
        ics_data["stored_path"] = str(current_ics_path)
        # Preservar max_events y days_ahead si existen, sino usar defaults
        if "max_events" not in ics_data:
            ics_data["max_events"] = 50
        if "days_ahead" not in ics_data:
            ics_data["days_ahead"] = 14
        ics_data["last_ok"] = datetime.now(timezone.utc).isoformat()
        ics_data["last_error"] = None
        # Preservar google si existe
        if "google" not in calendar_data:
            calendar_data["google"] = {}
        
        # Guardar configuración de forma atómica
        _persist_config(config_data, reason="calendar_ics_upload")
    except Exception as exc:
        logger.warning("[calendar] Failed to update config after ICS upload: %s", exc)
        # No fallar, el archivo ya está guardado
    
    # Obtener range_days de la config
    range_days = ics_data.get("days_ahead", 14) if "ics" in calendar_data else 14
    
    return {
        "ok": True,
        "events_parsed": events_count,
        "range_days": range_days
    }


@app.post("/api/calendar/ics/url")
async def set_calendar_ics_url(request: CalendarICSUrlRequest) -> Dict[str, Any]:
    """Configura una URL remota para cargar un calendario ICS.
    
    Descarga el archivo ICS desde la URL, lo valida y lo guarda en disco.
    """
    MAX_ICS_SIZE = 3 * 1024 * 1024  # 3 MB
    
    try:
        # CAMBIO: Descargar ICS desde URL asíncronamente
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(request.url)
        
        if response.status_code != 200:
            return {
                "ok": False,
                "error": "http_error",
                "detail": f"HTTP {response.status_code}"
            }
        
        content = response.content
        if len(content) > MAX_ICS_SIZE:
            return {
                "ok": False,
                "error": "file_too_large",
                "detail": f"File size exceeds maximum ({MAX_ICS_SIZE} bytes)"
            }
        
        # Validar formato ICS
        try:
            _validate_ics_basic(content)
        except HTTPException as exc:
            return {
                "ok": False,
                "error": "invalid_ics",
                "detail": exc.detail.get("error", "Invalid ICS format") if isinstance(exc.detail, dict) else str(exc.detail)
            }
        
        # Crear directorio si no existe
        _ensure_ics_storage_directory()
        
        # Obtener UID/GID del propietario del config
        uid = gid = None
        try:
            stat_info = config_manager.config_file.stat()
            uid, gid = stat_info.st_uid, stat_info.st_gid
        except (FileNotFoundError, OSError):
            try:
                parent_stat = config_manager.config_file.parent.stat()
                uid, gid = parent_stat.st_uid, parent_stat.st_gid
            except OSError:
                pass
        
        # Guardar archivo en thread (operación de disco bloqueante)
        def save_ics_file():
            with ICS_STORAGE_PATH.open("wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            
            # Ajustar permisos
            if uid is not None and gid is not None:
                try:
                    os.chown(ICS_STORAGE_PATH, uid, gid)
                except OSError:
                    pass
            try:
                os.chmod(ICS_STORAGE_PATH, 0o640)
            except OSError:
                pass
        
        try:
            await asyncio.to_thread(save_ics_file)
        except (OSError, PermissionError) as exc:
            return {
                "ok": False,
                "error": "write_error",
                "detail": f"Cannot write ICS file: {str(exc)}"
            }
        
        # Contar eventos en thread
        try:
            events = await asyncio.to_thread(fetch_ics_calendar_events, path=str(ICS_STORAGE_PATH))
            events_count = len(events)
        except Exception:
            events_count = 0
        
        # Actualizar configuración
        try:
            config = config_manager.read()
            config_data = config.model_dump(mode="json", exclude_none=True)
            
            # Actualizar calendar config
            if "calendar" not in config_data:
                config_data["calendar"] = {}
            
            config_data["calendar"]["enabled"] = True
            config_data["calendar"]["source"] = "ics"
            if "ics" not in config_data["calendar"]:
                config_data["calendar"]["ics"] = {}
            
            config_data["calendar"]["ics"]["mode"] = "url"
            config_data["calendar"]["ics"]["url"] = request.url
            config_data["calendar"]["ics"]["file_path"] = str(ICS_STORAGE_PATH)
            config_data["calendar"]["ics"]["last_ok"] = datetime.now(timezone.utc).isoformat()
            config_data["calendar"]["ics"]["last_error"] = None
            
            # Guardar configuración
            _persist_config(config_data, reason="calendar_ics_url")
        except Exception as exc:
            logger.warning("[calendar] Failed to update config after ICS URL set: %s", exc)
        
        return {
            "ok": True,
            "events": events_count
        }
    except requests.RequestException as exc:
        return {
            "ok": False,
            "error": "network_error",
            "detail": str(exc)
        }
    except Exception as exc:
        logger.error("[calendar] Error setting ICS URL: %s", exc)
        return {
            "ok": False,
            "error": "internal_error",
            "detail": str(exc)
        }


@app.post("/api/logs/client")
async def client_log(request: Request) -> Dict[str, Any]:
    """Registra logs del cliente (warnings/errors) para verlos en journalctl."""
    try:
        body = await request.json()
        ts = body.get("ts")
        where = body.get("where", "unknown")
        msg = body.get("msg", "")
        level = body.get("level", "warning")
        
        # Log al logger del backend (se verá en journalctl)
        log_msg = f"[client:{where}] {msg}"
        if level == "error":
            logger.error(log_msg)
        elif level == "warning":
            logger.warning(log_msg)
        else:
            logger.info(log_msg)
        
        return {"ok": True}
    except Exception as exc:
        logger.warning("[logs] Failed to process client log: %s", exc)
        return {"ok": False, "error": str(exc)}


@app.post("/api/config/reset-map-view")
def reset_map_view() -> Dict[str, Any]:
    """Resetea la vista del mapa a los valores por defecto de España."""
    logger.info("[config] Reset map view requested via /api/config/reset-map-view")
    try:
        config = config_manager.read()
        
        # Valores por defecto para España (Madrid centrado, zoom para ver toda la península)
        default_fixed = {
            "center": {
                "lat": 40.4637,
                "lon": -3.7492
            },
            "zoom": 5.5,
            "bearing": 0,
            "pitch": 0
        }
        
        # Convertir config a dict para modificar
        config_dict = config.model_dump(mode="json", exclude_none=True)
        
        # Asegurar que ui_map existe
        if "ui_map" not in config_dict:
            config_dict["ui_map"] = {}
        
        # Actualizar fixed
        config_dict["ui_map"]["fixed"] = default_fixed
        
        # Guardar la configuración actualizada
        config_manager.write(config_dict)
        
        # Recargar para aplicar cambios
        config_manager.reload()
        
        global map_reset_counter
        map_reset_counter += 1
        
        return {
            "success": True,
            "message": "Map view reset to Spain defaults",
            "fixed": default_fixed
        }
    except Exception as exc:
        logger.error("[config] Error resetting map view: %s", exc)
        return {
            "success": False,
            "message": f"Error: {exc}"
        }


@app.post("/api/config/reload")
def reload_config() -> Dict[str, Any]:
    """Recarga la configuración desde el archivo efectivo sin reiniciar el servicio."""
    logger.info("[config] Reload requested via /api/config/reload")
    try:
        config, was_reloaded = config_manager.reload()
        # Firmar URLs de MapTiler después de recargar
        sign_maptiler_urls(config)
        if was_reloaded:
            metadata = config_manager.get_config_metadata()
            logger.info("[config] Config reloaded successfully from %s", metadata["config_path"])
            # Incrementar contador para notificar al frontend
            global map_reset_counter
            map_reset_counter += 1
            # Inicializar/actualizar servicios según nueva configuración
            _ensure_blitzortung_service(config)
            return {
                "success": True,
                "message": "Config reloaded successfully",
                "config_path": metadata["config_path"],
                "config_loaded_at": metadata["config_loaded_at"],
            }
        else:
            logger.warning("[config] Reload requested but config was not reloaded (check logs)")
            return {
                "success": False,
                "message": "Config reload failed (check logs for details)",
                "config_path": config_manager.config_path_used,
                "config_loaded_at": config_manager.config_loaded_at,
            }
    except Exception as exc:  # noqa: BLE001
        logger.error("[config] Unexpected error during reload: %s", exc)
        return {
            "success": False,
            "message": f"Unexpected error: {exc}",
            "config_path": config_manager.config_path_used,
        }


def _health_payload_full_helper() -> Dict[str, Any]:
    """Helper para health full que lee config adicional."""
    payload = _health_payload()
    
    # Agregar información de configuración (config_source y checksum)
    import hashlib
    try:
        config_raw = read_json(CONFIG_PATH)
        config_str = json.dumps(config_raw, sort_keys=True)
        config_checksum = hashlib.sha256(config_str.encode("utf-8")).hexdigest()
        config_source = "disk"
    except FileNotFoundError:
        config_checksum = None
        config_source = "defaults"
    except Exception as e:
        logger.warning("[health] Failed to compute config checksum: %s", e)
        config_checksum = None
        config_source = "error"
    
    payload["config_source"] = config_source
    payload["config_checksum"] = config_checksum
    
    config = config_manager.read()
    
    # Safe OpenSky config access
    opensky_cfg = config.opensky
    opensky_enabled = opensky_cfg.enabled if opensky_cfg else False
    opensky_mode = opensky_cfg.mode if opensky_cfg else "bbox"
    opensky_bbox = opensky_cfg.bbox.model_dump() if opensky_cfg and opensky_cfg.bbox else {}

    opensky_status = opensky_service.get_status(config)
    snapshot = opensky_service.get_last_snapshot()
    last_fetch_iso = opensky_status.get("last_fetch_iso")
    last_fetch_ts = opensky_status.get("last_fetch_ts")
    last_fetch_age = int(time.time() - last_fetch_ts) if last_fetch_ts else None
    items_count = 0
    if snapshot and isinstance(snapshot.payload.get("count"), int):
        items_count = int(snapshot.payload["count"])

    auth_details = opensky_status.get("auth")
    if not isinstance(auth_details, dict):
        auth_details = {
            "has_credentials": opensky_status.get("has_credentials"),
            "token_cached": opensky_status.get("token_cached"),
            "expires_in_sec": opensky_status.get("expires_in"),
        }
    # Si falta auth, usar "stale" en lugar de "error"
    status_value = opensky_status.get("status", "stale")
    if status_value == "error" and not bool(auth_details.get("has_credentials", False)):
        status_value = "stale"
    opensky_block = {
        "enabled": opensky_enabled,
        "mode": opensky_mode,
        "effective_poll": opensky_status.get("effective_poll"),
        "configured_poll": opensky_status.get("configured_poll"),
        "has_credentials": auth_details.get("has_credentials"),
        "token_cached": auth_details.get("token_cached"),
        "expires_in_sec": auth_details.get("expires_in_sec"),
        "status": status_value,
        "last_fetch_ok": opensky_status.get("last_fetch_ok"),
        "last_fetch": last_fetch_iso,
        "last_fetch_age": last_fetch_age,
        "last_error": opensky_status.get("last_error"),
        "backoff_active": opensky_status.get("backoff_active"),
        "backoff_seconds": opensky_status.get("backoff_seconds"),
        "rate_limit_hint": opensky_status.get("rate_limit_hint"),
        "items_count": items_count,
        "bbox": opensky_bbox,
    }
    payload["opensky"] = opensky_block

    flights_status = "down"
    if opensky_enabled:
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
    ships_config = config.layers.ships if config.layers else None
    ships_enabled = ships_config.enabled if ships_config else False
    ships_provider = ships_config.provider if ships_config else "aisstream"
    
    ships_cached = cache_store.load("ships", max_age_minutes=None)
    ships_status = "down"
    ships_last_fetch = None
    ships_cache_age = None
    ships_items_count = 0
    
    if ships_enabled:
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
        "provider": ships_provider,
        "enabled": ships_enabled,
        "runtime": ships_service.get_status(),
    }

    # Resumen de integraciones y proveedores
    runtime = ships_service.get_status()
    payload.setdefault("integrations", {})
    payload.setdefault("providers", {})
    
    # Weather layers integration (RainViewer, GIBS, CAP)
    try:
        weather_layers = None
        if config.ui_global:
            weather_layers = getattr(config.ui_global, "weather_layers", None)
        
        payload["integrations"]["weather_layers"] = {
            "radar": {
                "enabled": bool(weather_layers and weather_layers.radar and weather_layers.radar.enabled),
                "provider": "rainviewer"
            },
            "satellite": {
                "enabled": bool(weather_layers and weather_layers.satellite and weather_layers.satellite.enabled),
                "provider": "gibs"
            },
            "alerts": {
                "enabled": bool(weather_layers and weather_layers.alerts and weather_layers.alerts.enabled),
                "provider": "cap_aemet"
            }
        }
    except Exception:
        payload["integrations"]["weather_layers"] = {
            "radar": {"enabled": False, "provider": "rainviewer"},
            "satellite": {"enabled": False, "provider": "gibs"},
            "alerts": {"enabled": False, "provider": "cap_aemet"}
        }
    
    # OpenSky integration
    opensky_status = opensky_service.get_status(config)
    payload["integrations"]["opensky"] = {
        "enabled": opensky_enabled,
        "has_credentials": bool(opensky_status.get("has_credentials")),
        "token_cached": bool(opensky_status.get("token_cached")),
        "expires_in_sec": opensky_status.get("expires_in_sec"),
        "status": opensky_status.get("status", "stale"),
        "last_error": opensky_status.get("last_error") or _opensky_last_error,
        "last_fetch_ok": opensky_status.get("last_fetch_ok"),
    }
    
    # Ships integration
    payload["integrations"]["ships"] = {
        "enabled": ships_enabled,
        "provider": ships_provider,
        "last_fetch_ok": bool(runtime.get("ws_connected") and runtime.get("buffer_size", 0) > 0)
        if ships_provider == "aisstream"
        else (ships_status == "ok"),
        "last_error": runtime.get("last_error"),
        "items_count": int(ships_items_count),
    }
    
    # Blitzortung / Lightning
    try:
        blitz_config = getattr(config, "blitzortung", None)
        blitz_enabled = blitz_config and getattr(blitz_config, "enabled", False) if blitz_config else False
        blitz_status = "down"
        blitz_error = None
        blitz_items = 0
        
        if blitzortung_service and blitz_enabled:
            with _blitzortung_lock:
                strikes = blitzortung_service.get_all_strikes()
                blitz_items = len(strikes)
                if blitzortung_service.running:
                    blitz_status = "ok"
                else:
                    blitz_status = "degraded"
        
        payload["providers"]["blitzortung"] = {
            "enabled": blitz_enabled,
            "status": blitz_status,
            "items_count": blitz_items,
            "last_error": blitz_error,
        }
    except Exception as exc:
        logger.debug("[health] Error getting blitzortung status: %s", exc)
        payload["providers"]["blitzortung"] = {
            "enabled": False,
            "status": "down",
            "items_count": 0,
            "last_error": None,
        }
    
    # GIBS Satellite
    try:
        if config.layers and config.layers.global_ and config.layers.global_.satellite:
            gibs_config = config.layers.global_.satellite
            gibs_enabled = gibs_config.enabled
            gibs_status = "ok" if gibs_enabled else "down"
        elif config.ui_global and config.ui_global.satellite:
            gibs_config = config.ui_global.satellite
            gibs_enabled = gibs_config.enabled
            gibs_status = "ok" if gibs_enabled else "down"
        else:
            gibs_enabled = False
            gibs_status = "down"
        
        payload["providers"]["gibs"] = {
            "enabled": gibs_enabled,
            "status": gibs_status,
            "provider": "gibs",
        }
    except Exception as exc:
        logger.debug("[health] Error getting GIBS status: %s", exc)
        payload["providers"]["gibs"] = {
            "enabled": False,
            "status": "down",
            "provider": "gibs",
        }
    
    # RainViewer Radar
    try:
        # Prioridad: weather_layers.radar > ui_global.radar > layers.global_.radar
        radar_enabled = False
        if config.ui_global and config.ui_global.weather_layers and config.ui_global.weather_layers.radar:
            radar_enabled = config.ui_global.weather_layers.radar.enabled
        elif config.ui_global and config.ui_global.radar:
            radar_enabled = config.ui_global.radar.enabled
        elif config.layers and config.layers.global_ and config.layers.global_.radar:
            radar_enabled = config.layers.global_.radar.enabled
        
        radar_status = "ok" if radar_enabled else "down"
        
        payload["providers"]["rainviewer"] = {
            "enabled": radar_enabled,
            "status": radar_status,
            "provider": "rainviewer",
        }
    except Exception as exc:
        logger.debug("[health] Error getting RainViewer status: %s", exc)
        payload["providers"]["rainviewer"] = {
            "enabled": False,
            "status": "down",
            "provider": "rainviewer",
        }
    
    # Calendar
    try:
        if config.calendar:
            calendar_config = config.calendar
            calendar_enabled = calendar_config.enabled
            calendar_provider = calendar_config.source or "google"
            calendar_status = "ok" if calendar_enabled else "down"
        elif config.panels and config.panels.calendar:
            calendar_config = config.panels.calendar
            calendar_enabled = calendar_config.enabled
            calendar_provider = calendar_config.provider or "google"
            calendar_status = "ok" if calendar_enabled else "down"
        else:
            calendar_enabled = False
            calendar_provider = "google"
            calendar_status = "down"
        
        payload["providers"]["calendar"] = {
            "enabled": calendar_enabled,
            "status": calendar_status,
            "provider": calendar_provider,
        }
    except Exception as exc:
        logger.debug("[health] Error getting calendar status: %s", exc)
        payload["providers"]["calendar"] = {
            "enabled": False,
            "status": "down",
            "provider": "unknown",
        }
    
    # News
    try:
        if config.panels and config.panels.news:
            news_config = config.panels.news
            news_enabled = news_config.enabled
            news_feeds_count = len(news_config.feeds) if news_config.feeds else 0
            news_status = "ok" if news_enabled and news_feeds_count > 0 else "down"
        else:
            news_enabled = False
            news_feeds_count = 0
            news_status = "down"
        
        payload["providers"]["news"] = {
            "enabled": news_enabled,
            "status": news_status,
            "feeds_count": news_feeds_count,
        }
    except Exception as exc:
        logger.debug("[health] Error getting news status: %s", exc)
        payload["providers"]["news"] = {
            "enabled": False,
            "status": "down",
            "feeds_count": 0,
        }
    
    # Últimos errores globales
    last_errors = []
    try:
        if _opensky_last_error:
            last_errors.append({
                "provider": "opensky",
                "error": _opensky_last_error,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        if opensky_status.get("last_error"):
            last_errors.append({
                "provider": "opensky",
                "error": opensky_status.get("last_error"),
                "timestamp": opensky_status.get("last_fetch_iso") or datetime.now(timezone.utc).isoformat()
            })
        if runtime.get("last_error"):
            last_errors.append({
                "provider": "ships",
                "error": runtime.get("last_error"),
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
    except Exception as exc:
        logger.debug("[health] Error collecting last errors: %s", exc)
    
    payload["last_errors"] = last_errors[:10]  # Limitar a últimos 10 errores
    
    # Información de focus masks
    # Modo Cine eliminado en v2: no aplicar lógica de cine_focus
    focus_status = "down"
    focus_last_build = None
    focus_source = None
    focus_area_km2 = None
    focus_cache_age = None
    
    payload["focus"] = {
        "status": focus_status,
        "last_build": focus_last_build,
        "source": focus_source,
        "area_km2": focus_area_km2,
        "cache_age": focus_cache_age
    }
    
    # Información de global layers
    global_config = getattr(config.layers, "global_", None)
    
    # Global Satellite
    global_sat_status = "down"
    global_sat_frames_count = 0
    global_sat_last_fetch = None
    global_sat_cache_age = None
    
    if global_config and global_config.satellite.enabled:
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
    global_radar_last_error = None
    
    # Determinar si el radar está habilitado considerando todas las fuentes
    # Prioridad: weather_layers.radar > ui_global.radar > layers.global_.radar
    radar_enabled_global = False
    radar_config_global = None
    radar_provider = "rainviewer"
    radar_history_minutes = 90
    radar_frame_step = 5
    
    if config.ui_global and config.ui_global.weather_layers and config.ui_global.weather_layers.radar:
        radar_config_global = config.ui_global.weather_layers.radar
        radar_enabled_global = radar_config_global.enabled
        radar_provider = getattr(radar_config_global, "provider", "rainviewer")
        radar_history_minutes = getattr(radar_config_global, "history_minutes", 90)
        radar_frame_step = getattr(radar_config_global, "frame_step", 5)
    elif config.ui_global and config.ui_global.radar:
        radar_config_global = config.ui_global.radar
        radar_enabled_global = radar_config_global.enabled
        radar_provider = getattr(radar_config_global, "provider", "rainviewer")
        radar_history_minutes = getattr(radar_config_global, "history_minutes", 90)
        radar_frame_step = getattr(radar_config_global, "frame_step", 5)
    elif global_config and global_config.radar:
        radar_config_global = global_config.radar
        radar_enabled_global = global_config.radar.enabled
        radar_provider = global_config.radar.provider
        radar_history_minutes = global_config.radar.history_minutes
        radar_frame_step = global_config.radar.frame_step

    if radar_enabled_global:
        if radar_provider == "openweathermap":
            layer_type = getattr(radar_config_global, "layer_type", "precipitation_new") if radar_config_global else "precipitation_new"
            openweather_provider = _get_openweather_provider(layer_type)
            api_key = openweather_provider.resolve_api_key()
            if not api_key:
                global_radar_last_error = "OWM API key missing"
                global_radar_status = "down"
            else:
                try:
                    frames = openweather_provider.get_available_frames(
                        history_minutes=radar_history_minutes,
                        frame_step=radar_frame_step,
                    )
                    if frames:
                        global_radar_status = "ok"
                        global_radar_frames_count = len(frames)
                        latest_frame = frames[-1]
                        timestamp = latest_frame.get("timestamp")
                        if isinstance(timestamp, (int, float)):
                            global_radar_last_fetch = datetime.fromtimestamp(
                                int(timestamp), tz=timezone.utc
                            ).isoformat()
                        else:
                            global_radar_last_fetch = datetime.now(timezone.utc).isoformat()
                    else:
                        global_radar_status = "degraded"
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Failed to get OpenWeatherMap radar status: %s", exc)
                    global_radar_status = "degraded"
                    global_radar_last_error = str(exc)
        else:
            # Verificar si RainViewer está marcado como down (403 detectado)
            try:
                from .routes import rainviewer
                if rainviewer.is_rainviewer_down():
                    global_radar_status = "down"
                    global_radar_last_error = "RainViewer tiles returning 403 (Forbidden)"
                    logger.debug("[health] RainViewer marked as down due to 403 detection")
                else:
                    frames = _rainviewer_provider.get_available_frames(
                        history_minutes=radar_history_minutes,
                        frame_step=radar_frame_step
                    )
                    if frames:
                        global_radar_status = "ok"
                        global_radar_frames_count = len(frames)
                        latest_frame = frames[-1]
                        timestamp = latest_frame.get("timestamp")
                        if isinstance(timestamp, (int, float)):
                            global_radar_last_fetch = datetime.fromtimestamp(
                                int(timestamp), tz=timezone.utc
                            ).isoformat()
                    else:
                        global_radar_status = "degraded"
            except (ImportError, AttributeError):
                # Si no se puede importar o la función no existe, intentar obtener frames normalmente
                try:
                    frames = _rainviewer_provider.get_available_frames(
                        history_minutes=radar_history_minutes,
                        frame_step=radar_frame_step
                    )
                    if frames:
                        global_radar_status = "ok"
                        global_radar_frames_count = len(frames)
                        latest_frame = frames[-1]
                        timestamp = latest_frame.get("timestamp")
                        if isinstance(timestamp, (int, float)):
                            global_radar_last_fetch = datetime.fromtimestamp(
                                int(timestamp), tz=timezone.utc
                            ).isoformat()
                    else:
                        global_radar_status = "degraded"
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Failed to get global radar status: %s", exc)
                    global_radar_status = "degraded"
                    global_radar_last_error = str(exc)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to get global radar status: %s", exc)
                global_radar_status = "degraded"
                global_radar_last_error = str(exc)

    payload["global_radar"] = {
        "status": global_radar_status,
        "frames_count": global_radar_frames_count,
        "provider": radar_provider,
        "last_fetch": global_radar_last_fetch,
        "cache_age": global_radar_cache_age,
        "last_error": global_radar_last_error,
    }
    
    # Reportar proveedores de mapa (maptiler_provider, backend_provider, ui_provider_runtime)
    # Estos campos siempre deben tener un valor, nunca null
    try:
        map_provider = config.ui_map.provider
        if not map_provider or map_provider == "":
            map_provider = "local_raster_xyz"
        payload["maptiler_provider"] = str(map_provider)
        payload["backend_provider"] = str(map_provider)
        payload["ui_provider_runtime"] = str(map_provider)
    except Exception as exc:
        logger.debug("[health] Error getting map provider: %s", exc)
        payload["maptiler_provider"] = "unknown"
        payload["backend_provider"] = "unknown"
        payload["ui_provider_runtime"] = "unknown"
    
    # Estado del mapa (MapTiler)
    # Información sobre el estilo del mapa para diagnóstico
    try:
        ui_map = config.ui_map
        maptiler_config = ui_map.maptiler if ui_map else None
        
        map_status = "ok"
        map_style = None
        map_styleUrl_ok = False
        map_style_bytes = None
        map_error = None
        
        if ui_map and ui_map.provider == "maptiler_vector" and maptiler_config:
            map_style = maptiler_config.style or "unknown"
            style_url = maptiler_config.styleUrl
            
            if style_url:
                # Validar el estilo (con timeout y caché para no abusar de MapTiler)
                validation_result = _validate_maptiler_style(style_url)
                map_styleUrl_ok = validation_result.get("ok", False)
                map_style_bytes = validation_result.get("bytes") if map_styleUrl_ok else None
                
                if not map_styleUrl_ok:
                    map_status = "error"
                    map_error = validation_result.get("error", "Style validation failed")
            else:
                map_status = "error"
                map_error = "Missing styleUrl"
        elif ui_map and ui_map.provider != "maptiler_vector":
            # Para otros proveedores, considerar ok
            map_status = "ok"
            map_style = ui_map.provider or "unknown"
        else:
            map_status = "unknown"
            map_error = "Map configuration not available"
        
        payload["maps"] = {
            "provider": str(ui_map.provider) if ui_map else "unknown",
            "style": map_style,
            "styleUrl_ok": map_styleUrl_ok,
            "style_bytes": map_style_bytes,
            "status": map_status,
            "error": map_error
        }
    except Exception as exc:
        logger.debug("[health] Error getting map status: %s", exc)
        payload["maps"] = {
            "provider": "unknown",
            "style": None,
            "styleUrl_ok": False,
            "style_bytes": None,
            "status": "error",
            "error": str(exc)
        }
    
    return payload


@app.post("/api/providers/opensky/refresh")
def opensky_manual_refresh() -> Dict[str, Any]:
    """Fuerza la renovación del token OAuth y un fetch inmediato de OpenSky."""

    logger.info("Manual OpenSky refresh requested")
    config = config_manager.read()
    try:
        result = opensky_service.force_refresh(config)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Manual OpenSky refresh failed unexpectedly: %s", exc)
        mode = getattr(config.opensky, "mode", "bbox") if hasattr(config, "opensky") else "bbox"
        return {
            "auth": {"token_cached": False, "expires_in_sec": None},
            "fetch": {
                "status": "error",
                "items": 0,
                "ts": datetime.now(timezone.utc).isoformat(),
                "mode": mode,
            },
            "error": "unexpected_refresh_error",
        }
    return result


@app.get("/api/config")
def get_config(request: Request) -> JSONResponse:
    """
    Obtiene la configuración exactamente como está en disco.
    NO reinyecta defaults para evitar resetear valores.
    """
    logger.info("Fetching configuration from disk")
    
    # Leer JSON crudo de disco (única fuente de verdad)
    try:
        disk_config = read_json(CONFIG_PATH)
    except FileNotFoundError:
        logger.warning("[config] Config file not found, returning defaults")
        disk_config = config_manager._default_config_model().model_dump(mode="json", exclude_none=True)
    except Exception as e:
        logger.error("[config] Failed to read config from disk: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read config from disk: {str(e)}"
        )
    
    # Agregar headers anti-cache
    from datetime import datetime
    try:
        config_mtime = config_manager.config_file.stat().st_mtime
        config_etag = f'"{config_mtime}"'
    except OSError:
        config_mtime = datetime.now().timestamp()
        config_etag = f'"{config_mtime}"'
    
    # Verificar si el cliente tiene una versión en caché
    cache_control_req = request.headers.get("cache-control", "").lower()
    if "no-cache" in cache_control_req or "no-store" in cache_control_req:
        if_none_match = None
    else:
        if_none_match = request.headers.get("if-none-match")

    if if_none_match == config_etag:
        return Response(status_code=304)  # Not Modified
    
    # Construir respuesta usando config_manager
    config = None
    try:
        config = config_manager.read()
        # Firmar URLs de MapTiler antes de serializar
        sign_maptiler_urls(config)
        public_config = config.model_dump(mode="json", exclude_none=True)
    except Exception as e:
        logger.warning("[config] Error building public config: %s", e)
        public_config = disk_config
    
    # Añadir metadatos de configuración
    config_metadata = config_manager.get_config_metadata()
    public_config["config_path"] = config_metadata.get("config_path", str(config_manager.config_file))
    public_config["config_source"] = config_metadata.get("config_source", "file")
    public_config["has_timezone"] = config_metadata.get("has_timezone", False)
    
    # Añadir información de calendario (provider y estructura top-level)
    panels_calendar = None
    if config and config.panels and config.panels.calendar:
        panels_calendar = config.panels.calendar
    top_calendar = getattr(config, "calendar", None)

    calendar_enabled = False
    calendar_provider = "google"
    calendar_ics_path: Optional[str] = None

    if top_calendar:
        calendar_enabled = getattr(top_calendar, "enabled", calendar_enabled)
        calendar_provider = getattr(top_calendar, "provider", calendar_provider)
        calendar_ics_path = getattr(top_calendar, "ics_path", None)
    elif panels_calendar:
        calendar_enabled = getattr(panels_calendar, "enabled", calendar_enabled)
        calendar_provider = getattr(panels_calendar, "provider", calendar_provider)
        calendar_ics_path = getattr(panels_calendar, "ics_path", None)

    # Fallback a panel si top-level no tiene ics_path
    if calendar_provider == "ics" and not calendar_ics_path and panels_calendar:
        calendar_ics_path = getattr(panels_calendar, "ics_path", None)

    panels_block = public_config.setdefault("panels", {})
    panel_payload = {
        "enabled": calendar_enabled,
        "provider": calendar_provider,
    }
    if calendar_provider == "ics" and calendar_ics_path:
        panel_payload["ics_path"] = calendar_ics_path
    panels_block["calendar"] = panel_payload

    public_calendar = {
        "enabled": calendar_enabled,
        "provider": calendar_provider,
    }
    if calendar_provider == "ics" and calendar_ics_path:
        public_calendar["ics_path"] = calendar_ics_path
    public_config["calendar"] = public_calendar

    stored_opensky_id = secret_store.get_secret("opensky_client_id")
    stored_opensky_secret = secret_store.get_secret("opensky_client_secret")
    
    # Determinar si OpenSky está efectivamente habilitado
    # Si layers.flights está habilitado con provider opensky, considerar OpenSky habilitado
    # incluso si opensky.enabled es False o undefined
    layers = getattr(config, "layers", None)
    flights_config = getattr(layers, "flights", None) if layers else None
    flights_enabled_with_opensky = (
        flights_config and 
        flights_config.enabled and 
        flights_config.provider == "opensky"
    )
    opensky_cfg = getattr(config, "opensky", None)
    opensky_enabled_effective = (
        getattr(opensky_cfg, "enabled", False) is not False or 
        flights_enabled_with_opensky
    )
    
    public_config["opensky"] = {
        "enabled": opensky_enabled_effective,
        "oauth2": {
            "has_credentials": bool(stored_opensky_id and stored_opensky_secret),
            "client_id_last4": (
                stored_opensky_id[-4:]
                if stored_opensky_id and len(stored_opensky_id) >= 4
                else stored_opensky_id
            ),
            "token_url": DEFAULT_TOKEN_URL,
            "scope": None,
        }
    }

    # Añadir secrets.calendar_ics (solo estructura, sin valores sensibles)
    public_config.setdefault("secrets", {}).setdefault("calendar_ics", {})
    
    # Unificar configuración de satélite global: asegurar que layers.global_satellite exista
    # (además de layers.global_.satellite para compatibilidad)
    try:
        layers_block = public_config.setdefault("layers", {})
        global_block = layers_block.get("global_") or layers_block.get("global")
        
        # Resolver configuración efectiva de GIBS
        gibs_config, _ = _resolve_gibs_config()
        
        # Construir objeto global_satellite unificado
        # FORZADO: Siempre desactivado para vista principal (solo streets-v4)
        global_satellite_config = {
            "enabled": False,  # FORZADO: siempre false para vista principal
            "provider": gibs_config.provider,
            "refresh_minutes": gibs_config.refresh_minutes,
            "history_minutes": gibs_config.history_minutes,
            "frame_step": gibs_config.frame_step,
            "layer": gibs_config.layer,
            "tile_matrix_set": gibs_config.tile_matrix_set,
            "min_zoom": gibs_config.min_zoom,
            "max_zoom": gibs_config.max_zoom,
            "default_zoom": gibs_config.default_zoom,
            "gibs": {
                "epsg": gibs_config.epsg,
                "tile_matrix_set": gibs_config.tile_matrix_set,
                "layer": gibs_config.layer,
                "format_ext": gibs_config.format_ext,
                "time_mode": gibs_config.time_mode,
                "time_value": gibs_config.time_value,
            }
        }
        
        # Añadir layers.global_satellite para que el frontend lo encuentre
        layers_block["global_satellite"] = global_satellite_config
        
        # También asegurar que layers.global_.satellite existe (para compatibilidad)
        if global_block:
            if isinstance(global_block, dict):
                if "satellite" not in global_block:
                    global_block["satellite"] = global_satellite_config
            layers_block["global_"] = global_block
        else:
            layers_block["global_"] = {"satellite": global_satellite_config}
            
    except Exception as exc:
        logger.warning("[config] Failed to unify global_satellite config: %s", exc)
        # En caso de error, al menos añadir un objeto vacío
        public_config.setdefault("layers", {}).setdefault("global_satellite", None)
    
    response = JSONResponse(content=public_config)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["ETag"] = config_etag
    response.headers["Last-Modified"] = datetime.fromtimestamp(config_mtime).strftime("%a, %d %b %Y %H:%M:%S GMT")
    
    return response


@app.get("/api/config/stream")
async def stream_config_events(request: Request) -> StreamingResponse:
    """
    Endpoint SSE para recibir eventos de cambios de configuración.
    Emite eventos config_changed cuando la configuración cambia.
    """
    import asyncio
    
    async def event_generator():
        """Generador de eventos SSE."""
        queue = None
        try:
            # Suscribirse al bus de eventos
            queue = await subscribe()
            
            # Enviar evento inicial de conexión
            yield f"data: {json.dumps({'type': 'connected', 'ts': int(datetime.now(timezone.utc).timestamp())})}\n\n"
            
            # Heartbeat cada 25 segundos
            last_heartbeat = datetime.now(timezone.utc)
            heartbeat_interval = 25
            
            while True:
                # Verificar si el cliente se desconectó
                if await request.is_disconnected():
                    logger.info("[config-events] Cliente desconectado")
                    break
                
                try:
                    # Esperar evento con timeout para permitir heartbeats
                    event = await asyncio.wait_for(queue.get(), timeout=1.0)
                    
                    # Formatear como SSE
                    event_json = json.dumps(event)
                    yield f"data: {event_json}\n\n"
                    
                    # Resetear timer de heartbeat
                    last_heartbeat = datetime.now(timezone.utc)
                    
                except asyncio.TimeoutError:
                    # Enviar heartbeat si pasó el intervalo
                    now = datetime.now(timezone.utc)
                    elapsed = (now - last_heartbeat).total_seconds()
                    if elapsed >= heartbeat_interval:
                        if await send_heartbeat(queue):
                            last_heartbeat = now
                            yield f"data: {json.dumps({'type': 'heartbeat', 'ts': int(now.timestamp())})}\n\n"
                    continue
                except Exception as e:
                    logger.error("[config-events] Error en generador de eventos: %s", e)
                    break
                    
        except Exception as e:
            logger.error("[config-events] Error en stream SSE: %s", e)
        finally:
            # Desuscribirse al salir
            if queue:
                await unsubscribe(queue)
                logger.info("[config-events] Cliente desuscrito")
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Accel-Buffering": "no",  # Para Nginx
        }
    )


@app.get("/api/config/meta")
def get_config_meta() -> JSONResponse:
    """Obtiene solo metadatos de configuración (config_version, config_loaded_at) para hot-reload.
    
    Returns:
        {config_version: int, config_loaded_at: str | null, config_path: str, config_source: str}
    """
    config_metadata = config_manager.get_config_metadata()
    return JSONResponse(content={
        "config_version": map_reset_counter,
        "config_loaded_at": config_metadata.get("config_loaded_at"),
        "config_path": config_metadata.get("config_path"),
        "config_source": config_metadata.get("config_source"),
    })


MAX_CONFIG_PAYLOAD_BYTES = 64 * 1024


_CONFIG_METADATA_KEYS = {
    "config_path",
    "config_source",
    "config_loaded_at",
    "has_timezone",
}


def _sanitize_incoming_config_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Remove metadata keys that should not be persisted."""
    ignored_keys = [key for key in payload.keys() if key in _CONFIG_METADATA_KEYS]
    if ignored_keys:
        logger.warning(
            "[config] Ignoring ephemeral fields from payload: %s",
            ", ".join(sorted(ignored_keys)),
        )
    return {key: value for key, value in payload.items() if key not in _CONFIG_METADATA_KEYS}


def _normalize_calendar_sections(payload: Dict[str, Any]) -> Tuple[str, bool, Optional[str]]:
    """Normalize calendar config between top-level and panels calendar blocks."""

    panels_raw = payload.get("panels")
    panels: Dict[str, Any]
    if isinstance(panels_raw, dict):
        panels = dict(panels_raw)
    else:
        panels = {}
    payload["panels"] = panels

    panel_calendar_raw = panels.get("calendar") if isinstance(panels, dict) else None
    panel_calendar = dict(panel_calendar_raw) if isinstance(panel_calendar_raw, dict) else {}

    calendar_raw = payload.get("calendar")
    top_calendar = dict(calendar_raw) if isinstance(calendar_raw, dict) else {}

    provider_value = (
        top_calendar.get("source")
        or top_calendar.get("provider")
        or panel_calendar.get("source")
        or panel_calendar.get("provider")
        or "google"
    )
    provider = provider_value.strip().lower() if isinstance(provider_value, str) else "google"
    if provider == "disabled":
        top_calendar["enabled"] = False
        panel_calendar["enabled"] = False
        provider = "google"
    if provider not in {"google", "ics"}:
        provider = "google"

    enabled_value = top_calendar.get("enabled")
    if enabled_value is None:
        enabled_value = panel_calendar.get("enabled")
    enabled = bool(enabled_value) if enabled_value is not None else False

    ics_path_value = top_calendar.get("ics_path") or panel_calendar.get("ics_path")
    ics_path = None
    if isinstance(ics_path_value, str):
        candidate = ics_path_value.strip()
        if candidate:
            ics_path = candidate

    normalized_panel = {
        "enabled": enabled,
        "provider": provider,
        "source": provider,
    }
    normalized_top = {
        "enabled": enabled,
        "provider": provider,
        "source": provider,
    }

    if provider == "ics" and ics_path:
        normalized_panel["ics_path"] = ics_path
        normalized_top["ics_path"] = ics_path

    panels["calendar"] = normalized_panel
    payload["calendar"] = normalized_top

    return provider, enabled, ics_path


def _resolve_calendar_settings(config: AppConfig) -> Tuple[str, bool, Optional[str]]:
    """Return provider, enabled flag and ICS path for current calendar configuration."""

    provider = "google"
    enabled = False
    ics_path = None

    if getattr(config, "calendar", None):
        provider_candidate = getattr(config.calendar, "source", None)
        if isinstance(provider_candidate, str):
            provider = provider_candidate.strip().lower() or provider
        enabled = getattr(config.calendar, "enabled", enabled)
        ics_path = getattr(config.calendar, "ics_path", None)

    panels_calendar = (
        config.panels.calendar if config.panels and config.panels.calendar else None
    )
    if not getattr(config, "calendar", None) and panels_calendar:
        provider_candidate = (
            getattr(panels_calendar, "source", None)
        )
        if isinstance(provider_candidate, str):
            provider = provider_candidate.strip().lower() or provider
        enabled = getattr(panels_calendar, "enabled", enabled)
        ics_path = getattr(panels_calendar, "ics_path", None)
    elif getattr(config, "calendar", None) and provider == "ics" and not ics_path and panels_calendar:
        ics_path = getattr(panels_calendar, "ics_path", None)

    if provider == "disabled":
        enabled = False
        provider = "google"

    if provider not in {"google", "ics"}:
        provider = "google"

    if isinstance(ics_path, str):
        ics_path = ics_path.strip() or None

    return provider, enabled, ics_path


def _ics_path_is_readable(ics_path: Optional[str]) -> bool:
    if not ics_path or not str(ics_path).strip():
        return False
    path_obj = Path(str(ics_path).strip())
    if not path_obj.exists() or not path_obj.is_file():
        return False
    try:
        with path_obj.open("rb") as handle:
            handle.read(1)
    except OSError:
        return False
    return True


def _validate_ics_basic(content: bytes) -> None:
    """Valida formato ICS básico (BEGIN:VCALENDAR y al menos un VEVENT).
    
    Raises HTTPException con 400 si no cumple.
    """
    try:
        # Intentar decodificar con múltiples encodings para mayor compatibilidad
        # entre diferentes sistemas (PC Windows/Linux a mini PC Linux)
        content_str = None
        for encoding in ['utf-8', 'utf-8-sig', 'iso-8859-1', 'windows-1252', 'latin1']:
            try:
                content_str = content.decode(encoding)
                break
            except (UnicodeDecodeError, LookupError):
                continue
        
        if content_str is None:
            # Si ninguno funciona, usar UTF-8 con replace como fallback
            content_str = content.decode('utf-8', errors='replace')
            logger.warning("[calendar] ICS file decoded with errors='replace', may have encoding issues")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "ICS file encoding not recognized", "reason": str(exc)},
        ) from exc
    
    # Validar que tiene BEGIN:VCALENDAR
    if "BEGIN:VCALENDAR" not in content_str.upper():
        raise HTTPException(
            status_code=400,
            detail={"error": "ICS file must contain BEGIN:VCALENDAR"},
        )
    
    # Validar que tiene al menos un VEVENT
    if "BEGIN:VEVENT" not in content_str.upper():
        raise HTTPException(
            status_code=400,
            detail={"error": "ICS file must contain at least one BEGIN:VEVENT"},
        )
    
    # Intentar parsear con icalendar para validar sintaxis
    try:
        from icalendar import Calendar
        Calendar.from_ical(content)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": f"Invalid ICS format: {str(exc)}"},
        ) from exc


def _handle_partial_opensky_update(payload: Dict[str, Any]) -> JSONResponse:
    opensky_data = payload.get("opensky")
    if not isinstance(opensky_data, dict):
        return JSONResponse(content={"success": True})

    oauth_payload = opensky_data.get("oauth2")
    if not isinstance(oauth_payload, dict):
        return JSONResponse(content={"success": True})

    changed = False

    if "client_id" in oauth_payload:
        raw_client_id = oauth_payload.get("client_id")
        sanitized_id = _sanitize_secret(raw_client_id)
        if sanitized_id is not None:
            secret_store.set_secret("opensky_client_id", sanitized_id)
            changed = True
        elif raw_client_id is None:
            secret_store.set_secret("opensky_client_id", None)
            changed = True

    if "client_secret" in oauth_payload:
        raw_client_secret = oauth_payload.get("client_secret")
        sanitized_secret = _sanitize_secret(raw_client_secret)
        if sanitized_secret is not None:
            secret_store.set_secret("opensky_client_secret", sanitized_secret)
            changed = True
        elif raw_client_secret is None:
            secret_store.set_secret("opensky_client_secret", None)
            changed = True

    if changed:
        opensky_service.reset()
        logger.info("[opensky] credentials updated via /api/config payload (partial)")
        _refresh_opensky_oauth_metadata()

    return JSONResponse(content={"success": True})


def _validate_and_normalize_maptiler(config: Dict[str, Any]) -> None:
    """Valida y normaliza URLs de MapTiler en el config.
    
    Args:
        config: Diccionario de configuración (modificado in-place)
        
    Raises:
        HTTPException con status_code 400 si hay error de validación
    """
    ui_map = config.get("ui_map", {})
    if not isinstance(ui_map, dict):
        return
    
    provider = ui_map.get("provider")
    if provider != "maptiler_vector":
        return
    
    maptiler = ui_map.get("maptiler")
    if not isinstance(maptiler, dict):
        return
    
    # Normalizar apiKey → api_key (aceptar ambos, persistir como api_key)
    api_key = maptiler.get("api_key") or maptiler.get("apiKey")
    if not api_key or not isinstance(api_key, str):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "api_key is required for maptiler_vector provider",
                "field": "ui_map.maptiler.api_key",
            },
        )
    
    api_key = str(api_key).strip()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "api_key is empty",
                "field": "ui_map.maptiler.api_key",
            },
        )
    
    if len(api_key) < 10:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "api_key must be at least 10 characters",
                "field": "ui_map.maptiler.api_key",
            },
        )
    
    # Validar formato de api_key (solo letras, números, guiones y guiones bajos)
    if not re.match(r"^[A-Za-z0-9\-_]+$", api_key):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "api_key contains invalid characters",
                "field": "ui_map.maptiler.api_key",
            },
        )
    
    # Persistir como api_key (eliminar apiKey legacy)
    maptiler["api_key"] = api_key
    if "apiKey" in maptiler:
        del maptiler["apiKey"]
    
    # Normalizar style: respetar valores válidos (hybrid, satellite, streets-v4, etc.)
    # Solo usar default si está vacío o inválido
    style = maptiler.get("style")
    if isinstance(style, str) and style.strip():
        normalized_style = style.strip()
        # Validar que sea un estilo conocido
        valid_styles = {"hybrid", "satellite", "streets-v4", "vector-dark", "vector-bright", "vector-light", "basic", "basic-dark"}
        if normalized_style not in valid_styles:
            logger.warning("[config] Unknown maptiler.style=%r, defaulting to streets-v4", normalized_style)
            normalized_style = "streets-v4"
        maptiler["style"] = normalized_style
    elif not style or (isinstance(style, str) and not style.strip()):
        maptiler["style"] = "streets-v4"
    
    # Normalizar styleUrl: respetar si existe, resolver desde style si no
    style_url = maptiler.get("styleUrl")
    current_style = maptiler.get("style", "streets-v4")
    
    if style_url and isinstance(style_url, str) and style_url.strip():
        # Si hay styleUrl, respetarlo pero asegurar que esté firmado
        normalized_url = normalize_maptiler_style_url(api_key, style_url.strip()) or style_url.strip()
        maptiler["styleUrl"] = normalized_url
    elif isinstance(current_style, str) and current_style.strip():
        # Si no hay styleUrl pero hay style, resolver desde style
        from .services.maptiler import resolve_maptiler_style_url
        resolved_url = resolve_maptiler_style_url(current_style.strip(), api_key)
        maptiler["styleUrl"] = resolved_url
    else:
        # Si no hay ni styleUrl ni style, usar default
        from .services.maptiler import resolve_maptiler_style_url
        default_url = resolve_maptiler_style_url("streets-v4", api_key)
        maptiler["styleUrl"] = default_url
        maptiler.setdefault("style", "streets-v4")
    
    # Limpiar urls.styleUrl* legacy (eliminar todo el bloque urls si existe)
    if "urls" in maptiler:
        urls = maptiler["urls"]
        if isinstance(urls, dict):
            # Limpiar todas las URLs legacy
            for url_key in ["styleUrl", "styleUrlDark", "styleUrlLight", "styleUrlBright"]:
                if url_key in urls:
                    del urls[url_key]
            # Si urls quedó vacío, eliminarlo
            if not urls or all(v is None for v in urls.values()):
                del maptiler["urls"]


@app.post("/api/config")
@app.put("/api/config")
@app.patch("/api/config")
async def save_config(request: Request) -> JSONResponse:
    """Persist configuration with non-destructive merge and hot reload."""
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

    if payload and set(payload.keys()) <= {"opensky"}:
        return _handle_partial_opensky_update(payload)

    v1_keys = _check_v1_keys(payload)
    if v1_keys:
        logger.warning("Rejecting v1 keys in payload: %s", v1_keys)
        raise HTTPException(
            status_code=400,
            detail={"error": "v1 keys not allowed", "v1_keys": v1_keys},
        )

    # Permitir payload sin version (asumir v2)
    incoming_version = payload.get("version")
    if incoming_version is not None and incoming_version != 2:
        logger.warning("Rejecting non-v2 config (version=%s)", incoming_version)
        raise HTTPException(
            status_code=400,
            detail={"error": "Only v2 supported", "field": "version"},
        )

    payload = _sanitize_incoming_config_payload(payload)

    ui_map_satellite_updated = False
    ui_map_maptiler_updated = False
    ui_map_payload = payload.get("ui_map")
    if isinstance(ui_map_payload, dict):
        if "satellite" in ui_map_payload:
            ui_map_satellite_updated = True
        # Detectar cambios en maptiler (api_key o styleUrl)
        if "maptiler" in ui_map_payload:
            maptiler_payload = ui_map_payload.get("maptiler")
            if isinstance(maptiler_payload, dict):
                # Verificar si hay cambios en api_key o styleUrl
                if "api_key" in maptiler_payload or "styleUrl" in maptiler_payload:
                    ui_map_maptiler_updated = True
                    logger.info("[config] Detected changes in ui_map.maptiler (api_key or styleUrl)")
    
    # Log del método HTTP recibido
    logger.info("[config] Received %s /api/config", request.method)

    persisted_config: Optional[Dict[str, Any]] = None
    provider_final = "google"
    enabled_final = False
    final_ics_path: Optional[str] = None

    try:
        # Cargar config actual para hacer deep-merge
        try:
            current_raw = load_raw_config(config_manager.config_file)
        except json.JSONDecodeError as exc:
            logger.error("[config] Current config is not valid JSON: %s", exc)
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "Current configuration file is not valid JSON",
                    "reason": str(exc),
                },
            ) from exc
        except OSError as exc:
            logger.error("[config] Could not read current config %s: %s", config_manager.config_file, exc)
            raise HTTPException(
                status_code=500,
                detail={"error": "Unable to read current configuration", "reason": str(exc)},
            ) from exc

        # Hacer deep-merge con el config actual (parche parcial)
        logger.info("[config] Performing deep-merge with current config (partial patch)")
        merged = deep_merge(current_raw, payload)
        
        # Forzar version=2 si falta o es None
        if merged.get("version") is None or merged.get("version") != 2:
            merged["version"] = 2
            logger.info("[config] Forced version=2 in merged config")
        
        # Sanitizar antes de validar (migra valores legacy/inválidos)
        sanitized = sanitize_config(merged)
        
        # Validar y normalizar MapTiler si provider=maptiler_vector
        if sanitized.get("ui_map", {}).get("provider") == "maptiler_vector":
            logger.info("[config] Validating and normalizing MapTiler URLs")
            try:
                _validate_and_normalize_maptiler(sanitized)
                # Normalizar secreto de MapTiler: si ui_map.maptiler.api_key viene en payload/merge y el secreto falta, guardarlo
                try:
                    mt = sanitized.get("ui_map", {}).get("maptiler", {})
                    api_key_candidate = None
                    if isinstance(mt, dict):
                        raw_key = mt.get("api_key")
                        if isinstance(raw_key, str) and raw_key.strip():
                            api_key_candidate = raw_key.strip()
                    if api_key_candidate:
                        current_secret = secret_store.get_secret("maptiler_api_key")
                        if not current_secret or current_secret.strip() != api_key_candidate:
                            secret_store.set_secret("maptiler_api_key", api_key_candidate)
                            logger.info("[maptiler] Secret synchronized from ui_map.maptiler.api_key (length=%d)", len(api_key_candidate))
                except Exception as sync_exc:
                    logger.debug("[maptiler] Secret sync skipped: %s", sync_exc)
            except HTTPException:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.error("[config] MapTiler validation error: %s", exc)
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": f"MapTiler validation failed: {str(exc)}",
                        "field": "ui_map.maptiler",
                    },
                ) from exc
        
        # NO aplicar defaults aquí - mantener solo lo que está en disco y payload
        # Los defaults se aplican solo en load_effective_config() al iniciar
        
        # Asegurar que maps y layers_global no sean null antes de validar
        # Si vienen como null en el payload, mantener los existentes o aplicar defaults
        if "maps" in sanitized and sanitized["maps"] is None:
            logger.info("[Config] maps was null in payload; preserving existing or applying defaults")
            # Si hay maps en current_raw, mantenerlo; si no, aplicar defaults
            if "maps" in current_raw and current_raw["maps"] is not None:
                sanitized["maps"] = current_raw["maps"]
            else:
                sanitized = _ensure_maps_defaults(sanitized)
        elif "maps" not in sanitized:
            # Si no viene maps en el payload, mantener el existente o aplicar defaults
            if "maps" in current_raw and current_raw["maps"] is not None:
                sanitized["maps"] = current_raw["maps"]
            else:
                sanitized = _ensure_maps_defaults(sanitized)
        
        # Asegurar que layers.global existe (no layers_global)
        if "layers" not in sanitized:
            sanitized["layers"] = {}
        if "layers" in sanitized and isinstance(sanitized["layers"], dict):
            layers = sanitized["layers"]
            if "global" not in layers or layers["global"] is None:
                # Si no viene layers.global en el payload, mantener el existente o aplicar defaults
                if "layers" in current_raw and isinstance(current_raw.get("layers"), dict):
                    existing_global = current_raw["layers"].get("global") or current_raw["layers"].get("global_")
                    if existing_global is not None:
                        layers["global"] = existing_global
                    else:
                        sanitized = _ensure_layers_global_defaults(sanitized)
                else:
                    sanitized = _ensure_layers_global_defaults(sanitized)
            else:
                # Asegurar que layers.global.radar tiene valores por defecto si falta algo
                sanitized = _ensure_layers_global_defaults(sanitized)
        
        # Validar con Pydantic (usar sanitized)
        try:
            config = AppConfig.model_validate(sanitized)
            config_dict = config.model_dump(mode="json", exclude_none=True)
            
            # Asegurar que maps y layers.global estén presentes después de validar
            # (por si Pydantic los excluyó por ser None)
            if "maps" not in config_dict or config_dict["maps"] is None:
                config_dict = _ensure_maps_defaults(config_dict)
            # Verificar layers.global (no layers_global)
            if "layers" not in config_dict or not isinstance(config_dict.get("layers"), dict):
                config_dict = _ensure_layers_global_defaults(config_dict)
            elif "global" not in config_dict["layers"] or config_dict["layers"]["global"] is None:
                config_dict = _ensure_layers_global_defaults(config_dict)
        except ValidationError as exc:
            logger.warning("[config] Validation error after merge: %s", exc.errors())
            # Extraer el primer error para formato {"error": "...", "field": "..."}
            first_error = exc.errors()[0] if exc.errors() else {}
            field_path = ".".join(str(x) for x in first_error.get("loc", []))
            error_msg = first_error.get("msg", "Validation failed")
            raise HTTPException(
                status_code=400,
                detail={
                    "error": error_msg,
                    "field": field_path,
                },
            ) from exc
        
        # Procesar secrets
        secrets = payload.get("secrets", {})
        google_secrets = secrets.get("google", {}) if isinstance(secrets, dict) else {}
        calendar_ics_secrets = secrets.get("calendar_ics", {}) if isinstance(secrets, dict) else {}

        google_api_key = google_secrets.get("api_key") if isinstance(google_secrets, dict) else None
        google_calendar_id = google_secrets.get("calendar_id") if isinstance(google_secrets, dict) else None
        calendar_ics_url = (
            calendar_ics_secrets.get("url") if isinstance(calendar_ics_secrets, dict) else None
        )
        calendar_ics_path_secret = (
            calendar_ics_secrets.get("path") if isinstance(calendar_ics_secrets, dict) else None
        )
        
        provider_final, enabled_final, final_ics_path = resolve_calendar_provider(merged)

        stored_calendar_ics_url = secret_store.get_secret("calendar_ics_url")
        stored_calendar_ics_path = secret_store.get_secret("calendar_ics_path")

        def _clean_optional_str(value: object) -> Optional[str]:
            if isinstance(value, str):
                stripped = value.strip()
                return stripped or None
            return None

        new_ics_url = _clean_optional_str(calendar_ics_url)
        new_ics_path = _clean_optional_str(calendar_ics_path_secret)
        existing_ics_url = _clean_optional_str(stored_calendar_ics_url)
        existing_ics_path = _clean_optional_str(stored_calendar_ics_path)
        config_ics_path = _clean_optional_str(final_ics_path)

        effective_ics_url = new_ics_url or existing_ics_url
        effective_ics_path = new_ics_path or config_ics_path or existing_ics_path
        
        # Validar Google Calendar
        if provider_final == "google" and enabled_final:
            missing: List[str] = []
            if not google_api_key or not str(google_api_key).strip():
                missing.append("secrets.google.api_key")
            if not google_calendar_id or not str(google_calendar_id).strip():
                missing.append("secrets.google.calendar_id")
            if missing:
                logger.warning("[config] Provider google requires credentials (missing=%s)", ", ".join(missing))
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "Calendar provider 'google' requires api_key and calendar_id",
                        "missing": missing,
                        "tip": "Desactiva calendar o rellena secrets.google.api_key y secrets.google.calendar_id",
                    },
                )
        
        if provider_final == "ics" and enabled_final:
            if not effective_ics_url and not effective_ics_path:
                logger.warning("[config] Provider ICS requires url or path (none provided)")
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "Calendar provider 'ics' requires url or path",
                        "field": "calendar.source",
                        "tip": "Configura secrets.calendar_ics.url o secrets.calendar_ics.path antes de activar ICS",
                        "missing": [
                            "secrets.calendar_ics.url",
                            "secrets.calendar_ics.path",
                        ],
                    },
                )

        # Validar ICS usando validate_calendar_provider (nunca 500, solo 400)
        try:
            validate_calendar_provider(provider_final, enabled_final, effective_ics_path)
        except CalendarValidationError as exc:
            logger.warning("[config] Calendar validation error: %s", exc)
            raise HTTPException(
                status_code=400,
                detail={"error": str(exc), "missing": exc.missing if exc.missing else []},
            ) from exc

        # Guardar config normalizado
        # Usar config_dict que tiene los defaults de maps y layers_global aplicados
        # Calcular tamaño del payload antes de guardar
        config_size = len(json.dumps(config_dict, ensure_ascii=False).encode('utf-8'))
        logger.info(
            "[config] Will save config to %s (size=%d bytes)",
            config_manager.config_file,
            config_size,
        )
        
        try:
            write_config_atomic(config_dict, config_manager.config_file)
            logger.info(
                "[config] Configuration persisted atomically to %s",
                config_manager.config_file,
            )
            
            try:
                method = request.method.lower()
            except Exception:
                method = "unknown"
            _schedule_kiosk_refresh(f"config_save_{method}")
            if ui_map_satellite_updated:
                if not refresh_ui_if_possible():
                    logger.debug("[kiosk] refresh UI request skipped or failed after ui_map.satellite update")
            # Forzar refresh del kiosk si cambió la configuración de MapTiler (api_key o styleUrl)
            if ui_map_maptiler_updated:
                logger.info("[kiosk] MapTiler config changed, forcing UI refresh")
                if not refresh_ui_if_possible():
                    logger.debug("[kiosk] refresh UI request skipped or failed after ui_map.maptiler update")

            # Publicar evento config_changed después de guardar exitosamente
            try:
                publish_config_changed_sync(
                    str(config_manager.config_file),
                    changed_groups=["all"]  # POST/PATCH completo afecta todo
                )
            except Exception as pub_exc:
                logger.warning("[config-events] No se pudo publicar evento: %s", pub_exc)
        except ConfigWriteError as write_exc:
            # ConfigWriteError ya tiene logging completo con traceback
            raise HTTPException(
                status_code=500,
                detail={"error": "config write failed"},
            ) from write_exc
        except (PermissionError, OSError) as write_exc:
            # Log con traceback completo
            traceback_str = traceback.format_exc()
            logger.error(
                "[config] Failed to write config atomically: %s\n%s",
                write_exc,
                traceback_str,
            )
            raise HTTPException(
                status_code=500,
                detail={"error": "config write failed"},
            ) from write_exc

        # Recargar config desde disco para devolver la versión final normalizada
        try:
            persisted_config = load_raw_config(config_manager.config_file)
            logger.info("[config] Reloaded config from disk after save")
            # Asegurar que maps y layers_global estén presentes en la respuesta
            persisted_config = _ensure_maps_defaults(persisted_config)
            persisted_config = _ensure_layers_global_defaults(persisted_config)
        except (json.JSONDecodeError, OSError) as reload_exc:
            logger.warning("[config] Failed to reload config from disk after save: %s", reload_exc)
            # Usar config_dict como fallback (ya tiene defaults aplicados)
            persisted_config = config_dict

        if google_api_key:
            masked_key = _mask_secret(str(google_api_key))
            logger.info(
                "[config] Saving Google Calendar API key (present=%s, last4=%s)",
                masked_key.get("has_api_key", False),
                masked_key.get("api_key_last4", "****"),
            )
            secret_store.set_secret("google_calendar_api_key", str(google_api_key).strip())
        else:
            secret_store.set_secret("google_calendar_api_key", None)
            logger.info("[config] Google Calendar API key removed")

        if google_calendar_id:
            logger.info(
                "[config] Saving Google Calendar ID (length=%d)",
                len(str(google_calendar_id)),
            )
            secret_store.set_secret("google_calendar_id", str(google_calendar_id).strip())
        else:
            secret_store.set_secret("google_calendar_id", None)
            logger.info("[config] Google Calendar ID removed")

        if new_ics_url is not None:
            logger.info("[config] Saving ICS calendar URL (length=%d)", len(new_ics_url))
            secret_store.set_secret("calendar_ics_url", new_ics_url)
        else:
            secret_store.set_secret("calendar_ics_url", None)

        ics_path_to_store: Optional[str] = None
        if new_ics_path is not None:
            ics_path_to_store = new_ics_path
        elif provider_final == "ics" and effective_ics_path:
            ics_path_to_store = effective_ics_path

        if ics_path_to_store and provider_final == "ics":
            logger.info("[config] Saving ICS calendar path (length=%d)", len(ics_path_to_store))
            secret_store.set_secret("calendar_ics_path", ics_path_to_store)
        else:
            secret_store.set_secret("calendar_ics_path", None)

        if config.layers and config.layers.ships:
            try:
                ships_service.apply_config(config.layers.ships)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[config] Skipping ships config apply due to error: %s", exc)

    except HTTPException:
        raise
    except ValidationError as exc:
        logger.warning("[config] Validation error: %s", exc.errors())
        # Extraer el primer error para formato {"error": "...", "field": "..."}
        first_error = exc.errors()[0] if exc.errors() else {}
        field_path = ".".join(str(x) for x in first_error.get("loc", []))
        error_msg = first_error.get("msg", "Validation failed")
        raise HTTPException(
            status_code=400,
            detail={
                "error": error_msg,
                "field": field_path,
            },
        ) from exc
    except ConfigWriteError as exc:
        # ConfigWriteError ya tiene logging completo con traceback
        raise HTTPException(
            status_code=500,
            detail={"error": "config write failed"},
        ) from exc
    except (PermissionError, OSError) as exc:
        # Log con traceback completo
        traceback_str = traceback.format_exc()
        logger.error(
            "[config] Failed to persist configuration: %s\n%s",
            exc,
            traceback_str,
        )
        raise HTTPException(
            status_code=500,
            detail={"error": "config write failed"},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        # Log con traceback completo
        traceback_str = traceback.format_exc()
        logger.error(
            "[config] Unexpected error: %s\n%s",
            exc,
            traceback_str,
        )
        raise HTTPException(
            status_code=500,
            detail={"error": "config write failed"},
        ) from exc

    # Invalidar caché relacionado con configuración para forzar re-carga
    # Esto asegura que los endpoints que dependen de config lean los nuevos valores
    cache_keys_to_invalidate = [
        "health",  # El health endpoint usa config
        "calendar",  # El calendar endpoint usa config
        "storm_mode",  # Storm mode usa config
    ]
    for cache_key in cache_keys_to_invalidate:
        try:
            cache_store.invalidate(cache_key)
        except Exception as cache_exc:  # noqa: BLE001
            logger.debug("[config] Failed to invalidate cache key %s: %s", cache_key, cache_exc)
    
    # Recargar configuración en runtime (hot-reload)
    try:
        reloaded = reload_runtime_config(config_manager)
        if reloaded:
            # Recargar global_config desde disco (sin reinyectar defaults)
            try:
                global global_config
                global_config = load_effective_config()
                logger.info("[config] Hot-reloaded global_config from disk")
            except Exception as reload_exc:
                logger.warning("[config] Failed to hot-reload global_config: %s", reload_exc)
            global map_reset_counter
            map_reset_counter += 1
            logger.info("[config] Configuration reloaded in-memory after save (hot-reload)")
            # Inicializar/actualizar servicios según nueva configuración
            try:
                config_after_reload = config_manager.read()
                _ensure_blitzortung_service(config_after_reload)
            except Exception as blitz_exc:  # noqa: BLE001
                logger.warning("[config] Failed to reload config for blitzortung service: %s", blitz_exc)
        else:
            logger.warning("[config] Configuration reload after save did not report changes")
    except Exception as reload_exc:  # noqa: BLE001
        logger.warning("[config] Failed to reload runtime config: %s", reload_exc)

    # Devolver config completo normalizado (recargado desde disco)
    return JSONResponse(content=persisted_config)


def _validation_loc_matches_group(loc: Tuple[object, ...], group_name: str) -> bool:
    """Determina si la ruta de error pertenece al grupo actualizado."""

    if not loc:
        return False

    parts = tuple(part for part in group_name.split(".") if part)
    if not parts:
        return False

    if parts == ("calendar",):
        return loc[:1] == ("calendar",) or loc[:2] == ("panels", "calendar")

    if parts == ("panels", "calendar"):
        return loc[:2] == ("panels", "calendar") or loc[:1] == ("calendar",)

    if parts[0] == "panels" and len(parts) > 1:
        return loc[:len(parts)] == parts

    if parts[0] == "layers" and len(parts) > 1:
        return loc[:len(parts)] == parts

    return loc[:1] == (parts[0],)


@app.patch("/api/config/group/{group_name}")
async def save_config_group(group_name: str, request: Request) -> JSONResponse:
    """
    Guarda un grupo específico de configuración.
    Hace deep-merge solo del subobjeto del grupo.
    Soporta grupos anidados como "layers.flights" o "layers.ships".
    
    Args:
        group_name: Nombre del grupo (map, aemet, weather, layers.flights, layers.ships, secrets, etc.)
        request: Request con el payload JSON del grupo
        
    Returns:
        JSONResponse con la configuración completa actualizada
    """
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty payload")
    
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(exc)}")
    
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")
    
    logger.info("[config] PATCH /api/config/group/%s", group_name)
    
    # Leer configuración actual desde disco
    try:
        current_config = read_json(CONFIG_PATH)
    except FileNotFoundError:
        current_config = config_manager._default_config_model().model_dump(mode="json", exclude_none=True)
    except Exception as e:
        logger.error("[config] Failed to read current config: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to read config: {str(e)}")
    
    # Manejar secrets de forma especial (no se guardan en config, solo en secret_store)
    refresh_satellite = False
    if group_name == "ui_map":
        if "satellite" in payload:
            refresh_satellite = True
    elif group_name.startswith("ui_map.satellite"):
        refresh_satellite = True

    if group_name == "secrets":
        # Guardar secrets en secret_store
        try:
            # opensky.oauth2
            if "opensky" in payload and isinstance(payload["opensky"], dict):
                opensky = payload["opensky"]
                if "oauth2" in opensky and isinstance(opensky["oauth2"], dict):
                    oauth2 = opensky["oauth2"]
                    if "client_id" in oauth2:
                        secret_store.set_secret("opensky_client_id", _sanitize_secret(oauth2["client_id"]))
                    if "client_secret" in oauth2:
                        secret_store.set_secret("opensky_client_secret", _sanitize_secret(oauth2["client_secret"]))
                if "basic" in opensky and isinstance(opensky["basic"], dict):
                    basic = opensky["basic"]
                    if "username" in basic:
                        secret_store.set_secret("opensky_username", _sanitize_secret(basic["username"]))
                    if "password" in basic:
                        secret_store.set_secret("opensky_password", _sanitize_secret(basic["password"]))
            
            # aviationstack
            if "aviationstack" in payload and isinstance(payload["aviationstack"], dict):
                if "api_key" in payload["aviationstack"]:
                    secret_store.set_secret("aviationstack_api_key", _sanitize_secret(payload["aviationstack"]["api_key"]))
            
            # aisstream
            if "aisstream" in payload and isinstance(payload["aisstream"], dict):
                if "api_key" in payload["aisstream"]:
                    secret_store.set_secret("aisstream_api_key", _sanitize_secret(payload["aisstream"]["api_key"]))
            
            # aishub
            if "aishub" in payload and isinstance(payload["aishub"], dict):
                if "api_key" in payload["aishub"]:
                    secret_store.set_secret("aishub_api_key", _sanitize_secret(payload["aishub"]["api_key"]))
            
            # maptiler
            if "maptiler" in payload and isinstance(payload["maptiler"], dict):
                if "api_key" in payload["maptiler"]:
                    secret_store.set_secret("maptiler_api_key", _sanitize_secret(payload["maptiler"]["api_key"]))
            
            logger.info("[secrets] Updated secrets via PATCH /api/config/group/secrets")
        except Exception as secret_exc:
            logger.warning("[secrets] Error updating secrets: %s", secret_exc)
        
        # Para secrets, no hacer merge en config, solo actualizar metadata
        # Los valores reales nunca se guardan en config
        if "secrets" not in current_config:
            current_config["secrets"] = {}
        secrets_meta = current_config["secrets"]
        # Actualizar solo metadata (sin valores)
        for key in payload:
            if key not in secrets_meta:
                secrets_meta[key] = {}
            if isinstance(payload[key], dict) and isinstance(secrets_meta[key], dict):
                for subkey in payload[key]:
                    if isinstance(payload[key][subkey], dict):
                        if subkey not in secrets_meta[key]:
                            secrets_meta[key][subkey] = {}
                        # Solo actualizar keys que no son valores sensibles
                        for meta_key in payload[key][subkey]:
                            if meta_key not in ["client_id", "client_secret", "username", "password", "api_key"]:
                                secrets_meta[key][subkey][meta_key] = payload[key][subkey][meta_key]
                    elif subkey not in ["client_id", "client_secret", "username", "password", "api_key"]:
                        secrets_meta[key][subkey] = payload[key][subkey]
        merged_config = current_config
    else:
        # Manejar grupos anidados (ej: "layers.flights", "layers.ships", "ui_global.satellite")
        # Soporta grupos de múltiples niveles: "a.b.c" -> {"a": {"b": {"c": payload}}}
        if "." in group_name:
            parts = group_name.split(".")
            if len(parts) < 2:
                raise HTTPException(status_code=400, detail=f"Invalid nested group name: {group_name}")
            
            # Construir estructura anidada recursivamente
            merge_payload: Dict[str, Any] = {}
            current = merge_payload
            for i, part in enumerate(parts[:-1]):
                current[part] = {}
                current = current[part]
            # Última parte contiene el payload
            current[parts[-1]] = payload
        else:
            merge_payload = {group_name: payload}
        
        # Hacer deep-merge solo del grupo
        # deep_merge preserva todas las claves no presentes en merge_payload
        merged_config = deep_merge(current_config, merge_payload)
    
    # Sanitizar antes de validar (migra valores legacy/inválidos)
    sanitized_config = sanitize_config(merged_config)
    
    # Validar configuración completa (usar sanitized)
    try:
        validated_config = AppConfig.model_validate(sanitized_config)
    except ValidationError as exc:
        relevant_errors = []

        for error in exc.errors():
            loc = tuple(error.get("loc", ()))
            if _validation_loc_matches_group(loc, group_name):
                relevant_errors.append(error)

        if relevant_errors:
            logger.warning(
                "[config] Validation error en grupo %s: %s",
                group_name,
                relevant_errors,
            )
            first_error = relevant_errors[0]
            field_path = ".".join(str(x) for x in first_error.get("loc", []))
            error_msg = first_error.get("msg", "Validation failed")
            raise HTTPException(
                status_code=400,
                detail={
                    "error": error_msg,
                    "field": field_path,
                },
            ) from exc

        logger.info(
            "[config] Ignorando %d errores de validación fuera del grupo %s",
            len(exc.errors()),
            group_name,
        )
        validated_config = None

    if validated_config is not None:
        provider_final, enabled_final, final_ics_path = _resolve_calendar_settings(validated_config)
    else:
        provider_final, enabled_final, final_ics_path = resolve_calendar_provider(
            deepcopy(sanitized_config)
        )

    stored_calendar_ics_url = secret_store.get_secret("calendar_ics_url")
    stored_calendar_ics_path = secret_store.get_secret("calendar_ics_path")

    def _clean_optional_str(value: object) -> Optional[str]:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return None

    sanitized_calendar_block = sanitized_config.get("calendar")
    sanitized_calendar_block = (
        sanitized_calendar_block if isinstance(sanitized_calendar_block, dict) else {}
    )
    sanitized_panel_calendar = (
        sanitized_config.get("panels", {}).get("calendar", {})
        if isinstance(sanitized_config.get("panels"), dict)
        else {}
    )
    sanitized_calendar_ics = sanitized_calendar_block.get("ics")
    sanitized_calendar_ics = (
        sanitized_calendar_ics if isinstance(sanitized_calendar_ics, dict) else {}
    )
    sanitized_panel_ics = sanitized_panel_calendar.get("ics")
    sanitized_panel_ics = (
        sanitized_panel_ics if isinstance(sanitized_panel_ics, dict) else {}
    )

    sanitized_ics_url = _clean_optional_str(sanitized_calendar_ics.get("url"))
    sanitized_panel_ics_url = _clean_optional_str(sanitized_panel_ics.get("url"))
    sanitized_ics_path = _clean_optional_str(sanitized_calendar_block.get("ics_path"))
    sanitized_panel_ics_path = _clean_optional_str(sanitized_panel_calendar.get("ics_path"))

    effective_ics_url = (
        sanitized_ics_url
        or sanitized_panel_ics_url
        or _clean_optional_str(stored_calendar_ics_url)
    )

    effective_ics_path = (
        sanitized_panel_ics_path
        or sanitized_ics_path
        or _clean_optional_str(final_ics_path)
        or _clean_optional_str(stored_calendar_ics_path)
    )

    if provider_final == "ics" and enabled_final:
        if not effective_ics_url and not effective_ics_path:
            logger.warning("[config] Provider ICS requires url or path (none provided) [group=%s]", group_name)
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Calendar provider 'ics' requires url or path",
                    "field": "calendar.source",
                    "tip": "Configura secrets.calendar_ics.url o secrets.calendar_ics.path antes de activar ICS",
                    "missing": [
                        "secrets.calendar_ics.url",
                        "secrets.calendar_ics.path",
                    ],
                },
            )

    try:
        validate_calendar_provider(provider_final, enabled_final, effective_ics_path)
    except CalendarValidationError as exc:
        logger.warning("[config] Calendar validation error (group=%s): %s", group_name, exc)
        raise HTTPException(
            status_code=400,
            detail={"error": str(exc), "missing": exc.missing if exc.missing else []},
        ) from exc
    
    # Guardar atómicamente (usar sanitized)
    try:
        write_json(CONFIG_PATH, sanitized_config)
        logger.info("[config] Group '%s' saved successfully", group_name)
        _schedule_kiosk_refresh(f"config_group_{group_name}")
        if refresh_satellite:
            if not refresh_ui_if_possible():
                logger.debug("[kiosk] refresh UI request skipped or failed after %s update", group_name)
        
        # Publicar evento config_changed después de guardar exitosamente
        try:
            publish_config_changed_sync(
                CONFIG_PATH,
                changed_groups=[group_name]
            )
        except Exception as pub_exc:
            logger.warning("[config-events] No se pudo publicar evento: %s", pub_exc)
    except Exception as e:
        logger.error("[config] Failed to save config: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to save config: {str(e)}")
    
    # Hot-reload global_config y forzar actualización de config_loaded_at
    try:
        global global_config
        global_config = load_effective_config()
        # Forzar recarga del config_manager para actualizar config_loaded_at
        # Esto asegura que el polling del frontend detecte el cambio
        config_manager.reload()
        logger.info("[config] Hot-reloaded global_config after group '%s' save", group_name)
    except Exception as reload_exc:
        logger.warning("[config] Failed to hot-reload global_config: %s", reload_exc)
    
    # Recargar configuración desde disco para devolver
    try:
        persisted_config = read_json(CONFIG_PATH)
    except Exception as reload_exc:
        logger.warning("[config] Failed to reload config after save: %s", reload_exc)
        persisted_config = sanitized_config
    
    return JSONResponse(content=persisted_config)


@app.post("/api/test/{test_name}")
async def test_config_group(test_name: str, request: Request) -> JSONResponse:
    """
    Ejecuta un test para un grupo de configuración.
    
    Args:
        test_name: Nombre del test (map, aemet, weather, etc.)
        request: Request opcional con configuración del grupo a testear
        
    Returns:
        JSONResponse con resultado del test
    """
    logger.info("[test] POST /api/test/%s", test_name)
    
    # Obtener función de test
    test_func = TEST_FUNCTIONS.get(test_name)
    if not test_func:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown test: {test_name}. Available: {', '.join(TEST_FUNCTIONS.keys())}"
        )
    
    # Obtener configuración del grupo desde disco o desde request body
    group_config = {}
    try:
        body = await request.body()
        if body:
            try:
                payload = json.loads(body)
                if isinstance(payload, dict):
                    group_config = payload
            except json.JSONDecodeError:
                pass  # Si no es JSON válido, usar configuración de disco
    except Exception:
        pass
    
    # Si no viene en body, leer desde disco
    if not group_config:
        try:
            current_config = read_json(CONFIG_PATH)
            # Mapear nombres de grupos a claves en config
            group_key_map = {
                "map": "ui_map",
                "weather": "weather",
                "news": "news",
                "astronomy": "astronomy",
                "ephemerides": "ephemerides",
                "calendar": "calendar",
                "storm": "storm",
                "ships": "layers",
                "flights": "layers",
            }
            
            config_key = group_key_map.get(test_name)
            if config_key:
                if config_key == "layers":
                    if test_name == "ships":
                        group_config = current_config.get("layers", {}).get("ships", {})
                    elif test_name == "flights":
                        group_config = current_config.get("layers", {}).get("flights", {}).get("opensky", {})
                else:
                    group_config = current_config.get(config_key, {})
        except FileNotFoundError:
            group_config = {}
        except Exception as e:
            logger.warning("[test] Failed to read config from disk: %s", e)
            group_config = {}
    
    # Ejecutar test
    try:
        result = await test_func(group_config)
        return JSONResponse(content=result)
    except Exception as e:
        logger.exception("[test] Error executing test %s", test_name)
        return JSONResponse(
            content={
                "ok": False,
                "detail": f"Test execution error: {str(e)}"
            },
            status_code=500
        )


@app.post("/api/map/reset", response_model=MapResetResponse)
def reset_map_endpoint() -> MapResetResponse:
    """Signal the UI to rebuild MapLibre state without restarting the backend."""

    global map_reset_counter
    map_reset_counter += 1
    logger.info("Map reset requested (counter=%d)", map_reset_counter)
    return MapResetResponse(
        reset_counter=map_reset_counter,
        reset_at=datetime.now(timezone.utc),
    )


@app.get("/api/config/schema")
def get_config_schema() -> Dict[str, Any]:
    """Devuelve un JSON Schema v2020-12 para la configuración v2."""

    schema = AppConfigV2.model_json_schema(ref_template="#/$defs/{model}")
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["title"] = "Pantalla Reloj Config v2"
    schema["description"] = "Esquema de validación para la configuración v2 del backend."

    # Limitar a las claves top-level relevantes
    relevant_keys = ["version", "ui_map", "ui_global", "layers", "panels", "secrets", "calendar"]
    properties = schema.get("properties", {})
    schema["properties"] = {key: properties[key] for key in relevant_keys if key in properties}

    # Asegurar campos obligatorios
    schema["required"] = ["version", "ui_map"]

    # Validación condicional para Google Calendar
    schema.setdefault("allOf", [])
    schema["allOf"].append(
        {
            "if": {
                "required": ["calendar"],
                "properties": {
                    "calendar": {
                        "required": ["provider"],
                        "properties": {"provider": {"const": "google"}},
                    }
                },
            },
            "then": {
                "required": ["secrets"],
                "properties": {
                    "secrets": {
                        "required": ["google"],
                        "properties": {
                            "google": {
                                "required": ["api_key", "calendar_id"],
                                "properties": {
                                    "api_key": {"type": "string", "minLength": 1},
                                    "calendar_id": {"type": "string", "minLength": 1},
                                },
                            }
                        },
                    }
                },
            },
        }
    )

    # Validación condicional para ICS
    schema["allOf"].append(
        {
            "if": {
                "required": ["calendar"],
                "properties": {
                    "calendar": {
                        "required": ["provider"],
                        "properties": {"provider": {"const": "ics"}},
                    }
                },
            },
            "then": {
                "properties": {
                    "calendar": {
                        "required": ["ics_path"],
                    }
                }
            },
        }
    )

    schema["x-maskedSecrets"] = [
        {"key": "opensky_client_id", "masked": True},
        {"key": "opensky_client_secret", "masked": True},
        {"key": "aisstream_api_key", "masked": True},
        {
            "key": "openweathermap_api_key",
            "masked": True,
            "description": "API key para tiles de precipitación de OpenWeatherMap",
        },
        {"key": "google_calendar_api_key", "masked": True},
        {"key": "google_calendar_id", "masked": True},
    ]

    return schema




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


@app.get("/api/config/secret/openweathermap_api_key")
def get_openweather_secret_meta() -> Dict[str, Any]:
    return _mask_secret(secret_store.get_secret("openweathermap_api_key"))


@app.post("/api/config/secret/openweathermap_api_key", status_code=204)
async def update_openweather_secret(request: OpenWeatherMapSecretRequest) -> Response:
    api_key = _sanitize_secret(request.api_key)
    secret_store.set_secret("openweathermap_api_key", api_key)
    masked = _mask_secret(api_key)
    logger.info(
        "Updating OpenWeatherMap API key (present=%s, last4=%s)",
        masked.get("has_api_key", False),
        masked.get("api_key_last4", "****"),
    )
    return Response(status_code=204)


@app.get("/api/config/secret/openweathermap_api_key/raw")
def get_openweather_secret_raw() -> PlainTextResponse:
    value = secret_store.get_secret("openweathermap_api_key") or ""
    return PlainTextResponse(content=value)


@app.get("/api/config/secret/maptiler_api_key")
def get_maptiler_secret_meta() -> Dict[str, Any]:
    return _mask_secret(secret_store.get_secret("maptiler_api_key"))


@app.post("/api/config/secret/maptiler_api_key", status_code=204)
async def update_maptiler_secret(request: MapTilerSecretRequest) -> Response:
    api_key = _sanitize_secret(request.api_key)
    secret_store.set_secret("maptiler_api_key", api_key)
    masked = _mask_secret(api_key)
    logger.info(
        "Updating MapTiler API key (present=%s, last4=%s)",
        masked.get("has_api_key", False),
        masked.get("api_key_last4", "****"),
    )
    # Firmar URLs después de actualizar el secreto
    config = config_manager.read()
    sign_maptiler_urls(config)
    return Response(status_code=204)


async def _update_opensky_secret(name: str, request: Request) -> Response:
    value = await _read_secret_value(request)
    secret_store.set_secret(name, value)
    opensky_service.reset()
    logger.info("[opensky] secret %s updated (set=%s)", name, bool(value))
    _refresh_opensky_oauth_metadata()
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







@app.get("/api/rainviewer/frames")
def get_rainviewer_frames(
    history_minutes: int = 90,
    frame_step: int = 5
) -> List[int]:
    """
    Obtiene lista de frames disponibles de RainViewer.
    
    Args:
        history_minutes: Minutos de historia a buscar (default: 90)
        frame_step: Intervalo entre frames en minutos (default: 5)
        
    Returns:
        Lista de timestamps ordenados (number[])
    """
    try:
        provider = RainViewerProvider()
        frames = provider.get_available_frames(
            history_minutes=history_minutes,
            frame_step=frame_step
        )
        
        # Cachear mapa timestamp -> path para uso en tiles
        paths_map = {f["timestamp"]: f.get("path") for f in frames}
        try:
            # Usar un TTL razonable (ej. 15 min) ya que los frames cambian
            # Serializar a dict simple por si acaso el cache store tiene limitaciones
            cache_store.store("rainviewer_paths", paths_map)
        except Exception as e:
            logger.warning("Error caching RainViewer paths: %s", e)
        
        # Extraer solo los timestamps como array de números
        timestamps = [f["timestamp"] for f in frames]
        
        return timestamps
    except Exception as e:
        logger.warning("Error fetching RainViewer frames: %s", e)
        return []


@app.get("/api/rainviewer/tiles/{timestamp}/{z}/{x}/{y}.png")
def get_rainviewer_tile(
    timestamp: int,
    z: int,
    x: int,
    y: int
) -> Response:
    """
    Proxy/cache de tiles de RainViewer.
    
    Args:
        timestamp: Unix timestamp del frame
        z: Zoom level
        x: Tile X
        y: Tile Y
        
    Returns:
        PNG tile desde RainViewer
    """
    try:
        # Intentar obtener path del cache global de paths
        path = None
        try:
            cached_paths = cache_store.load("rainviewer_paths", max_age_minutes=30)
            if cached_paths and cached_paths.payload and isinstance(cached_paths.payload, dict):
                path = cached_paths.payload.get(timestamp)
                # Si es timestamp string key, intentar convertir
                if path is None and str(timestamp) in cached_paths.payload:
                    path = cached_paths.payload[str(timestamp)]
        except Exception as e:
            logger.warning("Error loading RainViewer path cache: %s", e)

        provider = RainViewerProvider()
        # Pasar path explícito si lo tenemos
        tile_url = provider.get_tile_url(timestamp=timestamp, z=z, x=x, y=y, path=path)
        
        # Intentar obtener desde caché primero
        cache_key = f"rainviewer_tile_{timestamp}_{z}_{x}_{y}"
        cached = cache_store.load(cache_key, max_age_minutes=60) # Tiles son inmutables por timestamp, aumentar cache
        if cached and cached.payload:
            # Si está en caché como bytes, retornarlo
            if isinstance(cached.payload, bytes):
                return Response(
                    content=cached.payload,
                    media_type="image/png",
                    headers={"Cache-Control": "public, max-age=3600"}
                )
        
        # Obtener tile desde RainViewer con reintentos
        max_retries = 2
        for attempt in range(max_retries + 1):
            try:
                response = requests.get(tile_url, timeout=10)
                if response.status_code == 404 and not path:
                     # Si falla 404 y no teníamos path, tal vez es un nowcast frame nuevo
                     # y necesitamos refrescar el mapa de paths.
                     # Pero no podemos hacerlo aquí fácilmente sin riesgo de recursión/latencia.
                     pass
                
                response.raise_for_status()
                break
            except requests.RequestException as e:
                if attempt < max_retries:
                    # logger.warning(f"RainViewer tile attempt {attempt + 1} failed: {e}, retrying...")
                    time.sleep(0.5)
                    continue
                else:
                    logger.warning(f"RainViewer tile failed after {max_retries + 1} attempts: {e} URL: {tile_url}")
                    raise HTTPException(status_code=404, detail="Tile no disponible")
        
        # Guardar en caché
        cache_store.store(cache_key, response.content)
        
        return Response(
            content=response.content,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Error fetching RainViewer tile: %s", e)
        raise HTTPException(status_code=404, detail="Tile no disponible")


@app.get("/api/rainviewer/test")
def test_rainviewer() -> Dict[str, Any]:
    """
    Prueba la funcionalidad de RainViewer.
    
    Returns:
        {ok: boolean, frames_count: number}
    """
    try:
        provider = RainViewerProvider()
        frames = provider.get_available_frames(history_minutes=90, frame_step=5)
        frames_count = len(frames)
        
        if frames_count > 0:
            return {"ok": True, "frames_count": frames_count}
        else:
            return {"ok": False, "frames_count": 0, "reason": "no_frames_available"}
    except Exception as e:
        logger.warning("Error testing RainViewer: %s", e)
        return {"ok": False, "frames_count": 0, "reason": str(e)}


@app.post("/api/config/migrate")
def migrate_config_endpoint(to: int = 2, backup: bool = True) -> Dict[str, Any]:
    """
    Migra configuración v1 a v2 (idempotente).
    
    Args:
        to: Versión objetivo (por defecto 2)
        backup: Si True, crea backup antes de migrar
        
    Returns:
        Configuración migrada y estado de éxito
    """
    if to != 2:
        raise HTTPException(status_code=400, detail=f"Migración a versión {to} no soportada")
    
    try:
        # Leer configuración actual
        current_config = config_manager.read()
        current_data = current_config.model_dump(mode="json", exclude_none=True)
        
        # Verificar si ya es v2
        if current_data.get("version") == 2:
            logger.info("Configuración ya es v2, no se requiere migración")
            return {
                "ok": True,
                "version": 2,
                "migrated": False,
                "message": "Configuración ya es v2"
            }
        
        # Migrar v1→v2
        config, needs_geocoding = migrate_v1_to_v2(current_data)
        
        # Geocodificar código postal si es necesario
        if needs_geocoding:
            postal_code = config.get("ui", {}).get("map", {}).get("region", {}).get("postalCode")
            if postal_code:
                try:
                    from .main import _geocode_postal_es
                    coords = _geocode_postal_es(postal_code)
                    if coords:
                        lat, lon = coords
                        if "ui" in config and "map" in config["ui"]:
                            if "fixed" in config["ui"]["map"]:
                                config["ui"]["map"]["fixed"]["center"] = {
                                    "lat": lat,
                                    "lng": lon,
                                    "zoom": 9.8,
                                    "bearing": 0,
                                    "pitch": 0
                                }
                            else:
                                config["ui"]["map"]["fixed"] = {
                                    "center": {"lat": lat, "lng": lon},
                                    "zoom": 9.8,
                                    "bearing": 0,
                                    "pitch": 0
                                }
                        logger.info("Geocodificación aplicada para CP %s: %s, %s", postal_code, lat, lon)
                except Exception as e:
                    logger.warning("Error geocodificando CP %s: %s", postal_code, e)
        
        # Crear backup si es necesario
        if backup:
            backup_path = config_manager.config_file.with_suffix(".json.v1backup")
            backup_path.write_text(json.dumps(current_data, indent=2), encoding="utf-8")
            logger.info("Backup creado en %s", backup_path)
        
        # Guardar configuración migrada
        # La variable `config` aquí es un dict, no un modelo Pydantic, por lo que no necesita .model_dump()
        config_manager.config_file.write_text(
            json.dumps(config, indent=2),
            encoding="utf-8"
        )
        
        logger.info("Configuración migrada exitosamente a v2")
        return {
            "ok": True,
            "version": 2,
            "migrated": True,
            "message": "Configuración migrada exitosamente a v2",
            "config": config
        }
        
    except Exception as e:
        logger.error("Error migrando configuración: %s", e)
        raise HTTPException(status_code=500, detail=f"Error migrando configuración: {e}")


@app.get("/api/opensky/status")
def get_opensky_status() -> JSONResponse:
    """
    Devuelve el estado de OpenSky siempre en formato JSON válido, incluso en caso de error.
    """
    try:
        config = config_manager.read()
        
        # Verificar si OpenSky está desactivado en la configuración
        opensky_cfg = getattr(config, "opensky", None)
        layers = getattr(config, "layers", None)
        flights_layer = getattr(layers, "flights", None) if layers else None
        
        enabled_in_config = bool(
            (flights_layer.enabled if flights_layer else False)
            and (getattr(opensky_cfg, "enabled", True) if opensky_cfg else True)
        )
        
        if not enabled_in_config:
            return JSONResponse(
                content={
                    "enabled": False,
                    "reachable": False,
                    "error": "OpenSky integration is disabled in configuration",
                    "details": {},
                },
                status_code=200,
            )
        
        # Intentar obtener el estado real
        status = opensky_service.get_status(config)
        now = time.time()
        last_fetch_ts = status.get("last_fetch_ts")
        status["last_fetch_age"] = int(now - last_fetch_ts) if last_fetch_ts else None
        auth_details = status.get("auth")
        if isinstance(auth_details, dict):
            status["has_credentials"] = bool(auth_details.get("has_credentials"))
            status["token_cached"] = bool(auth_details.get("token_cached"))
            status["expires_in_sec"] = auth_details.get("expires_in_sec")
        else:
            status["has_credentials"] = bool(status.get("has_credentials"))
            status["token_cached"] = bool(status.get("token_cached"))
        
        # Añadir campos bbox, extended, cluster si están disponibles
        try:
            status["bbox"] = config.opensky.bbox.model_dump()
            status["extended"] = int(config.opensky.extended)
            status["cluster"] = bool(config.opensky.cluster)
        except Exception:
            # Si falla, usar valores por defecto
            status["bbox"] = {"lamin": 39.5, "lamax": 41.0, "lomin": -1.0, "lomax": 1.5}
            status["extended"] = 0
            status["cluster"] = False
        
        if not status.get("has_credentials") and status.get("effective_poll", 0) < 10:
            status["poll_warning"] = "anonymous_minimum_enforced"
        
        # Normalizar respuesta al formato esperado
        response = {
            "enabled": bool(status.get("enabled", True)),
            "reachable": status.get("status") == "ok",
            "error": status.get("last_error") if status.get("status") != "ok" else None,
            "details": {
                "status": status.get("status", "unknown"),
                "mode": status.get("mode", "bbox"),
                "has_credentials": status.get("has_credentials", False),
                "last_fetch_ok": status.get("last_fetch_ok"),
                "last_error": status.get("last_error"),
            },
            # Mantener campos adicionales para compatibilidad
            **{k: v for k, v in status.items() if k not in ["enabled", "reachable", "error", "details"]},
        }
        
        return JSONResponse(content=response, status_code=200)
        
    except Exception as exc:  # noqa: BLE001
        # Capturar cualquier excepción y devolver JSON de error válido
        logger.warning("OpenSky status check failed", exc_info=exc)
        
        # Determinar si está habilitado en config (intentar leerlo aunque haya fallado antes)
        enabled = True
        try:
            config = config_manager.read()
            opensky_cfg = getattr(config, "opensky", None)
            layers = getattr(config, "layers", None)
            flights_layer = getattr(layers, "flights", None) if layers else None
            enabled = bool(
                (flights_layer.enabled if flights_layer else False)
                and (getattr(opensky_cfg, "enabled", True) if opensky_cfg else True)
            )
        except Exception:
            # Si ni siquiera podemos leer la config, asumir habilitado
            enabled = True
        
        # Construir mensaje de error legible
        error_message = "OpenSky status check failed"
        exception_type = type(exc).__name__
        exception_msg = str(exc)
        
        # Recortar mensaje si es muy largo
        if len(exception_msg) > 200:
            exception_msg = exception_msg[:197] + "..."
        
        return JSONResponse(
            content={
                "enabled": enabled,
                "reachable": False,
                "error": error_message,
                "details": {
                    "exception": exception_type,
                    "message": exception_msg,
                },
            },
            status_code=200,  # Siempre 200 OK, el error está en el JSON
        )


_opensky_last_error: Optional[str] = None


@app.get("/api/opensky/test")
def test_opensky_credentials() -> Dict[str, Any]:
    """Intenta obtener un token OAuth2 con credenciales guardadas (autenticador compartido)."""
    client_id = secret_store.get_secret("opensky_client_id")
    client_secret = secret_store.get_secret("opensky_client_secret")
    if not client_id or not client_secret:
        _set_opensky_error("missing_credentials")
        return {"ok": False, "reason": "missing_credentials"}

    config = config_manager.read()
    oauth_cfg = getattr(config.opensky, "oauth2", None)
    token_url = getattr(oauth_cfg, "token_url", None) if oauth_cfg else None
    scope_value = getattr(oauth_cfg, "scope", None) if oauth_cfg else None
    result = opensky_service.force_refresh_token(token_url=token_url, scope=scope_value)
    if not result.get("ok"):
        _set_opensky_error("auth_error")
        return {"ok": False, "error": "auth_error"}

    _set_opensky_error(None)
    return {
        "ok": True,
        "token_valid": bool(result.get("token_valid")),
        "expires_in": result.get("expires_in"),
    }


@app.get("/api/opensky/refresh")
def refresh_opensky_and_status() -> Dict[str, Any]:
    """Fuerza refresh de token y devuelve el estado actualizado en un único paso."""
    refresh_result = opensky_service.force_refresh_token()
    config = config_manager.read()
    status = opensky_service.get_status(config)
    now = time.time()
    last_fetch_ts = status.get("last_fetch_ts")
    status["last_fetch_age"] = int(now - last_fetch_ts) if last_fetch_ts else None
    status["bbox"] = config.opensky.bbox.model_dump()
    status["extended"] = int(config.opensky.extended)
    status["cluster"] = bool(config.opensky.cluster)
    if not status.get("has_credentials") and status.get("effective_poll", 0) < 10:
        status["poll_warning"] = "anonymous_minimum_enforced"
    return {
        "refresh": refresh_result,
        "status": status,
    }


class OpenSkyTestOAuthRequest(BaseModel):
    """Request para probar OAuth2 de OpenSky."""
    client_id: Optional[str] = Field(default=None, max_length=512)
    client_secret: Optional[str] = Field(default=None, max_length=512)
    token_url: Optional[str] = Field(default=None, max_length=512)
    scope: Optional[str] = Field(default=None, max_length=256)


@app.post("/api/opensky/test_oauth")
async def test_opensky_oauth(request: OpenSkyTestOAuthRequest) -> Dict[str, Any]:
    """Prueba autenticación OAuth2 de OpenSky con credenciales proporcionadas.
    
    Si no se proporcionan credenciales en el request, usa las guardadas en secrets.
    """
    try:
        # Obtener credenciales: del request o de secrets
        client_id = request.client_id or secret_store.get_secret("opensky_client_id")
        client_secret = request.client_secret or secret_store.get_secret("opensky_client_secret")
        token_url = request.token_url or DEFAULT_TOKEN_URL
        
        if not client_id or not client_secret:
            return {
                "ok": False,
                "reason": "missing_credentials",
                "message": "OpenSky OAuth2 requires client_id and client_secret",
                "tip": "Configure client_id and client_secret in secrets or provide them in the request"
            }
        
        # Si se proporcionaron credenciales en el request, guardarlas temporalmente
        use_temp_creds = bool(request.client_id and request.client_secret)
        if use_temp_creds:
            # Guardar credenciales originales temporalmente
            original_id = secret_store.get_secret("opensky_client_id")
            original_secret = secret_store.get_secret("opensky_client_secret")
            try:
                # Usar credenciales del request temporalmente
                secret_store.set_secret("opensky_client_id", client_id)
                secret_store.set_secret("opensky_client_secret", client_secret)
                # Invalidar token cache para forzar nueva autenticación
                try:
                    opensky_service.reset()
                except AttributeError:
                    # Si reset no existe, usar invalidate
                    try:
                        opensky_service._auth.invalidate()
                    except AttributeError:
                        pass
            except Exception as exc:
                logger.warning("[opensky] Failed to set temporary credentials: %s", exc)
        
        try:
            # Intentar obtener token OAuth2
            result = opensky_service.force_refresh_token(
                token_url=token_url or DEFAULT_TOKEN_URL,
                scope=request.scope
            )
            
            if result.get("ok") and result.get("token_valid"):
                expires_in = result.get("expires_in", 0)
                return {
                    "ok": True,
                    "token_valid": True,
                    "expires_in": expires_in,
                    "expires_in_minutes": expires_in // 60 if expires_in else None,
                    "message": f"OAuth2 authentication successful. Token valid for {expires_in // 60 if expires_in else 0} minutes.",
                    "credentials_source": "request" if use_temp_creds else "secrets"
                }
            else:
                error_msg = result.get("error", "Unknown error")
                return {
                    "ok": False,
                    "reason": "auth_failed",
                    "message": f"OAuth2 authentication failed: {error_msg}",
                    "token_valid": False
                }
        except OpenSkyAuthError as exc:
            return {
                "ok": False,
                "reason": "auth_error",
                "message": f"OpenSky OAuth2 error: {str(exc)}",
                "status": exc.status,
                "retry_after": exc.retry_after
            }
        except Exception as exc:
            logger.error("[opensky] OAuth2 test error: %s", exc)
            return {
                "ok": False,
                "reason": "internal_error",
                "message": f"Internal error during OAuth2 test: {str(exc)}"
            }
        finally:
            # Restaurar credenciales originales si se usaron temporales
            if use_temp_creds:
                try:
                    if original_id:
                        secret_store.set_secret("opensky_client_id", original_id)
                    else:
                        secret_store.delete_secret("opensky_client_id")
                    if original_secret:
                        secret_store.set_secret("opensky_client_secret", original_secret)
                    else:
                        secret_store.delete_secret("opensky_client_secret")
                    # Invalidar token cache
                    try:
                        opensky_service.reset()
                    except AttributeError:
                        # Si reset no existe, usar invalidate
                        try:
                            opensky_service._auth.invalidate()
                        except AttributeError:
                            pass
                except Exception as exc:
                    logger.warning("[opensky] Failed to restore original credentials: %s", exc)
    except Exception as exc:
        logger.error("[opensky] Error in test_oauth endpoint: %s", exc)
        return {
            "ok": False,
            "reason": "internal_error",
            "message": str(exc)
        }


@app.get("/api/opensky/sample")
def get_opensky_sample(limit: int = 20) -> Dict[str, Any]:
    """Obtiene una muestra de vuelos de OpenSky.
    
    Args:
        limit: Número máximo de vuelos a retornar (default: 20, max: 100)
        
    Returns:
        Diccionario con {"count": N, "items": [...]}
    """
    try:
        limit = max(1, min(limit, 100))  # Limitar entre 1 y 100
        
        # Obtener configuración
        config = config_manager.read()
        opensky_cfg = getattr(config, "opensky", None)
        
        if not opensky_cfg or not opensky_cfg.enabled:
            return {
                "count": 0,
                "items": [],
                "enabled": False,
                "message": "OpenSky is disabled"
            }
        
        # Obtener snapshot más reciente
        snapshot = opensky_service.get_last_snapshot()
        if not snapshot or not snapshot.payload:
            return {
                "count": 0,
                "items": [],
                "enabled": True,
                "message": "No data available yet"
            }
        
        # Extraer vuelos del snapshot
        states = snapshot.payload.get("states", [])
        if not states:
            return {
                "count": 0,
                "items": [],
                "enabled": True,
                "message": "No flights in snapshot"
            }
        
        # Procesar vuelos (limitado a limit)
        items = []
        for state in states[:limit]:
            if not isinstance(state, list) or len(state) < 17:
                continue
            
            try:
                # Formato OpenSky: [icao24, callsign, origin_country, time_position, last_contact, 
                #                  longitude, latitude, baro_altitude, on_ground, velocity, heading,
                #                  vertical_rate, sensors, geo_altitude, squawk, spi, position_source]
                icao24 = state[0] if state[0] else None
                callsign = state[1].strip() if state[1] else None
                origin_country = state[2] if state[2] else None
                longitude = float(state[5]) if state[5] is not None else None
                latitude = float(state[6]) if state[6] is not None else None
                baro_altitude = float(state[7]) if state[7] is not None else None
                velocity = float(state[9]) if state[9] is not None else None
                heading = float(state[10]) if state[10] is not None else None
                vertical_rate = float(state[11]) if state[11] is not None else None
                geo_altitude = float(state[13]) if state[13] is not None else None
                
                items.append({
                    "icao24": icao24,
                    "callsign": callsign,
                    "origin_country": origin_country,
                    "longitude": longitude,
                    "latitude": latitude,
                    "baro_altitude": baro_altitude,
                    "geo_altitude": geo_altitude,
                    "velocity": velocity,
                    "heading": heading,
                    "vertical_rate": vertical_rate,
                    "on_ground": bool(state[8]) if state[8] is not None else None
                })
            except (ValueError, IndexError, TypeError) as exc:
                logger.debug("[opensky] Error parsing state: %s", exc)
                continue
        
        return {
            "count": len(items),
            "items": items,
            "enabled": True,
            "snapshot_age_sec": int(time.time() - snapshot.fetched_at) if snapshot.fetched_at else None,
            "stale": snapshot.stale
        }
    except Exception as exc:
        logger.error("[opensky] Error getting sample: %s", exc)
        return {
            "count": 0,
            "items": [],
            "error": str(exc)
        }


def _set_opensky_error(message: Optional[str]) -> None:
    global _opensky_last_error
    _opensky_last_error = message


@app.get("/api/weather")
def get_weather() -> Dict[str, Any]:
    return _load_or_default("weather")


@app.get("/api/weather/weekly")
async def get_weather_weekly(
    lat: Optional[float] = None,
    lon: Optional[float] = None
) -> Dict[str, Any]:
    """Obtiene pronóstico semanal de OpenWeatherMap (7 días) de forma asíncrona."""
    # Valores por defecto: Castellón
    DEFAULT_LAT = 39.98
    DEFAULT_LON = 0.20
    
    # Usar valores por defecto si no se proporcionan o son inválidos
    if lat is None or not (-90 <= lat <= 90):
        if lat is not None:
            logger.warning("[weather/weekly] Invalid latitude: %s, using default: %s", lat, DEFAULT_LAT)
        lat = DEFAULT_LAT
    if lon is None or not (-180 <= lon <= 180):
        if lon is not None:
            logger.warning("[weather/weekly] Invalid longitude: %s, using default: %s", lon, DEFAULT_LON)
        lon = DEFAULT_LON
    
    logger.info("[weather/weekly] Fetching forecast for lat=%s, lon=%s", lat, lon)
    
    api_key = secret_store.get_secret("openweathermap_api_key")
    if not api_key:
        logger.warning("[weather/weekly] OpenWeatherMap API key not configured")
        return {
            "ok": False,
            "reason": "api_key_not_configured",
            "daily": [],
            "location": {"lat": lat, "lon": lon}
        }
    
    try:
        # Usar API 2.5 (One Call API 2.5) que es gratuita, en lugar de 3.0 que requiere suscripción
        # Nota: One Call API 2.5 está disponible hasta abril 2025, después de esa fecha se requiere suscripción
        url = "https://api.openweathermap.org/data/2.5/onecall"
        params = {
            "lat": lat,
            "lon": lon,
            "appid": api_key,
            "units": "metric",
            "lang": "es",
            "exclude": "current,minutely,hourly,alerts"
        }
        
        # CAMBIO: Uso de httpx asíncrono
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
        
        daily = []
        for day in data.get("daily", [])[:7]:
            # Extraer datos de precipitación (lluvia y nieve)
            rain = day.get("rain")
            snow = day.get("snow")
            # rain puede ser un número (mm) o un objeto con "1h" o "3h"
            rain_mm = None
            if isinstance(rain, (int, float)):
                rain_mm = rain
            elif isinstance(rain, dict):
                rain_mm = rain.get("1h") or rain.get("3h") or rain.get("24h")
            
            # snow puede ser un número (mm) o un objeto con "1h" o "3h"
            snow_mm = None
            if isinstance(snow, (int, float)):
                snow_mm = snow
            elif isinstance(snow, dict):
                snow_mm = snow.get("1h") or snow.get("3h") or snow.get("24h")
            
            daily.append({
                "date": datetime.fromtimestamp(day.get("dt", 0), tz=timezone.utc).isoformat(),
                "temp_max": day.get("temp", {}).get("max"),
                "temp_min": day.get("temp", {}).get("min"),
                "condition": day.get("weather", [{}])[0].get("description", ""),
                "icon": day.get("weather", [{}])[0].get("icon", ""),
                "humidity": day.get("humidity"),
                "wind_speed": day.get("wind_speed"),
                "rain": rain_mm,  # mm de lluvia acumulada
                "snow": snow_mm,  # mm de nieve acumulada
                "precipitation": rain_mm or snow_mm,  # Precipitación total (lluvia o nieve)
            })
        
        logger.info("[weather/weekly] Successfully fetched %d days of forecast", len(daily))
        return {
            "ok": True,
            "daily": daily,
            "location": {"lat": lat, "lon": lon}
        }
    except httpx.HTTPStatusError as e:
        error_msg = str(e)
        status_code = e.response.status_code if e.response else None
        try:
            error_body = e.response.json() if e.response else {}
            error_msg = error_body.get("message", error_msg) if error_body else error_msg
        except:
            pass
        logger.error("[weather/weekly] HTTP error fetching forecast: status=%s, error=%s", status_code, error_msg)
        return {
            "ok": False,
            "reason": "api_http_error",
            "error": error_msg,
            "status_code": status_code,
            "daily": [],
            "location": {"lat": lat, "lon": lon}
        }
    except httpx.RequestError as e:
        logger.error("[weather/weekly] Network error fetching forecast: %s", e)
        return {
            "ok": False,
            "reason": "api_network_error",
            "error": str(e),
            "daily": [],
            "location": {"lat": lat, "lon": lon}
        }
    except Exception as e:
        logger.error("[weather/weekly] Unexpected error fetching forecast: %s", e, exc_info=True)
        return {
            "ok": False,
            "reason": "unexpected_error",
            "error": str(e),
            "daily": [],
            "location": {"lat": lat, "lon": lon}
        }


@app.get("/api/efemerides")
def get_efemerides(target_date: Optional[str] = None) -> Dict[str, Any]:
    """Obtiene efemérides históricas para una fecha específica.
    
    Args:
        target_date: Fecha en formato YYYY-MM-DD (opcional, por defecto: hoy)
        
    Returns:
        Diccionario con {"date": "YYYY-MM-DD", "count": N, "items": [...]}
    """
    try:
        # Leer configuración
        config = config_manager.read()
        
        # Obtener configuración del panel
        historical_events_config = None
        provider = "local"
        data_path = "/var/lib/pantalla-reloj/data/efemerides.json"
        wikimedia_config = None
        
        if config.panels and config.panels.historicalEvents:
            historical_events_config = config.panels.historicalEvents
            provider = historical_events_config.provider or "local"
            
            if provider == "local":
                if historical_events_config.local:
                    data_path = historical_events_config.local.data_path
            elif provider == "wikimedia":
                if historical_events_config.wikimedia:
                    wikimedia_config = {
                        "language": historical_events_config.wikimedia.language,
                        "event_type": historical_events_config.wikimedia.event_type,
                        "api_user_agent": historical_events_config.wikimedia.api_user_agent,
                        "max_items": historical_events_config.wikimedia.max_items,
                        "timeout_seconds": historical_events_config.wikimedia.timeout_seconds
                    }
                else:
                    # Configuración por defecto si no hay wikimedia config
                    wikimedia_config = {
                        "language": "es",
                        "event_type": "all",
                        "api_user_agent": "PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)",
                        "max_items": 10,
                        "timeout_seconds": 10
                    }
        
        # Parsear fecha si se proporciona
        parsed_date = None
        if target_date:
            try:
                parsed_date = datetime.strptime(target_date, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format. Expected YYYY-MM-DD, got: {target_date}"
                )
        
        # Obtener timezone del config
        tz_str = "Europe/Madrid"
        if hasattr(config, "display") and hasattr(config.display, "timezone"):
            tz_str = config.display.timezone or "Europe/Madrid"
        
        # Obtener efemérides
        result = get_efemerides_for_date(
            data_path=data_path if provider == "local" else None,
            target_date=parsed_date,
            tz_str=tz_str,
            provider=provider,
            wikimedia_config=wikimedia_config
        )
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting efemerides: %s", e, exc_info=True)
        # Retornar estructura vacía en lugar de 500
        return {
            "date": target_date or date.today().isoformat(),
            "count": 0,
            "items": []
        }


@app.get("/api/efemerides/status")
def get_efemerides_status() -> Dict[str, Any]:
    """Obtiene estado del servicio de efemérides históricas.
    
    Returns:
        Diccionario con información de estado
    """
    try:
        config = config_manager.read()
        
        historical_events_config = None
        enabled = False
        provider = "local"
        data_path = "/var/lib/pantalla-reloj/data/efemerides.json"
        
        if config.panels and config.panels.historicalEvents:
            historical_events_config = config.panels.historicalEvents
            enabled = historical_events_config.enabled
            provider = historical_events_config.provider or "local"
            if historical_events_config.local:
                data_path = historical_events_config.local.data_path
        
        # Verificar estado según el proveedor
        status = "ok"
        last_load_iso = None
        
        if provider == "local":
            # Verificar estado del archivo
            path = Path(data_path)
            if not path.exists():
                status = "missing"
            else:
                try:
                    # Intentar cargar datos para verificar validez
                    data = load_efemerides_data(data_path)
                    if data:
                        # Obtener fecha de modificación
                        mtime = path.stat().st_mtime
                        last_load_iso = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                    else:
                        status = "empty"
                except Exception as e:
                    logger.warning("Error loading efemerides for status: %s", e)
                    status = "error"
                    last_load_iso = None
        elif provider == "wikimedia":
            # Para Wikimedia, verificar conectividad
            try:
                # Hacer una petición de prueba (hoy)
                today = date.today()
                test_config = {
                    "language": "es",
                    "event_type": "all",
                    "api_user_agent": "PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)",
                    "max_items": 1,
                    "timeout_seconds": 5
                }
                if historical_events_config and historical_events_config.wikimedia:
                    test_config = {
                        "language": historical_events_config.wikimedia.language,
                        "event_type": historical_events_config.wikimedia.event_type,
                        "api_user_agent": historical_events_config.wikimedia.api_user_agent,
                        "max_items": 1,
                        "timeout_seconds": historical_events_config.wikimedia.timeout_seconds
                    }
                
                test_result = fetch_wikimedia_onthisday(
                    month=today.month,
                    day=today.day,
                    **test_config
                )
                
                if test_result and (test_result.get("events") or test_result.get("births")):
                    status = "ok"
                    last_load_iso = datetime.now(timezone.utc).isoformat()
                else:
                    status = "empty"
            except Exception as e:
                logger.warning("Error checking Wikimedia API status: %s", e)
                status = "error"
                last_load_iso = None
        
        return {
            "enabled": enabled,
            "provider": provider,
            "status": status,
            "last_load_iso": last_load_iso,
            "data_path": data_path if provider == "local" else None
        }
    
    except Exception as e:
        logger.error("Error getting efemerides status: %s", e, exc_info=True)
        return {
            "enabled": False,
            "provider": "local",
            "status": "error",
            "last_load_iso": None,
            "data_path": "/var/lib/pantalla-reloj/data/efemerides.json"
        }


@app.post("/api/efemerides/upload")
async def upload_efemerides(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Sube y guarda archivo JSON de efemérides históricas.
    
    Args:
        file: Archivo JSON con estructura {"MM-DD": ["evento1", ...]}
        
    Returns:
        Diccionario con información del guardado
    """
    try:
        # Leer configuración
        config = config_manager.read()
        
        # Obtener configuración del panel
        historical_events_config = None
        if config.panels and config.panels.historicalEvents:
            historical_events_config = config.panels.historicalEvents
        
        # Ruta por defecto si no hay configuración
        data_path = "/var/lib/pantalla-reloj/data/efemerides.json"
        if historical_events_config and historical_events_config.local:
            data_path = historical_events_config.local.data_path
        
        # Procesar archivo subido
        data = await upload_efemerides_file(file)
        
        # Guardar datos
        result = save_efemerides_data(data_path, data)
        
        # Invalidar cache de efemérides en cache_store si existe
        try:
            cache_store.invalidate("efemerides")
        except Exception:
            pass  # Ignorar si no hay cache store configurado
        
        # Añadir timestamp para invalidación de cache del frontend
        result["cache_invalidated"] = True
        result["timestamp"] = datetime.now(timezone.utc).isoformat()
        
        return result
    
    except HTTPException:
        raise
    except ValueError as e:
        # Errores de validación → 400
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error uploading efemerides: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error uploading efemerides: {str(e)}"
        )


@app.get("/api/news")
async def get_news() -> Dict[str, Any]:
    """Obtiene noticias de feeds RSS configurados (legacy endpoint)."""
    try:
        config = config_manager.read()
    except Exception:
        return {"items": [], "updated_at": datetime.now(timezone.utc).isoformat()}
    
    # Usar feeds de v2 panels.news si existe
    feeds = []
    if config.panels and config.panels.news and config.panels.news.feeds:
        feeds = config.panels.news.feeds
    
    if not feeds:
        return {"items": [], "updated_at": datetime.now(timezone.utc).isoformat()}
    
    # Obtener noticias de todos los feeds
    all_items: List[Dict[str, Any]] = []
    
    for feed_url in feeds:
        if not feed_url or not feed_url.strip():
            continue
        
        try:
            items = await parse_rss_feed(feed_url, max_items=10)
            all_items.extend(items)
        except Exception as exc:
            logger.warning("Failed to fetch RSS feed %s: %s", feed_url, exc)
            continue
    
    # Ordenar por fecha
    all_items.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    
    # Limitar total a 20
    all_items = all_items[:20]
    
    payload = {
        "items": all_items,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    
    return payload


@app.post("/api/news/rss")
async def post_news_rss(request: Request) -> Dict[str, Any]:
    """Obtiene noticias de feeds RSS proporcionados en el body."""
    try:
        body = await request.json()
        feeds = body.get("feeds", [])
    except Exception:
        feeds = []
    
    if not feeds or not isinstance(feeds, list):
        return {"items": []}
    
    # Obtener noticias de todos los feeds
    all_items: List[Dict[str, Any]] = []
    
    for feed_url in feeds[:10]:  # Máximo 10 feeds
        if not feed_url or not isinstance(feed_url, str) or not feed_url.strip():
            continue
        
        try:
            items = await parse_rss_feed(feed_url.strip(), max_items=10)
            for item in items:
                # Normalizar formato
                all_items.append({
                    "title": item.get("title", ""),
                    "link": item.get("link", ""),
                    "source": feed_url,
                    "published": item.get("published_at", item.get("published", ""))
                })
        except Exception as exc:
            logger.warning("Failed to fetch RSS feed %s: %s", feed_url, exc)
            continue
    
    # Ordenar por fecha
    all_items.sort(key=lambda x: x.get("published", ""), reverse=True)
    
    # Limitar total a 20
    all_items = all_items[:20]
    
    return {"items": all_items}


@app.get("/api/news/sample")
async def get_news_sample(limit: int = 10) -> Dict[str, Any]:
    """Obtiene una muestra de noticias de los feeds configurados.
    
    Args:
        limit: Número máximo de noticias a retornar (por defecto: 10)
        
    Returns:
        Diccionario con {"items": [...], "updated_at": "..."}
    """
    try:
        config = config_manager.read()
        
        # Usar feeds de v2 panels.news si existe
        feeds = []
        if config.panels and config.panels.news and config.panels.news.feeds:
            feeds = config.panels.news.feeds
        
        # Fallback a news top-level
        if not feeds and hasattr(config, "news") and config.news and config.news.rss_feeds:
            feeds = config.news.rss_feeds
        
        if not feeds:
            return {"items": [], "updated_at": datetime.now(timezone.utc).isoformat()}
        
        # Obtener noticias de todos los feeds
        all_items: List[Dict[str, Any]] = []
        
        for feed_url in feeds[:10]:  # Máximo 10 feeds
            if not feed_url or not feed_url.strip():
                continue
            
            try:
                items = await parse_rss_feed(feed_url.strip(), max_items=limit)
                all_items.extend(items)
            except Exception as exc:
                logger.warning("Failed to fetch RSS feed %s: %s", feed_url, exc)
                continue
        
        # Ordenar por fecha (más recientes primero)
        all_items.sort(key=lambda x: x.get("published_at", ""), reverse=True)
        
        # Limitar total
        all_items = all_items[:limit]
        
        return {
            "items": all_items,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(all_items)
        }
    except Exception as exc:
        logger.error("[news] Error getting news sample: %s", exc)
        return {"items": [], "updated_at": datetime.now(timezone.utc).isoformat(), "count": 0}


@app.post("/api/news/test")
async def test_news(request: NewsTestFeedsRequest) -> Dict[str, Any]:
    """Alias para POST /api/news/test_feeds."""
    return await test_news_feeds(request)


@app.post("/api/news/test_feeds")
async def test_news_feeds(request: NewsTestFeedsRequest) -> Dict[str, Any]:
    """Prueba múltiples feeds RSS/Atom y devuelve información detallada de cada uno.
    
    Para cada feed:
    - Verifica que sea accesible (timeout 3-5s)
    - Sigue redirecciones
    - Verifica content-type (rss/atom/xml)
    - Cuenta items
    - Extrae título del feed
    """
    results: List[Dict[str, Any]] = []
    
    for feed_url in request.feeds[:10]:  # Máximo 10 feeds
        if not feed_url or not feed_url.strip():
            continue
        
        feed_url = feed_url.strip()
        result: Dict[str, Any] = {
            "url": feed_url,
            "reachable": False,
            "items": 0,
            "title": None,
            "error": None
        }
        
        try:
            # CAMBIO: Usar httpx asíncrono
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                response = await client.get(
                    feed_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (compatible; PantallaReloj/1.0)"
                    }
                )
            
            # Verificar status code
            if response.status_code != 200:
                result["error"] = f"HTTP {response.status_code}"
                results.append(result)
                continue
            
            # Verificar content-type
            content_type = response.headers.get("content-type", "").lower()
            if "xml" not in content_type and "rss" not in content_type and "atom" not in content_type:
                result["error"] = f"Invalid content-type: {content_type}"
                results.append(result)
                continue
            
            # Parsear feed
            try:
                items = await parse_rss_feed(feed_url, max_items=100, timeout=5)
                result["reachable"] = True
                result["items"] = len(items)
                
                # Intentar extraer título del feed principal
                content = response.text
                title_match = re.search(
                    r'<(?:title|dc:title)[^>]*>(.*?)</(?:title|dc:title)>',
                    content[:2000],  # Buscar solo en los primeros 2000 caracteres
                    re.DOTALL | re.IGNORECASE
                )
                if title_match:
                    title = html.unescape(re.sub(r'<[^>]+>', '', title_match.group(1)).strip())
                    result["title"] = title[:100]  # Limitar a 100 caracteres
            except Exception as parse_exc:
                result["error"] = f"Parse error: {str(parse_exc)}"
                result["reachable"] = True  # El feed es accesible pero no se puede parsear
            
        except httpx.TimeoutException:
            result["error"] = "timeout"
        except httpx.RequestError as exc:
            result["error"] = str(exc)
        except Exception as exc:
            result["error"] = f"internal_error: {str(exc)}"
        
        results.append(result)
    
    return {
        "ok": True,
        "results": results
    }


# Legacy news endpoint code removed - using v2-compatible version above


@app.get("/api/astronomy")
def get_astronomy() -> Dict[str, Any]:
    """Obtiene datos astronómicos ampliados (fases lunares, salida/puesta de sol, duración del día, crepúsculos).
    
    Retorna información extendida con próximas fases lunares, duración del día,
    mediodía solar y crepúsculos (dawn/dusk). Mantiene retrocompatibilidad con campos básicos.
    """
    config = config_manager.read()
    ephemerides_config = config.ephemerides
    
    # Verificar si las efemérides están habilitadas
    # Primero desde ephemerides.enabled (top-level), luego desde panels.ephemerides.enabled
    ephemerides_enabled = getattr(ephemerides_config, "enabled", None)
    if ephemerides_enabled is None:
        # Si no existe en top-level, verificar en panels
        panels_config = getattr(config, "panels", None)
        if panels_config:
            ephemerides_panel = getattr(panels_config, "ephemerides", None)
            if ephemerides_panel:
                ephemerides_enabled = getattr(ephemerides_panel, "enabled", True)
        else:
            ephemerides_enabled = True  # Por defecto habilitado
    
    if ephemerides_enabled is False:
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


@app.get("/api/calendar/events")
async def get_calendar_events(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    inspect: Optional[int] = None,
    debug: Optional[int] = None,
) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
    """Obtiene eventos del calendario (Google Calendar) entre fechas.
    
    Si no se proporcionan fechas, usa el rango del día local actual según config.display.timezone.
    Si se proporcionan en ISO UTC, las interpreta como UTC pero loguea su proyección local.
    
    Args:
        from_date: Fecha de inicio en ISO UTC (opcional)
        to_date: Fecha de fin en ISO UTC (opcional)
        inspect: Si es 1, devuelve información de diagnóstico en lugar de eventos
        debug: Alias de inspect para compatibilidad
    """
    inspect_mode = inspect == 1 or debug == 1
    
    try:
        config = config_manager.read()
    except Exception as exc:
        if inspect_mode:
            return {
                "tz": None,
                "local_range": {"start": None, "end": None},
                "utc_range": {"start": None, "end": None},
                "provider": "google",
                "provider_enabled": False,
                "credentials_present": False,
                "calendars_found": 0,
                "raw_events_count": 0,
                "filtered_events_count": 0,
                "note": f"Config v2 read failed: {exc}",
            }
        return []
    
    # Determinar provider de calendario desde config
    calendar_provider, enabled, ics_path = _resolve_calendar_settings(config)

    # Si provider es "disabled" o enabled es False, retornar inmediatamente
    if calendar_provider == "disabled" or not enabled:
        if inspect_mode:
            return {
                "tz": str(_get_tz()),
                "local_range": {"start": None, "end": None},
                "utc_range": {"start": None, "end": None},
                "provider": calendar_provider,
                "provider_enabled": False,
                "credentials_present": False,
                "calendars_found": 0,
                "raw_events_count": 0,
                "filtered_events_count": 0,
                "note": f"Calendar provider is disabled (provider={calendar_provider}, enabled={enabled})",
            }
        return []
    
    # Leer credenciales según provider
    credentials_present = False
    calendars_found = 0
    api_key: Optional[str] = None
    calendar_id: Optional[str] = None

    if calendar_provider == "google":
        api_key = secret_store.get_secret("google_calendar_api_key") or secret_store.get_secret("google_api_key")
        calendar_id = secret_store.get_secret("google_calendar_id")
        credentials_present = bool(api_key and calendar_id)
        calendars_found = 1 if calendar_id else 0
    elif calendar_provider == "ics":
        credentials_present = _ics_path_is_readable(ics_path)
        calendars_found = 1 if credentials_present else 0

    provider_enabled = enabled
    
    # Parsear fechas con soporte de timezone
    tz = _get_tz()
    tz_str = str(tz)
    local_start: Optional[datetime] = None
    local_end: Optional[datetime] = None
    utc_start: Optional[datetime] = None
    utc_end: Optional[datetime] = None
    
    try:
        if from_date:
            # Interpretar como UTC si termina en Z o tiene offset
            from_dt = datetime.fromisoformat(from_date.replace('Z', '+00:00'))
            # Loguear proyección local para trazabilidad
            from_local = from_dt.astimezone(tz)
            local_start = from_local
            utc_start = from_dt
            logger.debug(
                "[timezone] Calendar from_date: UTC=%s -> Local=%s (tz=%s)",
                from_dt.isoformat(),
                from_local.isoformat(),
                tz_str,
            )
        else:
            # Construir rango del día local actual [00:00, 23:59:59] y convertir a UTC
            from_dt, _ = _get_local_day_range()
            now_local = datetime.now(tz)
            local_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
            utc_start = from_dt
            logger.debug(
                "[timezone] Calendar from_date: using local day range start (UTC=%s, tz=%s)",
                from_dt.isoformat(),
                tz_str,
            )
        
        if to_date:
            # Interpretar como UTC si termina en Z o tiene offset
            to_dt = datetime.fromisoformat(to_date.replace('Z', '+00:00'))
            # Loguear proyección local para trazabilidad
            to_local = to_dt.astimezone(tz)
            local_end = to_local
            utc_end = to_dt
            logger.debug(
                "[timezone] Calendar to_date: UTC=%s -> Local=%s (tz=%s)",
                to_dt.isoformat(),
                to_local.isoformat(),
                tz_str,
            )
        else:
            # Si no hay from_date, usar rango del día local; si hay, usar from_date + 7 días
            if from_date:
                to_dt = from_dt + timedelta(days=7)
                utc_end = to_dt
                local_end = to_dt.astimezone(tz)
            else:
                _, to_dt = _get_local_day_range()
                utc_end = to_dt
                now_local = datetime.now(tz)
                local_end = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)
                logger.debug(
                    "[timezone] Calendar to_date: using local day range end (UTC=%s, tz=%s)",
                    to_dt.isoformat(),
                    tz_str,
                )
    except Exception as e:
        logger.warning("[timezone] Error parsing dates: %s, using local day range", e)
        from_dt, to_dt = _get_local_day_range()
        now_local = datetime.now(tz)
        local_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        local_end = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)
        utc_start = from_dt
        utc_end = to_dt
    
    # Log detallado en modo inspect o debug
    logger.debug(
        "[Calendar] tz=%s local_start=%s local_end=%s utc_start=%s utc_end=%s provider=%s creds=%s calendars=%s",
        tz_str,
        local_start.isoformat() if local_start else None,
        local_end.isoformat() if local_end else None,
        utc_start.isoformat() if utc_start else None,
        utc_end.isoformat() if utc_end else None,
        calendar_provider,
        credentials_present,
        calendars_found,
    )
    
    if not credentials_present:
        if calendar_provider == "google":
            note = "Credentials missing: api_key or calendar_id not found in secrets"
        else:  # ics
            note = "ICS source missing: readable calendar.ics_path not provided"

        if inspect_mode:
            return {
                "tz": tz_str,
                "local_range": {
                    "start": local_start.isoformat() if local_start else None,
                    "end": local_end.isoformat() if local_end else None,
                },
                "utc_range": {
                    "start": utc_start.isoformat() if utc_start else None,
                    "end": utc_end.isoformat() if utc_end else None,
                },
                "provider": calendar_provider,
                "provider_enabled": provider_enabled,
                "credentials_present": credentials_present,
                "calendars_found": calendars_found,
                "raw_events_count": 0,
                "filtered_events_count": 0,
                "note": note,
            }
        if calendar_provider == "ics":
            _update_calendar_runtime_state("ics", enabled, "error", note, ics_path)
        return []
    
    raw_events_count = 0
    filtered_events_count = 0
    note: Optional[str] = None
    
    try:
        # Calcular días hacia adelante
        days_ahead = max(1, (utc_end - utc_start).days) if utc_end and utc_start else 7
        
        # Obtener eventos según provider
        if calendar_provider == "google":
            # Llamada a la nueva versión async
            events = await fetch_google_calendar_events(
                api_key=api_key or "",
                calendar_id=calendar_id or "",
                days_ahead=days_ahead,
                max_results=20,
                time_min=utc_start,
                time_max=utc_end,
            )
        else:  # ics
            # Ejecutar en thread porque es disco local
            events = await asyncio.to_thread(
                fetch_ics_calendar_events,
                path=ics_path if credentials_present else None,
                time_min=utc_start,
                time_max=utc_end,
            )
            _update_calendar_runtime_state("ics", enabled, "ok", None, ics_path)
        
        raw_events_count = len(events) if isinstance(events, list) else 0
        
        # Normalizar formato: añadir campos fin y ubicación si faltan
        normalized_events = []
        for event in (events if isinstance(events, list) else []):
            normalized = {
                "title": event.get("title", event.get("summary", "Evento sin título")),
                "start": event.get("start", ""),
                "end": event.get("end", event.get("start", "")),
                "location": event.get("location", ""),
            }
            normalized_events.append(normalized)
        
        filtered_events_count = len(normalized_events)
        
        if inspect_mode:
            return {
                "tz": tz_str,
                "local_range": {
                    "start": local_start.isoformat() if local_start else None,
                    "end": local_end.isoformat() if local_end else None,
                },
                "utc_range": {
                    "start": utc_start.isoformat() if utc_start else None,
                    "end": utc_end.isoformat() if utc_end else None,
                },
                "provider": calendar_provider,
                "provider_enabled": provider_enabled,
                "credentials_present": credentials_present,
                "calendars_found": calendars_found,
                "raw_events_count": raw_events_count,
                "filtered_events_count": filtered_events_count,
                "note": note or "OK",
            }
        
        return normalized_events
    except Exception as exc:
        logger.warning("[Calendar] Failed to fetch calendar events (provider=%s): %s", calendar_provider, exc)
        note = f"API error: {exc}"
        if calendar_provider == "ics":
            _update_calendar_runtime_state("ics", enabled, "error", note, ics_path)
        if inspect_mode:
            return {
                "tz": tz_str,
                "local_range": {
                    "start": local_start.isoformat() if local_start else None,
                    "end": local_end.isoformat() if local_end else None,
                },
                "utc_range": {
                    "start": utc_start.isoformat() if utc_start else None,
                    "end": utc_end.isoformat() if utc_end else None,
                },
                "provider": calendar_provider,
                "provider_enabled": provider_enabled,
                "credentials_present": credentials_present,
                "calendars_found": calendars_found,
                "raw_events_count": raw_events_count,
                "filtered_events_count": filtered_events_count,
                "note": note,
            }
        return []


@app.get("/api/calendar/status")
def get_calendar_status() -> Dict[str, Any]:
    """Obtiene el estado del calendario (provider, credenciales, estado)."""
    try:
        config = config_manager.read()
    except Exception as exc:
        return {
            "status": "error",
            "provider": "unknown",
            "detail": f"Config read failed: {exc}",
        }
    
    # Determinar provider de calendario
    calendar_provider, enabled, ics_path = _resolve_calendar_settings(config)

    # Si provider es "disabled" o enabled es False, retornar inmediatamente
    if calendar_provider == "disabled" or not enabled:
        return {
            "status": "empty",
            "provider": calendar_provider,
            "detail": "Calendar disabled",
        }
    
    # Leer credenciales según provider
    status = "error"
    detail: Optional[str] = None
    
    if calendar_provider == "google":
        api_key = secret_store.get_secret("google_calendar_api_key") or secret_store.get_secret("google_api_key")
        calendar_id = secret_store.get_secret("google_calendar_id")
        credentials_present = bool(api_key and calendar_id)
        
        if enabled and credentials_present:
            status = "ok"
            detail = "Google Calendar configured and ready"
        elif enabled and not credentials_present:
            status = "error"
            detail = "Calendar provider 'google' requires api_key and calendar_id"
        else:
            status = "empty"
            detail = "Calendar disabled"
    
    elif calendar_provider == "ics":
        credentials_present = _ics_path_is_readable(ics_path)

        if enabled and credentials_present:
            status = "ok"
            detail = "ICS calendar file accessible"
        elif enabled and not credentials_present:
            if not ics_path or not ics_path.strip():
                status = "empty"
                detail = "ICS calendar path not configured"
            else:
                status = "error"
                path_obj = Path(ics_path.strip())
                if path_obj.exists() and path_obj.is_file():
                    detail = f"Calendar provider 'ics' requires readable file at calendar.ics_path (permission denied: {path_obj})"
                else:
                    detail = f"Calendar provider 'ics' requires readable file at calendar.ics_path (not found: {path_obj})"
        else:
            status = "empty"
            detail = "Calendar disabled"
    else:
        status = "error"
        detail = f"Unknown provider: {calendar_provider}"
    
    result: Dict[str, Any] = {
        "status": status,
        "provider": calendar_provider,
        "detail": detail or "OK",
    }
    
    if calendar_provider == "ics" and ics_path:
        result["ics_path"] = ics_path
    
    return result


@app.post("/api/calendar/test")
async def test_calendar(request: Optional[CalendarTestRequest] = Body(default=None)) -> Dict[str, Any]:
    """Prueba el origen de calendario activo (ICS o Google).
    
    Si source="ics": verifica archivo y cuenta eventos.
    Si source="google": valida credenciales y hace query mínima.
    
    Si no se proporciona request body, usa el origen activo de la configuración.
    """
    try:
        config = config_manager.read()
        config_data = config.model_dump(mode="json", exclude_none=True)
        
        calendar_config = config_data.get("calendar", {})
        if not calendar_config.get("enabled", False):
            return {
                "ok": False,
                "reason": "calendar_disabled",
                "message": "Calendar is disabled"
            }
        
        source = calendar_config.get("source", "google")
        days_ahead = calendar_config.get("days_ahead", 14)
        
        if source == "ics":
            # Verificar ICS
            ics_config = calendar_config.get("ics", {})
            # Intentar obtener stored_path primero, luego file_path (legacy)
            file_path = ics_config.get("stored_path") or ics_config.get("file_path")
            # Si no hay stored_path, intentar current.ics como fallback
            if not file_path:
                current_ics_path = ICS_STORAGE_DIR / "current.ics"
                if current_ics_path.exists():
                    file_path = str(current_ics_path)
            
            if not file_path:
                return {
                    "ok": False,
                    "source": "ics",
                    "reason": "no_ics_uploaded",
                    "message": "No ICS file uploaded. Please upload an ICS file first.",
                    "tip": "Upload an ICS file via /api/calendar/ics/upload"
                }
            
            # Verificar que el archivo existe y es legible
            path_obj = Path(file_path)
            if not path_obj.exists() or not path_obj.is_file():
                return {
                    "ok": False,
                    "source": "ics",
                    "reason": "file_not_found",
                    "message": f"ICS file not found: {file_path}"
                }
            
            if not os.access(path_obj, os.R_OK):
                return {
                    "ok": False,
                    "source": "ics",
                    "reason": "file_not_readable",
                    "message": f"ICS file not readable: {file_path}"
                }
            
            # Parsear y contar eventos
            try:
                now = datetime.now(timezone.utc)
                days_ahead_actual = ics_config.get("days_ahead", days_ahead) if isinstance(ics_config, dict) else days_ahead
                time_max = now + timedelta(days=min(days_ahead_actual, 90))
                
                # Obtener eventos próximos (limitados a 5 para sample)
                events_raw = fetch_ics_calendar_events(path=file_path, time_min=now, time_max=time_max)
                
                # Normalizar eventos para devolver sample (próximos 5)
                sample_events = []
                for event in events_raw[:5]:
                    start_str = event.get("start", "")
                    end_str = event.get("end", start_str)
                    
                    # Determinar si es allDay (evento sin hora específica)
                    all_day = False
                    try:
                        if start_str:
                            # Si es solo fecha (sin hora), es allDay
                            if "T" not in start_str:
                                all_day = True
                            else:
                                # Verificar si la hora es 00:00:00
                                start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                                if start_dt.hour == 0 and start_dt.minute == 0 and start_dt.second == 0:
                                    # Verificar si termina al día siguiente a las 00:00:00
                                    if end_str:
                                        end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                                        if (end_dt - start_dt).days == 1 and end_dt.hour == 0:
                                            all_day = True
                    except Exception:
                        pass
                    
                    sample_events.append({
                        "title": event.get("title", "Evento sin título"),
                        "start": start_str,
                        "end": end_str,
                        "location": event.get("location", ""),
                        "allDay": all_day
                    })
                
                # Actualizar last_ok en config
                try:
                    if "ics" not in calendar_config:
                        calendar_config["ics"] = {}
                    calendar_config["ics"]["last_ok"] = datetime.now(timezone.utc).isoformat()
                    calendar_config["ics"]["last_error"] = None
                    config_data["calendar"] = calendar_config
                    config_manager._atomic_write_v2(config_data)
                except Exception:
                    pass  # No bloquear si no se puede actualizar
                
                return {
                    "ok": True,
                    "source": "ics",
                    "count": len(events_raw),
                    "sample": sample_events,
                    "range_days": days_ahead_actual
                }
            except ICSCalendarError as exc:
                # Actualizar last_error en config
                try:
                    if "ics" not in calendar_config:
                        calendar_config["ics"] = {}
                    calendar_config["ics"]["last_error"] = str(exc)
                    config_data["calendar"] = calendar_config
                    config_manager._atomic_write_v2(config_data)
                except Exception:
                    pass
                
                return {
                    "ok": False,
                    "source": "ics",
                    "reason": "parse_error",
                    "message": f"Invalid ICS file: {str(exc)}",
                    "tip": "Please check the ICS file format and try again."
                }
        
        elif source == "google":
            # Verificar Google Calendar
            api_key = request.api_key if request else None
            calendar_id = request.calendar_id if request else None
            
            # Si no se proporcionan, intentar obtener de secrets o config
            if not api_key:
                api_key = secret_store.get_secret("google_calendar_api_key") or secret_store.get_secret("google_api_key")
            if not api_key:
                api_key = calendar_config.get("google_api_key")
            
            if not calendar_id:
                calendar_id = secret_store.get_secret("google_calendar_id")
            if not calendar_id:
                calendar_id = calendar_config.get("google_calendar_id")
            
            if not api_key or not calendar_id:
                return {
                    "ok": False,
                    "source": "google",
                    "reason": "missing_google_config",
                    "message": "Google Calendar requires api_key and calendar_id",
                    "tip": "Please configure Google Calendar API key and Calendar ID in secrets."
                }
            
            try:
                # Hacer una query mínima con timeout
                now = datetime.now(timezone.utc)
                time_min = now
                time_max = now + timedelta(days=min(days_ahead, 7))
                
                events = await fetch_google_calendar_events(
                    api_key=api_key,
                    calendar_id=calendar_id,
                    days_ahead=min(days_ahead, 7),
                    max_results=5,
                    time_min=time_min,
                    time_max=time_max
                )
                
                # Normalizar eventos para devolver sample (próximos 5)
                sample_events = []
                for event in events[:5]:
                    start_str = event.get("start", "")
                    end_str = event.get("end", start_str)
                    
                    # Determinar si es allDay
                    all_day = event.get("allDay", False)
                    
                    sample_events.append({
                        "title": event.get("title", "Evento sin título"),
                        "start": start_str,
                        "end": end_str,
                        "location": event.get("location", ""),
                        "allDay": all_day
                    })
                
                return {
                    "ok": True,
                    "source": "google",
                    "count": len(events),
                    "sample": sample_events,
                    "message": f"Successfully connected. Found {len(events)} events in next {min(days_ahead, 7)} days."
                }
            except requests.HTTPError as exc:
                status_code = exc.response.status_code if hasattr(exc, 'response') else 0
                if status_code == 401 or status_code == 403:
                    return {
                        "ok": False,
                        "source": "google",
                        "reason": "unauthorized",
                        "message": "Invalid API key or calendar ID"
                    }
                else:
                    return {
                        "ok": False,
                        "source": "google",
                        "reason": "http_error",
                        "message": f"HTTP {status_code}: {str(exc)}"
                    }
        
        else:
            return {
                "ok": False,
                "reason": "unknown_source",
                "message": f"Unknown calendar source: {source}"
            }
    except Exception as exc:
        logger.error("[calendar] Error testing calendar: %s", exc)
        return {
            "ok": False,
            "reason": "internal_error",
            "message": str(exc)
        }


@app.get("/api/calendar/preview")
async def get_calendar_preview(limit: int = 10) -> Dict[str, Any]:
    """Obtiene preview de próximos eventos del calendario activo.
    
    Args:
        limit: Número máximo de eventos a devolver (default: 10)
    
    Returns:
        Dict con source, count, items (eventos normalizados)
    """
    try:
        config = config_manager.read()
        config_data = config.model_dump(mode="json", exclude_none=True)
        
        calendar_config = config_data.get("calendar", {})
        if not calendar_config.get("enabled", False):
            return {
                "ok": False,
                "error": "calendar_disabled",
                "message": "Calendar is disabled"
            }
        
        source = calendar_config.get("source", "google")
        days_ahead = calendar_config.get("days_ahead", 14)
        
        now = datetime.now(timezone.utc)
        time_max = now + timedelta(days=days_ahead)
        
        items: List[Dict[str, Any]] = []
        
        if source == "ics":
            ics_config = calendar_config.get("ics", {})
            file_path = ics_config.get("file_path")
            
            if not file_path:
                return {
                    "ok": False,
                    "source": "ics",
                    "error": "missing_file_path",
                    "message": "ICS file path not configured"
                }
            
            try:
                events = fetch_ics_calendar_events(path=file_path, time_min=now, time_max=time_max)
                
                # Normalizar eventos
                for event in events[:limit]:
                    start_dt = event.get("start")
                    end_dt = event.get("end")
                    
                    # Convertir datetime a ISO string si es necesario
                    start_str = start_dt.isoformat() if isinstance(start_dt, datetime) else str(start_dt)
                    end_str = end_dt.isoformat() if isinstance(end_dt, datetime) else str(end_dt)
                    
                    # Determinar si es all_day (si start es date sin hora)
                    all_day = False
                    if isinstance(start_dt, datetime):
                        all_day = start_dt.hour == 0 and start_dt.minute == 0 and start_dt.second == 0
                    
                    items.append({
                        "title": event.get("title", ""),
                        "start": start_str,
                        "end": end_str,
                        "location": event.get("location", ""),
                        "all_day": all_day
                    })
            except ICSCalendarError as exc:
                return {
                    "ok": False,
                    "source": "ics",
                    "error": "parse_error",
                    "message": f"Invalid ICS file: {str(exc)}"
                }
        
        elif source == "google":
            api_key = secret_store.get_secret("google_calendar_api_key") or secret_store.get_secret("google_api_key")
            calendar_id = secret_store.get_secret("google_calendar_id")
            
            if not api_key or not calendar_id:
                return {
                    "ok": False,
                    "source": "google",
                    "error": "missing_credentials",
                    "message": "Google Calendar requires api_key and calendar_id"
                }
            
            try:
                events = await fetch_google_calendar_events(
                    api_key=api_key,
                    calendar_id=calendar_id,
                    days_ahead=days_ahead,
                    max_results=limit,
                    time_min=now,
                    time_max=time_max
                )
                
                # Normalizar eventos de Google
                for event in events:
                    start_str = event.get("start", "")
                    end_str = event.get("end", "")
                    
                    # Determinar all_day (si start es solo fecha sin hora)
                    all_day = "T" not in start_str if isinstance(start_str, str) else False
                    
                    items.append({
                        "title": event.get("title", ""),
                        "start": start_str,
                        "end": end_str,
                        "location": event.get("location", ""),
                        "all_day": all_day
                    })
            except Exception as exc:
                return {
                    "ok": False,
                    "source": "google",
                    "error": "fetch_error",
                    "message": str(exc)
                }
        else:
            return {
                "ok": False,
                "error": "unknown_source",
                "message": f"Unknown calendar source: {source}"
            }
        
        return {
            "ok": True,
            "source": source,
            "count": len(items),
            "items": items
        }
    except Exception as exc:
        logger.error("[calendar] Error getting preview: %s", exc)
        return {
            "ok": False,
            "error": "internal_error",
            "message": str(exc)
        }


@app.get("/api/calendar")
async def get_calendar() -> Dict[str, Any]:
    """Obtiene datos del calendario (eventos, hortalizas, santoral)."""
    config = config_manager.read()
    calendar_config = getattr(config, "calendar", None)
    
    # Leer configuración de harvest desde v2 o v1
    harvest_config = None
    if hasattr(config, "version") and config.version == 2:
        # V2: panels.harvest
        if hasattr(config, "panels") and config.panels:
            harvest_config = getattr(config.panels, "harvest", None)
    # Fallback a v1: harvest
    if harvest_config is None:
        harvest_config = getattr(config, "harvest", None)
    
    saints_config = getattr(config, "saints", None)

    provider, calendar_enabled, ics_path = _resolve_calendar_settings(config)

    # Verificar caché
    cached = cache_store.load("calendar", max_age_minutes=60)
    if cached:
        return cached.payload

    payload: Dict[str, Any] = {
        "enabled": bool(calendar_enabled),
        "provider": provider,
        "source": provider,
        "status": "disabled" if not calendar_enabled else "ok",
        "upcoming": [],
        "events": [],
        "harvest": [],
        "saints": [],
        "namedays": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    error_message: Optional[str] = None
    events: List[Dict[str, Any]] = []

    # Eventos de calendario según provider configurado
    if calendar_enabled:
        days_ahead = (
            getattr(calendar_config, "days_ahead", None)
            or getattr(getattr(calendar_config, "ics", None), "days_ahead", None)
            or 14
        )

        if provider == "google":
            api_key = (
                getattr(calendar_config, "google_api_key", None)
                or secret_store.get_secret("google_calendar_api_key")
                or secret_store.get_secret("google_api_key")
            )
            calendar_id = (
                getattr(calendar_config, "google_calendar_id", None)
                or secret_store.get_secret("google_calendar_id")
            )

            if not api_key or not calendar_id:
                payload["status"] = "error"
                error_message = "Google Calendar credentials are missing"
            else:
                try:
                    events = await fetch_google_calendar_events(
                        api_key=api_key,
                        calendar_id=calendar_id,
                        days_ahead=days_ahead,
                        max_results=20,
                    )
                except Exception as exc:
                    logger.warning("Failed to fetch Google Calendar events: %s", exc)
                    payload["status"] = "error"
                    error_message = f"Google Calendar error: {exc}"
        elif provider == "ics":
            file_path = ics_path or secret_store.get_secret("calendar_ics_path")

            if not file_path:
                payload["status"] = "error"
                error_message = "ICS calendar enabled but no file path configured"
            elif not _ics_path_is_readable(file_path):
                payload["status"] = "error"
                error_message = f"ICS calendar file is not readable: {file_path}"
            else:
                now = datetime.now(timezone.utc)
                time_max = now + timedelta(days=days_ahead)
                try:
                    events = fetch_ics_calendar_events(
                        path=str(file_path),
                        time_min=now,
                        time_max=time_max,
                    )
                except ICSCalendarError as exc:
                    logger.warning("Failed to fetch ICS calendar events: %s", exc)
                    payload["status"] = "error"
                    error_message = f"ICS calendar error: {exc}"
        else:
            payload["status"] = "error"
            error_message = f"Unknown calendar provider: {provider}"

    payload["upcoming"] = events
    payload["events"] = events
    if error_message:
        payload["error_message"] = error_message

    # Hortalizas estacionales (mejoradas con siembra y mantenimiento)
    # Si harvest_config es None o enabled no está definido, usar True por defecto
    harvest_enabled = False
    if harvest_config is not None:
        harvest_enabled = getattr(harvest_config, "enabled", True)
    else:
        # Si no hay configuración, habilitar por defecto para mostrar datos estacionales
        harvest_enabled = True
    
    if harvest_enabled:
        try:
            harvest_data = get_harvest_data(
                custom_items=getattr(harvest_config, "custom_items", []),
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
    if getattr(saints_config, "enabled", False):
        try:
            # Obtener información enriquecida
            saints_data = get_saints_today(
                include_namedays=getattr(saints_config, "include_namedays", True),
                locale=getattr(saints_config, "locale", "es"),
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


def _load_santoral_data() -> Dict[str, List[str]]:
    """Carga datos de santoral desde backend/data/santoral.es.json."""
    santoral_path = Path(__file__).resolve().parent / "data" / "santoral.es.json"
    try:
        if santoral_path.exists():
            content = santoral_path.read_text(encoding="utf-8")
            data = json.loads(content)
            if isinstance(data, dict):
                return data
        logger.warning("Santoral file not found or invalid, using empty dict")
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to load santoral data from %s: %s", santoral_path, exc)
        return {}


@app.get("/api/santoral/today")
def get_santoral_today() -> JSONResponse:
    """Obtiene los santos del día actual desde el archivo JSON offline.
    
    Returns:
        {date: "YYYY-MM-DD", names: [...]} - Nunca error 500; si no hay datos, devuelve []
    """
    try:
        tz = _get_tz()
        today_local = datetime.now(tz).date()
        date_str = today_local.isoformat()
        date_key = f"{today_local.month:02d}-{today_local.day:02d}"
        
        santoral_data = _load_santoral_data()
        names = santoral_data.get(date_key, [])
        
        return JSONResponse(content={
            "date": date_str,
            "names": names if isinstance(names, list) else [],
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to get santoral for today: %s", exc)
        tz = _get_tz()
        today_local = datetime.now(tz).date()
        return JSONResponse(content={
            "date": today_local.isoformat(),
            "names": [],
        })


@app.get("/api/santoral/date")
def get_santoral_date(iso: str) -> JSONResponse:
    """Obtiene los santos para una fecha específica desde el archivo JSON offline.
    
    Args:
        iso: Fecha en formato ISO YYYY-MM-DD
    
    Returns:
        {date: "YYYY-MM-DD", names: [...]} - Nunca error 500; si fecha inválida o sin datos, devuelve []
    """
    try:
        # Validar formato ISO
        try:
            target_date = datetime.fromisoformat(iso).date()
        except (ValueError, TypeError):
            logger.warning("Invalid date format in /api/santoral/date: %s", iso)
            return JSONResponse(
                status_code=400,
                content={
                    "error": "Invalid date format. Use YYYY-MM-DD",
                    "date": iso,
                    "names": [],
                }
            )
        
        date_key = f"{target_date.month:02d}-{target_date.day:02d}"
        
        santoral_data = _load_santoral_data()
        names = santoral_data.get(date_key, [])
        
        return JSONResponse(content={
            "date": target_date.isoformat(),
            "names": names if isinstance(names, list) else [],
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to get santoral for date %s: %s", iso, exc)
        try:
            target_date = datetime.fromisoformat(iso).date()
        except (ValueError, TypeError):
            target_date = date.today()
        return JSONResponse(content={
            "date": target_date.isoformat(),
            "names": [],
        })


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


def _ensure_blitzortung_service(config: AppConfigV2) -> None:
    """Inicia o actualiza el servicio Blitzortung según configuración."""
    global blitzortung_service
    
    blitz_config = getattr(config, "blitzortung", None)
    if not blitz_config:
        # Detener servicio si existe pero configuración no está presente
        if blitzortung_service:
            with _blitzortung_lock:
                blitzortung_service.stop()
                blitzortung_service = None
        return
    
    enabled = getattr(blitz_config, "enabled", False)
    mqtt_host = getattr(blitz_config, "mqtt_host", "127.0.0.1")
    mqtt_port = getattr(blitz_config, "mqtt_port", 1883)
    mqtt_topic = getattr(blitz_config, "mqtt_topic", "blitzortung/1")
    ws_enabled = getattr(blitz_config, "ws_enabled", False) or False
    ws_url = getattr(blitz_config, "ws_url", None)
    buffer_max = getattr(blitz_config, "max_points", None)
    if buffer_max is None:
        buffer_max = getattr(blitz_config, "buffer_max", 1500)
    retention_minutes = getattr(blitz_config, "retention_minutes", None)
    prune_seconds = getattr(blitz_config, "prune_seconds", None)
    if retention_minutes is not None:
        try:
            prune_seconds = int(retention_minutes) * 60
        except (TypeError, ValueError):
            prune_seconds = None
    if prune_seconds is None:
        prune_seconds = 900
    
    with _blitzortung_lock:
        # Detener servicio existente si cambió la configuración
        if blitzortung_service:
            if (not enabled or
                blitzortung_service.mqtt_host != mqtt_host or
                blitzortung_service.mqtt_port != mqtt_port or
                blitzortung_service.mqtt_topic != mqtt_topic or
                blitzortung_service.ws_enabled != ws_enabled or
                blitzortung_service.ws_url != ws_url or
                blitzortung_service.buffer_max != buffer_max or
                blitzortung_service.prune_seconds != prune_seconds):
                blitzortung_service.stop()
                blitzortung_service = None
        
        # Crear/iniciar servicio si está habilitado
        if enabled and not blitzortung_service:
            blitzortung_service = BlitzortungService(
                enabled=True,
                mqtt_host=mqtt_host,
                mqtt_port=mqtt_port,
                mqtt_topic=mqtt_topic,
                ws_enabled=ws_enabled,
                ws_url=ws_url,
                buffer_max=buffer_max,
                prune_seconds=prune_seconds
            )
            
            def on_lightning_received(strikes: List[LightningStrike]) -> None:
                """Callback cuando se reciben nuevos rayos."""
                # Actualizar caché con todos los rayos
                geojson = blitzortung_service.to_geojson()
                cache_store.store("lightning", geojson)
                
                # Auto-enable storm mode si está configurado en blitzortung.auto_storm_mode
                try:
                    config = config_manager.read()
                    blitz_config = config.blitzortung if config.blitzortung else None
                    auto_storm_config = blitz_config.auto_storm_mode if blitz_config and blitz_config.auto_storm_mode else None
                    
                    # Fallback a config.storm si auto_storm_mode no está configurado
                    if not auto_storm_config:
                        config = config_manager.read()
                        storm_config = getattr(config, "storm", None)
                        if storm_config and getattr(storm_config, "auto_enable", False):
                            center_lat = getattr(storm_config, "center_lat", 39.986)
                            center_lng = getattr(storm_config, "center_lng", -0.051)
                            radius_km = getattr(storm_config, "radius_km", 30)
                            auto_disable_minutes = getattr(storm_config, "auto_disable_after_minutes", 60)
                            threshold_count = getattr(storm_config, "threshold_count", 1)
                            
                            # Verificar si algún rayo nuevo está dentro del radio
                            strikes_in_radius = []
                            for strike in strikes:
                                distance = _distance_km(center_lat, center_lng, strike.lat, strike.lon)
                                if distance <= radius_km:
                                    strikes_in_radius.append(strike)
                            
                            # Activar si se cumple el umbral
                            if len(strikes_in_radius) >= threshold_count:
                                cache_store.store("storm_mode", {
                                    "enabled": True,
                                    "last_triggered": datetime.now(timezone.utc).isoformat(),
                                    "center": {"lat": center_lat, "lng": center_lng},
                                    "zoom": getattr(storm_config, "zoom", 9.0),
                                    "auto_enabled": True,
                                    "radius_km": radius_km,
                                    "threshold_count": threshold_count,
                                    "strikes_count": len(strikes_in_radius),
                                    "auto_disable_after_minutes": auto_disable_minutes
                                })
                                logger.info(
                                    "[lightning] Auto-enabled storm mode: %d strikes within %.1f km from center",
                                    len(strikes_in_radius), radius_km
                                )
                    else:
                        # Usar configuración de auto_storm_mode desde blitzortung
                        if auto_storm_config.enabled:
                            # Obtener configuración de storm para center y zoom
                            config = config_manager.read()
                            storm_config = getattr(config, "storm", None)
                            center_lat = storm_config.center_lat if storm_config else 39.986
                            center_lng = storm_config.center_lng if storm_config else -0.051
                            zoom = storm_config.zoom if storm_config else 9.0
                            
                            radius_km = auto_storm_config.radius_km
                            threshold_count = auto_storm_config.min_events_in_5min
                            auto_disable_minutes = auto_storm_config.cooldown_minutes
                            
                            # Verificar si algún rayo nuevo está dentro del radio
                            strikes_in_radius = []
                            for strike in strikes:
                                distance = _distance_km(center_lat, center_lng, strike.lat, strike.lon)
                                if distance <= radius_km:
                                    strikes_in_radius.append(strike)
                            
                            # Activar si se cumple el umbral
                            if len(strikes_in_radius) >= threshold_count:
                                cache_store.store("storm_mode", {
                                    "enabled": True,
                                    "last_triggered": datetime.now(timezone.utc).isoformat(),
                                    "center": {"lat": center_lat, "lng": center_lng},
                                    "zoom": zoom,
                                    "auto_enabled": True,
                                    "radius_km": radius_km,
                                    "threshold_count": threshold_count,
                                    "strikes_count": len(strikes_in_radius),
                                    "auto_disable_after_minutes": auto_disable_minutes
                                })
                                logger.info(
                                    "[lightning] Auto-enabled storm mode: %d strikes (threshold: %d) within %.1f km from center",
                                    len(strikes_in_radius), threshold_count, radius_km
                                )
                                # Emitir evento interno para frontend (disponible vía GET /api/storm_mode)
                                publish_config_changed_async("storm_mode_activated", {
                                    "enabled": True,
                                    "center": {"lat": center_lat, "lng": center_lng},
                                    "zoom": zoom,
                                    "strikes_count": len(strikes_in_radius)
                                })
                except Exception as exc:
                    logger.debug("[lightning] Error in auto-enable storm mode: %s", exc)
            
            blitzortung_service.callback = on_lightning_received
            
            if not blitzortung_service.start():
                logger.warning("[lightning] Failed to start Blitzortung service")
                blitzortung_service = None
        elif not enabled and blitzortung_service:
            # Detener servicio si se deshabilitó
            blitzortung_service.stop()
            blitzortung_service = None


@app.get("/api/storm/local")
def get_storm_local(
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None
) -> Dict[str, Any]:
    """Obtiene resumen de rayos + radar en bbox local (Castellón por defecto).
    
    Args:
        min_lat: Latitud mínima del bbox (opcional, default: 39.5 para Castellón)
        max_lat: Latitud máxima del bbox (opcional, default: 40.2 para Castellón)
        min_lon: Longitud mínima del bbox (opcional, default: -1.2 para Castellón)
        max_lon: Longitud máxima del bbox (opcional, default: 0.5 para Castellón)
    """
    try:
        # Valores por defecto para Castellón si no se proporcionan
        if min_lat is None:
            min_lat = 39.5
        if max_lat is None:
            max_lat = 40.2
        if min_lon is None:
            min_lon = -1.2
        if max_lon is None:
            max_lon = 0.5
        
        # Obtener rayos en el bbox
        lightning_bbox = f"{min_lat},{max_lat},{min_lon},{max_lon}"
        lightning_data = get_lightning(bbox=lightning_bbox)
        lightning_features = lightning_data.get("features", []) if isinstance(lightning_data, dict) else []
        
        # Obtener avisos CAP públicos
        from .services import cap_warnings as cap_warnings_service
        cap_warnings_data = cap_warnings_service.get_alerts_geojson()
        cap_features = []
        if isinstance(cap_warnings_data, dict):
            all_features = cap_warnings_data.get("features", [])
            # Filtrar avisos que intersectan con el bbox
            for feature in all_features:
                if isinstance(feature, dict) and "geometry" in feature:
                    geom = feature["geometry"]
                    if geom.get("type") == "Polygon":
                        # Verificar si el polígono intersecta con el bbox
                        coords = geom.get("coordinates", [])
                        if coords and len(coords) > 0:
                            ring = coords[0] if isinstance(coords[0], list) else coords
                            # Verificar si algún punto del polígono está en el bbox
                            intersects = False
                            for point in ring:
                                if isinstance(point, list) and len(point) >= 2:
                                    lon, lat = point[0], point[1]
                                    if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
                                        intersects = True
                                        break
                            if intersects:
                                cap_features.append(feature)
                    elif geom.get("type") == "Point":
                        coords = geom.get("coordinates", [])
                        if len(coords) >= 2:
                            lon, lat = coords[0], coords[1]
                            if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
                                cap_features.append(feature)
        
        # Obtener estado de radar (último frame disponible)
        radar_data = None
        try:
            # Intentar obtener frames de radar desde RainViewer
            from .global_providers import RainViewerProvider
            radar_provider = RainViewerProvider()
            radar_frames = radar_provider.get_available_frames(history_minutes=90, frame_step=5)
            if radar_frames:
                latest_frame = radar_frames[-1]  # Frame más reciente
                radar_data = {
                    "latest_timestamp": latest_frame.get("timestamp"),
                    "latest_timestamp_iso": latest_frame.get("iso"),
                    "frames_count": len(radar_frames),
                    "provider": "rainviewer"
                }
        except Exception as exc:
            logger.debug("Failed to get radar frames for storm/local: %s", exc)
        
        return {
            "bbox": {
                "min_lat": min_lat,
                "max_lat": max_lat,
                "min_lon": min_lon,
                "max_lon": max_lon
            },
            "lightning": {
                "count": len(lightning_features),
                "features": lightning_features[:50]  # Limitar a 50 rayos más recientes
            },
            "cap_warnings": {
                "count": len(cap_features),
                "features": cap_features
            },
            "radar": radar_data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as exc:
        logger.error("[storm/local] Error getting storm local data: %s", exc)
        return {
            "bbox": {
                "min_lat": min_lat or 39.5,
                "max_lat": max_lat or 40.2,
                "min_lon": min_lon or -1.2,
                "max_lon": max_lon or 0.5
            },
            "lightning": {"count": 0, "features": []},
            "cap_warnings": {"count": 0, "features": []},
            "radar": None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": str(exc)
        }


@app.get("/api/lightning")
def get_lightning(bbox: Optional[str] = None) -> Dict[str, Any]:
    """Obtiene datos de rayos para mostrar en el mapa.
    
    Args:
        bbox: Opcional, formato "min_lat,max_lat,min_lon,max_lon" para filtrar
    """
    try:
        # Cargar configuración para inicializar servicio si es necesario
        config = config_manager.read()
        _ensure_blitzortung_service(config)
        
        # Obtener rayos del servicio o caché
        if blitzortung_service:
            with _blitzortung_lock:
                if bbox:
                    try:
                        parts = [float(x) for x in bbox.split(",")]
                        if len(parts) == 4:
                            geojson = blitzortung_service.to_geojson(bbox=(parts[0], parts[1], parts[2], parts[3]))
                        else:
                            geojson = blitzortung_service.to_geojson()
                    except (ValueError, IndexError):
                        geojson = blitzortung_service.to_geojson()
                else:
                    geojson = blitzortung_service.to_geojson()
                
                # Actualizar caché
                cache_store.store("lightning", geojson)
                return geojson
        
        # Fallback a caché si servicio no está disponible
        cached = cache_store.load("lightning", max_age_minutes=1)
        if cached:
            return cached.payload
        
        # Devolver datos vacíos por defecto
        default_data = {
            "type": "FeatureCollection",
            "features": []
        }
        cache_store.store("lightning", default_data)
        return default_data
    except Exception as exc:
        logger.error("[lightning] Error getting lightning data: %s", exc)
        return {
            "type": "FeatureCollection",
            "features": []
        }


@app.post("/api/lightning/test_mqtt")
async def test_lightning_mqtt(request: LightningMqttTestRequest) -> Dict[str, Any]:
    """Prueba conexión MQTT para Blitzortung.
    
    Conecta, se suscribe al topic, espera hasta timeout_sec y cuenta mensajes recibidos.
    """
    try:
        if not mqtt:
            return {"ok": False, "error": "paho-mqtt not installed"}
        
        test_messages: List[Dict[str, Any]] = []
        test_messages_lock = threading.Lock()
        connected = False
        start_time = time.time()
        latency_ms = None
        
        def on_connect(client: Any, userdata: Any, flags: Any, rc: int) -> None:
            nonlocal connected, latency_ms
            if rc == 0:
                connected = True
                latency_ms = int((time.time() - start_time) * 1000)
                client.subscribe(request.mqtt_topic)
        
        def on_message(client: Any, userdata: Any, msg: Any) -> None:
            try:
                payload = msg.payload.decode("utf-8")
                data = json.loads(payload)
                with test_messages_lock:
                    test_messages.append(data)
            except Exception:
                pass
        
        def on_disconnect(client: Any, userdata: Any, rc: int) -> None:
            pass
        
        try:
            test_client = mqtt.Client()
            test_client.on_connect = on_connect
            test_client.on_message = on_message
            test_client.on_disconnect = on_disconnect
            
            test_client.connect(request.mqtt_host, request.mqtt_port, keepalive=60)
            test_client.loop_start()
            
            # Esperar conexión o timeout
            timeout_time = time.time() + request.timeout_sec
            while not connected and time.time() < timeout_time:
                time.sleep(0.1)
            
            if not connected:
                test_client.loop_stop()
                test_client.disconnect()
                return {"ok": False, "error": "connection_refused", "connected": False}
            
            # Esperar mensajes durante el timeout restante
            remaining_time = timeout_time - time.time()
            if remaining_time > 0:
                time.sleep(min(remaining_time, 2.0))  # Esperar hasta 2 segundos más
            
            test_client.loop_stop()
            test_client.disconnect()
            
            return {
                "ok": True,
                "connected": True,
                "received": len(test_messages),
                "topic": request.mqtt_topic,
                "latency_ms": latency_ms
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc), "connected": False}
    except Exception as exc:
        logger.error("[lightning] Error testing MQTT: %s", exc)
        return {"ok": False, "error": "internal_error", "connected": False}


@app.post("/api/lightning/test_ws")
async def test_lightning_ws(request: LightningWsTestRequest) -> Dict[str, Any]:
    """Prueba conexión WebSocket para Blitzortung.
    
    Conecta, espera hasta timeout_sec y verifica que la conexión se establezca.
    """
    try:
        if not websocket:
            return {"ok": False, "error": "websocket-client not installed", "connected": False}
        
        connected = False
        error_msg: Optional[str] = None
        
        def on_open(ws: Any) -> None:
            nonlocal connected
            connected = True
        
        def on_error(ws: Any, error: Exception) -> None:
            nonlocal error_msg
            error_msg = str(error)
        
        def on_close(ws: Any, close_status_code: int, close_msg: str) -> None:
            pass
        
        try:
            test_ws = websocket.WebSocketApp(
                request.ws_url,
                on_open=on_open,
                on_error=on_error,
                on_close=on_close
            )
            
            # Iniciar conexión en thread separado
            ws_thread = threading.Thread(target=test_ws.run_forever, daemon=True)
            ws_thread.start()
            
            # Esperar conexión o timeout
            timeout_time = time.time() + request.timeout_sec
            while not connected and not error_msg and time.time() < timeout_time:
                time.sleep(0.1)
            
            test_ws.close()
            
            if connected:
                return {"ok": True, "connected": True}
            elif error_msg:
                return {"ok": False, "error": error_msg, "connected": False}
            else:
                return {"ok": False, "error": "timeout", "connected": False}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "connected": False}
    except Exception as exc:
        logger.error("[lightning] Error testing WebSocket: %s", exc)
        return {"ok": False, "error": "internal_error", "connected": False}


@app.get("/api/lightning/status")
def get_lightning_status() -> Dict[str, Any]:
    """Obtiene el estado actual del servicio de rayos."""
    try:
        config = config_manager.read()
        blitz_config = getattr(config, "blitzortung", None)
        storm_config = getattr(config, "storm", None)
        
        enabled = blitz_config and getattr(blitz_config, "enabled", False) if blitz_config else False
        
        source = "none"
        connected = False
        buffer_size = 0
        last_event_age_sec = None
        rate_per_min = 0
        
        if blitzortung_service:
            with _blitzortung_lock:
                if blitz_config:
                    if getattr(blitz_config, "ws_enabled", False):
                        source = "ws"
                    else:
                        source = "mqtt"
                
                connected = blitzortung_service.running
                strikes = blitzortung_service.get_all_strikes()
                buffer_size = len(strikes)
                
                if strikes:
                    # Calcular edad del último evento
                    now = time.time()
                    latest_strike = max(strikes, key=lambda s: s.timestamp)
                    last_event_age_sec = int(now - latest_strike.timestamp)
                    
                    # Calcular tasa por minuto (últimos 60 segundos)
                    recent_strikes = [s for s in strikes if (now - s.timestamp) <= 60]
                    rate_per_min = len(recent_strikes)
        
        center = None
        auto_enable_info = None
        
        if storm_config:
            center = {
                "lat": getattr(storm_config, "center_lat", 39.986),
                "lng": getattr(storm_config, "center_lng", -0.051),
                "zoom": getattr(storm_config, "zoom", 9.0)
            }
            
            auto_enable = getattr(storm_config, "auto_enable", False)
            if auto_enable:
                radius_km = getattr(storm_config, "radius_km", 30)
                auto_disable_minutes = getattr(storm_config, "auto_disable_after_minutes", 60)
                
                # Verificar si hay rayos cerca (lógica de auto-enable)
                active = False
                will_disable_in_min = None
                
                if blitzortung_service and enabled:
                    with _blitzortung_lock:
                        strikes = blitzortung_service.get_all_strikes()
                        if strikes:
                            # Calcular distancia desde centro a cada rayo
                            center_lat = center["lat"]
                            center_lng = center["lng"]
                            
                            for strike in strikes:
                                # Calcular distancia geodésica (Haversine)
                                lat1, lon1 = math.radians(center_lat), math.radians(center_lng)
                                lat2, lon2 = math.radians(strike.lat), math.radians(strike.lon)
                                
                                dlat = lat2 - lat1
                                dlon = lon2 - lon1
                                a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
                                c = 2 * math.asin(math.sqrt(a))
                                distance_km = 6371 * c  # Radio de la Tierra en km
                                
                                if distance_km <= radius_km:
                                    active = True
                                    break
                            
                            if active:
                                # Calcular tiempo hasta auto-disable
                                now = time.time()
                                latest_nearby = max(
                                    [s for s in strikes if _distance_km(center_lat, center_lng, s.lat, s.lon) <= radius_km],
                                    key=lambda s: s.timestamp,
                                    default=None
                                )
                                if latest_nearby:
                                    age_minutes = (now - latest_nearby.timestamp) / 60
                                    will_disable_in_min = max(0, int(auto_disable_minutes - age_minutes))
                
                auto_enable_info = {
                    "active": active,
                    "radius_km": radius_km,
                    "will_disable_in_min": will_disable_in_min
                }
        
        return {
            "enabled": enabled,
            "source": source,
            "connected": connected,
            "buffer_size": buffer_size,
            "last_event_age_sec": last_event_age_sec,
            "rate_per_min": rate_per_min,
            "center": center,
            "auto_enable": auto_enable_info
        }
    except Exception as exc:
        logger.error("[lightning] Error getting status: %s", exc)
        return {
            "enabled": False,
            "source": "none",
            "connected": False,
            "buffer_size": 0,
            "last_event_age_sec": None,
            "rate_per_min": 0,
            "center": None,
            "auto_enable": None
        }


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calcula distancia geodésica en km entre dos puntos."""
    lat1_rad, lon1_rad = math.radians(lat1), math.radians(lon1)
    lat2_rad, lon2_rad = math.radians(lat2), math.radians(lon2)
    
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    
    a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return 6371 * c  # Radio de la Tierra en km


@app.get("/api/lightning/sample")
def get_lightning_sample(limit: int = 50) -> Dict[str, Any]:
    """Obtiene una muestra de los últimos eventos de rayos."""
    try:
        items: List[Dict[str, Any]] = []
        
        if blitzortung_service:
            with _blitzortung_lock:
                strikes = blitzortung_service.get_all_strikes()
                # Ordenar por timestamp (más recientes primero)
                strikes.sort(key=lambda s: s.timestamp, reverse=True)
                strikes = strikes[:limit]
                
                for strike in strikes:
                    items.append({
                        "ts": int(strike.timestamp),
                        "lat": strike.lat,
                        "lng": strike.lon,
                        "amplitude": None,  # Blitzortung no proporciona amplitud por defecto
                        "type": "cloud-to-ground"  # Valor por defecto
                    })
        
        return {
            "count": len(items),
            "items": items
        }
    except Exception as exc:
        logger.error("[lightning] Error getting sample: %s", exc)
        return {"count": 0, "items": []}


@app.get("/api/history")
def get_history(date: Optional[str] = None, lang: str = "es") -> Dict[str, Any]:
    """Obtiene efemérides históricas para una fecha específica.
    
    GARANTÍA: Este endpoint SIEMPRE devuelve datos, usando fallback a Wikimedia si es necesario.
    
    Args:
        date: Fecha en formato MM-DD (por defecto: hoy)
        lang: Código de idioma ISO 639-1 (FORZADO a "es" para Castellón)
        
    Returns:
        Diccionario con {"date": "YYYY-MM-DD", "count": N, "items": [...], "source": "..."}
    """
    # FORZAR lang="es" SIEMPRE para garantizar contenido en castellano
    lang = "es"
    
    try:
        # Parsear fecha
        target_date = None
        if date:
            try:
                parts = date.split("-")
                if len(parts) == 2:
                    month = int(parts[0])
                    day = int(parts[1])
                    # Usar año actual
                    now = datetime.now(timezone.utc)
                    target_date = datetime(now.year, month, day).date()
            except (ValueError, IndexError):
                logger.warning("[history] Invalid date format: %s, using today", date)
        
        if not target_date:
            target_date = datetime.now(timezone.utc).date()
        
        # Leer configuración
        config = config_manager.read()
        
        # Obtener configuración de efemérides históricas
        historical_events_config = None
        provider = "wikimedia"  # DEFAULT siempre wikimedia
        data_path = None
        wikimedia_config = None
        attempt_local_first = False
        
        if config.panels and config.panels.historicalEvents:
            historical_events_config = config.panels.historicalEvents
            configured_provider = historical_events_config.provider or "wikimedia"
            
            # Si está configurado como local, intentar local primero pero con fallback garantizado
            if configured_provider == "local" and historical_events_config.local:
                data_path = historical_events_config.local.data_path
                # Verificar si el archivo existe antes de intentar usarlo
                if data_path and Path(data_path).exists():
                    attempt_local_first = True
                    provider = "local"
                    logger.info("[history] Attempting local provider first: %s", data_path)
                else:
                    logger.warning("[history] Local provider configured but file not found: %s, falling back to wikimedia", data_path)
                    provider = "wikimedia"
            else:
                provider = "wikimedia"
            
            # Preparar config de wikimedia (siempre, por si necesitamos fallback)
            if historical_events_config.wikimedia:
                wikimedia_config = {
                    "language": "es",  # FORZADO
                    "event_type": historical_events_config.wikimedia.event_type or "all",
                    "api_user_agent": historical_events_config.wikimedia.api_user_agent or "PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)",
                    "max_items": historical_events_config.wikimedia.max_items or 10,
                    "timeout_seconds": historical_events_config.wikimedia.timeout_seconds or 10
                }
        
        # Si no hay configuración de wikimedia, crear una por defecto (SIEMPRE necesaria para fallback)
        if not wikimedia_config:
            wikimedia_config = {
                "language": "es",  # FORZADO
                "event_type": "all",
                "api_user_agent": "PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)",
                "max_items": 10,
                "timeout_seconds": 10
            }
        
        # Cache key basado en fecha y provider (siempre lang=es)
        cache_key = f"history_{target_date.isoformat()}_es_{provider}"
        cached = cache_store.load(cache_key, max_age_minutes=24 * 60)  # 24 horas
        if cached:
            logger.debug("[history] Cache hit for %s", cache_key)
            return cached.payload
        
        # Intentar obtener efemérides
        result = None
        
        try:
            result = get_efemerides_for_date(
                data_path=data_path if attempt_local_first else None,
                target_date=target_date,
                tz_str="Europe/Madrid",
                provider=provider,
                wikimedia_config=wikimedia_config
            )
            
            # Verificar que haya datos
            if result and result.get("count", 0) > 0:
                logger.info("[history] Successfully fetched %d items from %s", result["count"], provider)
                # Guardar en caché
                cache_store.store(cache_key, result)
                return result
            else:
                logger.warning("[history] Provider %s returned no items, trying fallback to wikimedia", provider)
                raise ValueError("No items returned")
                
        except Exception as first_exc:
            logger.warning("[history] Primary provider failed: %s, falling back to wikimedia", first_exc)
            
            # FALLBACK GARANTIZADO: Siempre intentar wikimedia si falla el primero
            if provider != "wikimedia":
                try:
                    result = get_efemerides_for_date(
                        data_path=None,
                        target_date=target_date,
                        tz_str="Europe/Madrid",
                        provider="wikimedia",
                        wikimedia_config=wikimedia_config
                    )
                    
                    if result and result.get("count", 0) > 0:
                        logger.info("[history] Fallback to wikimedia successful: %d items", result["count"])
                        # Guardar en caché con indicador de fallback
                        cache_store.store(cache_key, result)
                        return result
                    else:
                        logger.error("[history] Wikimedia fallback returned no items")
                        
                except Exception as fallback_exc:
                    logger.error("[history] Wikimedia fallback also failed: %s", fallback_exc)
        
        # Si llegamos aquí, TODO falló - devolver mensaje informativo pero NO vacío
        logger.error("[history] All providers failed, returning placeholder message")
        return {
            "date": target_date.isoformat(),
            "count": 1,
            "items": [{
                "year": target_date.year,
                "text": f"No se pudieron cargar efemérides históricas para el {target_date.strftime('%d de %B')}. Por favor, verifica la configuración.",
                "type": "info",
                "source": "system"
            }],
            "source": "placeholder",
            "error": True
        }
        
    except Exception as exc:
        logger.error("[history] Fatal error getting historical events: %s", exc, exc_info=True)
        # Aún en error fatal, devolver estructura con mensaje
        fallback_date = date or datetime.now(timezone.utc).date().isoformat()
        return {
            "date": fallback_date,
            "count": 1,
            "items": [{
                "year": datetime.now().year,
                "text": "Error al cargar efemérides históricas. Sistema en mantenimiento.",
                "type": "error",
                "source": "system"
            }],
            "source": "error",
            "error": True
        }


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


# Caché para geocodificación de códigos postales españoles
_SPANISH_POSTAL_CACHE: Dict[str, Tuple[float, float]] = {}
_POSTAL_CACHE_LOCK = Lock()

# Centroides por provincia (primer dígito) y zonas de código postal (3 primeros dígitos)
# Fallback offline para España
_SPANISH_POSTAL_FALLBACK: Dict[str, Tuple[float, float]] = {
    # Provincias (por primer dígito)
    "0": (39.4699, -0.3763),  # Alicante aproximado
    "1": (42.8467, -2.6716),  # Álava
    "2": (38.9537, -2.1322),  # Albacete
    "3": (38.3450, -0.4810),  # Alicante
    "4": (36.8381, -2.4597),  # Almería
    "5": (40.6448, -4.7473),  # Ávila
    "6": (38.8794, -6.9707),  # Badajoz
    "7": (39.5692, 2.6502),   # Baleares
    "8": (40.4168, -3.7038),  # Madrid
    "9": (42.3439, -3.6969),  # Burgos
    
    # Zonas específicas comunes (3 primeros dígitos)
    "120": (39.98, -0.20),   # Castellón
    "460": (39.47, -0.38),   # Valencia
    "280": (40.42, -3.70),   # Madrid
    "080": (41.39, 2.17),    # Barcelona
    "410": (37.38, -5.98),   # Sevilla
    "290": (36.72, -4.42),   # Málaga
    "150": (43.36, -8.41),   # A Coruña
    "330": (43.36, -5.84),   # Oviedo
}

def _geocode_postal_es(code: str) -> Optional[Tuple[float, float]]:
    """Geocodifica un código postal español usando Nominatim o fallback."""
    if not code or len(code) != 5 or not code.isdigit():
        return None
    
    # Verificar caché
    with _POSTAL_CACHE_LOCK:
        if code in _SPANISH_POSTAL_CACHE:
            return _SPANISH_POSTAL_CACHE[code]
    
    # Intentar con Nominatim
    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            "postalcode": code,
            "countrycodes": "es",
            "format": "json",
            "limit": 1,
            "addressdetails": 1,
        }
        headers = {
            "User-Agent": "Pantalla_reloj/1.0 (kiosk display; contact: admin@localhost)",
        }
        
        # Rate limit: 1 request per second
        time.sleep(1.1)
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        if data and len(data) > 0:
            result = data[0]
            lat = float(result.get("lat", 0))
            lon = float(result.get("lon", 0))
            
            # Validar coordenadas
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                coords = (lat, lon)
                with _POSTAL_CACHE_LOCK:
                    _SPANISH_POSTAL_CACHE[code] = coords
                return coords
    except Exception as exc:
        logger.debug("Nominatim geocoding failed for postal code %s: %s", code, exc)
    
    # Fallback: usar zona o provincia
    zone = code[:3]
    province = code[0]
    
    with _POSTAL_CACHE_LOCK:
        if zone in _SPANISH_POSTAL_FALLBACK:
            coords = _SPANISH_POSTAL_FALLBACK[zone]
            _SPANISH_POSTAL_CACHE[code] = coords
            return coords
        if province in _SPANISH_POSTAL_FALLBACK:
            coords = _SPANISH_POSTAL_FALLBACK[province]
            _SPANISH_POSTAL_CACHE[code] = coords
            return coords
    
    # Fallback final: centro de España
    coords = (40.4168, -3.7038)
    with _POSTAL_CACHE_LOCK:
        _SPANISH_POSTAL_CACHE[code] = coords
    return coords


@app.get("/api/geocode/es/postal")
def geocode_postal_es(code: str) -> Dict[str, Any]:
    """Geocodifica un código postal español a coordenadas (lat, lon)."""
    if not code or len(code) != 5 or not code.isdigit():
        raise HTTPException(
            status_code=400,
            detail="Invalid postal code. Must be 5 digits."
        )
    
    coords = _geocode_postal_es(code)
    if not coords:
        raise HTTPException(
            status_code=404,
            detail=f"Could not geocode postal code {code}"
        )
    
    lat, lon = coords
    return {
        "ok": True,
        "postal_code": code,
        "lat": lat,
        "lon": lon,
        "source": "nominatim" if code not in _SPANISH_POSTAL_FALLBACK else "fallback",
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


def _get_flights_provider(config: AppConfigV2) -> FlightProvider:
    """Obtiene o crea el proveedor de vuelos según la configuración."""
    layers_config = getattr(config, "layers", None)
    flights_config = getattr(layers_config, "flights", None) if layers_config else None
    if not flights_config:
        return OpenSkyFlightProvider()

    # Crear nuevo proveedor según configuración
    if flights_config.provider == "opensky":
        username = secret_store.get_secret("opensky_username")
        password = secret_store.get_secret("opensky_password")
        provider_key = f"opensky:{username or 'anonymous'}"
        cached_provider = _flights_provider_cache.get(provider_key)
        if cached_provider and isinstance(cached_provider, OpenSkyFlightProvider):
            return cached_provider
        provider = OpenSkyFlightProvider(username=username, password=password)
    elif flights_config.provider == "aviationstack":
        base_url = flights_config.aviationstack.base_url if flights_config.aviationstack else None
        api_key = secret_store.get_secret("aviationstack_api_key") or (
            flights_config.aviationstack.api_key if flights_config.aviationstack else None
        )
        provider_key = f"aviationstack:{base_url or 'default'}:{'key' if api_key else 'anon'}"
        cached_provider = _flights_provider_cache.get(provider_key)
        if cached_provider and isinstance(cached_provider, AviationStackFlightProvider):
            return cached_provider
        provider = AviationStackFlightProvider(base_url=base_url, api_key=api_key)
    elif flights_config.provider == "custom":
        api_url = flights_config.custom.api_url if flights_config.custom else None
        api_key = flights_config.custom.api_key if flights_config.custom else None
        provider_key = f"custom:{api_url or 'none'}"
        cached_provider = _flights_provider_cache.get(provider_key)
        if cached_provider and isinstance(cached_provider, CustomFlightProvider):
            return cached_provider
        provider = CustomFlightProvider(api_url=api_url, api_key=api_key)
    else:
        # Fallback a OpenSky si no se reconoce
        logger.warning("Unknown flights provider: %s, using OpenSky", flights_config.provider)
        provider = OpenSkyFlightProvider()
        provider_key = "opensky:anonymous"
    
    _flights_provider_cache[provider_key] = provider
    return provider


def _get_ships_provider(config: AppConfigV2) -> ShipProvider:
    """Obtiene o crea el proveedor de barcos según la configuración."""
    layers_config = getattr(config, "layers", None)
    ships_config = getattr(layers_config, "ships", None) if layers_config else None
    if not ships_config:
        return AISStreamProvider()

    # Crear nuevo proveedor según configuración
    if ships_config.provider == "ais_generic":
        provider = GenericAISProvider(
            api_url=ships_config.ais_generic.api_url if ships_config.ais_generic else None,
            api_key=ships_config.ais_generic.api_key if ships_config.ais_generic else None,
            demo_enabled=True,
        )
        provider_key = f"ais_generic:{provider.api_url or 'demo'}"
        cached_provider = _ships_provider_cache.get(provider_key)
        if cached_provider and isinstance(cached_provider, GenericAISProvider):
            return cached_provider
    elif ships_config.provider == "aisstream":
        ws_url = ships_config.aisstream.ws_url if ships_config.aisstream else None
        api_key = secret_store.get_secret("aisstream_api_key") or (
            ships_config.aisstream.api_key if ships_config.aisstream else None
        )
        provider = AISStreamProvider(ws_url=ws_url, api_key=api_key)
        provider_key = f"aisstream:{ws_url or 'default'}:{'key' if api_key else 'anon'}"
        cached_provider = _ships_provider_cache.get(provider_key)
        if cached_provider and isinstance(cached_provider, AISStreamProvider):
            return cached_provider
    elif ships_config.provider == "aishub":
        base_url = ships_config.aishub.base_url if ships_config.aishub else None
        api_key = secret_store.get_secret("aishub_api_key") or (
            ships_config.aishub.api_key if ships_config.aishub else None
        )
        provider = AISHubProvider(base_url=base_url, api_key=api_key)
        provider_key = f"aishub:{base_url or 'default'}:{'key' if api_key else 'anon'}"
        cached_provider = _ships_provider_cache.get(provider_key)
        if cached_provider and isinstance(cached_provider, AISHubProvider):
            return cached_provider
    elif ships_config.provider == "custom":
        api_url = ships_config.custom.api_url if ships_config.custom else None
        api_key = ships_config.custom.api_key if ships_config.custom else None
        provider = CustomShipProvider(api_url=api_url, api_key=api_key)
        provider_key = f"custom:{api_url or 'none'}"
        cached_provider = _ships_provider_cache.get(provider_key)
        if cached_provider and isinstance(cached_provider, CustomShipProvider):
            return cached_provider
    else:
        # Fallback a GenericAIS si no se reconoce
        logger.warning("Unknown ships provider: %s, using AISStream", ships_config.provider)
        api_key = secret_store.get_secret("aisstream_api_key")
        provider = AISStreamProvider(api_key=api_key)
        provider_key = f"aisstream:fallback:{'key' if api_key else 'anon'}"
    
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


_GLOBAL_VIEWPORT_WIDTH = 1920
_GLOBAL_VIEWPORT_HEIGHT = 480
_GLOBAL_LAT_MIN = -85.0
_GLOBAL_LAT_MAX = 85.0

T = TypeVar("T")


def _clamp(value: float, minimum: float, maximum: float) -> float:
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value


def _normalize_flights_bounds(
    bbox: Optional[Tuple[float, float, float, float]]
) -> Tuple[float, float, float, float]:
    if not bbox:
        return (-180.0, _GLOBAL_LAT_MIN, 180.0, _GLOBAL_LAT_MAX)
    lamin, lamax, lomin, lomax = bbox
    min_lat = _clamp(float(lamin), _GLOBAL_LAT_MIN, _GLOBAL_LAT_MAX)
    max_lat = _clamp(float(lamax), min_lat, _GLOBAL_LAT_MAX)
    min_lon = _clamp(float(lomin), -180.0, 180.0)
    max_lon = _clamp(float(lomax), min_lon, 180.0)
    return min_lon, min_lat, max_lon, max_lat


def _normalize_generic_bounds(
    bounds: Optional[Tuple[float, float, float, float]]
) -> Tuple[float, float, float, float]:
    if not bounds:
        return (-180.0, _GLOBAL_LAT_MIN, 180.0, _GLOBAL_LAT_MAX)
    min_lon, min_lat, max_lon, max_lat = bounds
    min_lat = _clamp(float(min_lat), _GLOBAL_LAT_MIN, _GLOBAL_LAT_MAX)
    max_lat = _clamp(float(max_lat), min_lat, _GLOBAL_LAT_MAX)
    min_lon = _clamp(float(min_lon), -180.0, 180.0)
    max_lon = _clamp(float(max_lon), min_lon, 180.0)
    return min_lon, min_lat, max_lon, max_lat


def _grid_cell_counts(grid_px: int) -> Tuple[int, int]:
    size = max(1, grid_px)
    cols = max(1, int(round(_GLOBAL_VIEWPORT_WIDTH / float(size))))
    rows = max(1, int(round(_GLOBAL_VIEWPORT_HEIGHT / float(size))))
    return cols, rows


def _grid_decimate_entries(
    entries: Iterable[T],
    grid_px: int,
    bounds: Tuple[float, float, float, float],
    coord_getter: Callable[[T], Tuple[Optional[float], Optional[float]]],
    priority_getter: Callable[[T], Tuple[Any, ...]],
    max_items: Optional[int] = None,
) -> Tuple[List[T], Dict[str, Any]]:
    items_list = list(entries)
    if not items_list or grid_px <= 0:
        kept = list(items_list)
        summary = {
            "strategy": "none",
            "grid_px": grid_px,
            "input": len(items_list),
            "kept": len(kept),
            "collisions": 0,
        }
        if max_items:
            summary["max_items_view"] = max_items
            summary["truncated"] = max(0, len(kept) - max_items)
        return kept, summary

    min_lon, min_lat, max_lon, max_lat = bounds
    lon_range = max(max_lon - min_lon, 1e-6)
    lat_range = max(max_lat - min_lat, 1e-6)
    cols, rows = _grid_cell_counts(grid_px)
    cell_width = lon_range / cols
    cell_height = lat_range / rows

    buckets: Dict[Tuple[int, int], T] = {}
    collisions = 0
    for entry in items_list:
        raw_lon, raw_lat = coord_getter(entry)
        if raw_lon is None or raw_lat is None:
            continue
        try:
            lon = float(raw_lon)
            lat = float(raw_lat)
        except (TypeError, ValueError):
            continue

        lon = _clamp(lon, min_lon, max_lon)
        lat = _clamp(lat, min_lat, max_lat)
        ix = int((lon - min_lon) / cell_width) if cell_width > 0 else 0
        iy = int((lat - min_lat) / cell_height) if cell_height > 0 else 0
        if ix >= cols:
            ix = cols - 1
        if iy >= rows:
            iy = rows - 1
        key = (ix, iy)
        existing = buckets.get(key)
        if existing is None:
            buckets[key] = entry
        else:
            collisions += 1
            if priority_getter(entry) < priority_getter(existing):
                buckets[key] = entry

    selected = list(buckets.values())
    selected.sort(key=priority_getter)

    truncated = 0
    if max_items and max_items > 0 and len(selected) > max_items:
        truncated = len(selected) - max_items
        selected = selected[:max_items]

    summary = {
        "strategy": "grid",
        "grid_px": grid_px,
        "cells": {"cols": cols, "rows": rows},
        "input": len(items_list),
        "kept": len(selected),
        "collisions": collisions,
    }
    if max_items and max_items > 0:
        summary["max_items_view"] = max_items
        summary["truncated"] = truncated

    return selected, summary


def _prepare_flights_items(
    items: Iterable[Dict[str, Any]],
    config: Any,
    bbox: Optional[Tuple[float, float, float, float]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    now = int(time.time())
    input_count = 0
    invalid_count = 0
    processed: List[Dict[str, Any]] = []

    for raw in items or []:
        input_count += 1
        if not isinstance(raw, dict):
            invalid_count += 1
            continue
        lon = raw.get("lon")
        lat = raw.get("lat")
        if lon is None or lat is None:
            invalid_count += 1
            continue
        try:
            lon_f = float(lon)
            lat_f = float(lat)
        except (TypeError, ValueError):
            invalid_count += 1
            continue

        item = dict(raw)
        item["lon"] = lon_f
        item["lat"] = lat_f

        timestamp_raw = item.get("last_contact")
        ts = None
        if isinstance(timestamp_raw, (int, float)):
            ts = int(timestamp_raw)
            item["last_contact"] = ts
        elif isinstance(timestamp_raw, str) and timestamp_raw.isdigit():
            ts = int(timestamp_raw)
            item["last_contact"] = ts

        age_seconds = None
        if ts is not None:
            age_seconds = max(0, now - ts)

        stale_flag = False
        if age_seconds is not None and getattr(config, "max_age_seconds", 0) > 0:
            stale_flag = age_seconds > int(config.max_age_seconds)

        if stale_flag:
            item["stale"] = True
        else:
            item.pop("stale", None)

        if age_seconds is not None:
            item["age_sec"] = age_seconds

        processed.append(item)

    valid_count = len(processed)
    stale_candidates = sum(1 for item in processed if item.get("stale"))
    max_view = int(getattr(config, "max_items_view", 0) or 0)

    decimation_meta: Dict[str, Any]
    if getattr(config, "decimate", "grid") == "grid" and int(getattr(config, "grid_px", 0)) > 0:
        bounds = _normalize_flights_bounds(bbox)
        decimated, decimation_meta = _grid_decimate_entries(
            processed,
            int(config.grid_px),
            bounds,
            lambda item: (item.get("lon"), item.get("lat")),
            lambda item: (
                1 if item.get("stale") else 0,
                -int(item.get("last_contact") or 0),
            ),
            max_view if max_view > 0 else None,
        )
    else:
        decimated = list(processed)
        if max_view > 0 and len(decimated) > max_view:
            decimated.sort(
                key=lambda item: (
                    1 if item.get("stale") else 0,
                    -int(item.get("last_contact") or 0),
                )
            )
            decimated = decimated[:max_view]
            truncated = valid_count - len(decimated)
        else:
            truncated = 0
        decimation_meta = {
            "strategy": "none",
            "grid_px": int(getattr(config, "grid_px", 0) or 0),
            "input": valid_count,
            "kept": len(decimated),
            "collisions": 0,
        }
        if max_view > 0:
            decimation_meta["max_items_view"] = max_view
            decimation_meta["truncated"] = max(0, truncated)

    decimated.sort(
        key=lambda item: (
            1 if item.get("stale") else 0,
            -int(item.get("last_contact") or 0),
        )
    )

    stale_final = sum(1 for item in decimated if item.get("stale"))

    meta = {
        "input": input_count,
        "valid": valid_count,
        "invalid": invalid_count,
        "stale_candidates": stale_candidates,
        "stale_features": stale_final,
        "decimation": decimation_meta,
    }
    return decimated, meta


def _prepare_ship_features(
    features: Iterable[Dict[str, Any]],
    config: Any,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    now = int(time.time())
    input_count = 0
    processed: List[Dict[str, Any]] = []
    invalid_count = 0
    stale_candidates = 0

    for raw in features or []:
        input_count += 1
        if not isinstance(raw, dict):
            invalid_count += 1
            continue
        geometry = raw.get("geometry", {})
        if not isinstance(geometry, dict) or geometry.get("type") != "Point":
            invalid_count += 1
            continue
        coords = geometry.get("coordinates")
        if not isinstance(coords, (list, tuple)) or len(coords) < 2:
            invalid_count += 1
            continue
        lon, lat = coords[0], coords[1]
        if lon is None or lat is None:
            invalid_count += 1
            continue
        try:
            lon_f = float(lon)
            lat_f = float(lat)
        except (TypeError, ValueError):
            invalid_count += 1
            continue

        props = dict(raw.get("properties", {}))
        timestamp_raw = props.get("timestamp")
        ts = None
        if isinstance(timestamp_raw, (int, float)):
            ts = int(timestamp_raw)
        elif isinstance(timestamp_raw, str) and timestamp_raw.isdigit():
            ts = int(timestamp_raw)

        age_seconds = None
        if ts is not None:
            age_seconds = max(0, now - ts)

        stale_flag = False
        max_age = int(getattr(config, "max_age_seconds", 0) or 0)
        if age_seconds is not None and max_age > 0:
            stale_flag = age_seconds > max_age

        if stale_flag:
            props["stale"] = True
            stale_candidates += 1
        else:
            props.pop("stale", None)

        speed = props.get("speed")
        try:
            speed_value = float(speed) if speed is not None else 0.0
        except (TypeError, ValueError):
            speed_value = 0.0
        if getattr(config, "min_speed_knots", 0.0) and speed_value < float(config.min_speed_knots):
            continue

        feature = {
            **raw,
            "geometry": {"type": "Point", "coordinates": [lon_f, lat_f]},
            "properties": props,
        }
        processed.append(feature)

    if getattr(config, "max_items_global", 0):
        global_limit = int(config.max_items_global)
        if global_limit > 0 and len(processed) > global_limit:
            processed.sort(
                key=lambda feat: -int(feat.get("properties", {}).get("timestamp") or 0)
            )
            processed = processed[:global_limit]

    meta = {
        "input": input_count,
        "valid": len(processed),
        "invalid": invalid_count,
        "stale_candidates": stale_candidates,
    }
    return processed, meta

def _augment_flights_payload(payload: Dict[str, Any], metadata: Dict[str, Any]) -> None:
    """Attach GeoJSON feature data to the flights payload in-place."""

    items = payload.get("items", []) or []
    features: List[Dict[str, Any]] = []
    for it in items:
        lon = it.get("lon")
        lat = it.get("lat")
        if lon is None or lat is None:
            continue

        try:
            lon_f = float(lon)
            lat_f = float(lat)
        except (TypeError, ValueError):
            continue

        props = {
            "id": it.get("id"),
            "icao24": it.get("icao24"),
            "callsign": it.get("callsign"),
            "origin_country": it.get("origin_country"),
            "alt": it.get("alt"),
            "velocity": it.get("velocity"),
            "vertical_rate": it.get("vertical_rate"),
            "track": it.get("track"),
            "on_ground": it.get("on_ground"),
            "squawk": it.get("squawk"),
            "category": it.get("category"),
            "last_contact": it.get("last_contact"),
            "age_sec": it.get("age_sec"),
            "source": "opensky",
            "in_focus": False,
        }
        if it.get("stale"):
            props["stale"] = True
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon_f, lat_f]},
                "properties": {k: v for k, v in props.items() if v is not None},
            }
        )

    payload["type"] = "FeatureCollection"
    payload["features"] = features
    existing_meta = payload.get("meta")
    combined_meta: Dict[str, Any] = {}
    if isinstance(existing_meta, dict):
        combined_meta.update(existing_meta)
    combined_meta.update(metadata)
    payload["meta"] = combined_meta


@app.post("/api/flights/test")
async def test_flights() -> Dict[str, Any]:
    """
    Test de conexión para el proveedor de vuelos configurado.
    Lee layers.flights.provider y prueba la conexión según el proveedor.
    """
    try:
        config = config_manager.read()
        flights_config = config.layers.flights if config.layers else None
        
        if not flights_config or not flights_config.enabled:
            return {
                "ok": False,
                "reason": "layer_disabled",
                "tip": "Habilita la capa de vuelos primero"
            }
        
        provider = flights_config.provider
        
        # OpenSky
        if provider == "opensky":
            opensky_cfg = flights_config.opensky
            if not opensky_cfg:
                return {
                    "ok": False,
                    "reason": "opensky_config_missing",
                    "tip": "Configura OpenSky en layers.flights.opensky"
                }
            
            mode = opensky_cfg.mode if opensky_cfg.mode else "oauth2"
            
            if mode == "oauth2":
                client_id = secret_store.get_secret("opensky_client_id")
                client_secret = secret_store.get_secret("opensky_client_secret")
                
                if not client_id or not client_secret:
                    return {
                        "ok": False,
                        "reason": "missing_credentials",
                        "tip": "Configura client_id y client_secret en secrets.opensky.oauth2"
                    }
                
                # Intentar obtener token
                try:
                    token_url = (
                        opensky_cfg.token_url
                        if opensky_cfg.token_url
                        else "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
                    )
                    
                    import httpx
                    timeout = httpx.Timeout(5.0, connect=5.0, read=5.0)
                    with httpx.Client(timeout=timeout) as client:
                        response = client.post(
                            token_url,
                            data={
                                "grant_type": "client_credentials",
                                "client_id": client_id,
                                "client_secret": client_secret,
                            }
                        )
                        
                        if response.status_code in [401, 403]:
                            return {
                                "ok": False,
                                "reason": "invalid_credentials",
                                "tip": "Las credenciales OAuth2 son inválidas"
                            }
                        
                        if response.status_code >= 400:
                            return {
                                "ok": False,
                                "reason": f"auth_error_{response.status_code}",
                                "tip": f"Error al autenticar: HTTP {response.status_code}"
                            }
                        
                        token_data = response.json()
                        token = token_data.get("access_token")
                        expires_in = token_data.get("expires_in", 0)
                        
                        if not token:
                            return {
                                "ok": False,
                                "reason": "invalid_token_response",
                                "tip": "No se recibió token válido"
                            }
                        
                        return {
                            "ok": True,
                            "provider": "opensky",
                            "auth": "oauth2",
                            "token_last4": token[-4:] if len(token) >= 4 else token,
                            "expires_in": expires_in
                        }
                except Exception as exc:
                    return {
                        "ok": False,
                        "reason": "connection_error",
                        "tip": f"Error de conexión: {str(exc)}"
                    }
            
            elif mode == "basic":
                username = secret_store.get_secret("opensky_username")
                password = secret_store.get_secret("opensky_password")
                
                if not username or not password:
                    return {
                        "ok": False,
                        "reason": "missing_credentials",
                        "tip": "Configura username y password en secrets.opensky.basic"
                    }
                
                # Test básico con credenciales
                try:
                    bbox = opensky_cfg.bbox
                    if bbox:
                        params = {
                            "lamin": bbox.lamin,
                            "lamax": bbox.lamax,
                            "lomin": bbox.lomin,
                            "lomax": bbox.lomax
                        }
                    else:
                        params = {"lamin": 39.5, "lamax": 41.0, "lomin": -1.0, "lomax": 1.5}
                    
                    response = requests.get(
                        "https://opensky-network.org/api/states/all",
                        params=params,
                        auth=(username, password),
                        timeout=5
                    )
                    
                    if response.status_code == 401:
                        return {
                            "ok": False,
                            "reason": "invalid_credentials",
                            "tip": "Las credenciales básicas son inválidas"
                        }
                    
                    if response.status_code >= 400:
                        return {
                            "ok": False,
                            "reason": f"http_error_{response.status_code}",
                            "tip": f"Error HTTP: {response.status_code}"
                        }
                    
                    return {
                        "ok": True,
                        "provider": "opensky",
                        "auth": "basic",
                        "detail": "auth_ok"
                    }
                except Exception as exc:
                    return {
                        "ok": False,
                        "reason": "connection_error",
                        "tip": f"Error de conexión: {str(exc)}"
                    }
        
        # AviationStack
        elif provider == "aviationstack":
            api_key = secret_store.get_secret("aviationstack_api_key")
            
            if not api_key:
                return {
                    "ok": False,
                    "reason": "missing_api_key",
                    "tip": "Configura api_key en secrets.aviationstack"
                }
            
            try:
                base_url = flights_config.aviationstack.base_url if flights_config.aviationstack else "http://api.aviationstack.com/v1"
                response = requests.get(
                    f"{base_url}/flights",
                    params={"access_key": api_key, "limit": 1},
                    timeout=5
                )
                
                if response.status_code in [401, 403]:
                    return {
                        "ok": False,
                        "reason": "invalid_api_key",
                        "tip": "La API key de AviationStack es inválida"
                    }
                
                if response.status_code >= 400:
                    return {
                        "ok": False,
                        "reason": f"http_error_{response.status_code}",
                        "tip": f"Error HTTP: {response.status_code}"
                    }
                
                return {
                    "ok": True,
                    "provider": "aviationstack",
                    "detail": "auth_ok"
                }
            except Exception as exc:
                return {
                    "ok": False,
                    "reason": "connection_error",
                    "tip": f"Error de conexión: {str(exc)}"
                }
        
        # Custom
        elif provider == "custom":
            custom_cfg = flights_config.custom
            if not custom_cfg or not custom_cfg.api_url:
                return {
                    "ok": False,
                    "reason": "missing_api_url",
                    "tip": "Configura api_url en layers.flights.custom"
                }
            
            try:
                api_url = custom_cfg.api_url
                api_key = custom_cfg.api_key or secret_store.get_secret("custom_flights_api_key")
                
                # Intentar GET /health o endpoint básico
                test_url = f"{api_url.rstrip('/')}/health" if not api_url.endswith('/health') else api_url
                headers = {}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                
                response = requests.get(test_url, headers=headers, timeout=5)
                
                if response.status_code >= 400:
                    # Intentar con ?limit=1
                    test_url2 = f"{api_url.rstrip('/')}?limit=1"
                    response2 = requests.get(test_url2, headers=headers, timeout=5)
                    if response2.status_code >= 400:
                        return {
                            "ok": False,
                            "reason": f"http_error_{response2.status_code}",
                            "tip": f"Error HTTP: {response2.status_code}"
                        }
                
                return {
                    "ok": True,
                    "provider": "custom",
                    "detail": "connection_ok"
                }
            except Exception as exc:
                return {
                    "ok": False,
                    "reason": "connection_error",
                    "tip": f"Error de conexión: {str(exc)}"
                }
        
        else:
            return {
                "ok": False,
                "reason": "unknown_provider",
                "tip": f"Proveedor desconocido: {provider}"
            }
    
    except Exception as exc:
        logger.exception("[test] Error in test_flights")
        return {
            "ok": False,
            "reason": "internal_error",
            "tip": f"Error interno: {str(exc)}"
        }


@app.post("/api/ais/test")
async def test_ais() -> Dict[str, Any]:
    """Alias para POST /api/ships/test."""
    return await test_ships()


@app.post("/api/ships/test")
async def test_ships() -> Dict[str, Any]:
    """
    Test de conexión para el proveedor de barcos configurado.
    Lee layers.ships.provider y prueba la conexión según el proveedor.
    """
    try:
        config = config_manager.read()
        ships_config = config.layers.ships if config.layers else None
        
        if not ships_config or not ships_config.enabled:
            return {
                "ok": False,
                "reason": "layer_disabled",
                "tip": "Habilita la capa de barcos primero"
            }
        
        provider = ships_config.provider
        
        # AISStream
        if provider == "aisstream":
            api_key = secret_store.get_secret("aisstream_api_key")
            
            if not api_key:
                return {
                    "ok": False,
                    "reason": "missing_api_key",
                    "tip": "Configura api_key en secrets.aisstream"
                }
            
            try:
                ws_url = ships_config.aisstream.ws_url if ships_config.aisstream else "wss://stream.aisstream.io/v0/stream"
                
                # Intentar conexión HTTP para verificar autenticación (no WebSocket completo)
                # AISStream normalmente requiere WebSocket, pero podemos verificar la API key
                # haciendo una petición HTTP a un endpoint de verificación si existe
                # Por ahora, solo verificamos que la URL sea válida y que tengamos API key
                if not ws_url or not ws_url.startswith("wss://"):
                    return {
                        "ok": False,
                        "reason": "invalid_ws_url",
                        "tip": "La URL WebSocket debe ser válida (wss://...)"
                    }
                
                # Para AISStream, la verificación real requiere WebSocket, pero podemos
                # hacer una verificación básica de formato
                return {
                    "ok": True,
                    "provider": "aisstream",
                    "detail": "api_key_configured",
                    "tip": "La API key está configurada. La conexión WebSocket se establecerá automáticamente."
                }
            except Exception as exc:
                return {
                    "ok": False,
                    "reason": "configuration_error",
                    "tip": f"Error de configuración: {str(exc)}"
                }
        
        # AIS Hub
        elif provider == "aishub":
            api_key = secret_store.get_secret("aishub_api_key")
            
            if not api_key:
                return {
                    "ok": False,
                    "reason": "missing_api_key",
                    "tip": "Configura api_key en secrets.aishub"
                }
            
            try:
                base_url = ships_config.aishub.base_url if ships_config.aishub else "https://www.aishub.net/api"
                response = requests.get(
                    f"{base_url}/",
                    params={"username": api_key, "format": "json", "latmin": 39.5, "latmax": 41.0, "lonmin": -1.0, "lonmax": 1.5},
                    timeout=5
                )
                
                if response.status_code in [401, 403]:
                    return {
                        "ok": False,
                        "reason": "invalid_api_key",
                        "tip": "La API key de AIS Hub es inválida"
                    }
                
                if response.status_code >= 400:
                    return {
                        "ok": False,
                        "reason": f"http_error_{response.status_code}",
                        "tip": f"Error HTTP: {response.status_code}"
                    }
                
                return {
                    "ok": True,
                    "provider": "aishub",
                    "detail": "auth_ok"
                }
            except Exception as exc:
                return {
                    "ok": False,
                    "reason": "connection_error",
                    "tip": f"Error de conexión: {str(exc)}"
                }
        
        # AIS Generic / Custom
        elif provider in ["ais_generic", "custom"]:
            if provider == "ais_generic":
                cfg = ships_config.ais_generic
            else:
                cfg = ships_config.custom
            
            if not cfg or not cfg.api_url:
                return {
                    "ok": False,
                    "reason": "missing_api_url",
                    "tip": f"Configura api_url en layers.ships.{provider}"
                }
            
            try:
                api_url = cfg.api_url
                api_key = None
                if provider == "custom" and cfg.api_key:
                    api_key = cfg.api_key
                
                # Intentar GET /health o endpoint básico
                test_url = f"{api_url.rstrip('/')}/health" if not api_url.endswith('/health') else api_url
                headers = {}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                
                response = requests.get(test_url, headers=headers, timeout=5)
                
                if response.status_code >= 400:
                    # Intentar endpoint raíz
                    test_url2 = api_url.rstrip('/')
                    response2 = requests.get(test_url2, headers=headers, timeout=5)
                    if response2.status_code >= 400:
                        return {
                            "ok": False,
                            "reason": f"http_error_{response2.status_code}",
                            "tip": f"Error HTTP: {response2.status_code}"
                        }
                
                return {
                    "ok": True,
                    "provider": provider,
                    "detail": "connection_ok"
                }
            except Exception as exc:
                return {
                    "ok": False,
                    "reason": "connection_error",
                    "tip": f"Error de conexión: {str(exc)}"
                }
        
        else:
            return {
                "ok": False,
                "reason": "unknown_provider",
                "tip": f"Proveedor desconocido: {provider}"
            }
    
    except Exception as exc:
        logger.exception("[test] Error in test_ships")
        return {
            "ok": False,
            "reason": "internal_error",
            "tip": f"Error interno: {str(exc)}"
        }


@app.get("/api/flights/sample")
async def get_flights_sample(limit: int = 20) -> Dict[str, Any]:
    """Obtiene una vista previa de vuelos desde la caché si está activa la capa."""
    try:
        config = config_manager.read()
        flights_config = config.layers.flights if config.layers else None
        
        if not flights_config or not flights_config.enabled:
            return {"ok": False, "reason": "layer_disabled", "count": 0, "items": []}

        snapshot = opensky_service.get_last_snapshot()
        if snapshot and snapshot.payload:
            items = snapshot.payload.get("items", [])
            limited_items = items[:limit] if items else []
            return {
                "ok": True,
                "count": len(limited_items),
                "total": len(items),
                "items": limited_items,
            }

        return {"ok": True, "count": 0, "items": []}
    except Exception as exc:
        logger.exception("[preview] Error in get_flights_preview")
        return {
            "ok": False,
            "reason": "internal_error",
            "count": 0,
            "items": []
        }


@app.get("/api/ships/preview")
async def get_ships_preview(limit: int = 20) -> Dict[str, Any]:
    """Obtiene una vista previa de barcos desde la caché si está activa la capa."""
    try:
        config = config_manager.read()
        ships_config = config.layers.ships if config.layers else None
        
        if not ships_config or not ships_config.enabled:
            return {
                "ok": False,
                "reason": "layer_disabled",
                "count": 0,
                "items": []
            }
        
        # Intentar obtener datos desde cache_store
        try:
            cached_ships = cache_store.load("ships", max_age_minutes=None)
            if cached_ships and cached_ships.payload:
                features = cached_ships.payload.get("features", [])
                limited_features = features[:limit] if features else []
                return {
                    "ok": True,
                    "count": len(limited_features),
                    "total": len(features),
                    "items": limited_features
                }
        except Exception:
            pass
        
        return {
            "ok": True,
            "count": 0,
            "items": []
        }
    except Exception as exc:
        logger.exception("[preview] Error in get_ships_preview")
        return {
            "ok": False,
            "reason": "internal_error",
            "count": 0,
            "items": []
        }


def get_flights(request: Request, bbox: Optional[str] = None, extended: Optional[int] = None) -> JSONResponse:
    config = config_manager.read()
    opensky_cfg = config.opensky
    
    # Verificar si la capa de vuelos está habilitada y usa OpenSky
    layers = getattr(config, "layers", None)
    flights_config = getattr(layers, "flights", None) if layers else None
    flights_enabled = flights_config and flights_config.enabled and flights_config.provider == "opensky"
    
    # Si opensky.enabled está explícitamente en False, deshabilitar
    # Pero si layers.flights está habilitado con provider opensky, permitir que funcione
    if opensky_cfg.enabled is False and not flights_enabled:
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
        _augment_flights_payload(
            payload,
            {
                "provider": "opensky",
                "mode": opensky_cfg.mode,
                "bbox": bbox_override,
                "remaining": None,
                "polled": False,
            },
        )
        response = JSONResponse(payload, status_code=200)
        response.headers["X-OpenSky-Polled"] = "false"
        response.headers["X-OpenSky-Mode"] = opensky_cfg.mode
        return response
    except OpenSkyClientError as exc:
        logger.error("[opensky] client error during fetch: %s", exc)
        payload = {"count": 0, "items": [], "stale": True, "ts": int(time.time()), "error": "client"}
        _augment_flights_payload(
            payload,
            {
                "provider": "opensky",
                "mode": opensky_cfg.mode,
                "bbox": bbox_override,
                "remaining": None,
                "polled": False,
            },
        )
        response = JSONResponse(payload, status_code=200)
        response.headers["X-OpenSky-Polled"] = "false"
        response.headers["X-OpenSky-Mode"] = opensky_cfg.mode
        return response
    except Exception as exc:  # noqa: BLE001
        logger.exception("[opensky] unexpected error during fetch: %s", exc)
        payload = {"count": 0, "items": [], "stale": True, "ts": int(time.time()), "error": "unexpected"}
        _augment_flights_payload(
            payload,
            {
                "provider": "opensky",
                "mode": opensky_cfg.mode,
                "bbox": bbox_override,
                "remaining": None,
                "polled": False,
            },
        )
        response = JSONResponse(payload, status_code=200)
        response.headers["X-OpenSky-Polled"] = "false"
        response.headers["X-OpenSky-Mode"] = opensky_cfg.mode
        return response

    payload = dict(snapshot.payload)
    if snapshot.stale:
        payload["stale"] = True

    flights_cfg = config.layers.flights
    processed_items, stats = _prepare_flights_items(payload.get("items", []), flights_cfg, snapshot.bbox)
    payload["items"] = processed_items
    payload["count"] = len(processed_items)
    if stats.get("stale_features"):
        payload["stale"] = True

    meta_block: Dict[str, Any]
    base_meta = payload.get("meta")
    if isinstance(base_meta, dict):
        meta_block = dict(base_meta)
    else:
        meta_block = {}
    meta_block.update(
        {
            "input_items": stats.get("input", 0),
            "valid_items": stats.get("valid", 0),
            "invalid_items": stats.get("invalid", 0),
            "stale_candidates": stats.get("stale_candidates", 0),
            "stale_features": stats.get("stale_features", 0),
            "decimation": stats.get("decimation"),
        }
    )
    if stats.get("stale_features"):
        meta_block["stale"] = True
    payload["meta"] = meta_block

    _augment_flights_payload(
        payload,
        {
            "provider": "opensky",
            "mode": snapshot.mode,
            "bbox": snapshot.bbox,
            "remaining": snapshot.remaining,
            "polled": snapshot.polled,
        },
    )

    response = JSONResponse(payload)
    response.headers["X-OpenSky-Polled"] = "true" if snapshot.polled else "false"
    response.headers["X-OpenSky-Mode"] = snapshot.mode
    if snapshot.remaining is not None:
        response.headers["X-OpenSky-Remaining"] = snapshot.remaining
    return response


@app.get("/api/layers/flights.geojson")
def get_flights_geojson(request: Request, bbox: Optional[str] = None, extended: Optional[int] = None) -> JSONResponse:
    """Devuelve solo GeoJSON (FeatureCollection) reutilizando la lógica de get_flights."""
    base_response = get_flights(request, bbox, extended)
    try:
        content = json.loads(base_response.body.decode("utf-8"))
    except Exception:
        content = {}

    geojson_only = {
        "type": content.get("type", "FeatureCollection"),
        "features": content.get("features", []),
        "meta": content.get("meta", {}),
    }

    response = JSONResponse(geojson_only)
    # Propagar cabeceras relevantes
    for header in ("X-OpenSky-Polled", "X-OpenSky-Mode", "X-OpenSky-Remaining"):
        if header in base_response.headers:
            response.headers[header] = base_response.headers[header]
    return response

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

        filtered_features, stats = _prepare_ship_features(data.get("features", []), ships_config)

        bounds_normalized = _normalize_generic_bounds(bounds)
        viewport_features = filtered_features
        if bounds:
            viewport_features = []
            for feature in filtered_features:
                geometry = feature.get("geometry", {})
                if not isinstance(geometry, dict) or geometry.get("type") != "Point":
                    continue
                coords = geometry.get("coordinates", [])
                if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                    lon, lat = coords[0], coords[1]
                    if bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3]:
                        viewport_features.append(feature)

        features_for_focus = viewport_features
        
        # Modo Cine eliminado en v2: no aplicar máscara de foco
        # Etiquetar features con in_focus (siempre False)
        features_with_focus: List[Dict[str, Any]] = []
        for feature in features_for_focus:
            props = feature.get("properties", {})
            
            features_with_focus.append({
                **feature,
                "properties": {
                    **props,
                    "in_focus": False
                }
            })

        max_view_limit = max_items_view if max_items_view else ships_config.max_items_view

        def priority_fn(feat: Dict[str, Any]) -> Tuple[int, int, int, float]:
            props = feat.get("properties", {})
            in_focus_rank = 0 if props.get("in_focus") else 1
            stale_rank = 0 if not props.get("stale") else 1
            timestamp_rank = -int(props.get("timestamp") or 0)
            speed_raw = props.get("speed")
            try:
                speed_rank = -float(speed_raw) if speed_raw is not None else 0.0
            except (TypeError, ValueError):
                speed_rank = 0.0
            return (in_focus_rank, stale_rank, timestamp_rank, speed_rank)

        if ships_config.decimate == "grid" and int(ships_config.grid_px) > 0:
            final_features, decimation_meta = _grid_decimate_entries(
                features_with_focus,
                int(ships_config.grid_px),
                bounds_normalized,
                lambda feat: (
                    feat.get("geometry", {}).get("coordinates", [None, None])[0],
                    feat.get("geometry", {}).get("coordinates", [None, None])[1],
                ),
                priority_fn,
                max_view_limit if max_view_limit and max_view_limit > 0 else None,
            )
        else:
            final_features = list(features_with_focus)
            truncated = 0
            if max_view_limit and max_view_limit > 0 and len(final_features) > max_view_limit:
                final_features.sort(key=priority_fn)
                truncated = len(final_features) - max_view_limit
                final_features = final_features[:max_view_limit]
            decimation_meta = {
                "strategy": "none",
                "grid_px": int(getattr(ships_config, "grid_px", 0) or 0),
                "input": len(features_with_focus),
                "kept": len(final_features),
                "collisions": 0,
            }
            if max_view_limit and max_view_limit > 0:
                decimation_meta["max_items_view"] = max_view_limit
                decimation_meta["truncated"] = max(0, truncated)

        final_features.sort(key=priority_fn)

        stale_final = sum(1 for feat in final_features if feat.get("properties", {}).get("stale"))
        stats.update(
            {
                "stale_features": stale_final,
                "decimation": decimation_meta,
            }
        )

        data["features"] = final_features
        
        # Añadir metadata si focus no está disponible
        if focus_unavailable:
            data["properties"] = data.get("properties", {})
            data["properties"]["focus_unavailable"] = True

        # Guardar en caché
        meta = data.setdefault("meta", {})
        meta.setdefault("provider", ships_config.provider)
        meta.update(
            {
                "input_items": stats.get("input", 0),
                "valid_items": stats.get("valid", 0),
                "invalid_items": stats.get("invalid", 0),
                "stale_candidates": stats.get("stale_candidates", 0),
                "stale_features": stats.get("stale_features", 0),
                "decimation": stats.get("decimation"),
            }
        )
        if stream_provider and not meta.get("ok"):
            meta["ok"] = len(final_features) > 0
        if not stream_provider:
            meta.setdefault("ok", True)
        if stats.get("stale_features"):
            data["stale"] = True
            meta["stale"] = True
        if not used_cache:
            cache_store.store("ships", data)
        logger.info(
            "Fetched %d ships (in_focus: %d)",
            len(final_features),
            sum(1 for f in final_features if f.get("properties", {}).get("in_focus", False)),
        )
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


@app.get("/api/layers/ships")
def get_ships_layer(request: Request) -> JSONResponse:
    """Devuelve el FeatureCollection actual de AISStream.

    Si la capa de barcos está deshabilitada, devuelve una colección vacía.
    """
    config = config_manager.read()
    ships_config = config.layers.ships if config.layers else None
    if not ships_config or not ships_config.enabled:
        return JSONResponse({"type": "FeatureCollection", "features": [], "stale": True})
    # Obtener snapshot del servicio AISStream
    snapshot = ships_service.get_snapshot()
    return JSONResponse(snapshot)


def get_lightning(request: Request, bbox: Optional[str] = None) -> JSONResponse:
    """Devuelve datos de rayos en formato GeoJSON."""
    global blitzortung_service
    
    if not blitzortung_service:
        return JSONResponse({
            "type": "FeatureCollection",
            "features": [],
            "meta": {"ok": False, "reason": "service_not_initialized"}
        })
        
    # Parsear bbox si está presente
    bounds = None
    if bbox:
        try:
            parts = [float(x.strip()) for x in bbox.split(",")]
            if len(parts) == 4:
                bounds = (parts[0], parts[1], parts[2], parts[3])
        except (ValueError, IndexError):
            pass
            
    data = blitzortung_service.to_geojson(bbox=bounds)
    return JSONResponse(data)

# Proveedores globales
_gibs_provider = GIBSProvider()
_rainviewer_provider = RainViewerProvider()


@dataclass
class _PathsConfig:
    gibs_cache_dir: Path = Path(
        os.getenv("PANTALLA_GIBS_CACHE_DIR", "/var/cache/pantalla-reloj/gibs")
    )


paths = _PathsConfig()


def _get_openweather_provider(layer_type: Optional[str] = None) -> OpenWeatherMapRadarProvider:
    """Obtiene una instancia del proveedor OpenWeatherMap con la capa especificada."""
    return OpenWeatherMapRadarProvider(
        api_key_resolver=lambda: secret_store.get_secret("openweathermap_api_key"),
        layer=layer_type or os.getenv("PANTALLA_GLOBAL_RADAR_LAYER", "precipitation_new"),
    )


@dataclass
class _EffectiveGIBSConfig:
    enabled: bool
    provider: str
    refresh_minutes: int
    history_minutes: int
    frame_step: int
    layer: str
    tile_matrix_set: str
    min_zoom: int
    max_zoom: int
    default_zoom: int
    epsg: str
    format_ext: str
    time_mode: str
    time_value: str


def _resolve_gibs_config() -> Tuple[_EffectiveGIBSConfig, Optional[str]]:
    """Return the effective satellite configuration combining layers and UI."""

    provider_candidates: List[str] = []
    enabled_flags: List[bool] = []
    error: Optional[str] = None

    history_minutes = GIBS_DEFAULT_HISTORY_MINUTES
    frame_step = GIBS_DEFAULT_FRAME_STEP
    refresh_minutes = 10
    layer_name = GIBS_DEFAULT_LAYER
    tile_matrix_set = GIBS_DEFAULT_TILE_MATRIX_SET
    min_zoom = GIBS_DEFAULT_MIN_ZOOM
    max_zoom = GIBS_DEFAULT_MAX_ZOOM
    default_zoom = GIBS_DEFAULT_DEFAULT_ZOOM
    epsg = GIBS_DEFAULT_EPSG
    format_ext = GIBS_DEFAULT_FORMAT_EXT
    time_mode = GIBS_DEFAULT_TIME_MODE
    time_value = GIBS_DEFAULT_TIME_VALUE

    global_satellite = None
    ui_satellite = None

    try:
        config = config_manager.read()
        if config.layers and config.layers.global_ and config.layers.global_.satellite:
            global_satellite = config.layers.global_.satellite
        if config.ui_global and config.ui_global.satellite:
            ui_satellite = config.ui_global.satellite
    except Exception as exc:  # noqa: BLE001
        error = "config_read_error"
        logger.warning("Failed to read v2 config for global satellite: %s", exc)

    if global_satellite is None and ui_satellite is None:
        try:
            legacy_config = config_manager.read()
            legacy_layers = getattr(legacy_config.layers, "global_", None)
            if legacy_layers and getattr(legacy_layers, "satellite", None):
                global_satellite = legacy_layers.satellite
        except Exception as exc:  # noqa: BLE001
            if error is None:
                error = "config_read_error"
            logger.warning("Failed to read legacy satellite config: %s", exc)

    if global_satellite is not None:
        provider = getattr(global_satellite, "provider", None)
        if provider:
            provider_candidates.append(provider)
        history_minutes = getattr(global_satellite, "history_minutes", history_minutes)
        frame_step = getattr(global_satellite, "frame_step", frame_step)
        refresh_minutes = getattr(global_satellite, "refresh_minutes", refresh_minutes)
        layer_name = getattr(global_satellite, "layer", layer_name)
        tile_matrix_set = getattr(global_satellite, "tile_matrix_set", tile_matrix_set)
        min_zoom = getattr(global_satellite, "min_zoom", min_zoom)
        max_zoom = getattr(global_satellite, "max_zoom", max_zoom)
        default_zoom = getattr(global_satellite, "default_zoom", default_zoom)
        enabled_flags.append(bool(getattr(global_satellite, "enabled", True)))

        gibs_config = getattr(global_satellite, "gibs", None)
        if gibs_config is not None:
            epsg = getattr(gibs_config, "epsg", epsg)
            format_ext = getattr(gibs_config, "format_ext", format_ext)
            time_mode = getattr(gibs_config, "time_mode", time_mode)
            time_value = getattr(gibs_config, "time_value", time_value)
            fields_set = getattr(gibs_config, "model_fields_set", set())
            if "layer" in fields_set:
                layer_name = getattr(gibs_config, "layer", layer_name)
            if "tile_matrix_set" in fields_set:
                tile_matrix_set = getattr(gibs_config, "tile_matrix_set", tile_matrix_set)

    if ui_satellite is not None:
        provider = getattr(ui_satellite, "provider", None)
        if provider:
            provider_candidates.append(provider)
        layer_name = getattr(ui_satellite, "layer", layer_name)
        tile_matrix_set = getattr(ui_satellite, "tile_matrix_set", tile_matrix_set)
        min_zoom = getattr(ui_satellite, "min_zoom", min_zoom)
        max_zoom = getattr(ui_satellite, "max_zoom", max_zoom)
        default_zoom = getattr(ui_satellite, "default_zoom", default_zoom)
        history_minutes = getattr(ui_satellite, "history_minutes", history_minutes)
        frame_step = getattr(ui_satellite, "frame_step", frame_step)
        enabled_flags.append(bool(getattr(ui_satellite, "enabled", True)))

        gibs_config = getattr(ui_satellite, "gibs", None)
        if gibs_config is not None:
            epsg = getattr(gibs_config, "epsg", epsg)
            format_ext = getattr(gibs_config, "format_ext", format_ext)
            time_mode = getattr(gibs_config, "time_mode", time_mode)
            time_value = getattr(gibs_config, "time_value", time_value)
            fields_set = getattr(gibs_config, "model_fields_set", set())
            if "layer" in fields_set:
                layer_name = getattr(gibs_config, "layer", layer_name)
            if "tile_matrix_set" in fields_set:
                tile_matrix_set = getattr(gibs_config, "tile_matrix_set", tile_matrix_set)

    provider_name = provider_candidates[0] if provider_candidates else "gibs"
    enabled = all(enabled_flags) if enabled_flags else True

    if any(candidate and candidate != "gibs" for candidate in provider_candidates):
        enabled = False

    if max_zoom < min_zoom:
        max_zoom = min_zoom

    default_zoom = max(min(int(default_zoom), int(max_zoom)), int(min_zoom))

    if not epsg:
        epsg = GIBS_DEFAULT_EPSG
    if not format_ext:
        format_ext = GIBS_DEFAULT_FORMAT_EXT
    if not time_mode:
        time_mode = GIBS_DEFAULT_TIME_MODE
    if not time_value:
        time_value = GIBS_DEFAULT_TIME_VALUE

    effective_config = _EffectiveGIBSConfig(
        enabled=bool(enabled),
        provider=provider_name or "gibs",
        refresh_minutes=int(refresh_minutes),
        history_minutes=int(history_minutes),
        frame_step=int(frame_step),
        layer=str(layer_name),
        tile_matrix_set=str(tile_matrix_set),
        min_zoom=int(min_zoom),
        max_zoom=int(max_zoom),
        default_zoom=int(default_zoom),
        epsg=str(epsg),
        format_ext=str(format_ext),
        time_mode=str(time_mode),
        time_value=str(time_value),
    )

    return effective_config, error


def _build_gibs_tile_url(
    *,
    z: int,
    x: int,
    y: int,
    config: _EffectiveGIBSConfig,
) -> str:
    """Build the WMTS URL for a GIBS tile using the effective configuration.
    
    Valida y aplica clamp de zoom según los límites del tile_matrix_set para evitar
    errores 400 Bad Request cuando z/x/y no cuadran con los límites válidos.
    """

    # Clamp de zoom: asegurar que z esté dentro de los límites válidos del tile_matrix_set
    min_zoom = config.min_zoom if config.min_zoom is not None else GIBS_DEFAULT_MIN_ZOOM
    max_zoom = config.max_zoom if config.max_zoom is not None else GIBS_DEFAULT_MAX_ZOOM
    
    # Para GoogleMapsCompatible_Level9, el máximo zoom efectivo es 9
    # Asegurar que max_zoom nunca exceda 9 para este tile_matrix_set
    tile_matrix_set = (config.tile_matrix_set or GIBS_DEFAULT_TILE_MATRIX_SET).strip() or GIBS_DEFAULT_TILE_MATRIX_SET
    if "Level9" in tile_matrix_set:
        max_zoom = min(max_zoom, 9)
    
    # Clamp z al rango válido [min_zoom, max_zoom]
    z_clamped = max(min(int(z), int(max_zoom)), int(min_zoom))
    
    # Si el zoom fue modificado, registrar un warning para debugging
    if z_clamped != z:
        logger.debug(
            "[GIBS] Clamped zoom z=%d -> z=%d (min=%d, max=%d, tile_matrix_set=%s)",
            z, z_clamped, min_zoom, max_zoom, tile_matrix_set
        )
    
    current = datetime.now(timezone.utc)
    time_key = _gibs_provider._resolve_time_key(  # type: ignore[attr-defined]
        current=current,
        time_mode=config.time_mode or GIBS_DEFAULT_TIME_MODE,
        explicit_time=config.time_value or GIBS_DEFAULT_TIME_VALUE,
    )

    epsg_code = (config.epsg or GIBS_DEFAULT_EPSG).strip() or GIBS_DEFAULT_EPSG
    layer_name = (config.layer or GIBS_DEFAULT_LAYER).strip() or GIBS_DEFAULT_LAYER
    extension = (config.format_ext or GIBS_DEFAULT_FORMAT_EXT).lstrip(".") or GIBS_DEFAULT_FORMAT_EXT

    # Usar z_clamped en lugar de z en la URL
    return (
        f"{_gibs_provider.base_url}/wmts/{epsg_code}/best/{layer_name}/default/"
        f"{time_key}/{tile_matrix_set}/{z_clamped}/{y}/{x}.{extension}"
    )


def build_gibs_tile_url_for_frame(
    frame: GlobalSatelliteFrame,
    *,
    z: int,
    x: int,
    y: int,
) -> str:
    """Return the WMTS URL for a specific GIBS frame.
    
    Valida y aplica clamp de zoom según los límites del frame para evitar
    errores 400 Bad Request cuando z/x/y no cuadran con los límites válidos.
    """
    # Obtener configuración efectiva para validar límites de zoom
    config, _ = _resolve_gibs_config()
    
    # Clamp de zoom: usar min_zoom y max_zoom del frame si están disponibles,
    # si no, usar los de la configuración
    min_zoom = frame.min_zoom if frame.min_zoom is not None else (config.min_zoom if config.min_zoom is not None else GIBS_DEFAULT_MIN_ZOOM)
    max_zoom = frame.max_zoom if frame.max_zoom is not None else (config.max_zoom if config.max_zoom is not None else GIBS_DEFAULT_MAX_ZOOM)
    
    # Para GoogleMapsCompatible_Level9, el máximo zoom efectivo es 9
    tile_matrix_set = frame.tile_matrix_set if frame.tile_matrix_set else (config.tile_matrix_set if config.tile_matrix_set else GIBS_DEFAULT_TILE_MATRIX_SET)
    if "Level9" in tile_matrix_set:
        max_zoom = min(max_zoom, 9)
    
    # Clamp z al rango válido [min_zoom, max_zoom]
    z_clamped = max(min(int(z), int(max_zoom)), int(min_zoom))
    
    # Si el zoom fue modificado, registrar un warning para debugging
    if z_clamped != z:
        logger.debug(
            "[GIBS] Clamped zoom z=%d -> z=%d (min=%d, max=%d, tile_matrix_set=%s)",
            z, z_clamped, min_zoom, max_zoom, tile_matrix_set
        )

    template = (frame.tile_url or "").strip()
    if template:
        try:
            # Usar z_clamped en lugar de z en el template
            return template.format(z=z_clamped, x=x, y=y)
        except KeyError:
            logger.warning("Frame tile_url missing placeholders, falling back to defaults")
    layer_name = frame.layer or GIBS_DEFAULT_LAYER
    time_key = frame.time_key or GIBS_DEFAULT_TIME_VALUE
    extension = GIBS_DEFAULT_FORMAT_EXT.lstrip(".") or "jpg"
    # Usar z_clamped y tile_matrix_set validado en lugar de z original
    return (
        f"{_gibs_provider.base_url}/wmts/{GIBS_DEFAULT_EPSG}/best/{layer_name}/default/"
        f"{time_key}/{tile_matrix_set}/{z_clamped}/{y}/{x}.{extension}"
    )


def _build_global_satellite_frames_response(
    *, now_dt: Optional[datetime] = None
) -> Tuple[GlobalSatelliteFramesResponse, _EffectiveGIBSConfig]:
    """Return frames metadata and the effective configuration."""

    now_dt = (now_dt or datetime.now(timezone.utc)).replace(microsecond=0)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")

    config, config_error = _resolve_gibs_config()

    base_kwargs = dict(
        provider=config.provider,
        history_minutes=config.history_minutes,
        frame_step=config.frame_step,
        now_iso=now_iso,
    )

    if not config.enabled:
        return (
            GlobalSatelliteFramesResponse(
                enabled=False,
                frames=[],
                error=config_error,
                **base_kwargs,
            ),
            config,
        )

    try:
        frames_raw = _gibs_provider.get_available_frames(
            history_minutes=config.history_minutes,
            frame_step=config.frame_step,
            now=now_dt,
            layer=config.layer,
            tile_matrix_set=config.tile_matrix_set,
            min_zoom=config.min_zoom,
            max_zoom=config.max_zoom,
            default_zoom=config.default_zoom,
            epsg=config.epsg,
            format_ext=config.format_ext,
            time_mode=config.time_mode,
            time_value=config.time_value,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to get global satellite frames: %s", exc)
        return (
            GlobalSatelliteFramesResponse(
                enabled=False,
                frames=[],
                error=str(exc),
                **base_kwargs,
            ),
            config,
        )

    if not frames_raw:
        logger.warning("GIBS returned no frames for the configured window")
        return (
            GlobalSatelliteFramesResponse(
                enabled=False,
                frames=[],
                error=config_error,
                **base_kwargs,
            ),
            config,
        )

    frames_raw.sort(key=lambda frame: frame.get("timestamp", 0))
    frames = [GlobalSatelliteFrame(**frame_dict) for frame_dict in frames_raw]

    return (
        GlobalSatelliteFramesResponse(
            enabled=True,
            frames=frames,
            error=config_error,
            **base_kwargs,
        ),
        config,
    )


@app.get(
    "/api/global/satellite/frames",
    response_model=GlobalSatelliteFramesResponse,
)
def get_global_satellite_frames() -> GlobalSatelliteFramesResponse:
    """Return temporal frames for the global satellite animation."""

    frames_response, _ = _build_global_satellite_frames_response()
    return frames_response


@app.get("/api/global/sat/tiles/{z:int}/{x:int}/{y:int}.png")
async def get_global_sat_tile(z: int, x: int, y: int, request: Request) -> Response:
    """Proxy simple para tiles actuales de GIBS.
    
    Valida z/x/y antes de construir la URL para evitar errores 400 Bad Request.
    """

    config, _ = _resolve_gibs_config()
    enabled = config.enabled and config.provider == "gibs"

    if not enabled:
        raise HTTPException(status_code=404, detail="GIBS global satellite disabled")
    
    # Validar que z, x, y sean valores razonables antes de construir la URL
    if z < 0 or z > 24:
        logger.warning("[GIBS] Invalid zoom level z=%d (requested by client)", z)
        raise HTTPException(status_code=400, detail=f"Invalid zoom level: {z}")
    
    if x < 0 or y < 0:
        logger.warning("[GIBS] Invalid tile coordinates x=%d, y=%d (requested by client)", x, y)
        raise HTTPException(status_code=400, detail=f"Invalid tile coordinates: x={x}, y={y}")
    
    # Construir URL con validación y clamp de zoom
    tile_url = _build_gibs_tile_url(z=z, x=x, y=y, config=config)

    headers = {"User-Agent": request.headers.get("user-agent", "pantalla-reloj/1.0")}
    timeout = 10.0

    try:
        if httpx is not None:
            async with httpx.AsyncClient(timeout=timeout) as client:
                upstream = await client.get(tile_url, headers=headers)
        else:
            upstream = requests.get(tile_url, headers=headers, timeout=timeout)

        response_headers = {}
        for header_name in ("Content-Type", "Cache-Control", "ETag", "Last-Modified", "Expires", "Content-Length"):
            value = upstream.headers.get(header_name)
            if value is not None:
                response_headers[header_name] = value

        media_type = response_headers.pop("Content-Type", None)
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=media_type,
            headers=response_headers,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to proxy GIBS tile: %s", exc)
        raise HTTPException(status_code=502, detail="gibs_proxy_error") from exc


@app.get("/api/global/radar/frames")
def get_global_radar_frames() -> Dict[str, Any]:
    """Obtiene lista de frames disponibles de radar global."""
    # Leer configuración
    try:
        config = config_manager.read()
        if config.layers and config.layers.global_ and config.layers.global_.radar:
            # V2: leer de layers.global.radar (prioridad)
            radar_config = config.layers.global_.radar
            enabled = radar_config.enabled
            provider_name = radar_config.provider
            history_minutes = radar_config.history_minutes
            frame_step = radar_config.frame_step
        elif config.ui_global and config.ui_global.radar:
            # V2: fallback a ui_global.radar (configuración legacy)
            radar_config = config.ui_global.radar
            enabled = radar_config.enabled if radar_config else False
            provider_name = radar_config.provider if radar_config else "rainviewer"
            history_minutes = 90  # defaults
            frame_step = 5
        else:
            enabled = False
            provider_name = "rainviewer"
            history_minutes = 90
            frame_step = 5
    except Exception:
        # Fallback a V1
        try:
            config = config_manager.read()
            gl = getattr(config.layers, "global_", None)
            if not gl:
                enabled = False
                provider_name = "rainviewer"
                history_minutes = 90
                frame_step = 5
            else:
                global_config = gl.radar
                enabled = global_config.enabled
                provider_name = global_config.provider
                history_minutes = global_config.history_minutes
                frame_step = global_config.frame_step
        except Exception:
            return {"frames": [], "count": 0, "provider": "rainviewer", "status": "down"}

    if not enabled:
        return {"frames": [], "count": 0, "provider": provider_name, "status": "down"}

    try:
        if provider_name == "openweathermap":
            # Obtener layer_type de la configuración global
            layer_type = "precipitation_new"
            try:
                global_config = config_manager.get_config()
                if hasattr(global_config, "layers") and hasattr(global_config.layers, "global_"):
                    gl = getattr(global_config.layers, "global_", None)
                    if gl and hasattr(gl, "radar"):
                        layer_type = getattr(gl.radar, "layer_type", "precipitation_new")
            except Exception:
                pass  # Usar valor por defecto si hay error
            
            openweather_provider = _get_openweather_provider(layer_type)
            frames = openweather_provider.get_available_frames(
                history_minutes=history_minutes,
                frame_step=frame_step,
            )
        else:
            frames = _rainviewer_provider.get_available_frames(
                history_minutes=history_minutes,
                frame_step=frame_step,
            )
        status = "ok" if frames else "degraded"
        return {
            "frames": frames,
            "count": len(frames),
            "provider": provider_name,
            "status": status,
        }
    except OpenWeatherMapApiKeyError as exc:
        logger.warning("OpenWeatherMap radar frames unavailable: %s", exc)
        return {
            "frames": [],
            "count": 0,
            "provider": provider_name,
            "status": "down",
            "error": str(exc),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to get global radar frames: %s", exc)
        return {
            "frames": [],
            "count": 0,
            "provider": provider_name,
            "status": "degraded",
            "error": str(exc),
        }


@app.get("/api/global/satellite/tiles/{timestamp:int}/{z:int}/{x:int}/{y:int}.png")
async def get_global_satellite_tile(
    timestamp: int,
    z: int,
    x: int,
    y: int,
    request: Request
) -> Response:
    """Return cached or proxied GIBS tiles for the requested frame.
    
    Valida z/x/y antes de construir la URL para evitar errores 400 Bad Request.
    """

    frames_response, config = _build_global_satellite_frames_response()

    if not (config.enabled and config.provider == "gibs"):
        raise HTTPException(status_code=404, detail="Global satellite (GIBS) disabled")

    frames = frames_response.frames
    if not frames:
        raise HTTPException(status_code=503, detail="No GIBS frames available")
    
    # Validar que z, x, y sean valores razonables antes de construir la URL
    if z < 0 or z > 24:
        logger.warning("[GIBS] Invalid zoom level z=%d (requested by client)", z)
        raise HTTPException(status_code=400, detail=f"Invalid zoom level: {z}")
    
    if x < 0 or y < 0:
        logger.warning("[GIBS] Invalid tile coordinates x=%d, y=%d (requested by client)", x, y)
        raise HTTPException(status_code=400, detail=f"Invalid tile coordinates: x={x}, y={y}")

    frame = next((item for item in frames if item.timestamp == timestamp), None)
    if frame is None:
        frame = min(frames, key=lambda item: abs(item.timestamp - timestamp))

    # Construir URL con validación y clamp de zoom (ya se hace dentro de build_gibs_tile_url_for_frame)
    upstream_url = build_gibs_tile_url_for_frame(frame, z=z, x=x, y=y)

    cache_path = (
        paths.gibs_cache_dir
        / str(timestamp)
        / str(z)
        / str(x)
        / f"{y}.jpg"
    )

    if cache_path.exists():
        return FileResponse(cache_path, media_type="image/jpeg")

    cache_dir = cache_path.parent
    cache_dir_ready = True
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        cache_dir_ready = cache_dir.exists()
        if not cache_dir_ready:
            logger.warning("Could not ensure GIBS cache directory %s: %s", cache_dir, exc)

    headers = {"User-Agent": request.headers.get("user-agent", "pantalla-reloj/1.0")}
    timeout = 12.0

    try:
        if httpx is not None:
            async with httpx.AsyncClient(timeout=timeout) as client:
                upstream = await client.get(upstream_url, headers=headers)
        else:
            loop = asyncio.get_running_loop()

            def _fetch() -> requests.Response:
                return requests.get(upstream_url, headers=headers, timeout=timeout)

            upstream = await loop.run_in_executor(None, _fetch)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to fetch GIBS tile %s: %s", upstream_url, exc)
        raise HTTPException(status_code=502, detail="GIBS upstream error") from exc

    status_code = upstream.status_code

    if 200 <= status_code < 300:
        content = upstream.content
        file_written = False
        if cache_dir_ready:
            try:
                tmp_path = cache_path.with_suffix(cache_path.suffix + ".tmp")
                tmp_path.write_bytes(content)
                tmp_path.replace(cache_path)
                file_written = True
            except OSError as exc:
                logger.warning("Could not write GIBS cache %s: %s", cache_path, exc)
        if file_written:
            return FileResponse(cache_path, media_type="image/jpeg")
        return Response(content=content, media_type="image/jpeg")

    if status_code in {400, 404}:
        raise HTTPException(status_code=404, detail="GIBS tile_not_available")

    logger.error(
        "Unexpected status code %s fetching GIBS tile %s", status_code, upstream_url
    )
    raise HTTPException(status_code=502, detail="GIBS upstream error")


@app.get("/api/global/radar/tiles/{timestamp:int}/{z:int}/{x:int}/{y:int}.png")
async def get_global_radar_tile(
    timestamp: int,
    z: int,
    x: int,
    y: int,
    request: Request
) -> Response:
    """Proxy de tiles de radar global con caché."""
    # Leer configuración V2 si está disponible
    enabled = False
    provider_name = "rainviewer"
    refresh_minutes = 5
    layer_type = "precipitation_new"
    try:
        config = config_manager.read()
        if config.layers and config.layers.global_ and config.layers.global_.radar:
            # V2: leer de layers.global.radar (prioridad)
            radar_config = config.layers.global_.radar
            enabled = radar_config.enabled
            provider_name = radar_config.provider
            refresh_minutes = radar_config.refresh_minutes
            layer_type = radar_config.layer_type or "precipitation_new"
        elif config.ui_global and config.ui_global.radar:
            # V2: fallback a ui_global.radar
            radar_config = config.ui_global.radar
            enabled = radar_config.enabled if radar_config else False
            provider_name = radar_config.provider if radar_config else "rainviewer"
            layer_type = radar_config.layer_type or "precipitation_new"
            refresh_minutes = 5  # default
    except Exception:
        # Fallback a V1
        try:
            config = config_manager.read()
            gl = getattr(config.layers, "global_", None)
            if gl:
                global_config = gl.radar
                enabled = global_config.enabled
                provider_name = global_config.provider
                refresh_minutes = global_config.refresh_minutes
                layer_type = getattr(global_config, "layer_type", "precipitation_new")
        except Exception:
            enabled = False

    if not enabled:
        raise HTTPException(status_code=404, detail="Global radar layer disabled")

    # Caché de tiles en disco
    cache_dir = Path("/var/cache/pantalla/global/radar")
    cache_dir.mkdir(parents=True, exist_ok=True)
    tile_path = cache_dir / f"{timestamp}_{z}_{x}_{y}.png"

    if tile_path.exists():
        tile_age = datetime.now(timezone.utc).timestamp() - tile_path.stat().st_mtime
        if tile_age < refresh_minutes * 60:
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
        if provider_name == "openweathermap":
            # Obtener layer_type de la configuración global
            layer_type = "precipitation_new"
            try:
                global_config = config_manager.get_config()
                if hasattr(global_config, "layers") and hasattr(global_config.layers, "global_"):
                    gl = getattr(global_config.layers, "global_", None)
                    if gl and hasattr(gl, "radar"):
                        layer_type = getattr(gl.radar, "layer_type", "precipitation_new")
            except Exception:
                pass  # Usar valor por defecto si hay error
            
            openweather_provider = _get_openweather_provider(layer_type)
            tile_url = openweather_provider.get_tile_url(timestamp, z, x, y)
        else:
            tile_url = _rainviewer_provider.get_tile_url(timestamp, z, x, y)

        # CAMBIO: Usar httpx asíncrono
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(tile_url)
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
    except OpenWeatherMapApiKeyError as exc:
        logger.warning("OpenWeatherMap radar tile requested but API key missing")
        raise HTTPException(status_code=502, detail="OWM API key missing") from exc

    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        logger.warning("Failed to fetch global radar tile: %s", exc)

        # Intentar extraer el status original si existe
        status = 502
        try:
            resp = getattr(exc, "response", None)
            if resp is not None and hasattr(resp, "status_code"):
                status = resp.status_code
        except Exception:
            pass

        # Si es un 400/404 del proveedor, lo tratamos como tile no disponible
        if status in (400, 404):
            raise HTTPException(
                status_code=404,
                detail="Global radar tile_not_available"
            ) from exc

        # Para el resto, error de upstream
        raise HTTPException(
            status_code=502,
            detail="Global radar upstream error"
        ) from exc

    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error fetching global radar tile: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Global radar internal error"
        ) from exc


def sign_maptiler_urls(cfg: AppConfigV2) -> AppConfigV2:
    """Firma automáticamente las URLs de MapTiler añadiendo ?key= si falta.
    
    Esta función modifica el objeto cfg en memoria añadiendo ?key= a:
    - ui_map.maptiler.styleUrl (si provider empieza por maptiler_)
    - ui_map.satellite.labels_style_url (si existe y no tiene ?key=)
    
    La API key se obtiene de secret_store['maptiler_api_key'].
    No persiste cambios en disco, solo modifica el objeto en memoria.
    
    Args:
        cfg: Configuración AppConfigV2 a modificar
        
    Returns:
        El mismo objeto cfg (modificado en memoria)
    """
    provider = cfg.ui_map.provider or ""
    if not provider.startswith("maptiler_"):
        return cfg
    
    # Obtener API key del secret store
    maptiler_key = secret_store.get_secret("maptiler_api_key")
    if not maptiler_key or not maptiler_key.strip():
        return cfg
    
    maptiler_key = maptiler_key.strip()
    
    # Asegurar que cfg.ui_map.maptiler existe y tiene api_key en memoria
    if not cfg.ui_map.maptiler:
        from .models_v2 import MapTilerConfig
        cfg.ui_map.maptiler = MapTilerConfig()
    
    # Establecer api_key en memoria (no se expone en GET /api/config)
    cfg.ui_map.maptiler.api_key = maptiler_key
    
    # Firmar styleUrl usando helper centralizado
    if cfg.ui_map.maptiler.styleUrl:
        cfg.ui_map.maptiler.styleUrl = (
            normalize_maptiler_style_url(maptiler_key, cfg.ui_map.maptiler.styleUrl)
            or cfg.ui_map.maptiler.styleUrl
        )
    
    # Firmar labels_style_url si existe
    if cfg.ui_map.satellite and cfg.ui_map.satellite.labels_overlay:
        labels_overlay = cfg.ui_map.satellite.labels_overlay
        if labels_overlay.style_url:
            labels_overlay.style_url = (
                normalize_maptiler_style_url(maptiler_key, labels_overlay.style_url)
                or labels_overlay.style_url
            )
    
    return cfg


def ensure_maptiler_key() -> None:
    """Asegura que las URLs de MapTiler contengan ?key= con la API key.
    
    Lee config.json y verifica si ui_map.maptiler.styleUrl y 
    ui_map.satellite.labels_style_url contienen ?key=.
    Si falta, lee la API key de secrets.maptiler.api_key o MAPTILER_API_KEY,
    reconstruye las URLs y reescribe config.json.
    """
    try:
        # Leer config.json como dict
        if not config_manager.config_file.exists():
            logger.debug("[maptiler] Config file not found, skipping key injection")
            return
        
        config_data = json.loads(config_manager.config_file.read_text(encoding="utf-8"))
        
        # Obtener API key de secrets o entorno
        api_key = (
            secret_store.get_secret("maptiler_api_key") or
            os.getenv("MAPTILER_API_KEY") or
            None
        )
        
        if not api_key:
            logger.debug("[maptiler] No API key found in secrets or environment, skipping")
            return
        
        api_key = api_key.strip()
        if not api_key:
            return
        
        changed = False
        ui_map = config_data.get("ui_map", {})
        
        # Verificar y actualizar ui_map.maptiler.styleUrl
        maptiler = ui_map.get("maptiler", {})
        if isinstance(maptiler, dict):
            style_url = maptiler.get("styleUrl")
            if isinstance(style_url, str) and style_url:
                new_url = normalize_maptiler_style_url(api_key, style_url)
                if isinstance(new_url, str) and new_url != style_url:
                    maptiler["styleUrl"] = new_url
                    ui_map["maptiler"] = maptiler
                    config_data["ui_map"] = ui_map
                    changed = True
                    logger.info("[maptiler] Added ?key= to ui_map.maptiler.styleUrl")
        
        # Verificar y actualizar ui_map.satellite.labels_overlay.style_url
        satellite = ui_map.get("satellite", {})
        if isinstance(satellite, dict):
            # Manejar nuevo formato: labels_overlay.style_url
            labels_overlay = satellite.get("labels_overlay", {})
            if isinstance(labels_overlay, dict):
                labels_style_url = labels_overlay.get("style_url")
            elif isinstance(labels_overlay, bool):
                # Si es bool, crear objeto
                labels_overlay = {"enabled": labels_overlay}
                satellite["labels_overlay"] = labels_overlay
                labels_style_url = None
            else:
                labels_style_url = None
            
            # Fallback a labels_style_url legacy si existe
            if not labels_style_url:
                labels_style_url = satellite.get("labels_style_url")
            
            if isinstance(labels_style_url, str) and labels_style_url:
                new_url = normalize_maptiler_style_url(api_key, labels_style_url)
                if isinstance(new_url, str) and new_url != labels_style_url:
                    if "labels_overlay" not in satellite or not isinstance(satellite["labels_overlay"], dict):
                        satellite["labels_overlay"] = {"enabled": True}
                    satellite["labels_overlay"]["style_url"] = new_url
                    ui_map["satellite"] = satellite
                    config_data["ui_map"] = ui_map
                    changed = True
                    logger.info("[maptiler] Added ?key= to ui_map.satellite.labels_overlay.style_url")
        
        # Guardar cambios si hubo alguno
        if changed:
            config_manager._atomic_write_v2(config_data)
            logger.info("[maptiler] Updated config.json with MapTiler API keys in URLs")
    except Exception as exc:
        logger.warning("[maptiler] Failed to ensure MapTiler keys in URLs: %s", exc)


@app.on_event("startup")
def on_startup() -> None:
    # Migrar secretos desde config pública si existieran
    _migrate_public_secrets_to_store()
    # Asegurar que las URLs de MapTiler tengan ?key=
    ensure_maptiler_key()
    config = config_manager.read()
    # Firmar URLs de MapTiler en memoria después de cargar config
    sign_maptiler_urls(config)
    display_timezone = config.display.timezone if config.display else "unknown"
    logger.info(
        "Pantalla backend started (timezone=%s)",
        display_timezone,
    )
    if config.layers and config.layers.ships:
        ships_service.apply_config(config.layers.ships)
    # Inicializar Blitzortung si está configurado
    _ensure_blitzortung_service(config)
    cache_store.store("health", {"started_at": APP_START.isoformat()})
    map_provider = config.ui_map.provider
    map_style = None
    if config.ui_map.maptiler and config.ui_map.maptiler.styleUrl:
        map_style = config.ui_map.maptiler.styleUrl
    logger.info(
        "Configuration path %s (map_style=%s, map_provider=%s)",
        config_manager.config_file,
        map_style,
        map_provider,
    )
    root = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla-reloj"))
    for child in (root / "cache").glob("*.json"):
        child.touch(exist_ok=True)


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend(full_path: str, request: Request):
    if full_path.startswith("api/") or full_path.startswith("static/"):
        raise HTTPException(status_code=404, detail="Not Found")
    path = full_path or "index.html"
    return await spa_static_files.get_response(path, request.scope)


def run(host: str = "127.0.0.1", port: int = 8081) -> None:
    """Ejecuta la aplicación FastAPI usando uvicorn.

    Args:
        host: Dirección IP en la que se expone el servicio.
        port: Puerto TCP del servicio.
    """

    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        proxy_headers=True,
    )


if __name__ == "__main__":
    host = os.getenv("PANTALLA_BACKEND_HOST", "127.0.0.1")
    port_raw = os.getenv("PANTALLA_BACKEND_PORT", "8081")

    try:
        port_value = int(port_raw)
    except ValueError as exc:  # pragma: no cover - configuración inválida
        raise RuntimeError(
            f"Invalid port value in PANTALLA_BACKEND_PORT: {port_raw!r}"
        ) from exc

    run(host=host, port=port_value)
