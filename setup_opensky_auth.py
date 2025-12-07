
import json
from pathlib import Path

SECRETS_PATH = Path("d:\pantalla_reloj\Pantalla_reloj\secrets.json")
CONFIG_PATH = Path(r"D:\var\lib\pantalla-reloj\config.json")

def apply_opensky_credentials():
    # 1. Update secrets.json
    try:
        if SECRETS_PATH.exists():
            secrets = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
        else:
            secrets = {}
        
        print("Updating secrets.json with OpenSky credentials...")
        secrets["opensky_username"] = "danigt-api-client"
        secrets["opensky_password"] = "Mph0txbYD1udcExVL7OrsLoxDjl3eKbQ"
        
        SECRETS_PATH.write_text(json.dumps(secrets, indent=2), encoding="utf-8")
        print("Secrets updated.")
    except Exception as e:
        print(f"Error updating secrets: {e}")
        return

    # 2. Update config.json to use oauth2
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
    
    # Update Global OpenSky
    opensky = data.get("opensky", {})
    if opensky.get("mode") != "oauth2":
        print("Switching Global OpenSky mode to 'oauth2'...")
        opensky["mode"] = "oauth2"
        # Ensure enabled
        opensky["enabled"] = True
        data["opensky"] = opensky
        updated = True
        
    # Update Layers OpenSky
    layers = data.get("layers", {})
    flights = layers.get("flights", {})
    if flights:
        flights_opensky = flights.get("opensky", {})
        if flights_opensky.get("mode") != "oauth2":
            print("Switching Flights Layer OpenSky mode to 'oauth2'...")
            flights_opensky["mode"] = "oauth2"
            flights["opensky"] = flights_opensky
            data["layers"]["flights"] = flights
            updated = True

    if updated:
        print("Writing updated config...")
        try:
            CONFIG_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
            print("Config updated to use OAuth2.")
        except Exception as e:
            print(f"Error writing config: {e}")
    else:
        print("Config was already correctly set to OAuth2.")

if __name__ == "__main__":
    apply_opensky_credentials()
