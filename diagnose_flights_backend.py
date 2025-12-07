import sys
import os
import asyncio
import logging
from pprint import pprint

# Añadir el directorio raíz al path para poder importar módulos del backend
sys.path.append(os.getcwd())

from backend.services.opensky_service import OpenSkyService
from backend.secret_store import SecretStore
from backend.models import AppConfig, FlightsLayerConfig, OpenSkyProviderConfig, OpenSkyTopLevelConfig, OpenSkyBBoxTopLevelConfig, OpenSkyBBoxConfig, LayersConfig

# ... (rest of imports)

def create_mock_config():
    # Crear una configuración simple para pruebas
    return AppConfig(
        opensky=OpenSkyTopLevelConfig(
            enabled=True,
            mode="bbox",
            bbox=OpenSkyBBoxTopLevelConfig(lamin=36.0, lamax=44.0, lomin=-10.0, lomax=5.0)
        ),
        layers=LayersConfig(
            flights=FlightsLayerConfig(
                enabled=True,
                provider="opensky",
                opensky=OpenSkyProviderConfig(
                    mode="oauth2",
                    bbox=OpenSkyBBoxConfig(lamin=36.0, lamax=44.0, lomin=-10.0, lomax=5.0)
                )
            )
        )
    )

from pathlib import Path

def test_opensky_service():
    print("=== Iniciando diagnóstico de OpenSkyService ===")
    
    # Simular SecretStore
    secret_store = SecretStore(Path("secrets.json"))
    
    # Instanciar servicio
    service = OpenSkyService(secret_store)
    
    try:
        config = create_mock_config()
        
        # Test 1: get_snapshot con bbox explícito (España)
        print("TEST_1_START")
        bbox = (36.0, 44.0, -10.0, 5.0)
        snapshot = service.get_snapshot(config, bbox=bbox)
        
        count = snapshot.payload.get('count')
        print(f"SNAPSHOT_COUNT={count}")
        items = snapshot.payload.get("items", [])
        if items:
            print(f"FIRST_ITEM={items[0]['icao24']}")
        else:
            print("NO_ITEMS")
            
        # Test 2: Status
        status = service.get_status(config)
        print(f"STATUS_HAS_CREDENTIALS={status.get('has_credentials')}")
        print(f"STATUS_VALUE={status.get('status')}")

        # Test 3: Force Refresh
        print("TEST_3_START")
        refresh_result = service.force_refresh(config)
        print(f"REFRESH_STATUS={refresh_result.get('fetch', {}).get('status')}")
        print(f"REFRESH_ITEMS={refresh_result.get('fetch', {}).get('items')}")
        print(f"REFRESH_ERROR={refresh_result.get('error')}")

    except Exception as e:
        print(f"ERROR_CRITICO={e}")
    finally:
        service.close()
        print("DONE")

if __name__ == "__main__":
    test_opensky_service()
