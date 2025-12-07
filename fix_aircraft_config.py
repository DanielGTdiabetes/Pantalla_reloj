
import json
import os
from pathlib import Path

CONFIG_PATH = Path(r"D:\var\lib\pantalla-reloj\config.json")

def fix_config():
    if not CONFIG_PATH.exists():
        print(f"Config file not found at {CONFIG_PATH}")
        return

    print(f"Reading config from {CONFIG_PATH}...")
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Error reading config: {e}")
        return

    updated = False
    
    # Enable global opensky
    opensky = data.get("opensky", {})
    if not opensky.get("enabled") or opensky.get("mode") != "bbox":
        print("Enable global OpenSky and set mode to 'bbox'...")
        opensky["enabled"] = True
        opensky["mode"] = "bbox"
        
        # Ensure bbox is set correctly (Spain)
        if "bbox" not in opensky:
            opensky["bbox"] = {
              "lamin": 36.0,
              "lamax": 44.0,
              "lomin": -10.0,
              "lomax": 5.0
            }
        
        data["opensky"] = opensky
        updated = True

    # Check layers.flights
    layers = data.get("layers", {})
    flights = layers.get("flights", {})
    
    if not flights.get("enabled") or flights.get("provider") != "opensky":
        print("Enabling flights layer...")
        flights["enabled"] = True
        flights["provider"] = "opensky"
        layers["flights"] = flights
        data["layers"] = layers
        updated = True
        
    # Check flights opensky config
    flights_opensky = flights.get("opensky", {})
    if flights_opensky.get("mode") != "bbox":
         print("Setting flights layer OpenSky mode to 'bbox'...")
         flights_opensky["mode"] = "bbox"
         # Ensure bbox is set
         if "bbox" not in flights_opensky:
            flights_opensky["bbox"] = {
              "lamin": 36.0,
              "lamax": 44.0,
              "lomin": -10.0,
              "lomax": 5.0
            }
         flights["opensky"] = flights_opensky
         updated = True

    if updated:
        print("Writing updated config...")
        try:
            # Atomic write not strictly necessary for this script, but good practice
            CONFIG_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
            print("Config updated successfully.")
        except Exception as e:
            print(f"Error writing config: {e}")
    else:
        print("Config was already correct.")

if __name__ == "__main__":
    fix_config()
