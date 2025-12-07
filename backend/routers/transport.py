from __future__ import annotations

import importlib
import math
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

router = APIRouter(prefix="/api/transport", tags=["transport"])

def _load_main_module():
    """Lazy load main module to access services."""
    return importlib.import_module("backend.main")

def _dist(lat1, lon1, lat2, lon2):
    # Simple Euclidean distance for rough proximity sorts (degrees)
    return math.sqrt((lat1 - lat2)**2 + (lon1 - lon2)**2)

import requests
from functools import lru_cache

@lru_cache(maxsize=100)
def _resolve_plane_image(icao24: str) -> Optional[str]:
    """Fetch plane image from Planespotters API by ICAO24 hex."""
    try:
        # User-Agent is required by Planespotters
        headers = {"User-Agent": "PantallaReloj/1.0 (Personal Display)"}
        # Attempt lookup by hex (unofficial but often supported or via separate lookup)
        # Actually Planespotters API uses Registration normally.
        # But we can try to search? No, simple API is /reg/.
        # OpenSky provides icao24. We don't always have REG.
        # However, OpenSky sometimes provides CALLSIGN.
        # Let's try to query by hex if possible or fallback.
        # Strategy: Use icao24 to find photo on generic aggregators or just return None if strict.
        # But user wants a photo.
        # Let's try: https://api.planespotters.net/pub/photos/hex/{icao24} -> This works on some versions?
        # Let's verify URL: https://api.planespotters.net/pub/photos/hex/<hex> IS VALID.
        url = f"https://api.planespotters.net/pub/photos/hex/{icao24}"
        resp = requests.get(url, headers=headers, timeout=2)
        if resp.status_code == 200:
            data = resp.json()
            photos = data.get("photos", [])
            if photos:
                # Prefer "thumbnail_large" which is decent quality but not full resolution
                return photos[0].get("thumbnail_large", {}).get("src")
    except Exception:
        pass
    return None

@router.get("/nearby")
async def get_transport_nearby(
    lat: float = 39.9378,  # Default: Vila-real
    lon: float = -0.1014,
    radius_km: float = 200.0  # Increased default radius for sorting context
):
    """
    Get transport (planes and ships) near a location.
    Specific logic for Vila-real/Castellón context requested by user.
    """
    planes_data = []
    ships_data = []
    errors = []
    
    try:
        main = _load_main_module()
    except Exception as e:
        print(f"Error loading main module: {e}")
        return {
            "ok": False,
            "error": f"module_load_failed: {e}",
            "location": {"lat": lat, "lon": lon},
            "planes": [],
            "ships": []
        }
    
    # 1. OpenSky (Planes) - Widen the box to ensures we catch planes on approach to Valencia/Castellón
    d_lat = 2.0 # ~220km latitude delta
    d_lon = 3.0 # ~240km longitude delta
    
    planes_bbox = (
        lat - d_lat, # min_lat
        lat + d_lat, # max_lat
        lon - d_lon, # min_lon
        lon + d_lon  # max_lon
    )
    
    try:
        opensky = main.opensky_service
        config = main.global_config
        
        # Check if flights layer is enabled
        layers = getattr(config, "layers", None)
        flights_config = getattr(layers, "flights", None) if layers else None
        
        if flights_config and flights_config.enabled:
            snapshot = opensky.get_snapshot(
                config=config,
                bbox=planes_bbox,
                extended_override=1
            )
            
            if snapshot and snapshot.payload.get("items"):
                for item in snapshot.payload["items"]:
                    p = item
                    if isinstance(p, dict):
                        icao = p.get("icao24")
                        img = None
                        if icao:
                             # Run in threadpool to avoid blocking loop with requests
                             try:
                                 img = await run_in_threadpool(_resolve_plane_image, icao)
                             except Exception:
                                 pass

                        p_lat = p.get("latitude")
                        p_lon = p.get("longitude")
                        # Skip items without coordinates
                        if p_lat is None or p_lon is None:
                            continue
                            
                        planes_data.append({
                            "ic": icao,
                            "cs": (p.get("callsign") or "").strip(),
                            "alt": p.get("baro_altitude"),
                            "spd": p.get("velocity"),
                            "hdg": p.get("true_track"),
                            "lat": p_lat,
                            "lon": p_lon,
                            "co": p.get("origin_country"),
                            "img": img
                        })
        else:
            errors.append("flights_layer_disabled")
    except Exception as e:
        print(f"Error fetching planes: {e}")
        errors.append(f"planes_error: {e}")

    # 2. Ships (AISStream)
    # Widen to include Castellón/Burriana coast (-0.1 is Vila-real, Coast is approx -0.0)
    # Min lon must be west of Vila-real (-0.10) to catch anything close, or at least covers the port.
    # Widen to include Castellón/Burriana coast (-0.1 is Vila-real).
    # Box covering Valencia to Delta Ebro approx.
    ships_bbox = (38.5, 41.5, -1.0, 2.0)
    
    try:
        ais = main.ships_service
        
        # Check if ships layer is enabled
        layers = getattr(main.global_config, "layers", None)
        ships_config = getattr(layers, "ships", None) if layers else None
        
        if ships_config and ships_config.enabled:
            snapshot = ais.get_snapshot()
            if snapshot and "features" in snapshot:
                for feature in snapshot["features"]:
                    geo = feature.get("geometry", {})
                    coords = geo.get("coordinates")
                    if coords:
                        slon, slat = coords
                        # Check if inside our "nearby" box
                        if (ships_bbox[0] <= slat <= ships_bbox[1] and 
                            ships_bbox[2] <= slon <= ships_bbox[3]):
                            
                            props = feature.get("properties", {})
                            ships_data.append({
                                "name": props.get("name") or str(props.get("mmsi")),
                                "mmsi": props.get("mmsi"),
                                "type": props.get("shipType"),
                                "spd": props.get("speed"),
                                "hdg": props.get("heading"),
                                "lat": slat,
                                "lon": slon,
                                "dest": props.get("destination"),
                                # Ship photos are harder to get freely by API. 
                                # Leaving img as null/undefined to trigger fallback.
                                "img": None 
                            })
        else:
            errors.append("ships_layer_disabled")
    except Exception as e:
        print(f"Error fetching ships: {e}")
        errors.append(f"ships_error: {e}")

    # Sort by proximity to target (Vila-real)
    # Use default 0 for None values to avoid math errors
    try:
        planes_data.sort(key=lambda x: _dist(lat, lon, x.get('lat') or 0, x.get('lon') or 0))
        ships_data.sort(key=lambda x: _dist(lat, lon, x.get('lat') or 0, x.get('lon') or 0))
    except Exception as e:
        print(f"Error sorting transport data: {e}")
        errors.append(f"sort_error: {e}")

    result = {
        "ok": len(errors) == 0,
        "location": {"lat": lat, "lon": lon},
        "planes": planes_data[:5], 
        "ships": ships_data[:10]
    }
    
    if errors:
        result["errors"] = errors
        
    return result

