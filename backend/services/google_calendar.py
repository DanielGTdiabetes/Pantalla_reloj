from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from zoneinfo import ZoneInfo

from urllib.parse import quote

from .google_oauth import GoogleOAuthDeviceFlowManager, GoogleOAuthError

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / "storage" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_PATH = CACHE_DIR / "calendar_google_upcoming.json"
CACHE_TTL_SECONDS = 300
HTTP_TIMEOUT = httpx.Timeout(10.0, connect=10.0, read=10.0)
CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList"
EVENTS_URL_TEMPLATE = "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
MAX_RESULTS = 40


class GoogleCalendarError(Exception):
    """Raised when the Google Calendar service fails."""


@dataclass
class CachedPayload:
    payload: Dict[str, Any]
    expires_at: float
    calendar_id: str
    days: int
    timezone: str


class GoogleCalendarService:
    def __init__(
        self,
        oauth_manager: GoogleOAuthDeviceFlowManager,
        *,
        cache_path: Path = CACHE_PATH,
        cache_ttl: int = CACHE_TTL_SECONDS,
    ) -> None:
        self._oauth = oauth_manager
        self._cache_path = cache_path
        self._cache_ttl = max(60, cache_ttl)
        self._client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
        self._cache_lock = asyncio.Lock()

    async def close(self) -> None:
        await self._client.aclose()

    async def list_calendars(self) -> List[Dict[str, Any]]:
        for attempt in range(2):
            try:
                await self._oauth.get_access_token(force_refresh=attempt > 0)
                headers = self._oauth.authorization_header()
            except GoogleOAuthError as exc:
                raise GoogleCalendarError(str(exc)) from exc

            page_token: Optional[str] = None
            calendars: List[Dict[str, Any]] = []
            unauthorized = False
            while True:
                params: Dict[str, Any] = {"maxResults": MAX_RESULTS}
                if page_token:
                    params["pageToken"] = page_token
                try:
                    response = await self._client.get(CALENDAR_LIST_URL, headers=headers, params=params)
                except httpx.HTTPError as exc:  # pragma: no cover - red externa
                    logger.error("Google Calendar: fallo de red al listar calendarios: %s", exc)
                    raise GoogleCalendarError("No se pudo listar los calendarios de Google") from exc

                if response.status_code == 401 and attempt == 0:
                    unauthorized = True
                    logger.info("Google Calendar: token caducado, reintentando")
                    break
                if response.status_code != 200:
                    logger.error(
                        "Google Calendar: respuesta inesperada %s al listar calendarios", response.status_code
                    )
                    raise GoogleCalendarError("No se pudo listar los calendarios de Google")

                payload = response.json()
                for item in payload.get("items", []):
                    if not isinstance(item, dict):
                        continue
                    calendars.append(
                        {
                            "id": item.get("id"),
                            "summary": item.get("summary"),
                            "primary": bool(item.get("primary")),
                        }
                    )
                page_token = payload.get("nextPageToken")
                if not page_token:
                    logger.info("Google Calendar: listado %d calendarios", len(calendars))
                    return calendars

            if unauthorized and attempt == 0:
                page_token = None
                continue
        raise GoogleCalendarError("No se pudo renovar el token de Google Calendar")

    async def upcoming_events(
        self,
        calendar_id: str,
        *,
        days: int,
        timezone_name: str,
    ) -> Dict[str, Any]:
        tzinfo = _safe_timezone(timezone_name)
        now = datetime.now(tz=tzinfo)
        async with self._cache_lock:
            cached = self._load_cache()
            if (
                cached
                and cached.calendar_id == calendar_id
                and cached.days == days
                and cached.timezone == timezone_name
                and time.time() < cached.expires_at
            ):
                payload = dict(cached.payload)
                payload["cached"] = True
                return payload

        events_payload = await self._fetch_remote_events(calendar_id, days=days, tzinfo=tzinfo)
        payload = {
            "provider": "google",
            "calendarId": calendar_id,
            "items": events_payload,
            "updated_at": int(time.time()),
            "cached": False,
        }

        async with self._cache_lock:
            self._store_cache(payload, calendar_id=calendar_id, days=days, timezone_name=timezone_name)

        return payload

    async def _fetch_remote_events(
        self,
        calendar_id: str,
        *,
        days: int,
        tzinfo: ZoneInfo,
    ) -> List[Dict[str, Any]]:
        time_min = datetime.now(tz=tzinfo)
        time_max = time_min + timedelta(days=days)

        params = {
            "singleEvents": "true",
            "orderBy": "startTime",
            "timeMin": _format_datetime(time_min),
            "timeMax": _format_datetime(time_max),
            "maxResults": MAX_RESULTS,
        }

        events: List[Dict[str, Any]] = []
        page_token: Optional[str] = None
        for attempt in range(2):
            try:
                await self._oauth.get_access_token(force_refresh=attempt > 0)
                headers = self._oauth.authorization_header()
            except GoogleOAuthError as exc:
                raise GoogleCalendarError(str(exc)) from exc

            unauthorized = False
            while True:
                query = dict(params)
                if page_token:
                    query["pageToken"] = page_token
                encoded_calendar = quote(calendar_id, safe="@._-+/=%")
                url = EVENTS_URL_TEMPLATE.format(calendar_id=encoded_calendar)
                try:
                    response = await self._client.get(url, headers=headers, params=query)
                except httpx.HTTPError as exc:  # pragma: no cover - red externa
                    logger.error("Google Calendar: fallo de red al obtener eventos: %s", exc)
                    raise GoogleCalendarError("No se pudieron obtener eventos del calendario") from exc

                if response.status_code == 401 and attempt == 0:
                    unauthorized = True
                    logger.info("Google Calendar: token caducado al obtener eventos, reintentando")
                    break
                if response.status_code != 200:
                    logger.error(
                        "Google Calendar: respuesta inesperada %s al obtener eventos", response.status_code
                    )
                    raise GoogleCalendarError("No se pudieron obtener eventos del calendario")

                data = response.json()
                for item in data.get("items", []):
                    event = _normalize_event(item, tzinfo)
                    if event:
                        events.append(event)
                page_token = data.get("nextPageToken")
                if not page_token:
                    logger.info("Google Calendar: fetched %d items for %s", len(events), calendar_id)
                    return events

            if unauthorized and attempt == 0:
                page_token = None
                continue
        raise GoogleCalendarError("No se pudo renovar el token de Google Calendar")

    def _load_cache(self) -> Optional[CachedPayload]:
        if not self._cache_path.exists():
            return None
        try:
            raw = self._cache_path.read_text(encoding="utf-8")
            data = json.loads(raw)
            payload = data.get("payload")
            if not isinstance(payload, dict):
                return None
            return CachedPayload(
                payload=payload,
                expires_at=float(data.get("expires_at", 0.0)),
                calendar_id=str(data.get("calendar_id", "")),
                days=int(data.get("days", 0)),
                timezone=str(data.get("timezone", "")),
            )
        except (OSError, ValueError):
            return None

    def _store_cache(
        self,
        payload: Dict[str, Any],
        *,
        calendar_id: str,
        days: int,
        timezone_name: str,
    ) -> None:
        cache_entry = {
            "payload": payload,
            "expires_at": time.time() + self._cache_ttl,
            "calendar_id": calendar_id,
            "days": days,
            "timezone": timezone_name,
        }
        tmp_path = self._cache_path.with_suffix(".tmp")
        try:
            with tmp_path.open("w", encoding="utf-8") as handle:
                json.dump(cache_entry, handle, ensure_ascii=False)
            tmp_path.replace(self._cache_path)
        except OSError:
            logger.debug("Google Calendar: no se pudo escribir caché", exc_info=True)
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:  # pragma: no cover - best effort
                pass


