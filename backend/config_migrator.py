"""
Migrador de configuración v1→v2 idempotente.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Tuple, Optional

from .models import AppConfig as AppConfigV1
from .models_v2 import AppConfigV2, MapCenter, XyzConfig, MapFixedView, MapRegion

logger = logging.getLogger(__name__)


def migrate_v1_to_v2(
    config_v1: Dict[str, Any]
) -> Tuple[Dict[str, Any], bool]:
    """
    Migra configuración v1 a v2.
    
    Args:
        config_v1: Configuración v1 (dict)
        
    Returns:
        Tuple de (config_v2_dict, needs_geocoding)
        - config_v2_dict: Configuración v2 como dict
        - needs_geocoding: True si necesita geocodificación (postal code)
    """
    needs_geocoding = False
    v2: Dict[str, Any] = {
        "version": 2,
        "ui_map": {},
        "ui_global": {},
        "layers": {},
        "panels": {},
        "secrets": {}
    }
    
    # === UI Map ===
    ui_v1 = config_v1.get("ui", {})
    map_v1 = ui_v1.get("map", {})
    
    # Provider: XYZ por defecto (no maptiler ni raster-carto legacy)
    v2["ui_map"] = {
        "engine": "maplibre",
        "provider": "xyz",
        "xyz": {
            "urlTemplate": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "attribution": "© Esri, Maxar, Earthstar, CNES/Airbus, USDA, USGS, IGN, GIS User Community",
            "minzoom": 0,
            "maxzoom": 19,
            "tileSize": 256
        },
        "labelsOverlay": {
            "enabled": True,
            "style": "carto-only-labels"
        },
        "viewMode": "fixed"
    }
    
    # Código postal
    region_postal = config_v1.get("region", {}).get("postalCode") or map_v1.get("region", {}).get("postalCode")
    if region_postal:
        v2["ui_map"]["region"] = {"postalCode": str(region_postal)}
        needs_geocoding = True
    else:
        v2["ui_map"]["region"] = {"postalCode": "12001"}
    
    # Vista fija: extraer de fixed (ya no usar cinema)
    fixed_center = None
    fixed_zoom = 7.8
    fixed_bearing = 0
    fixed_pitch = 0
    
    if map_v1.get("fixed"):
        fixed_data = map_v1["fixed"]
        fixed_center = {
            "lat": fixed_data.get("center", {}).get("lat", 39.98),
            "lon": fixed_data.get("center", {}).get("lon", 0.20)
        }
        fixed_zoom = fixed_data.get("zoom", 7.8)
        fixed_bearing = fixed_data.get("bearing", 0)
        fixed_pitch = fixed_data.get("pitch", 0)
    
    if not fixed_center:
        fixed_center = {"lat": 39.98, "lon": 0.20}  # Castellón por defecto
    
    v2["ui_map"]["fixed"] = {
        "center": fixed_center,
        "zoom": fixed_zoom,
        "bearing": fixed_bearing,
        "pitch": fixed_pitch
    }
    
    # AOI Cycle: ya no se migra desde cinema (solo desde viewMode explícito)
    # Por defecto siempre es "fixed"
    
    # === UI Global ===
    # global.satellite v1 → ui_global.satellite v2
    global_v1 = config_v1.get("global", {})
    satellite_v1 = global_v1.get("satellite", {})
    if satellite_v1.get("enabled", True):
        v2["ui_global"]["satellite"] = {
            "enabled": True,
            "provider": "gibs",
            "opacity": satellite_v1.get("opacity", 1.0)
        }
    else:
        v2["ui_global"]["satellite"] = {
            "enabled": False,
            "provider": "gibs",
            "opacity": 1.0
        }
    
    # global.radar v1 → ui_global.radar v2
    radar_v1 = global_v1.get("radar", {})
    radar_provider = "rainviewer"  # Por defecto RainViewer
    if config_v1.get("aemet", {}).get("radar_enabled"):
        radar_provider = "aemet"
    
    v2["ui_global"]["radar"] = {
        "enabled": radar_v1.get("enabled", False),
        "provider": radar_provider
    }
    
    # === Layers ===
    layers_v1 = config_v1.get("layers", {})
    
    # Flights
    flights_v1 = layers_v1.get("flights", {})
    opensky_v1 = config_v1.get("opensky", {})
    
    if flights_v1.get("enabled") or opensky_v1.get("enabled", True):
        # Convertir render_mode v1 a v2
        render_mode_v1 = flights_v1.get("render_mode", "symbol_custom")
        render_mode_v2 = "circle" if render_mode_v1 == "circle" else "circle"  # Forzar circle por defecto
        
        circle_v1 = flights_v1.get("circle", {})
        radius_vh = circle_v1.get("radius_vh", 0.9)
        # Convertir radius_vh a radius_base (aproximación: asumir zoom 5)
        radius_base = radius_vh * 10  # Aproximación
        
        v2["layers"]["flights"] = {
            "enabled": flights_v1.get("enabled", True),
            "provider": "opensky",
            "refresh_seconds": flights_v1.get("refresh_seconds", 12),
            "max_age_seconds": flights_v1.get("max_age_seconds", 120),
            "max_items_global": flights_v1.get("max_items_global", opensky_v1.get("max_aircraft", 2000)),
            "max_items_view": flights_v1.get("max_items_view", 1500),
            "rate_limit_per_min": flights_v1.get("rate_limit_per_min", 6),
            "decimate": flights_v1.get("decimate", "none"),
            "grid_px": flights_v1.get("grid_px", 24),
            "styleScale": flights_v1.get("styleScale", 3.2),
            "render_mode": render_mode_v2,
            "circle": {
                "radius_base": radius_base,
                "radius_zoom_scale": 1.7,
                "opacity": circle_v1.get("opacity", 1.0),
                "color": circle_v1.get("color", "#FFD400"),
                "stroke_color": circle_v1.get("stroke_color", "#000000"),
                "stroke_width": circle_v1.get("stroke_width", 2.0)
            }
        }
    
    # Ships
    ships_v1 = layers_v1.get("ships", {})
    if ships_v1.get("enabled", False):
        v2["layers"]["ships"] = {
            "enabled": True,
            "provider": ships_v1.get("provider", "aisstream"),
            "refresh_seconds": ships_v1.get("refresh_seconds", 10),
            "max_age_seconds": ships_v1.get("max_age_seconds", 180),
            "max_items_global": ships_v1.get("max_items_global", 1500),
            "max_items_view": ships_v1.get("max_items_view", 420),
            "decimate": ships_v1.get("decimate", "grid"),
            "grid_px": ships_v1.get("grid_px", 24),
            "styleScale": ships_v1.get("styleScale", 1.4)
        }
    else:
        v2["layers"]["ships"] = {
            "enabled": False,
            "provider": "aisstream",
            "refresh_seconds": 10,
            "max_age_seconds": 180,
            "max_items_global": 1500,
            "max_items_view": 420,
            "decimate": "grid",
            "grid_px": 24,
            "styleScale": 1.4
        }
    
    # === Panels ===
    # Paneles desde panel/news/calendar v1
    v2["panels"] = {
        "weatherWeekly": {
            "enabled": True
        },
        "ephemerides": {
            "enabled": True
        },
        "news": {
            "enabled": True,
            "feeds": config_v1.get("news", {}).get("feeds", ui_v1.get("panel", {}).get("news", {}).get("feeds", []))
        },
        "calendar": {
            "enabled": True
        }
    }
    
    # Secrets (metadata only)
    v2["secrets"] = {
        "opensky": {},
        "google": {},
        "aemet": {}
    }
    
    return v2, needs_geocoding


def apply_postal_geocoding(
    config_v2: Dict[str, Any],
    postal_code: str,
    geocode_result: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Aplica geocodificación de código postal y actualiza fixed.center.
    
    Args:
        config_v2: Configuración v2
        postal_code: Código postal
        geocode_result: Resultado de geocodificación (dict con lat/lon)
        
    Returns:
        Configuración v2 actualizada
    """
    try:
        if geocode_result and isinstance(geocode_result, dict):
            lat = geocode_result.get("lat")
            lon = geocode_result.get("lon")
            if lat is not None and lon is not None:
                if "ui_map" in config_v2:
                    if "fixed" in config_v2["ui_map"]:
                        config_v2["ui_map"]["fixed"]["center"] = {
                            "lat": lat,
                            "lon": lon
                        }
                    else:
                        config_v2["ui_map"]["fixed"] = {
                            "center": {"lat": lat, "lon": lon},
                            "zoom": 7.8,
                            "bearing": 0,
                            "pitch": 0
                        }
    except Exception as e:
        logger.warning("Error geocodificando código postal %s: %s", postal_code, e)
    
    return config_v2


def migrate_config_to_v2(
    config_path: Path,
    backup: bool = True
) -> Tuple[Dict[str, Any], bool]:
    """
    Migra un archivo de configuración v1 a v2.
    
    Args:
        config_path: Ruta al archivo de configuración
        backup: Si True, crea backup antes de migrar
        
    Returns:
        Tuple de (config_v2_dict, success)
    """
    try:
        # Leer v1
        data_v1 = json.loads(config_path.read_text(encoding="utf-8"))
        
        # Crear backup si es necesario
        if backup:
            backup_path = config_path.with_suffix(".json.v1backup")
            backup_path.write_text(json.dumps(data_v1, indent=2), encoding="utf-8")
            logger.info("Backup creado en %s", backup_path)
        
        # Migrar
        config_v2, needs_geocoding = migrate_v1_to_v2(data_v1)
        
        return config_v2, True
        
    except Exception as e:
        logger.error("Error migrando configuración: %s", e)
        return {}, False
