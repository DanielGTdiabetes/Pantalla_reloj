from __future__ import annotations

import importlib
import math
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

router = APIRouter(prefix="/api/transport", tags=["transport"])
logger = logging.getLogger(__name__)

AIS_TYPE_MAP: Dict[int, str] = {
    60: "Pasajeros",
    70: "Carga",
    71: "Carga",
    72: "Carga",
    73: "Carga",
    74: "Carga",
    75: "Carga",
    76: "Carga",
    77: "Carga",
    78: "Carga",
    79: "Carga",
    80: "Petrolero",
    81: "Petrolero",
    82: "Petrolero",
    83: "Petrolero",
    84: "Petrolero",
    85: "Petrolero",
    86: "Petrolero",
    87: "Petrolero",
    88: "Petrolero",
    89: "Petrolero",
}

def _load_main_module():
    """Lazy load main module to access services."""
    return importlib.import_module("backend.main")

def _dist(lat1, lon1, lat2, lon2):
    # Simple Euclidean distance for rough proximity sorts (degrees)
    return math.sqrt((lat1 - lat2)**2 + (lon1 - lon2)**2)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _resolve_ship_type(raw_type: Any) -> Optional[str]:
    if raw_type is None:
        return None

    if isinstance(raw_type, (int, float)):
        return AIS_TYPE_MAP.get(int(raw_type)) or str(int(raw_type))

    if isinstance(raw_type, str):
        normalized = raw_type.strip()
        if normalized.isdigit():
            mapped = AIS_TYPE_MAP.get(int(normalized))
            if mapped:
                return mapped
        return normalized if normalized else None

    return None

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
    planes_data: List[Dict[str, Any]] = []
    ships_data = []
    errors = []

    try:
        main = _load_main_module()
        config = main.global_config
    except Exception as e:
        print(f"Error loading main module: {e}")
        return {
            "ok": False,
            "error": f"module_load_failed: {e}",
            "location": {"lat": lat, "lon": lon},
            "planes": [],
            "ships": []
        }

    # 1. OpenSky (Planes) - prefer configured bbox
    radius = max(50.0, min(radius_km, 250.0))
    d_lat = radius / 111.0
    d_lon = radius / max(1e-6, 111.0 * math.cos(math.radians(lat)))

    bbox_cfg = getattr(getattr(config, "opensky", None), "bbox", None)
    planes_bbox = None
    if bbox_cfg:
        try:
            planes_bbox = (
                float(bbox_cfg.lamin),
                float(bbox_cfg.lamax),
                float(bbox_cfg.lomin),
                float(bbox_cfg.lomax),
            )
        except Exception:
            planes_bbox = None

    if not planes_bbox:
        planes_bbox = (
            lat - d_lat, # min_lat
            lat + d_lat, # max_lat
            lon - d_lon, # min_lon
            lon + d_lon  # max_lon
        )
    
    try:
        opensky = main.opensky_service
        
        # Check if flights layer is enabled
        layers = getattr(config, "layers", None)
        flights_config = getattr(layers, "flights", None) if layers else None
        
        if flights_config and flights_config.enabled:
            snapshot = opensky.get_snapshot(
                config=config,
                bbox=planes_bbox,
                extended_override=1
            )

            payload_items = []
            if snapshot and snapshot.payload.get("items"):
                payload_items = snapshot.payload["items"]
            elif hasattr(opensky, "get_last_snapshot"):
                fallback = opensky.get_last_snapshot()
                if fallback and fallback.payload.get("items"):
                    payload_items = fallback.payload["items"]

            for item in payload_items:
                p = item
                if not isinstance(p, dict):
                    continue

                p_lat = p.get("lat") or p.get("latitude")
                p_lon = p.get("lon") or p.get("longitude")
                if p_lat is None or p_lon is None:
                    continue

                distance_km = _haversine_km(lat, lon, p_lat, p_lon)

                icao = p.get("icao24")
                img = None
                if icao:
                    try:
                        img = await run_in_threadpool(_resolve_plane_image, icao)
                    except Exception:
                        pass

                altitude_m = p.get("alt") or p.get("baro_altitude")
                altitude_ft = altitude_m * 3.28084 if altitude_m is not None else None
                speed_ms = p.get("velocity")
                speed_kts = speed_ms * 1.94384 if speed_ms is not None else 0.0
                heading = p.get("track") or p.get("true_track") or 0.0
                callsign = (p.get("callsign") or "").strip() or "Vuelo"
                origin = p.get("estDepartureAirport") or p.get("from")
                destination = p.get("estArrivalAirport") or p.get("to")

                planes_data.append({
                    "id": icao or callsign or f"plane-{p_lat:.4f}-{p_lon:.4f}",
                    "callsign": callsign,
                    "icao": icao,
                    "origin": origin,
                    "destination": destination,
                    "altitude_ft": altitude_ft,
                    "speed_kts": speed_kts,
                    "vel_kts": speed_kts,
                    "heading_deg": heading,
                    "heading": heading,
                    "lat": p_lat,
                    "lon": p_lon,
                    "distance_km": distance_km,
                    "airline": p.get("origin_country"),
                    "icao24": icao,
                    "image": img,
                    "kind": "aircraft",
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
                    if not coords or not isinstance(coords, (list, tuple)):
                        continue

                    if len(coords) != 2:
                        continue

                    slon, slat = coords

                    valid_bbox = ships_bbox if ships_bbox and len(ships_bbox) == 4 else None

                    if not valid_bbox:
                        continue

                    # Check if inside our "nearby" box
                    if (
                        valid_bbox[0] <= slat <= valid_bbox[1]
                        and valid_bbox[2] <= slon <= valid_bbox[3]
                    ):
                        props = feature.get("properties", {}) or {}
                        raw_type = props.get("shipType") or props.get("type")
                        ship_type = _resolve_ship_type(raw_type)
                        ships_data.append({
                            "id": props.get("mmsi") or f"ship-{slat:.4f}-{slon:.4f}",
                            "name": props.get("name") or str(props.get("mmsi") or ""),
                            "mmsi": props.get("mmsi"),
                            "type": ship_type or raw_type,
                            "ship_type": ship_type or raw_type,
                            "speed_kts": props.get("speed"),
                            "heading_deg": props.get("heading"),
                            "lat": slat,
                            "lon": slon,
                            "destination": props.get("destination"),
                            "distance_km": _haversine_km(lat, lon, slat, slon),
                            # Ship photos are harder to get freely by API.
                            # Leaving img as null/undefined to trigger fallback.
                            "img": None,
                            "kind": "ship",
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

    logger.info(
        "transport.nearby counts ships=%d aircraft=%d (radius_km=%.1f)",
        len(ships_data),
        len(planes_data),
        radius,
    )

    result = {
        "ok": len(errors) == 0,
        "center": {"lat": lat, "lon": lon},
        "location": {"lat": lat, "lon": lon},
        "planes": planes_data[:20],
        "aircraft": planes_data[:20],
        "ships": ships_data[:15],
    }
    
    if errors:
        result["errors"] = errors
        
    return result

