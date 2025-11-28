"""
Servicio para cargar y escribir configuración desde disco.
Garantiza que el disco tiene prioridad sobre defaults.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

log = logging.getLogger("config_loader")


def read_json(path: str | Path) -> Dict[str, Any]:
    """
    Lee un archivo JSON desde disco.
    
    Args:
        path: Ruta al archivo JSON
        
    Returns:
        Diccionario con los datos del JSON
        
    Raises:
        FileNotFoundError: Si el archivo no existe
        json.JSONDecodeError: Si el JSON es inválido
        OSError: Si hay error de lectura
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str | Path, data: Dict[str, Any]) -> None:
    """
    Escribe un diccionario como JSON a disco.
    Usa ConfigManager para escritura atómica.
    
    Args:
        path: Ruta destino del archivo JSON
        data: Diccionario a escribir
    """
    from ..config_manager import ConfigManager
    
    config_manager = ConfigManager(config_file=Path(path))
    config_manager._atomic_write(data)


def merge_defaults(defaults: Dict[str, Any], disk: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fusiona defaults con configuración de disco.
    El disco tiene prioridad sobre defaults.
    
    Args:
        defaults: Diccionario con valores por defecto
        disk: Diccionario con configuración de disco
        
    Returns:
        Diccionario fusionado (disco tiene prioridad)
    """
    from ..config_store import deep_merge
    
    # Iniciar con defaults
    result = dict(defaults or {})
    
    # Aplicar disco con prioridad
    return deep_merge(result, disk or {})

