import sys
import os
from pathlib import Path

# Add current directory to sys.path
sys.path.append(os.getcwd())

from backend.config_manager import ConfigManager

def debug_location():
    cm = ConfigManager()
    print(f"CONF_FILE: {cm.config_file}")
    
    config = cm.read()
    
    if config.ephemerides:
        print(f"EPHEM_LAT: {config.ephemerides.latitude}")
        print(f"EPHEM_LON: {config.ephemerides.longitude}")
    else:
        print("EPHEM: NONE")
        
    lat = 40.4168
    lon = -3.7038
    
    if config.ephemerides:
        lat = config.ephemerides.latitude
        lon = config.ephemerides.longitude
        print("RESULT: EPHEMERIDES")
    
    print(f"FINAL_LAT: {lat}")
    print(f"FINAL_LON: {lon}")

if __name__ == "__main__":
    debug_location()
