"""Utilities for reading calendar events from ICS sources."""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from icalendar import Calendar

LOGGER = logging.getLogger("pantalla.backend.ics")


class ICSCalendarError(Exception):
    """Base exception for ICS calendar failures."""


class ICSFileError(ICSCalendarError):
    """Raised when the ICS file cannot be read."""


class ICSParseError(ICSCalendarError):
    """Raised when the ICS file content cannot be parsed."""


_ICS_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_LAST_ERROR: Optional[str] = None


def _reset_last_error() -> None:
    global _LAST_ERROR
    _LAST_ERROR = None


def get_last_error() -> Optional[str]:
    """Return the last parsing error message, if any."""

    return _LAST_ERROR


def _set_last_error(message: str) -> None:
    global _LAST_ERROR
    _LAST_ERROR = message


def _normalize_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None

    raw = getattr(value, "dt", value)
    if isinstance(raw, datetime):
        if raw.tzinfo is None:
            return raw.replace(tzinfo=timezone.utc)
        return raw.astimezone(timezone.utc)
    if isinstance(raw, date):
        return datetime.combine(raw, time.min, tzinfo=timezone.utc)
    return None


def _read_ics_from_path(path: Path) -> List[Dict[str, Any]]:
    if not path.exists() or not path.is_file():
        raise ICSFileError(f"ICS file not found: {path}")
    try:
        content = path.read_bytes()
    except OSError as exc:  # noqa: BLE001
        raise ICSFileError(f"Unable to read ICS file {path}: {exc}") from exc

    try:
        calendar = Calendar.from_ical(content)
    except Exception as exc:  # noqa: BLE001
        raise ICSParseError(f"Invalid ICS file {path}: {exc}") from exc

    events: List[Dict[str, Any]] = []
    for component in calendar.walk("VEVENT"):
        start_dt = _normalize_datetime(component.get("dtstart"))
        if start_dt is None:
            LOGGER.debug("Skipping VEVENT without DTSTART in %s", path)
            continue
        end_dt = _normalize_datetime(component.get("dtend")) or start_dt
        summary = component.get("summary")
        location = component.get("location")
        events.append(
            {
                "title": str(summary) if summary is not None else "",
                "start": start_dt,
                "end": end_dt,
                "location": str(location) if location is not None else "",
            }
        )

    return events


def _filter_events(
    events: Iterable[Dict[str, Any]],
    time_min: Optional[datetime],
    time_max: Optional[datetime],
) -> List[Dict[str, Any]]:
    filtered: List[Dict[str, Any]] = []
    for event in events:
        start_dt = event.get("start")
        if not isinstance(start_dt, datetime):
            continue
        if time_min and start_dt < time_min:
            continue
        if time_max and start_dt > time_max:
            continue
        filtered.append(event)
    return filtered


def _serialize_events(events: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    serialized: List[Dict[str, Any]] = []
    for event in events:
        start_dt = event.get("start")
        end_dt = event.get("end")
        serialized.append(
            {
                "title": event.get("title", ""),
                "start": start_dt.isoformat() if isinstance(start_dt, datetime) else "",
                "end": end_dt.isoformat() if isinstance(end_dt, datetime) else "",
                "location": event.get("location", ""),
            }
        )
    return serialized


def fetch_ics_calendar_events(
    url: Optional[str] = None,
    path: Optional[str] = None,
    time_min: Optional[datetime] = None,
    time_max: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Return events from an ICS source, caching by file mtime."""

    _reset_last_error()
    events: List[Dict[str, Any]]

    if url:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise ICSFileError(f"Unsupported ICS URL scheme: {parsed.scheme}")
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise ICSFileError(f"Unable to fetch ICS from {url}: {exc}") from exc
        try:
            calendar = Calendar.from_ical(response.content)
        except Exception as exc:  # noqa: BLE001
            raise ICSParseError(f"Invalid ICS content from {url}: {exc}") from exc
        events = []
        for component in calendar.walk("VEVENT"):
            start_dt = _normalize_datetime(component.get("dtstart"))
            if start_dt is None:
                continue
            end_dt = _normalize_datetime(component.get("dtend")) or start_dt
            summary = component.get("summary")
            location = component.get("location")
            events.append(
                {
                    "title": str(summary) if summary is not None else "",
                    "start": start_dt,
                    "end": end_dt,
                    "location": str(location) if location is not None else "",
                }
            )
    elif path:
        path_obj = Path(path)
        try:
            stat = path_obj.stat()
        except OSError as exc:  # noqa: BLE001
            raise ICSFileError(f"Unable to stat ICS file {path_obj}: {exc}") from exc

        cache_key = str(path_obj)
        cached = _ICS_CACHE.get(cache_key)
        if cached and cached[0] == stat.st_mtime:
            events = [dict(item) for item in cached[1]]
        else:
            events = _read_ics_from_path(path_obj)
            _ICS_CACHE[cache_key] = (stat.st_mtime, [dict(item) for item in events])
    else:
        raise ICSCalendarError("No ICS source provided (url or path required)")

    filtered = _filter_events(events, time_min, time_max)
    filtered.sort(
        key=lambda ev: ev.get("start")
        or datetime.max.replace(tzinfo=timezone.utc)
    )
    serialized = _serialize_events(filtered)
    return serialized


def fetch_ics_calendar_events_safe(
    url: Optional[str] = None,
    path: Optional[str] = None,
    time_min: Optional[datetime] = None,
    time_max: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Wrapper returning [] on error while recording the failure."""

    try:
        return fetch_ics_calendar_events(url=url, path=path, time_min=time_min, time_max=time_max)
    except ICSCalendarError as exc:
        message = str(exc)
        LOGGER.warning("ICS calendar failure: %s", message)
        _set_last_error(message)
        return []
