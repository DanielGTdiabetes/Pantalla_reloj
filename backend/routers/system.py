from __future__ import annotations

import logging
import subprocess
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

from fastapi import APIRouter, HTTPException, Body
from ..secret_store import SecretStore

router = APIRouter(prefix="/api/system", tags=["system"])
logger = logging.getLogger(__name__)

secret_store = SecretStore()

# --- WiFi Models ---
class WifiNetwork(BaseModel):
    ssid: str
    strength: int # 0-100
    security: str
    active: bool

class WifiConnectRequest(BaseModel):
    ssid: str
    password: Optional[str] = None

# --- Secrets Models ---
class SecretUpdateRequest(BaseModel):
    items: Dict[str, str]

# --- WiFi Utils ---
import shutil

def _scan_wifi() -> List[WifiNetwork]:
    """Scans for WiFi networks using nmcli."""
    networks = []
    
    # Check if nmcli exists
    if not shutil.which("nmcli"):
         logger.warning("nmcli not found, returning mock data")
         return [
             WifiNetwork(ssid="WiFi_Casa_Mock", strength=90, security="WPA2", active=True),
             WifiNetwork(ssid="Vecino_Mock", strength=45, security="WPA3", active=False)
         ]

    try:
        # nmcli -t -f SSID,SIGNAL,SECURITY,ACTIVE dev wifi
        cmd = ["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY,ACTIVE", "dev", "wifi"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
             logger.warning(f"nmcli failed: {result.stderr}")
             # If linux but failed, maybe permissions?
             return []

        lines = result.stdout.strip().split('\n')
        seen_ssids = set()

        for line in lines:
            if not line: continue
            parts = line.split(':')
            if len(parts) < 4: continue
            
            active = parts[-1] == 'yes'
            security = parts[-2]
            signal = parts[-3]
            ssid = ":".join(parts[:-3])

            if not ssid: continue
            if ssid in seen_ssids: continue
            seen_ssids.add(ssid)

            networks.append(WifiNetwork(
                ssid=ssid,
                strength=int(signal) if signal.isdigit() else 0,
                security=security,
                active=active
            ))

    except Exception as e:
        logger.error(f"WiFi scan exception: {e}")
        # Return mock if exception
        return [
             WifiNetwork(ssid="Error_Mock_Net", strength=0, security="None", active=False)
        ]
    
    return sorted(networks, key=lambda x: x.strength, reverse=True)

def _connect_wifi(ssid: str, password: Optional[str] = None) -> bool:
    try:
        cmd = ["nmcli", "dev", "wifi", "connect", ssid]
        if password:
            cmd.extend(["password", password])
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return True
        else:
            logger.error(f"WiFi Connect Error: {result.stderr}")
            return False
    except Exception as e:
        logger.error(f"WiFi Connect Exception: {e}")
        return False

# --- Routes ---

@router.get("/wifi/scan")
def get_wifi_scan() -> List[WifiNetwork]:
    """List available WiFi networks."""
    return _scan_wifi()

@router.post("/wifi/connect")
def connect_wifi(req: WifiConnectRequest) -> Dict[str, Any]:
    """Connect to a WiFi network."""
    success = _connect_wifi(req.ssid, req.password)
    if success:
        return {"ok": True, "message": f"Connected to {req.ssid}"}
    else:
        # Check if we are mocking
        if hasattr(subprocess, 'STARTUPINFO'):
             return {"ok": True, "message": f"Mock connected to {req.ssid}"}
        raise HTTPException(status_code=400, detail="Failed to connect to WiFi network")

@router.get("/secrets")
def get_secrets_status() -> Dict[str, bool]:
    """Returns which secrets are currently set (true/false). Does not return values."""
    # List of known keys we care about
    known_keys = [
        "meteoblue_api_key",
        "openweathermap_api_key",
        "maptiler_key",
        "opensky_username",
        "opensky_password",
        "aisstream_api_key",
        "calendar_ics_url"
    ]
    
    result = {}
    for key in known_keys:
        result[key] = secret_store.has_secret(key)
    
    return result

@router.post("/secrets")
def update_secrets(req: SecretUpdateRequest) -> Dict[str, Any]:
    """Update secret keys. Empty values delete the key."""
    updated = []
    for key, value in req.items.items():
        if value:
            secret_store.set_secret(key, value)
            updated.append(key)
        else:
            # If empty string, consider removing or ignoring?
            # Let's assume user might want to clear it if they send empty string
            if value == "":
                 secret_store.set_secret(key, None) # Remove
    
    logger.info(f"Secrets updated: {updated}")
    return {"ok": True, "updated": updated}

# --- Config Management Endpoints ---

class DisplayConfigUpdate(BaseModel):
    module_cycle_seconds: int

@router.get("/config/display")
def get_display_config() -> Dict[str, Any]:
    """Get display configuration from config.json."""
    from ..main import config_manager
    config = config_manager.read()
    return {
        "module_cycle_seconds": config.display.module_cycle_seconds
    }

@router.post("/config/display")
def update_display_config(req: DisplayConfigUpdate) -> Dict[str, Any]:
    """Update display configuration."""
    from ..main import config_manager
    config = config_manager.read()
    
    # Update values
    config.display.module_cycle_seconds = req.module_cycle_seconds
    
    # Write back
    config_manager.write(config.model_dump(mode="json"))
    return {"ok": True, "module_cycle_seconds": req.module_cycle_seconds}
