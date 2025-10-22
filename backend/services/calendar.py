from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timedelta, timezone
from pathlib import Path
from time import monotonic
from typing import Awaitable, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import httpx

from .config import CalendarConfig


class CalendarServiceError(Exception):
    """Generic calendar service error."""


@dataclass
class ParsedCalendarEvent:
    title: str
    start: datetime
    end: Optional[datetime]
    all_day: bool


class CalendarService:
    """Fetch and cache events from a remote iCalendar feed."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=10.0)
        self._cache: Dict[str, Tuple[float, List[ParsedCalendarEvent]]] = {}
        self._timezone = datetime.now().astimezone().tzinfo or timezone.utc

    async def close(self) -> None:
        await self._client.aclose()

    async def events_for_today(self, config: Optional[CalendarConfig]) -> List[ParsedCalendarEvent]:
        if not config or not config.enabled:
            return []

        today = datetime.now(tz=self._timezone).date()
        loader: Callable[[str], Awaitable[str]]
        loader_arg: str
        if config.mode == "ics" and config.icsPath:
            cache_key = self._cache_key_for_path(config.icsPath, today)
            loader = self._load_from_path
            loader_arg = config.icsPath
        elif config.mode == "url" and config.url:
            cache_key = f"{config.url}|{today.isoformat()}"
            loader = self._load_from_url
            loader_arg = str(config.url)
        else:
            return []

        cached = self._cache.get(cache_key)
        now_monotonic = monotonic()
        if cached and now_monotonic - cached[0] < 300:
            return cached[1]

        payload = await loader(loader_arg)

        events = self._parse_ics(payload)
        filtered = self._filter_for_day(events, today)
        filtered.sort(key=lambda event: event.start)
        limit = max(1, min(config.maxEvents or 3, 10))
        limited = filtered[:limit]
        self._cache[cache_key] = (monotonic(), limited)
        return limited

    async def _load_from_url(self, url: str) -> str:
        try:
            response = await self._client.get(url, headers={"Cache-Control": "no-cache"})
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover - network failure path
            raise CalendarServiceError("No se pudo descargar el calendario") from exc
        return response.text

    async def _load_from_path(self, location: str) -> str:
        path = Path(location)
        try:
            data = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise CalendarServiceError("Archivo ICS no disponible")
        except OSError as exc:  # pragma: no cover - permisos insuficientes
            raise CalendarServiceError("No se pudo leer el archivo ICS") from exc
        if not data.strip():
            raise CalendarServiceError("Archivo ICS vacío")
        return data

    def _cache_key_for_path(self, path_value: str, day: date) -> str:
        path = Path(path_value)
        try:
            stat = path.stat()
            stamp = f"{stat.st_mtime_ns}"
        except OSError:
            stamp = "missing"
        return f"file://{path.resolve()}|{stamp}|{day.isoformat()}"

    def _filter_for_day(self, events: List[ParsedCalendarEvent], day: date) -> List[ParsedCalendarEvent]:
        matches: List[ParsedCalendarEvent] = []
        for event in events:
            start_local = event.start.astimezone(self._timezone)
            end_local = event.end.astimezone(self._timezone) if event.end else None
            if event.all_day:
                start_date = start_local.date()
                # iCalendar DTEND for all-day events is exclusive (next day after event ends)
                # So we subtract 1 day to get the actual last day of the event
                if end_local:
                    end_date = end_local.date() - timedelta(days=1)
                else:
                    end_date = start_date
            else:
                start_date = start_local.date()
                end_date = end_local.date() if end_local else start_date

            if start_date <= day <= end_date:
                matches.append(event)
        return matches

    def _parse_ics(self, payload: str) -> List[ParsedCalendarEvent]:
        events: List[ParsedCalendarEvent] = []
        for raw_event in self._extract_event_blocks(payload):
            parsed = self._parse_event_block(raw_event)
            if parsed:
                events.append(parsed)
        return events

    def _extract_event_blocks(self, payload: str) -> List[List[str]]:
        lines = self._unfold(payload)
        blocks: List[List[str]] = []
        current: List[str] = []
        inside = False
        for line in lines:
            if line == "BEGIN:VEVENT":
                current = []
                inside = True
                continue
            if line == "END:VEVENT" and inside:
                blocks.append(current.copy())
                inside = False
                current = []
                continue
            if inside:
                current.append(line)
        return blocks

    def _parse_event_block(self, lines: List[str]) -> Optional[ParsedCalendarEvent]:
        fields: Dict[str, Tuple[Dict[str, str], str]] = {}
        for line in lines:
            if ":" not in line:
                continue
            key_part, value = line.split(":", 1)
            key_parts = key_part.split(";")
            name = key_parts[0].upper()
            params: Dict[str, str] = {}
            for param in key_parts[1:]:
                if "=" in param:
                    p_key, p_value = param.split("=", 1)
                    params[p_key.upper()] = p_value
            fields[name] = (params, value)

        if "SUMMARY" not in fields or "DTSTART" not in fields:
            return None

        summary = fields["SUMMARY"][1]
        dtstart_params, dtstart_value = fields["DTSTART"]
        dtend_params, dtend_value = fields.get("DTEND", ({}, ""))

        all_day = dtstart_params.get("VALUE") == "DATE"
        try:
            start_dt = self._parse_datetime(dtstart_value, dtstart_params.get("TZID"), all_day)
        except ValueError:
            return None
        end_dt = None
        if dtend_value:
            try:
                end_dt = self._parse_datetime(dtend_value, dtend_params.get("TZID"), all_day)
            except ValueError:
                end_dt = None
        elif all_day:
            end_dt = start_dt + timedelta(days=1)

        return ParsedCalendarEvent(title=summary, start=start_dt, end=end_dt, all_day=all_day)

    def _parse_datetime(self, value: str, tzid: Optional[str], all_day: bool) -> datetime:
        if all_day:
            day = datetime.strptime(value, "%Y%m%d").date()
            return datetime.combine(day, dt_time.min, tzinfo=self._timezone)

        is_utc = value.endswith("Z")
        raw_value = value[:-1] if is_utc else value
        dt = self._try_parse_datetime(raw_value)
        if is_utc:
            dt = dt.replace(tzinfo=timezone.utc)
        elif tzid:
            try:
                dt = dt.replace(tzinfo=ZoneInfo(tzid))
            except Exception:  # pragma: no cover - unknown timezone
                dt = dt.replace(tzinfo=self._timezone)
        else:
            dt = dt.replace(tzinfo=self._timezone)
        return dt.astimezone(self._timezone)

    def _try_parse_datetime(self, value: str) -> datetime:
        for fmt in ("%Y%m%dT%H%M%S", "%Y%m%dT%H%M"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        raise ValueError(f"Formato de fecha desconocido: {value}")

    def _unfold(self, payload: str) -> List[str]:
        lines = payload.splitlines()
        unfolded: List[str] = []
        for line in lines:
            if line.startswith(" ") or line.startswith("\t"):
                if unfolded:
                    unfolded[-1] += line[1:]
            else:
                unfolded.append(line.strip())
        return unfolded
