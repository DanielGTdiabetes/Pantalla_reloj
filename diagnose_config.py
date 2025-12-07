
import sys
import os
from pathlib import Path
import json

# Add project root to sys.path
current_dir = Path(__file__).resolve().parent
sys.path.append(str(current_dir))

from backend.config_manager import ConfigManager

def check_config():
    print("--- DIAGNOSING CONFIGURATION ---")
    cm = ConfigManager()
    config = cm.read()
    
    print(f"Config File Path Absolute: {cm.config_file.resolve()}")
    print(f"Config File Exists: {cm.config_file.exists()}")
    
    # Check layer status
    layers = getattr(config, "layers", None)
    flights = getattr(layers, "flights", None)
    
    print(f"Flights Layer Enabled: {flights.enabled if flights else 'N/A'}")
    print(f"Flights Provider: {flights.provider if flights else 'N/A'}")
    print(f"Flights OpenSky Mode: {flights.opensky.mode if flights and flights.opensky else 'N/A'}")
    
    # Check global opensky
    opensky = getattr(config, "opensky", None)
    print(f"Global OpenSky Enabled: {opensky.enabled if opensky else 'N/A'}")
    print(f"Global OpenSky Mode: {opensky.mode if opensky else 'N/A'}")
    
    if flights.enabled and opensky.enabled and opensky.mode == 'bbox':
        print("RESULT: Configuration looks CORRECT for anonymous bbox mode.")
    else:
        print("RESULT: Configuration looks INCORRECT.")

if __name__ == "__main__":
    check_config()
