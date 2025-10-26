from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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
            "enabled": config_manager.read().storm_mode.enabled,
            "last_triggered": config_manager.read().storm_mode.last_triggered,
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


@app.get("/api/health")
def healthcheck() -> Dict[str, Any]:
    logger.debug("Health check requested")
    return _health_payload()


@app.get("/api/config", response_model=AppConfig)
def get_config() -> AppConfig:
    logger.info("Fetching configuration")
    return config_manager.read()


@app.patch("/api/config", response_model=AppConfig)
def update_config(payload: Dict[str, Any]) -> AppConfig:
    try:
        updated = config_manager.update(payload)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to update configuration: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid configuration payload") from exc
    logger.info("Configuration updated")
    return updated


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
    config = config_manager.read()
    payload = {
        "enabled": config.storm_mode.enabled,
        "last_triggered": config.storm_mode.last_triggered,
    }
    cache_store.store("storm_mode", payload)
    return payload


@app.post("/api/storm_mode")
def update_storm_mode(payload: Dict[str, Any]) -> Dict[str, Any]:
    config_data = config_manager.read().model_dump()
    config_data.setdefault("storm_mode", {}).update(payload)
    updated = config_manager.update({"storm_mode": config_data["storm_mode"]})
    result = {
        "enabled": updated.storm_mode.enabled,
        "last_triggered": updated.storm_mode.last_triggered,
    }
    cache_store.store("storm_mode", result)
    logger.info("Storm mode updated: %s", result)
    return result


@app.on_event("startup")
def on_startup() -> None:
    config = config_manager.read()
    logger.info("Pantalla backend started with rotation '%s'", config.display.rotation)
    cache_store.store("health", {"started_at": APP_START.isoformat()})
    logger.info(
        "Configuration path %s (defaults: layout=%s, side_panel=%s, demo=%s, carousel=%s)",
        config_manager.config_file,
        config.ui.layout,
        config.ui.side_panel,
        config.ui.enable_demo,
        config.ui.carousel,
    )
    root = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
    for child in (root / "cache").glob("*.json"):
        child.touch(exist_ok=True)
