import re
from pathlib import Path

def process_file(file_path):
    print(f"Processing {file_path}")
    content = file_path.read_text(encoding="utf-8")
    
    # 1. Replace imports from config_v2 to config
    content = content.replace('from "../types/config_v2"', 'from "../types/config"')
    
    # 2. Replace V2 suffixes in Type definitions and usages
    # We need to be careful not to replace things that shouldn't be replaced.
    # But in this context, AppConfigV2 -> AppConfig is desired.
    # Regex: replace WordV2 with Word, but only if Word is one of our known types or generic V2 suffix.
    
    # List of known types to rename
    types_to_rename = [
        "AppConfig", "MapConfig", "UIGlobalConfig", "LayersConfig", 
        "FlightsLayerConfig", "ShipsLayerConfig", "GlobalRadarLayerConfig",
        "PanelsConfig", "CalendarConfig", "UIRotationConfig",
        "OpenSkyConfig", "OpenSkyOAuthConfig", "HarvestConfig",
        "GlobalSatelliteLayerConfig", "GlobalLayersConfig", "UIConfig",
        "FlightsLayerCircleConfig", "FlightsLayerSymbolConfig",
        "MapSatelliteConfig" # This one might be tricky if it was MapSatelliteConfigV2? No, it was MapSatelliteConfig in V2.
    ]
    
    # In config_v2.ts, most types end with V2.
    # In defaults_v2.ts, variables like DEFAULT_CONFIG_V2 exist.
    
    # Replace DEFAULT_CONFIG_V2 -> DEFAULT_CONFIG
    content = content.replace("DEFAULT_CONFIG_V2", "DEFAULT_CONFIG")
    
    # Replace withConfigDefaultsV2 -> withConfigDefaults
    content = content.replace("withConfigDefaultsV2", "withConfigDefaults")
    
    # Replace TypeV2 -> Type
    # We use a regex to match whole words ending in V2
    content = re.sub(r'\b(\w+)V2\b', r'\1', content)
    
    file_path.write_text(content, encoding="utf-8")

base_dir = Path(r"d:\pantalla_reloj\Pantalla_reloj\dash-ui\src")
process_file(base_dir / "types/config.ts")
process_file(base_dir / "config/defaults.ts")
