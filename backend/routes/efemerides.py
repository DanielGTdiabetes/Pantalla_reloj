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

import requests
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


def fetch_wikimedia_onthisday(
    month: int,
    day: int,
    language: str = "es",
    event_type: str = "all",
    api_user_agent: str = "PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)",
    max_items: int = 10,
    timeout_seconds: int = 10
) -> Dict[str, Any]:
    """Obtiene efemérides desde la API de Wikimedia OnThisDay.
    
    Args:
        month: Mes (1-12)
        day: Día (1-31)
        language: Código de idioma ISO 639-1 (por defecto: "es")
        event_type: Tipo de eventos: "all", "events", "births", "deaths", "holidays"
        api_user_agent: User-Agent para la API de Wikimedia
        max_items: Máximo de items por tipo a retornar
        timeout_seconds: Timeout en segundos para la petición
        
    Returns:
        Diccionario con estructura normalizada:
        {
            "events": ["texto1", "texto2", ...],
            "births": ["texto1", "texto2", ...],
            "deaths": ["texto1", "texto2", ...],
            "holidays": ["texto1", "texto2", ...]
        }
    """
    # Validar mes y día
    if not (1 <= month <= 12):
        raise ValueError(f"Month must be between 1 and 12, got: {month}")
    if not (1 <= day <= 31):
        raise ValueError(f"Day must be between 1 and 31, got: {day}")
    
    # Construir URL
    base_url = "https://api.wikimedia.org/feed/v1/wikipedia"
    url = f"{base_url}/{language}/onthisday/{event_type}/{month:02d}/{day:02d}"
    
    # Headers con Api-User-Agent
    headers = {
        "Api-User-Agent": api_user_agent,
        "Accept": "application/json"
    }
    
    try:
        # Realizar petición
        response = requests.get(url, headers=headers, timeout=timeout_seconds)
        response.raise_for_status()
        
        data = response.json()
        
        # Normalizar respuesta
        normalized = {
            "events": [],
            "births": [],
            "deaths": [],
            "holidays": []
        }
        
        # Mapear datos de Wikimedia a nuestro formato
        if event_type == "all":
            # Si pedimos "all", la respuesta tiene todos los tipos
            for event_type_key in ["events", "births", "deaths", "holidays"]:
                items = data.get(event_type_key, [])
                for item in items[:max_items]:
                    text = item.get("text", "")
                    year = item.get("year", "")
                    if text:
                        # Formato: "YYYY: texto"
                        if year:
                            normalized[event_type_key].append(f"{year}: {text}")
                        else:
                            normalized[event_type_key].append(text)
        else:
            # Si pedimos un tipo específico, solo ese tipo está en la respuesta
            items = data.get(event_type, [])
            for item in items[:max_items]:
                text = item.get("text", "")
                year = item.get("year", "")
                if text:
                    if year:
                        normalized[event_type].append(f"{year}: {text}")
                    else:
                        normalized[event_type].append(text)
        
        return normalized
        
    except requests.exceptions.Timeout:
        logger.warning(f"Timeout fetching Wikimedia OnThisDay for {month:02d}-{day:02d}")
        return {"events": [], "births": [], "deaths": [], "holidays": []}
    except requests.exceptions.RequestException as e:
        logger.warning(f"Error fetching Wikimedia OnThisDay: {e}")
        return {"events": [], "births": [], "deaths": [], "holidays": []}
    except (KeyError, ValueError, TypeError) as e:
        logger.warning(f"Error parsing Wikimedia OnThisDay response: {e}")
        return {"events": [], "births": [], "deaths": [], "holidays": []}


def get_efemerides_for_date(
    data_path: Optional[str] = None,
    target_date: Optional[date] = None,
    tz_str: str = "Europe/Madrid",
    provider: str = "local",
    wikimedia_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Obtiene efemérides para una fecha específica.
    
    Args:
        data_path: Ruta al archivo JSON de efemérides (solo para provider="local")
        target_date: Fecha objetivo (por defecto: hoy en timezone especificado)
        tz_str: Timezone a usar (por defecto: Europe/Madrid)
        provider: Proveedor a usar: "local" o "wikimedia"
        wikimedia_config: Configuración para proveedor Wikimedia (solo si provider="wikimedia")
        
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
    
    # Si el proveedor es Wikimedia, usar la API
    if provider == "wikimedia":
        if not wikimedia_config:
            wikimedia_config = {
                "language": "es",
                "event_type": "all",
                "api_user_agent": "PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)",
                "max_items": 10,
                "timeout_seconds": 10
            }
        
        month = target_date.month
        day = target_date.day
        
        wikimedia_data = fetch_wikimedia_onthisday(
            month=month,
            day=day,
            language=wikimedia_config.get("language", "es"),
            event_type=wikimedia_config.get("event_type", "all"),
            api_user_agent=wikimedia_config.get("api_user_agent", "PantallaReloj/1.0"),
            max_items=wikimedia_config.get("max_items", 10),
            timeout_seconds=wikimedia_config.get("timeout_seconds", 10)
        )
        
        # Combinar todos los tipos en una sola lista
        all_items = []
        for event_type in ["events", "births", "deaths", "holidays"]:
            all_items.extend(wikimedia_data.get(event_type, []))
        
        return {
            "date": target_date.isoformat(),
            "count": len(all_items),
            "items": all_items,
            "source": "wikimedia",
            "by_type": wikimedia_data  # Incluir datos por tipo para uso futuro
        }
    
    # Proveedor local (código original)
    if not data_path:
        data_path = "/var/lib/pantalla-reloj/data/efemerides.json"
    
    # Formatear fecha como "MM-DD"
    date_key = target_date.strftime("%m-%d")
    
    # Cargar datos
    all_data = load_efemerides_data(data_path)
    
    # Obtener eventos para esta fecha
    events = all_data.get(date_key, [])
    
    return {
        "date": target_date.isoformat(),
        "count": len(events),
        "items": events,
        "source": "local"
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

