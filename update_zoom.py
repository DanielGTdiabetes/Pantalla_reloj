
import json
from pathlib import Path

CONFIG_PATH = Path(r"D:\var\lib\pantalla-reloj\config.json")

def update_zoom():
    if not CONFIG_PATH.exists():
        print("Config file not found.")
        return

    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        
        updated = False
        if "ui_map" in data and "fixed" in data["ui_map"]:
            if data["ui_map"]["fixed"].get("zoom") != 5.0:
                data["ui_map"]["fixed"]["zoom"] = 5.0
                updated = True
                print("Updated saved config zoom to 5.0")
        
        if updated:
            CONFIG_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        else:
            print("Zoom already 5.0 in saved config or structure differs.")
            
    except Exception as e:
        print(f"Error updating config: {e}")

if __name__ == "__main__":
    update_zoom()
