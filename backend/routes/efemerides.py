"""Módulo para gestión de efemérides históricas (hechos/curiosidades del día)."""
from __future__ import annotations

import calendar
import json
import logging
import os
import shutil
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


def load_efemerides_data(data_path: str) -> Dict[str, List[str]]:
    """Carga datos de efemérides desde archivo JSON.
    
    Args:
        data_path: Ruta al archivo JSON de efemérides
        
    Returns:
        Diccionario con estructura {"MM-DD": ["evento1", "evento2", ...]}
    """
    try:
        path = Path(data_path)
        if not path.exists():
            logger.debug("Efemerides file not found: %s", data_path)
            return {}
        
        data = json.loads(path.read_text(encoding="utf-8"))
        
        # Validar estructura básica
        if not isinstance(data, dict):
            logger.warning("Invalid efemerides JSON structure: not a dict")
            return {}
        
        # Validar que las claves sean strings "MM-DD" y valores sean listas de strings
        validated_data = {}
        for key, value in data.items():
            if not isinstance(key, str):
                continue
            if not isinstance(value, list):
                continue
            # Validar que todos los elementos sean strings
            validated_items = [
                item for item in value 
                if isinstance(item, str) and item.strip()
            ]
            if validated_items:
                validated_data[key] = validated_items
        
        return validated_data
    
    except FileNotFoundError:
        logger.debug("Efemerides file not found: %s", data_path)
        return {}
    except json.JSONDecodeError as e:
        logger.warning("Invalid JSON in efemerides file: %s", e)
        return {}
    except PermissionError as e:
        logger.warning("Permission denied reading efemerides file: %s", e)
        return {}
    except Exception as e:
        logger.error("Error loading efemerides data: %s", e, exc_info=True)
        return {}


def get_efemerides_for_date(
    data_path: str,
    target_date: Optional[date] = None,
    tz_str: str = "Europe/Madrid"
) -> Dict[str, Any]:
    """Obtiene efemérides para una fecha específica.
    
    Args:
        data_path: Ruta al archivo JSON de efemérides
        target_date: Fecha objetivo (por defecto: hoy en timezone especificado)
        tz_str: Timezone a usar (por defecto: Europe/Madrid)
        
    Returns:
        Diccionario con {"date": "YYYY-MM-DD", "count": N, "items": [...]}
    """
    if target_date is None:
        # Usar fecha actual en timezone especificado
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(tz_str)
            now = datetime.now(tz)
            target_date = now.date()
        except Exception:
            # Fallback a UTC si zoneinfo no está disponible o timezone inválido
            now = datetime.now(timezone.utc)
            target_date = now.date()
    
    # Formatear fecha como "MM-DD"
    date_key = target_date.strftime("%m-%d")
    
    # Cargar datos
    all_data = load_efemerides_data(data_path)
    
    # Obtener eventos para esta fecha
    events = all_data.get(date_key, [])
    
    return {
        "date": target_date.isoformat(),
        "count": len(events),
        "items": events
    }


def validate_efemerides_json(data: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Valida estructura de JSON de efemérides.
    
    Args:
        data: Datos JSON a validar
        
    Returns:
        Tuple (is_valid, error_message)
    """
    if not isinstance(data, dict):
        return False, "JSON must be a dictionary"
    
    for key, value in data.items():
        # Validar clave "MM-DD"
        if not isinstance(key, str):
            return False, f"Key '{key}' must be a string in format 'MM-DD'"
        
        # Validar formato "MM-DD"
        parts = key.split("-")
        if len(parts) != 2:
            return False, f"Key '{key}' must be in format 'MM-DD'"
        
        try:
            month = int(parts[0])
            day = int(parts[1])
            if not (1 <= month <= 12):
                return False, f"Month in key '{key}' must be between 1 and 12"
            # Validar día válido para el mes usando calendar.monthrange
            # Usamos año 2000 (bisiesto) para permitir 29 de febrero
            year = 2000
            max_day = calendar.monthrange(year, month)[1]
            if not (1 <= day <= max_day):
                return False, f"Day {day} in key '{key}' is invalid for month {month} (max: {max_day})"
        except ValueError:
            return False, f"Key '{key}' must have numeric month and day"
        
        # Validar valor (lista de strings)
        if not isinstance(value, list):
            return False, f"Value for key '{key}' must be a list"
        
        for item in value:
            if not isinstance(item, str):
                return False, f"All items in '{key}' must be strings"
            if not item.strip():
                return False, f"Empty string found in '{key}'"
    
    return True, None


def save_efemerides_data(data_path: str, data: Dict[str, List[str]]) -> Dict[str, Any]:
    """Guarda datos de efemérides de forma atómica.
    
    Args:
        data_path: Ruta destino del archivo JSON
        data: Datos a guardar
        
    Returns:
        Diccionario con información del guardado
    """
    path = Path(data_path)
    
    # Crear directorio si no existe
    path.parent.mkdir(parents=True, exist_ok=True)
    
    # Validar datos
    is_valid, error_msg = validate_efemerides_json(data)
    if not is_valid:
        raise ValueError(f"Invalid efemerides data: {error_msg}")
    
    # Guardar de forma atómica (tmp + rename)
    try:
        # Crear archivo temporal en el mismo directorio
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
            suffix=".json.tmp"
        ) as tmp_file:
            json.dump(data, tmp_file, indent=2, ensure_ascii=False)
            tmp_path = Path(tmp_file.name)
        
        # Mover archivo temporal al destino (atómico)
        shutil.move(str(tmp_path), str(path))
        
        # Ajustar permisos (0644)
        try:
            os.chmod(path, 0o644)
        except Exception:
            pass  # Ignorar si no se pueden ajustar permisos
        
        # Contar total de eventos
        total_items = sum(len(events) for events in data.values())
        
        return {
            "ok": True,
            "saved_path": str(path),
            "items_total": total_items
        }
    
    except Exception as e:
        # Limpiar archivo temporal si existe
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass
        
        logger.error("Error saving efemerides data: %s", e, exc_info=True)
        raise


async def upload_efemerides_file(file: UploadFile) -> Dict[str, Any]:
    """Procesa archivo JSON subido y valida estructura.
    
    Args:
        file: Archivo subido
        
    Returns:
        Datos parseados y validados
        
    Raises:
        HTTPException: Si el archivo es demasiado grande, no es JSON válido o no cumple el formato
    """
    # Límite de tamaño: 2 MB (mismo que ICS)
    MAX_FILE_SIZE = 2 * 1024 * 1024  # 2 MB
    
    # Leer contenido
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading file: {e}")
    
    # Validar tamaño
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds maximum ({MAX_FILE_SIZE // (1024 * 1024)} MB)"
        )
    
    # Parsear JSON
    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSON format: {str(e)}"
        )
    
    # Validar estructura
    is_valid, error_msg = validate_efemerides_json(data)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid efemerides format: {error_msg}"
        )
    
    return data

