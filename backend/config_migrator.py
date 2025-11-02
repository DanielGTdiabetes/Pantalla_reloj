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
from .services.aemet_service import AEMETServiceError

logger = logging.getLogger(__name__)


def migrate_v1_to_v2(
    config_v1: Dict[str, Any]
) -> Tuple[Dict[str, Any], bool]:
    """
    Migra configuración v1 a v2.
    
    Args:
        config_v1: Configuración v1 (dict)
        geocode_postal: Función opcional para geocodificar códigos postales
        
    Returns:
        Tuple de (config_v2_dict, needs_geocoding)
        - config_v2_dict: Configuración v2 como dict
        - needs_geocoding: True si necesita geocodificación (postal code)
    """
    needs_geocoding = False
    v2: Dict[str, Any] = {
        "version": 2,
        "ui": {},
        "layers": {},
        "secrets": {}
    }
    
    # === UI ===
    ui_v1 = config_v1.get("ui", {})
    map_v1 = ui_v1.get("map", {})
    
    # Mapa: provider XYZ por defecto
    v2["ui"]["map"] = {
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
        "viewMode": "fixed",
        "region": {}
    }
    
    # Si hay código postal, configurarlo
    region_postal = config_v1.get("region", {}).get("postalCode") or map_v1.get("region", {}).get("postalCode")
    if region_postal:
        v2["ui"]["map"]["region"] = {"postalCode": str(region_postal)}
        needs_geocoding = True
    
    # Vista fija: extraer de cinema o fixed
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
    elif map_v1.get("cinema") and map_v1["cinema"].get("bands"):
        # Usar primera banda de cinema
        first_band = map_v1["cinema"]["bands"][0]
        fixed_center = {
            "lat": first_band.get("lat", 39.98),
            "lon": 0.20  # Default para Castellón
        }
        fixed_zoom = first_band.get("zoom", 7.8)
        fixed_pitch = first_band.get("pitch", 0)
    
    if not fixed_center:
        fixed_center = {"lat": 39.98, "lon": 0.20}  # Castellón por defecto
    
    v2["ui"]["map"]["fixed"] = {
        "center": fixed_center,
        "zoom": fixed_zoom,
        "bearing": fixed_bearing,
        "pitch": fixed_pitch
    }
    
    # AOI Cycle: extraer de cinema si existe
    if map_v1.get("cinema") and map_v1["cinema"].get("enabled"):
        cinema = map_v1["cinema"]
        bands = cinema.get("bands", [])
        if len(bands) > 1:
            stops = []
            for band in bands:
                stops.append({
                    "center": {"lat": band.get("lat", 0), "lon": 0.20},
                    "zoom": band.get("zoom", 7.8),
                    "bearing": 0,
                    "pitch": band.get("pitch", 0),
                    "duration_sec": band.get("duration_sec")
                })
            v2["ui"]["map"]["aoiCycle"] = {
                "intervalSec": 25,
                "stops": stops
            }
            v2["ui"]["map"]["viewMode"] = "aoiCycle"
    
    # AEMET v2
    aemet_v1 = config_v1.get("aemet", {})
    if aemet_v1.get("enabled"):
        v2["ui"]["aemet"] = {
            "enabled": True,
            "warnings": {
                "enabled": aemet_v1.get("cap_enabled", True),
                "min_severity": "yellow"
            },
            "radar": {
                "enabled": aemet_v1.get("radar_enabled", True),
                "opacity": 0.6,
                "speed": 1.0
            },
            "sat": {
                "enabled": aemet_v1.get("satellite_enabled", False),
                "opacity": 0.5
            }
        }
    else:
        v2["ui"]["aemet"] = {"enabled": False}
    
    # Panel rotatorio
    rotation_v1 = ui_v1.get("rotation", {})
    v2["ui"]["panel"] = {
        "rotate": {
            "enabled": rotation_v1.get("enabled", True),
            "order": rotation_v1.get("panels", [
                "weather_now", "forecast_week", "luna", "harvest",
                "efemerides", "news", "calendar"
            ]),
            "intervalSec": rotation_v1.get("duration_sec", 12)
        },
        "news": {
            "feeds": config_v1.get("news", {}).get("feeds", [
                "https://www.elperiodicomediterraneo.com/rss.html",
                "https://www.xataka.com/feed"
            ])
        },
        "efemerides": {
            "source": "built-in"
        }
    }
    
    # Layout
    v2["ui"]["layout"] = ui_v1.get("layout", "grid-2-1")
    
    # === Layers ===
    layers_v1 = config_v1.get("layers", {})
    
    # Flights
    flights_v1 = layers_v1.get("flights", {})
    if flights_v1.get("enabled") or config_v1.get("opensky", {}).get("enabled"):
        v2["layers"]["flights"] = {
            "enabled": flights_v1.get("enabled", True),
            "provider": "opensky",
            "render_mode": flights_v1.get("render_mode", "symbol_custom"),
            "max_items_view": flights_v1.get("max_items_view", 1200),
            "symbol": {
                "size_vh": flights_v1.get("symbol", {}).get("size_vh", 1.6),
                "allow_overlap": flights_v1.get("symbol", {}).get("allow_overlap", True)
            },
            "circle": {
                "radius_vh": flights_v1.get("circle", {}).get("radius_vh", 0.9),
                "color": flights_v1.get("circle", {}).get("color", "#FFD400"),
                "stroke_color": flights_v1.get("circle", {}).get("stroke_color", "#000000"),
                "stroke_width": flights_v1.get("circle", {}).get("stroke_width", 2.0)
            }
        }
    
    # Ships
    ships_v1 = layers_v1.get("ships", {})
    if ships_v1.get("enabled"):
        v2["layers"]["ships"] = {
            "enabled": True,
            "provider": ships_v1.get("provider", "aisstream"),
            "decimate": ships_v1.get("decimate", "grid"),
            "grid_px": ships_v1.get("grid_px", 24),
            "max_items_view": ships_v1.get("max_items_view", 420),
            "symbol": {
                "size_vh": ships_v1.get("symbol", {}).get("size_vh", 1.4),
                "allow_overlap": ships_v1.get("symbol", {}).get("allow_overlap", True)
            },
            "circle": {
                "radius_vh": ships_v1.get("circle", {}).get("radius_vh", 0.8),
                "color": ships_v1.get("circle", {}).get("color", "#5ad35a"),
                "stroke_color": ships_v1.get("circle", {}).get("stroke_color", "#002200"),
                "stroke_width": ships_v1.get("circle", {}).get("stroke_width", 2.0)
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
                if "ui" in config_v2 and "map" in config_v2["ui"]:
                    if "fixed" in config_v2["ui"]["map"]:
                        config_v2["ui"]["map"]["fixed"]["center"] = {
                            "lat": lat,
                            "lon": lon
                        }
                    else:
                        config_v2["ui"]["map"]["fixed"] = {
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

