import sys
import os
from pathlib import Path

# Agregar el directorio raíz al path para importar backend
sys.path.append(os.getcwd())

from backend.config_manager import ConfigManager
from backend.models import AppConfigV2

def enable_layers():
    config_path = os.getenv("PANTALLA_CONFIG", "/var/lib/pantalla-reloj/config.json")
    print(f"Leyendo configuración de: {config_path}")
    
    cm = ConfigManager()
    
    # Leer config actual
    try:
        config = cm.read()
    except Exception as e:
        print(f"Error leyendo config: {e}")
        return

    updated = False

    # 1. Habilitar Vuelos (Flights)
    if not config.layers:
        print("Inicializando objeto layers...")
        # (Aquí requeriría importar Modelos si layers es None, pero config_manager suele devolver defaults)
        pass 
    
    if config.layers and config.layers.flights:
        if not config.layers.flights.enabled:
            print("Habilitando capa Flights...")
            config.layers.flights.enabled = True
            updated = True
        
        if config.layers.flights.provider != "opensky":
            print("Estableciendo proveedor Flights a 'opensky'...")
            config.layers.flights.provider = "opensky"
            updated = True
    
    # 2. Habilitar OpenSky Global
    if config.opensky:
        if not config.opensky.enabled:
            print("Habilitando OpenSky global...")
            config.opensky.enabled = True
            updated = True
    
    # 3. Habilitar Barcos (Ships)
    if config.layers and config.layers.ships:
        if not config.layers.ships.enabled:
            print("Habilitando capa Ships...")
            config.layers.ships.enabled = True
            updated = True
        
        if config.layers.ships.provider != "aisstream":
            print("Estableciendo proveedor Ships a 'aisstream'...")
            config.layers.ships.provider = "aisstream"
            updated = True

    # 4. Habilitar Rayos (Lightning)
    if config.layers and config.layers.lightning:
        if not config.layers.lightning.enabled:
             print("Habilitando capa Lightning...")
             config.layers.lightning.enabled = True
             updated = True

    if updated:
        print("Guardando configuración actualizada...")
        try:
            # Usamos model_dump para serializar (pydantic v2) o dict()
            data = config.model_dump(mode='json')
            cm.write(data)
            print("Configuración guardada correctamente.")
        except Exception as e:
            print(f"Error al guardar config: {e}")
            # Fallback pydantic v1
            try:
                data = config.dict()
                cm.write(data)
                print("Configuración guardada (fallback dict).")
            except Exception as e2:
                print(f"Error fatal guardando: {e2}")
    else:
        print("Las capas ya estaban habilitadas. No se hicieron cambios.")

if __name__ == "__main__":
    enable_layers()
