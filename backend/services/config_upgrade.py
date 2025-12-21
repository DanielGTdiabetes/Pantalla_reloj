import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

def clean_aemet_keys(config_path: Path) -> None:
    """Removes legacy AEMET keys from config to force re-auth or cleanup."""
    if not config_path.exists():
        return
        
    try:
        text = config_path.read_text(encoding="utf-8")
        data = json.loads(text)
        
        changed = False
        # Logic to clean keys if needed, for now just a pass
        # logic placeholder
        
        if changed:
            config_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            logger.info("Cleaned legacy AEMET keys from config")
            
    except Exception as e:
        logger.warning(f"Failed to clean config: {e}")
