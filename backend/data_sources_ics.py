"""Módulo para leer eventos desde archivos ICS (iCalendar)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests


def _parse_ics_content(content: str) -> List[Dict[str, Any]]:
    """Parsea el contenido de un archivo ICS y extrae eventos.
    
    Args:
        content: Contenido del archivo ICS
        
    Returns:
        Lista de eventos con formato {title, start, end, location}
    """
    events = []
    
    # Buscar bloques VEVENT
    vevent_pattern = re.compile(r'BEGIN:VEVENT(.*?)END:VEVENT', re.DOTALL | re.MULTILINE)
    vevents = vevent_pattern.findall(content)
    
    for vevent in vevents:
        event: Dict[str, Any] = {
            "title": "",
            "start": "",
            "end": "",
            "location": "",
        }
        
        # Extraer SUMMARY (título)
        summary_match = re.search(r'SUMMARY[;:]?(.*?)(?:\r?\n|$)', vevent, re.IGNORECASE | re.MULTILINE)
        if summary_match:
            event["title"] = summary_match.group(1).strip()
        
        # Extraer DTSTART (fecha inicio)
        dtstart_match = re.search(r'DTSTART[;:]?(?:;TZID=([^:]+))?:(.*?)(?:\r?\n|$)', vevent, re.IGNORECASE | re.MULTILINE)
        if dtstart_match:
            dtstart_str = dtstart_match.group(2).strip()
            event["start"] = _parse_ics_datetime(dtstart_str)
        
        # Extraer DTEND (fecha fin)
        dtend_match = re.search(r'DTEND[;:]?(?:;TZID=([^:]+))?:(.*?)(?:\r?\n|$)', vevent, re.IGNORECASE | re.MULTILINE)
        if dtend_match:
            dtend_str = dtend_match.group(2).strip()
            event["end"] = _parse_ics_datetime(dtend_str)
        else:
            # Si no hay DTEND, usar DTSTART
            event["end"] = event["start"]
        
        # Extraer LOCATION
        location_match = re.search(r'LOCATION[;:]?(.*?)(?:\r?\n|$)', vevent, re.IGNORECASE | re.MULTILINE)
        if location_match:
            event["location"] = location_match.group(1).strip()
        
        # Solo añadir si tiene título o fecha válida
        if event["title"] or event["start"]:
            events.append(event)
    
    return events


def _parse_ics_datetime(dt_str: str) -> str:
    """Parsea una fecha/hora ICS y la convierte a ISO.
    
    Formatos soportados:
    - YYYYMMDDTHHMMSSZ (UTC)
    - YYYYMMDDTHHMMSS (local sin TZ)
    - YYYYMMDD (solo fecha)
    
    Args:
        dt_str: String de fecha/hora ICS
        
    Returns:
        String ISO8601
    """
    dt_str = dt_str.strip()
    
    # Formato UTC: YYYYMMDDTHHMMSSZ
    if len(dt_str) == 16 and dt_str.endswith("Z"):
        try:
            year = int(dt_str[0:4])
            month = int(dt_str[4:6])
            day = int(dt_str[6:8])
            hour = int(dt_str[9:11])
            minute = int(dt_str[11:13])
            second = int(dt_str[13:15])
            dt = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
            return dt.isoformat()
        except (ValueError, IndexError):
            pass
    
    # Formato local: YYYYMMDDTHHMMSS
    if len(dt_str) >= 15 and "T" in dt_str:
        try:
            date_part, time_part = dt_str.split("T")
            if len(date_part) == 8:
                year = int(date_part[0:4])
                month = int(date_part[4:6])
                day = int(date_part[6:8])
                if len(time_part) >= 6:
                    hour = int(time_part[0:2])
                    minute = int(time_part[2:4])
                    second = int(time_part[4:6]) if len(time_part) >= 6 else 0
                    dt = datetime(year, month, day, hour, minute, second)
                    return dt.isoformat()
        except (ValueError, IndexError):
            pass
    
    # Formato solo fecha: YYYYMMDD
    if len(dt_str) == 8:
        try:
            year = int(dt_str[0:4])
            month = int(dt_str[4:6])
            day = int(dt_str[6:8])
            dt = datetime(year, month, day)
            return dt.date().isoformat()
        except (ValueError, IndexError):
            pass
    
    # Fallback: devolver como está
    return dt_str


def fetch_ics_calendar_events(
    url: Optional[str] = None,
    path: Optional[str] = None,
    time_min: Optional[datetime] = None,
    time_max: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Obtiene eventos desde un archivo ICS (URL o path local).
    
    Args:
        url: URL HTTP/HTTPS del archivo ICS
        path: Ruta local del archivo ICS
        time_min: Fecha mínima (opcional, para filtrar)
        time_max: Fecha máxima (opcional, para filtrar)
        
    Returns:
        Lista de eventos con formato {title, start, end, location}
    """
    content: Optional[str] = None
    
    # Leer desde URL
    if url:
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            content = response.text
        except requests.RequestException as exc:
            print(f"Error fetching ICS from URL {url}: {exc}")
            return []
    
    # Leer desde path local
    elif path:
        try:
            ics_path = Path(path)
            if not ics_path.exists():
                print(f"ICS file not found: {path}")
                return []
            if not ics_path.is_file():
                print(f"ICS path is not a file: {path}")
                return []
            content = ics_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            print(f"Error reading ICS file {path}: {exc}")
            return []
    
    else:
        print("ICS calendar: neither url nor path provided")
        return []
    
    if not content:
        return []
    
    # Parsear eventos
    all_events = _parse_ics_content(content)
    
    # Filtrar por rango de fechas si se proporcionan
    if time_min or time_max:
        filtered_events = []
        for event in all_events:
            start_str = event.get("start", "")
            if not start_str:
                continue
            
            try:
                # Intentar parsear como datetime o date
                if "T" in start_str:
                    event_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                else:
                    event_start = datetime.fromisoformat(start_str + "T00:00:00")
                
                # Asegurar timezone si no tiene
                if event_start.tzinfo is None:
                    event_start = event_start.replace(tzinfo=timezone.utc)
                
                # Filtrar
                if time_min and event_start < time_min:
                    continue
                if time_max and event_start > time_max:
                    continue
                
                filtered_events.append(event)
            except (ValueError, AttributeError):
                # Si no se puede parsear, incluir de todos modos
                filtered_events.append(event)
        
        return filtered_events
    
    return all_events

