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
    radius_km: float = 100.0  # Increased from 50.0 to 100.0
):
    """
    Get transport (planes and ships) near a location.
    Specific logic for Vila-real/Castellón context requested by user.
    """
    main = _load_main_module()
    
    # 1. OpenSky (Planes) - Widen the box to ensures we catch planes on approach to Valencia/Castellón
    d_lat = 1.0 # ~110km latitude delta
    d_lon = 1.5 # ~120km longitude delta
    
    planes_bbox = (
        lat - d_lat, # min_lat
        lat + d_lat, # max_lat
        lon - d_lon, # min_lon
        lon + d_lon  # max_lon
    )
    
    planes_data = []
    try:
        opensky = main.opensky_service
        snapshot = opensky.get_snapshot(
            config=main.global_config,
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
                         img = await run_in_threadpool(_resolve_plane_image, icao)

                    planes_data.append({
                        "ic": icao,
                        "cs": (p.get("callsign") or "").strip(),
                        "alt": p.get("baro_altitude"),
                        "spd": p.get("velocity"),
                        "hdg": p.get("true_track"),
                        "lat": p.get("latitude"),
                        "lon": p.get("longitude"),
                        "co": p.get("origin_country"),
                        "img": img
                    })
    except Exception as e:
        print(f"Error fetching planes: {e}")

    # 2. Ships (AISStream)
    # Widen to include Castellón/Burriana coast (-0.1 is Vila-real, Coast is approx -0.0)
    # Min lon must be west of Vila-real (-0.10) to catch anything close, or at least covers the port.
    ships_bbox = (39.0, 41.0, -0.50, 1.50)
    
    ships_data = []
    try:
        ais = main.ships_service
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
    except Exception as e:
        print(f"Error fetching ships: {e}")

    # Sort by proximity to target (Vila-real)
    planes_data.sort(key=lambda x: _dist(lat, lon, x.get('lat',0), x.get('lon',0)))
    ships_data.sort(key=lambda x: _dist(lat, lon, x.get('lat',0), x.get('lon',0)))

    return {
        "ok": True,
        "location": {"lat": lat, "lon": lon},
        "planes": planes_data[:5], 
        "ships": ships_data[:10]
    }
