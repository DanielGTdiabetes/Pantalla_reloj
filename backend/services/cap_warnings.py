"""
Servicio para obtener avisos CAP públicos de AEMET.
"""
from __future__ import annotations

import gzip
import io
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List

import requests

logger = logging.getLogger(__name__)

CAP_URL = "https://alerts.aemet.es/descargas/avisos_cap.xml.gz"
TIMEOUT = 15

# Namespace CAP
CAP_NS = "{urn:oasis:names:tc:emergency:cap:1.2}"


def get_alerts_geojson() -> Dict[str, Any]:
    """
    Obtiene avisos CAP de AEMET y los convierte a GeoJSON.
    
    Returns:
        GeoJSON FeatureCollection con los avisos
    """
    try:
        # Descargar archivo CAP comprimido
        response = requests.get(CAP_URL, timeout=TIMEOUT)
        response.raise_for_status()
        
        # Descomprimir contenido gzip
        xml_content = gzip.decompress(response.content)
        
        # Parsear XML
        try:
            tree = ET.parse(io.BytesIO(xml_content))
            root = tree.getroot()
        except ET.ParseError as e:
            logger.error("Error parsing CAP XML: %s", e)
            return {
                "type": "FeatureCollection",
                "features": [],
                "metadata": {
                    "source": "aemet",
                    "error": "xml_parse_error",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            }
        
        features: List[Dict[str, Any]] = []
        
        # Buscar todos los elementos <alert>
        alerts = root.findall(f".//{CAP_NS}alert") or root.findall(".//alert")
        
        for alert_idx, alert in enumerate(alerts[:50]):  # Limitar a 50 avisos
            # Extraer información básica
            info_elem = alert.find(f".//{CAP_NS}info") or alert.find(".//info")
            if info_elem is None:
                continue
            
            severity_elem = info_elem.find(f".//{CAP_NS}severity") or info_elem.find(".//severity")
            severity = severity_elem.text.strip().lower() if severity_elem is not None and severity_elem.text else "unknown"
            
            status_elem = info_elem.find(f".//{CAP_NS}status") or info_elem.find(".//status")
            status = status_elem.text.strip().lower() if status_elem is not None and status_elem.text else "unknown"
            
            event_elem = info_elem.find(f".//{CAP_NS}event") or info_elem.find(".//event")
            event = event_elem.text.strip() if event_elem is not None and event_elem.text else "Unknown"
            
            headline_elem = info_elem.find(f".//{CAP_NS}headline") or info_elem.find(".//headline")
            headline = headline_elem.text.strip() if headline_elem is not None and headline_elem.text else ""
            
            # Buscar áreas (polygons)
            areas = info_elem.findall(f".//{CAP_NS}area") or info_elem.findall(".//area")
            
            for area_idx, area in enumerate(areas):
                # Buscar polígonos
                polygon_elem = area.find(f".//{CAP_NS}polygon") or area.find(".//polygon")
                
                if polygon_elem is not None and polygon_elem.text:
                    coords_str = polygon_elem.text.strip()
                    try:
                        # Parsear coordenadas (formato: "lat1,lon1 lat2,lon2 ...")
                        coord_pairs = coords_str.split()
                        polygon_coords = []
                        
                        for pair in coord_pairs:
                            parts = pair.split(',')
                            if len(parts) == 2:
                                try:
                                    # Intentar ambos formatos (lat,lon y lon,lat)
                                    lat = float(parts[0])
                                    lon = float(parts[1])
                                    
                                    # Validar rango
                                    if -90 <= lat <= 90 and -180 <= lon <= 180:
                                        polygon_coords.append([lon, lat])
                                    else:
                                        # Intentar al revés
                                        lon = float(parts[0])
                                        lat = float(parts[1])
                                        if -90 <= lat <= 90 and -180 <= lon <= 180:
                                            polygon_coords.append([lon, lat])
                                except ValueError:
                                    continue
                        
                        # Cerrar el polígono si no está cerrado
                        if len(polygon_coords) >= 3:
                            if polygon_coords[0] != polygon_coords[-1]:
                                polygon_coords.append(polygon_coords[0])
                            
                            if len(polygon_coords) >= 4:  # Mínimo para un polígono cerrado
                                feature = {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [polygon_coords]
                                    },
                                    "properties": {
                                        "id": f"cap_{alert_idx}_{area_idx}",
                                        "severity": severity,
                                        "status": status,
                                        "event": event,
                                        "headline": headline,
                                        "source": "aemet",
                                    }
                                }
                                features.append(feature)
                    except (ValueError, IndexError) as e:
                        logger.debug("Error parsing coordinates: %s", e)
                        continue
        
        # Si no encontramos polígonos, crear un feature genérico para España
        if not features:
            logger.warning("No se encontraron polígonos en avisos CAP, creando feature genérico")
            spain_bbox = [
                [-9.0, 36.0],  # SW
                [4.0, 36.0],   # SE
                [4.0, 44.0],   # NE
                [-9.0, 44.0],  # NW
                [-9.0, 36.0],  # Cerrar
            ]
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [spain_bbox]
                },
                "properties": {
                    "id": "cap_spain_generic",
                    "severity": "moderate",
                    "status": "unknown",
                    "event": "No data available",
                    "headline": "",
                    "source": "aemet",
                }
            })
        
        return {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "source": "aemet",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        }
        
    except requests.RequestException as e:
        logger.error("Error fetching CAP warnings: %s", e)
        return {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "source": "aemet",
                "error": "network_error",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        }
    except Exception as e:
        logger.error("Error processing CAP warnings: %s", e)
        return {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "source": "aemet",
                "error": "processing_error",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        }