def _safe_timezone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:  # pragma: no cover - fallback
        return ZoneInfo("UTC")


def _format_datetime(value: datetime) -> str:
    iso = value.isoformat()
    if value.tzinfo is None:
        return f"{iso}+00:00"
    return iso


def _normalize_event(item: Dict[str, Any], tzinfo: ZoneInfo) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    summary = item.get("summary") or item.get("description")
    if not isinstance(summary, str):
        summary = "Sin título"

    start_info = item.get("start") or {}
    end_info = item.get("end") or {}

    start_dt, all_day = _parse_event_datetime(start_info, tzinfo)
    if not start_dt:
        return None
    end_dt, _ = _parse_event_datetime(end_info, tzinfo, all_day=all_day, default_start=start_dt)
    if all_day:
        if end_dt is None:
            end_dt = start_dt + timedelta(days=1)
    else:
        if end_dt is None:
            end_dt = start_dt

    location = item.get("location") if isinstance(item.get("location"), str) else None
    status = item.get("status") if isinstance(item.get("status"), str) else "confirmed"

    return {
        "id": item.get("id"),
        "title": summary,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat() if end_dt else None,
        "allDay": all_day,
        "location": location,
        "status": status,
    }


def _parse_event_datetime(
    info: Dict[str, Any],
    tzinfo: ZoneInfo,
    *,
    all_day: bool = False,
    default_start: Optional[datetime] = None,
) -> tuple[Optional[datetime], bool]:
    if not isinstance(info, dict):
        return default_start, all_day
    if "dateTime" in info:
        raw = info.get("dateTime")
        if isinstance(raw, str):
            try:
                dt = _parse_rfc3339(raw)
            except ValueError:
                return default_start, all_day
            tz_override = info.get("timeZone")
            if isinstance(tz_override, str) and tz_override:
                try:
                    dt = dt.astimezone(ZoneInfo(tz_override))
                except Exception:  # pragma: no cover - fallback
                    dt = dt.astimezone(tzinfo)
            else:
                dt = dt.astimezone(tzinfo)
            return dt, False
        return default_start, all_day
    if "date" in info:
        raw = info.get("date")
        if isinstance(raw, str):
            try:
                day = datetime.fromisoformat(raw).date()
            except ValueError:
                return default_start, True
            dt = datetime.combine(day, datetime.min.time(), tzinfo)
            return dt, True
    return default_start, all_day


def _parse_rfc3339(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)
