"""
Utilidades para limpiar y actualizar configuración obsoleta.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)


def clean_aemet_keys(config_path: str) -> bool:
    """
    Elimina entradas obsoletas de AEMET de config.json.
    
    Args:
        config_path: Ruta al archivo de configuración
        
    Returns:
        True si se modificó el archivo, False en caso contrario
    """
    try:
        config_file = Path(config_path)
        if not config_file.exists():
            logger.debug("Config file does not exist: %s", config_path)
            return False
        
        # Leer configuración
        with open(config_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        modified = False
        
        # Eliminar claves obsoletas de AEMET
        keys_to_remove = [
            "aemet",
            ("secrets", "aemet"),
            ("layers", "aemet"),
            ("ui_global", "aemet"),
        ]
        
        for key_path in keys_to_remove:
            if isinstance(key_path, str):
                # Clave de nivel superior
                if key_path in data:
                    data.pop(key_path, None)
                    modified = True
                    logger.info("Removed obsolete key: %s", key_path)
            elif isinstance(key_path, tuple):
                # Clave anidada
                node = data
                for i, part in enumerate(key_path[:-1]):
                    if isinstance(node, dict) and part in node:
                        node = node[part]
                    else:
                        break
                else:
                    # Llegamos al nodo padre
                    if isinstance(node, dict) and key_path[-1] in node:
                        node.pop(key_path[-1], None)
                        modified = True
                        logger.info("Removed obsolete nested key: %s", ".".join(key_path))
        
        # Guardar si hubo cambios
        if modified:
            # Escritura atómica
            temp_file = config_file.with_suffix(".json.tmp")
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            temp_file.replace(config_file)
            logger.info("Removed obsolete AEMET keys from config.json")
            return True
        
        return False
        
    except json.JSONDecodeError as e:
        logger.error("Failed to parse config.json: %s", e)
        return False
    except Exception as e:
        logger.error("Failed to clean AEMET keys: %s", e)
        return False

