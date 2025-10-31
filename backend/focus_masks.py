"""Construcción y caché de máscaras de foco (cine_focus) para destacar tráfico en fenómenos adversos."""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .cache import CacheStore
from .logging_utils import configure_logging
from .models import AEMET, CineFocus

logger = configure_logging()

# Cache para focus masks
FOCUS_CACHE_DIR = Path("/var/cache/pantalla/focus")
FOCUS_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calcula distancia en km entre dos puntos usando fórmula de Haversine."""
    R = 6371.0  # Radio de la Tierra en km
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    
    a = (
        math.sin(dlat / 2) ** 2 +
        math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


def point_in_polygon(lat: float, lon: float, polygon: List[List[float]]) -> bool:
    """Verifica si un punto está dentro de un polígono (algoritmo ray casting).
    
    Args:
        lat: Latitud del punto
        lon: Longitud del punto
        polygon: Lista de coordenadas [[lon, lat], ...] del polígono
        
    Returns:
        True si el punto está dentro del polígono
    """
    if not polygon or len(polygon) < 3:
        return False
    
    inside = False
    j = len(polygon) - 1
    
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        
        j = i
    
    return inside


def apply_buffer_simple(
    polygon: List[List[float]],
    buffer_km: float
) -> List[List[float]]:
    """Aplica un buffer simple a un polígono expandiéndolo hacia afuera.
    
    Nota: Esta es una implementación simplificada. Para mayor precisión,
    usaría una librería como Shapely o similar.
    
    Args:
        polygon: Lista de coordenadas [[lon, lat], ...]
        buffer_km: Distancia del buffer en km
        
    Returns:
        Polígono expandido
    """
    if not polygon or len(polygon) < 3:
        return polygon
    
    # Calcular el centro del polígono
    center_lon = sum(p[0] for p in polygon) / len(polygon)
    center_lat = sum(p[1] for p in polygon) / len(polygon)
    
    # Expandir cada punto desde el centro
    buffered = []
    for lon, lat in polygon:
        # Calcular dirección desde el centro
        dist = haversine_distance_km(center_lat, center_lon, lat, lon)
        if dist == 0:
            buffered.append([lon, lat])
            continue
        
        # Factor de expansión
        factor = 1.0 + (buffer_km / dist)
        
        # Aplicar expansión
        new_lon = center_lon + (lon - center_lon) * factor
        new_lat = center_lat + (lat - center_lat) * factor
        
        buffered.append([new_lon, new_lat])
    
    return buffered


def build_cap_mask(
    cap_warnings: List[Dict[str, Any]],
    min_severity: str,
    buffer_km: float
) -> Optional[Dict[str, Any]]:
    """Construye una máscara de foco a partir de avisos CAP.
    
    Args:
        cap_warnings: Lista de avisos CAP (GeoJSON features)
        min_severity: Severidad mínima ("yellow", "orange", "red")
        buffer_km: Buffer en km
        
    Returns:
        GeoJSON MultiPolygon o None si no hay avisos
    """
    severity_order = {"yellow": 1, "orange": 2, "red": 3}
    min_level = severity_order.get(min_severity, 1)
    
    polygons = []
    
    for warning in cap_warnings:
        if not isinstance(warning, dict):
            continue
        
        # Verificar severidad
        severity = warning.get("properties", {}).get("severity", "").lower()
        severity_level = severity_order.get(severity, 0)
        
        if severity_level < min_level:
            continue
        
        # Extraer geometría
        geometry = warning.get("geometry")
        if not geometry or geometry.get("type") not in ["Polygon", "MultiPolygon"]:
            continue
        
        if geometry["type"] == "Polygon":
            coords = geometry.get("coordinates", [])
            if coords:
                # Aplicar buffer
                buffered = apply_buffer_simple(coords[0], buffer_km)
                polygons.append([buffered])
        elif geometry["type"] == "MultiPolygon":
            coords = geometry.get("coordinates", [])
            for ring_group in coords:
                if ring_group and ring_group[0]:
                    buffered = apply_buffer_simple(ring_group[0], buffer_km)
                    polygons.append([buffered])
    
    if not polygons:
        return None
    
    # Si hay múltiples polígonos, crear MultiPolygon
    if len(polygons) == 1:
        return {
            "type": "Polygon",
            "coordinates": polygons[0]
        }
    else:
        return {
            "type": "MultiPolygon",
            "coordinates": polygons
        }


def build_radar_mask(
    radar_data: Dict[str, Any],
    threshold_dbz: float,
    buffer_km: float
) -> Optional[Dict[str, Any]]:
    """Construye una máscara de foco a partir de datos de radar.
    
    Nota: Por ahora, esto es una implementación simplificada.
    En producción, necesitaría procesar los tiles de radar reales.
    
    Args:
        radar_data: Datos de radar (simplificado por ahora)
        threshold_dbz: Umbral de dBZ
        buffer_km: Buffer en km
        
    Returns:
        GeoJSON MultiPolygon o None
    """
    # Por ahora, retornar None ya que necesitaríamos procesar tiles de radar
    # En producción, esto procesaría los tiles y generaría contornos
    return None


def build_focus_mask(
    mode: str,
    cap_warnings: Optional[List[Dict[str, Any]]],
    radar_data: Optional[Dict[str, Any]],
    min_severity: str,
    radar_threshold: float,
    buffer_km: float
) -> Optional[Dict[str, Any]]:
    """Construye una máscara de foco combinando CAP y/o Radar según el modo.
    
    Args:
        mode: "cap", "radar" o "both"
        cap_warnings: Lista de avisos CAP
        radar_data: Datos de radar
        min_severity: Severidad mínima para CAP
        radar_threshold: Umbral para radar (dBZ)
        buffer_km: Buffer en km
        
    Returns:
        GeoJSON MultiPolygon con la máscara combinada
    """
    cap_mask = None
    radar_mask = None
    
    if mode in ["cap", "both"] and cap_warnings:
        cap_mask = build_cap_mask(cap_warnings, min_severity, buffer_km)
    
    if mode in ["radar", "both"] and radar_data:
        radar_mask = build_radar_mask(radar_data, radar_threshold, buffer_km)
    
    # Combinar según modo
    if mode == "cap":
        return cap_mask
    elif mode == "radar":
        return radar_mask
    elif mode == "both":
        # Unir las máscaras (simplificado: devolver la que exista)
        if cap_mask and radar_mask:
            # En producción, haría union geométrica
            # Por ahora, devolver la de CAP como prioridad
            return cap_mask
        elif cap_mask:
            return cap_mask
        elif radar_mask:
            return radar_mask
        else:
            return None
    else:
        return None


def check_point_in_focus(
    lat: float,
    lon: float,
    focus_mask: Optional[Dict[str, Any]]
) -> bool:
    """Verifica si un punto está dentro de la máscara de foco.
    
    Args:
        lat: Latitud del punto
        lon: Longitud del punto
        focus_mask: Máscara de foco (GeoJSON Polygon o MultiPolygon)
        
    Returns:
        True si el punto está en foco
    """
    if not focus_mask:
        return False
    
    geom_type = focus_mask.get("type")
    coords = focus_mask.get("coordinates", [])
    
    if geom_type == "Polygon":
        if coords and coords[0]:
            return point_in_polygon(lat, lon, coords[0])
    elif geom_type == "MultiPolygon":
        for polygon_coords in coords:
            if polygon_coords and polygon_coords[0]:
                if point_in_polygon(lat, lon, polygon_coords[0]):
                    return True
    
    return False


def load_or_build_focus_mask(
    cache_store: CacheStore,
    config: Any,  # AppConfig
    cine_focus: CineFocus,
    mode_key: str  # "cap", "radar" o "both"
) -> Tuple[Optional[Dict[str, Any]], bool]:
    """Carga o construye una máscara de foco con caché.
    
    Args:
        cache_store: Store de caché
        config: Configuración completa (AppConfig)
        cine_focus: Configuración de cine_focus
        mode_key: Clave del modo ("cap", "radar", "both")
        
    Returns:
        Tuple de (máscara, from_cache)
        - máscara: GeoJSON MultiPolygon o None
        - from_cache: True si se cargó de caché
    """
    if not cine_focus.enabled or not config.aemet.enabled:
        return None, False
    
    # Determinar TTL según refresh de CAP/Radar
    aemet_config = config.aemet
    ttl_minutes = min(
        aemet_config.cache_minutes if aemet_config.cap_enabled else 9999,
        aemet_config.cache_minutes if aemet_config.radar_enabled else 9999,
    )
    
    # Intentar cargar de caché
    cache_key = f"focus_mask_{mode_key}"
    cached = cache_store.load(cache_key, max_age_minutes=ttl_minutes)
    
    if cached and cached.payload:
        logger.debug("Focus mask loaded from cache: %s", mode_key)
        return cached.payload, True
    
    # Construir máscara
    try:
        # Obtener datos CAP (si está habilitado)
        cap_warnings = None
        if aemet_config.cap_enabled and mode_key in ["cap", "both"]:
            # Intentar cargar desde caché de AEMET
            aemet_cached = cache_store.load("aemet_warnings", max_age_minutes=None)
            if aemet_cached and aemet_cached.payload:
                warnings_data = aemet_cached.payload
                if isinstance(warnings_data, dict) and "features" in warnings_data:
                    cap_warnings = warnings_data["features"]
        
        # Obtener datos Radar (simplificado por ahora)
        radar_data = None
        if aemet_config.radar_enabled and mode_key in ["radar", "both"]:
            # Por ahora, radar_data = None (se implementaría procesando tiles)
            pass
        
        # Construir máscara
        mask = build_focus_mask(
            mode=cine_focus.mode,
            cap_warnings=cap_warnings,
            radar_data=radar_data,
            min_severity=cine_focus.min_severity,
            radar_threshold=cine_focus.radar_dbz_threshold,
            buffer_km=cine_focus.buffer_km
        )
        
        if mask:
            # Guardar en caché
            cache_store.store(cache_key, mask)
            logger.info("Focus mask built and cached: %s (polygons: %d)", mode_key, 
                       len(mask.get("coordinates", [])))
        
        return mask, False
    except Exception as exc:
        logger.error("Failed to build focus mask: %s", exc)
        return None, False

