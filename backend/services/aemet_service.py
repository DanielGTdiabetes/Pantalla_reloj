"""
Servicio para obtener datos de AEMET.
Proporciona avisos CAP públicos (Meteoalerta) y convierte a GeoJSON.
No requiere token API - usa feed público.
"""
from __future__ import annotations

import gzip
import json
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

# URL pública de avisos CAP de AEMET (sin autenticación)
CAP_URL = "https://alerts.aemet.es/descargas/avisos_cap.xml.gz"
AEMET_TIMEOUT = 10


class AEMETServiceError(Exception):
    """Error del servicio AEMET."""
    pass


def fetch_aemet_warnings(api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Obtiene avisos CAP públicos de AEMET (Meteoalerta) y los convierte a GeoJSON.
    
    Args:
        api_key: Ignorado (mantenido para compatibilidad, no se usa)
        
    Returns:
        GeoJSON FeatureCollection con los avisos CAP
        
    Raises:
        AEMETServiceError: Si hay error al obtener o procesar datos
    """
    try:
        # Descargar XML CAP comprimido directamente desde URL pública
        logger.debug("Fetching AEMET CAP from %s", CAP_URL)
        response = requests.get(CAP_URL, timeout=AEMET_TIMEOUT)
        response.raise_for_status()
        
        # Descomprimir contenido gzip
        xml_content = gzip.decompress(response.content).decode('utf-8')
        
        # Parsear XML CAP usando xml.etree.ElementTree
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            logger.error("Error parsing AEMET CAP XML: %s", e)
            # Fallback: retornar estructura vacía
            return {
                "type": "FeatureCollection",
                "features": [],
                "metadata": {
                    "source": "aemet",
                    "error": "xml_parse_error",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            }
        
        # Namespace CAP (Common Alerting Protocol)
        namespaces = {
            'cap': 'urn:oasis:names:tc:emergency:cap:1.2',
            'aemet': 'http://www.aemet.es/xml/meteoalert/1.0'
        }
        
        features: List[Dict[str, Any]] = []
        
        # Buscar todos los elementos <alert>
        alerts = root.findall('.//cap:alert', namespaces) or root.findall('.//alert')
        
        for alert_idx, alert in enumerate(alerts[:50]):  # Limitar a 50 avisos
            # Extraer propiedades básicas del alert
            severity_elem = alert.find('.//cap:severity', namespaces) or alert.find('.//severity')
            severity = severity_elem.text.strip().lower() if severity_elem is not None and severity_elem.text else "moderate"
            
            status_elem = alert.find('.//cap:status', namespaces) or alert.find('.//status')
            status = status_elem.text.strip().lower() if status_elem is not None and status_elem.text else "unknown"
            
            event_elem = alert.find('.//cap:event', namespaces) or alert.find('.//event')
            event = event_elem.text.strip() if event_elem is not None and event_elem.text else "Unknown"
            
            # Buscar áreas (polygons)
            areas = alert.findall('.//cap:area', namespaces) or alert.findall('.//area')
            
            for area_idx, area in enumerate(areas):
                # Buscar polígonos
                polygon_elem = area.find('.//cap:polygon', namespaces) or area.find('.//polygon')
                
                if polygon_elem is not None and polygon_elem.text:
                    coords_str = polygon_elem.text.strip()
                    try:
                        # Parsear coordenadas (formato: "lat1,lon1 lat2,lon2 ..." o "lon1,lat1 lon2,lat2 ...")
                        coord_pairs = coords_str.split()
                        polygon_coords = []
                        for pair in coord_pairs:
                            parts = pair.split(',')
                            if len(parts) == 2:
                                # Intentar ambos formatos (lat,lon y lon,lat)
                                try:
                                    lat = float(parts[0])
                                    lon = float(parts[1])
                                    # Validar rango (lat: -90 a 90, lon: -180 a 180)
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
                                        "id": f"aemet_{alert_idx}_{area_idx}",
                                        "severity": severity,
                                        "status": status,
                                        "event": event,
                                        "source": "aemet",
                                    }
                                }
                                features.append(feature)
                    except (ValueError, IndexError) as e:
                        logger.debug("Error parsing coordinates: %s", e)
                        continue
        
        # Si no encontramos polígonos, crear un feature genérico para España
        if not features:
            logger.warning("No se encontraron polígonos en avisos AEMET, creando feature genérico")
            # Bbox aproximado de España
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
                    "id": "aemet_spain_generic",
                    "severity": "moderate",
                    "status": "unknown",
                    "event": "No data available",
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
        logger.error("Error fetching AEMET warnings: %s", e)
        raise AEMETServiceError(f"Error al obtener datos de AEMET: {e}") from e
    except Exception as e:
        logger.error("Error processing AEMET warnings: %s", e)
        raise AEMETServiceError(f"Error al procesar datos de AEMET: {e}") from e

