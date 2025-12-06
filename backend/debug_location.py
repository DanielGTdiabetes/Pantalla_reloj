import sys
import os
from pathlib import Path

# Add current directory to sys.path
sys.path.append(os.getcwd())

from backend.config_manager import ConfigManager
from backend.routers.weather import router  # just to import logger related stuff if needed, but keeping it simple

def debug_location():
    cm = ConfigManager()
    print(f"DEBUG: Config source: {cm.config_source}")
    print(f"DEBUG: Config file path used: {cm.config_file}")
    print(f"DEBUG: Default config file: {cm.default_config_file}")
    
    config = cm.read()
    
    print("-" * 20)
    print("DEBUG: Ephemerides Config (config.ephemerides):")
    if config.ephemerides:
        print(f"  Latitude: {config.ephemerides.latitude}")
        print(f"  Longitude: {config.ephemerides.longitude}")
    else:
        print("  None")
        
    print("-" * 20)
    print("DEBUG: UI Map Center (config.ui_map.fixed.center):")
    if config.ui_map and config.ui_map.fixed and config.ui_map.fixed.center:
        print(f"  Lat: {config.ui_map.fixed.center.lat}")
        print(f"  Lon: {config.ui_map.fixed.center.lon}")
    else:
        print("  None or Invalid structure")

    print("-" * 20)
    print("DEBUG: Resolved Location Logic for Weather:")
    lat = None
    lon = None
    
    # 1. Try Ephemerides
    if config.ephemerides:
        lat = config.ephemerides.latitude
        lon = config.ephemerides.longitude
        print(f"  -> Resolved from Ephemerides: {lat}, {lon}")
    
    # 2. Try Map center
    if (lat is None or lon is None) and config.ui_map and config.ui_map.fixed and config.ui_map.fixed.center:
        lat = config.ui_map.fixed.center.lat
        lon = config.ui_map.fixed.center.lon
        print(f"  -> Resolved from Map Center: {lat}, {lon}")
        
    if lat is None or lon is None:
        lat = 40.4168
        lon = -3.7038
        print(f"  -> Fallback to Hardcoded Madrid: {lat}, {lon}")

if __name__ == "__main__":
    debug_location()
