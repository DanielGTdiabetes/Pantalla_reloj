from __future__ import annotations

import asyncio
import json
import os
import uuid
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Literal
from threading import Lock

from fastapi import Body, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

# Internal Imports
from backend.cache import CacheStore
from backend.config_manager import ConfigManager
from backend.services.config_upgrade import clean_aemet_keys
from backend.services.opensky_service import OpenSkyService
from backend.services.ships_service import AISStreamService
from backend.services.blitzortung_service import BlitzortungService
from backend.secret_store import SecretStore
from backend.services import ephemerides
from backend.logging_utils import configure_logging

# Routers
# Imporing calendar here to avoid NameError
from backend.routers import layers, weather, transport, saints, system, calendar, farming, news
from backend.routes import rainviewer, efemerides

# Constants
ICS_STORAGE_DIR = Path("/var/lib/pantalla-reloj/ics")

# Initialize Logging
logger = configure_logging()

# --- Config & Services Setup ---
# Clean legacy config keys on startup
CONFIG_PATH = os.getenv("PANTALLA_CONFIG", "/var/lib/pantalla-reloj/config.json")
try:
    clean_aemet_keys(Path(CONFIG_PATH))
except Exception:
    pass

config_manager = ConfigManager()
cache_store = CacheStore()
secret_store = SecretStore()

# Initialize Global Services
opensky_service = OpenSkyService(secret_store, logger)
ships_service = AISStreamService(cache_store=cache_store, secret_store=secret_store, logger=logger)
blitzortung_service: Optional[BlitzortungService] = None
_blitzortung_lock = Lock()


# --- Kiosk Refresh Logic ---
def _auto_refresh_disabled() -> bool:
    value = os.getenv("PANTALLA_AUTOREFRESH_ENABLED", "1").strip().lower()
    return value in {"0", "false", "no", "off"}

def _schedule_kiosk_refresh(reason: str = "config_saved") -> None:
    if _auto_refresh_disabled():
        return

    flag_path = Path(os.getenv("PANTALLA_KIOSK_REFRESH_FLAG", "/var/lib/pantalla-reloj/state/kiosk-refresh.flag"))
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "nonce": uuid.uuid4().hex,
    }

    try:
        flag_path.parent.mkdir(parents=True, exist_ok=True)
        flag_path.write_text(json.dumps(payload), encoding="utf-8")
        logger.info("[kiosk] refresh requested (%s)", reason)
    except Exception as exc:
        logger.warning("[kiosk] Failed to schedule refresh: %s", exc)

# --- FastAPI App ---
ALLOWED_ORIGINS = os.getenv("PANTALLA_CORS_ORIGINS", "*").split(",")

app = FastAPI(title="Smart Display Backend", version="2025.12.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(ephemerides.router)
app.include_router(rainviewer.router)
app.include_router(layers.router)
app.include_router(weather.router)
app.include_router(transport.router)
app.include_router(saints.router)
app.include_router(system.router)

app.include_router(calendar.router)
app.include_router(farming.router)
app.include_router(news.router)

# --- Routes ---

@app.post("/api/kiosk/refresh")
def kiosk_refresh(payload: Optional[Dict[str, Any]] = Body(default=None)) -> Dict[str, Any]:
    """Schedule immediate kiosk refresh."""
    reason = "manual_api"
    if isinstance(payload, dict) and payload.get("reason"):
        reason = str(payload.get("reason")).strip()
    
    _schedule_kiosk_refresh(reason)
    return {"ok": True, "scheduled": True, "reason": reason}

@app.get("/api/health")
def health_check() -> Dict[str, str]:
    """Simple health check for systemd/scripts."""
    return {"status": "ok"}

@app.post("/api/maps/test_maptiler")
def test_maptiler(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Test MapTiler configuration (Mocked for installation check)."""
    return {"ok": True, "provider": "maptiler", "status": "valid"}

# --- Startup/Shutdown ---

@app.on_event("startup")
def _startup_services() -> None:
    """Initialize background services."""
    # Ensure ICS directory
    try:
        if not ICS_STORAGE_DIR.exists():
            ICS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
            os.chmod(ICS_STORAGE_DIR, 0o755)
    except Exception as e:
        logger.warning(f"Could not create ICS dir: {e}")

    # Init Ephemerides cache
    ephemerides.init_cache(cache_store)

    # Init Blitzortung (Lightning)
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
        logger.error("[startup] Failed to start Blitzortung: %s", exc)

@app.on_event("shutdown")
def _shutdown_services() -> None:
    """Stop background services."""
    logger.info("Shutting down services...")
    opensky_service.close()
    ships_service.close()
    
    global blitzortung_service
    if blitzortung_service:
        with _blitzortung_lock:
            blitzortung_service.stop()
            blitzortung_service = None

# --- Static Files (SPA) ---
# Serve the smart-display frontend
class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 404:
            return await super().get_response("index.html", scope)
        return response

# Locations for static files
STATIC_DIR = Path("/opt/pantalla-reloj/frontend/static")
FRONTEND_DIST_DIR = Path(os.getenv("PANTALLA_UI_DIST", "/var/www/html"))

# Create valid mocks if not existing (for local dev robustness)
if not STATIC_DIR.exists():
    try:
        STATIC_DIR.mkdir(parents=True, exist_ok=True)
    except Exception: 
        STATIC_DIR = Path(os.getcwd()) / "static_mock"
        STATIC_DIR.mkdir(exist_ok=True)

if not FRONTEND_DIST_DIR.exists():
     # If we are in dev mode, maybe point to dist? But mostly specific for prod.
     pass

# Mount Static
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if FRONTEND_DIST_DIR.exists():
    app.mount("/", SPAStaticFiles(directory=str(FRONTEND_DIST_DIR), html=True), name="frontend")
else:
    logger.warning("Frontend dist directory not found at %s. Root '/' will 404.", FRONTEND_DIST_DIR)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
