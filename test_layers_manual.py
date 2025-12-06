import sys
import os
import json
import logging
from pprint import pprint

# Añadir directorio raíz al path
sys.path.append(os.getcwd())

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test_layers")

try:
    from backend.services.cap_warnings import get_alerts_geojson
    from backend.services.blitzortung_service import BlitzortungService
except ImportError as e:
    logger.error(f"Error importando servicios: {e}")
    sys.exit(1)

def test_aemet_alerts():
    print("\n--- TEST: AEMET CAP Warnings ---")
    try:
        print("Obteniendo alertas...")
        geojson = get_alerts_geojson()
        
        feature_count = len(geojson.get("features", []))
        print(f"Número de alertas encontradas: {feature_count}")
        
        if feature_count > 0:
            # Mostrar la primera alerta como ejemplo
            print("\nEjemplo de primera alerta:")
            first = geojson["features"][0]
            props = first.get("properties", {})
            print(f"Evento: {props.get('event')}")
            print(f"Titular: {props.get('headline')}")
            print(f"Severidad: {props.get('severity')}")
            print(f"Tipo Geometría: {first.get('geometry', {}).get('type')}")
        else:
            print("No se encontraron alertas activas.")
            
        return feature_count > 0
        
    except Exception as e:
        print(f"ERROR probando AEMET: {e}")
        return False

def test_blitzortung():
    print("\n--- TEST: Blitzortung Lightning ---")
    # Crear servicio en modo dummy o con ws
    # Nota: Este test solo verifica la estructura, no conecta en vivo
    # a menos que usemos WebSocket real.
    
    service = BlitzortungService(
        enabled=True,
        ws_url="wss://ws.blitzortung.org:443"  # Try a real-looking or dummy url
    )
    
    # 1. Simular datos
    fake_data = [
        {"time": 1701880000, "lat": 40.0, "lon": -3.5, "severity": "medium"},
        {"time": 1701880010, "lat": 40.1, "lon": -3.6, "severity": "strong"}
    ]
    
    print("Inyectando datos simulados...")
    service._process_lightning_data(fake_data)
    
    # 2. Verificar GeoJSON
    geojson = service.to_geojson()
    feature_count = len(geojson.get("features", []))
    print(f"Rayos en sistema (simulados): {feature_count}")
    
    if feature_count == 2:
        print("Test estructura OK.")
        first = geojson["features"][0]
        print(f"Coordenadas ejemplo: {first['geometry']['coordinates']}")
        return True
    else:
        print("Test fallido: conteo incorrecto.")
        return False

if __name__ == "__main__":
    test_aemet_alerts()
    test_blitzortung()
