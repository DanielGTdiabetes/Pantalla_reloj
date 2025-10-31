from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

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


@app.get("/ui-healthz", response_model=Dict[str, str])
def ui_healthcheck() -> Dict[str, str]:
    logger.debug("UI health probe requested")
    return {"ui": "ok"}


@app.get("/api/health")
def healthcheck() -> Dict[str, Any]:
    logger.debug("Health check requested")
    return _health_payload()


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
    
    response = JSONResponse(content=config.model_dump(mode="json", exclude_none=True))
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
        updated = config_manager.write(payload)
    except ValidationError as exc:
        logger.debug("Configuration validation error: %s", exc.errors())
        raise HTTPException(status_code=400, detail=exc.errors()) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to persist configuration: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to persist configuration") from exc
    logger.info("Configuration updated")
    
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
    
    response = JSONResponse(content=updated.model_dump(mode="json", exclude_none=True))
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["ETag"] = config_etag
    response.headers["Last-Modified"] = datetime.fromtimestamp(config_mtime).strftime("%a, %d %b %Y %H:%M:%S GMT")
    
    return response


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


def _run_nmcli(args: List[str], timeout: int = 30) -> tuple[str, str, int]:  # type: ignore[valid-type]
    """Run nmcli command and return stdout, stderr, returncode."""
    try:
        result = subprocess.run(
            ["nmcli"] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
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


class WiFiNetwork(BaseModel):
    ssid: str
    signal: int
    security: str
    mode: str


class WiFiConnectRequest(BaseModel):
    ssid: str
    password: Optional[str] = None


@app.get("/api/wifi/scan")
def wifi_scan() -> Dict[str, Any]:
    """Scan for available WiFi networks."""
    interface = _get_wifi_interface()
    logger.info("Scanning WiFi networks on interface %s", interface)
    
    # First check if WiFi device exists and is enabled
    stdout, stderr, code = _run_nmcli(["device", "status"], timeout=10)
    if code != 0:
        logger.error("Failed to check device status: stdout=%r, stderr=%r", stdout, stderr)
        raise HTTPException(
            status_code=500,
            detail=f"Cannot check WiFi device status: {stderr or stdout or 'Unknown error'}",
        )
    
    # Check if WiFi interface exists
    device_found = False
    for line in stdout.strip().split("\n"):
        if interface in line:
            device_found = True
            parts = line.split()
            if len(parts) >= 2:
                device_type = parts[1]
                if device_type != "wifi":
                    logger.warning("Device %s is not a WiFi device (type: %s)", interface, device_type)
            break
    
    if not device_found:
        logger.warning("WiFi device %s not found in device list", interface)
        # Continue anyway, nmcli will report the error
    
    # Enable WiFi radio if needed (this might require root)
    _run_nmcli(["radio", "wifi", "on"], timeout=5)  # Ignore errors, might not have permission
    
    # Trigger scan
    stdout, stderr, code = _run_nmcli(["device", "wifi", "rescan", "--ifname", interface], timeout=10)
    if code != 0:
        logger.warning("Failed to trigger WiFi scan: stdout=%r, stderr=%r", stdout, stderr)
        # Continue anyway, we can still try to list existing scan results
    
    # Wait a bit for scan to complete
    import time
    time.sleep(2)
    
    # List available networks using tabular format for easier parsing
    stdout, stderr, code = _run_nmcli(
        [
            "-t",
            "-f",
            "ssid,signal,security,mode",
            "device",
            "wifi",
            "list",
            "--ifname",
            interface,
            "--rescan",
            "no",
        ],
        timeout=15,
    )
    
    if code != 0:
        logger.error("Failed to list WiFi networks: stdout=%r, stderr=%r, code=%d", stdout, stderr, code)
        # Provide more helpful error message
        error_detail = stderr or stdout or "Unknown error"
        if "permission denied" in error_detail.lower() or "permission" in error_detail.lower():
            error_msg = f"Permission denied. The backend may need to run with elevated privileges to access WiFi: {error_detail}"
        elif "device" in error_detail.lower() and "not found" in error_detail.lower():
            error_msg = f"WiFi device '{interface}' not found. Please check /etc/pantalla-reloj/wifi.conf: {error_detail}"
        else:
            error_msg = f"Failed to scan WiFi networks: {error_detail}"
        raise HTTPException(status_code=500, detail=error_msg)
    
    networks: List[WiFiNetwork] = []
    lines = stdout.strip().split("\n")
    
    # Parse tabular format: SSID:SIGNAL:SECURITY:MODE
    for line in lines:
        if not line.strip():
            continue
        parts = line.split(":")
        if len(parts) >= 4:
            ssid = parts[0] or "Unknown"
            signal_str = parts[1] if len(parts) > 1 else "0"
            security = parts[2] if len(parts) > 2 else "none"
            mode = parts[3] if len(parts) > 3 else "Infra"
            
            try:
                signal = int(signal_str) if signal_str else 0
            except ValueError:
                signal = 0
            
            # Skip empty SSIDs
            if ssid and ssid != "--":
                networks.append(
                    WiFiNetwork(
                        ssid=ssid,
                        signal=signal,
                        security=security if security and security != "--" else "none",
                        mode=mode if mode and mode != "--" else "Infra",
                    )
                )
    
    # Sort by signal strength (descending)
    networks.sort(key=lambda x: x.signal, reverse=True)
    
    logger.info("Found %d WiFi networks", len(networks))
    
    return {
        "interface": interface,
        "networks": [net.model_dump() for net in networks],
        "count": len(networks),
    }


@app.get("/api/wifi/status")
def wifi_status() -> Dict[str, Any]:
    """Get current WiFi connection status."""
    interface = _get_wifi_interface()
    
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
        stdout, stderr, code = _run_nmcli(
            ["device", "wifi", "list", "--ifname", interface], timeout=10
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
    """Get saved WiFi networks."""
    stdout, stderr, code = _run_nmcli(
        ["connection", "show"], timeout=10
    )
    
    if code != 0:
        logger.error("Failed to list connections: %s", stderr)
        return {
            "networks": [],
            "count": 0,
        }
    
    networks: List[Dict[str, str]] = []
    lines = stdout.strip().split("\n")
    
    for line in lines:
        parts = line.split()
        if len(parts) >= 4 and parts[2] == "wifi":
            uuid = parts[0]
            name = parts[1]
            networks.append({"uuid": uuid, "name": name})
    
    return {
        "networks": networks,
        "count": len(networks),
    }


@app.post("/api/wifi/connect")
async def wifi_connect(request: WiFiConnectRequest) -> Dict[str, Any]:
    """Connect to a WiFi network."""
    interface = _get_wifi_interface()
    logger.info("Connecting to WiFi network %s on interface %s", request.ssid, interface)
    
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
        "--ifname",
        interface,
    ]
    
    if request.password:
        args.extend(["--password", request.password])
    
    stdout, stderr, code = _run_nmcli(args, timeout=30)
    
    if code != 0:
        error_msg = stderr or stdout or "Unknown error"
        logger.error("Failed to connect to WiFi: %s", error_msg)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to WiFi network: {error_msg}",
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
    
    stdout, stderr, code = _run_nmcli(
        ["device", "disconnect", interface], timeout=10
    )
    
    if code != 0:
        error_msg = stderr or stdout or "Unknown error"
        logger.error("Failed to disconnect WiFi: %s", error_msg)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect WiFi: {error_msg}",
        )
    
    logger.info("Successfully disconnected WiFi")
    return {
        "success": True,
        "message": "Successfully disconnected from WiFi",
    }


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
        config.map.provider,
    )
    root = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
    for child in (root / "cache").glob("*.json"):
        child.touch(exist_ok=True)
