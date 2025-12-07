
import json
from pathlib import Path

CONFIG_PATH = Path(r"D:\var\lib\pantalla-reloj\config.json")

def read_map_config():
    if not CONFIG_PATH.exists():
        print("Config file not found.")
        return

    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        ui_map = data.get("ui_map", {})
        print("--- UI MAP CONFIG ---")
        print(json.dumps(ui_map, indent=2))
        
        # Also check if environment variables might be interfering if used in config_manager
        # (I can't check env vars of the running backend process directly easily, but this shows what's on disk)
    except Exception as e:
        print(f"Error reading config: {e}")

if __name__ == "__main__":
    read_map_config()
