from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .cache import CacheStore
from .config_manager import ConfigManager
from .logging_utils import configure_logging
from .models import AppConfig

APP_START = datetime.now(timezone.utc)
logger = configure_logging()
config_manager = ConfigManager()
cache_store = CacheStore()

app = FastAPI(title="Pantalla Reloj Backend", version="2025.10.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path("/opt/pantalla-reloj/frontend/static")
STATIC_DIR.mkdir(parents=True, exist_ok=True)

FRONTEND_DIST_DIR = Path(os.getenv("PANTALLA_UI_DIST", "/var/www/html"))
FRONTEND_DIST_DIR.mkdir(parents=True, exist_ok=True)


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


@app.get("/ui-healthz")
def ui_healthcheck() -> Dict[str, str]:
    return {"ui": "ok"}


@app.get("/api/health")
def healthcheck() -> Dict[str, Any]:
    logger.debug("Health check requested")
    return _health_payload()


@app.get("/api/config", response_model=AppConfig)
def get_config() -> AppConfig:
    logger.info("Fetching configuration")
    return config_manager.read()


MAX_CONFIG_PAYLOAD_BYTES = 64 * 1024


@app.post("/api/config", response_model=AppConfig)
async def save_config(request: Request) -> AppConfig:
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
        updated = config_manager.write(payload)
    except ValidationError as exc:
        logger.debug("Configuration validation error: %s", exc.errors())
        raise HTTPException(status_code=400, detail=exc.errors()) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to persist configuration: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to persist configuration") from exc
    logger.info("Configuration updated")
    return updated


@app.get("/api/config/schema")
def get_config_schema() -> Dict[str, Any]:
    return AppConfig.model_json_schema()


@app.get("/api/weather")
def get_weather() -> Dict[str, Any]:
    return _load_or_default("weather")


@app.get("/api/news")
def get_news() -> Dict[str, Any]:
    return _load_or_default("news")


@app.get("/api/astronomy")
def get_astronomy() -> Dict[str, Any]:
    return _load_or_default("astronomy")


@app.get("/api/calendar")
def get_calendar() -> Dict[str, Any]:
    return _load_or_default("calendar")


@app.get("/api/storm_mode")
def get_storm_mode() -> Dict[str, Any]:
    payload = {
        "enabled": False,
        "last_triggered": None,
    }
    cache_store.store("storm_mode", payload)
    return payload


@app.post("/api/storm_mode")
def update_storm_mode(payload: Dict[str, Any]) -> Dict[str, Any]:
    cache_store.store("storm_mode", payload)
    logger.info("Storm mode update ignored under config v1.5: %s", payload)
    return {"enabled": False, "last_triggered": None}


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend(full_path: str, request: Request):
    if full_path.startswith("api/") or full_path.startswith("static/"):
        raise HTTPException(status_code=404, detail="Not Found")
    path = full_path or "index.html"
    return await spa_static_files.get_response(path, request.scope)


@app.on_event("startup")
def on_startup() -> None:
    config = config_manager.read()
    logger.info(
        "Pantalla backend started (timezone=%s, rotation_panels=%s)",
        config.display.timezone,
        ",".join(config.ui.rotation.panels),
    )
    cache_store.store("health", {"started_at": APP_START.isoformat()})
    logger.info(
        "Configuration path %s (layout=%s, map_style=%s, map_provider=%s)",
        config_manager.config_file,
        config.ui.layout,
        config.ui.map.style,
        config.ui.map.provider,
    )
    root = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
    for child in (root / "cache").glob("*.json"):
        child.touch(exist_ok=True)
