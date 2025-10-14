"""Daylight saving time helpers for Europe/Madrid."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol, runtime_checkable
from zoneinfo import ZoneInfo
import calendar
import json

TZ_NAME = "Europe/Madrid"
_DST_NOTICE_STATE = Path(__file__).resolve().parent.parent / "storage" / "cache" / "dst_notice.json"


@runtime_checkable
class SpeechQueueLike(Protocol):
    async def enqueue(self, text: str, volume: float = 1.0) -> None:  # pragma: no cover - interface
        ...


def _last_sunday(year: int, month: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    candidate = date(year, month, last_day)
    offset = (candidate.weekday() - 6) % 7  # weekday: 0=Monday, 6=Sunday
    return candidate - timedelta(days=offset)


def _transitions_for_year(year: int) -> list[tuple[date, str, int]]:
    return [
        (_last_sunday(year, 3), "forward", 1),
        (_last_sunday(year, 10), "back", -1),
    ]


def next_transition_info(today: date) -> dict[str, Any]:
    """Return information about the next DST transition from ``today`` onwards."""
    transitions: list[tuple[date, str, int]] = []
    for year in (today.year, today.year + 1):
        transitions.extend(_transitions_for_year(year))
    transitions.sort(key=lambda item: item[0])

    for change_date, kind, delta in transitions:
        if change_date < today:
            continue
        days_left = (change_date - today).days
        return {
            "has_upcoming": True,
            "date": change_date.isoformat(),
            "kind": kind,
            "delta_hours": delta,
            "days_left": days_left,
        }

    # Should not happen with the above logic, but keep fallback for safety.
    return {
        "has_upcoming": False,
        "date": None,
        "kind": None,
        "delta_hours": 0,
        "days_left": None,
    }


def current_time_payload(now: datetime | None = None) -> dict[str, Any]:
    tz = ZoneInfo(TZ_NAME)
    now_dt = now.astimezone(tz) if now else datetime.now(tz)
    offset = now_dt.utcoffset() or timedelta(0)
    return {
        "datetime": now_dt.isoformat(),
        "timestamp": now_dt.timestamp(),
        "timezone": TZ_NAME,
        "utc_offset_seconds": int(offset.total_seconds()),
        "is_dst": bool(now_dt.dst()),
    }


async def maybe_tts_dst_notice(
    queue: SpeechQueueLike | None,
    change_date: date,
    message: str,
    *,
    volume: float = 1.0,
) -> bool:
    """Queue a DST notice via TTS once per change date.

    Returns ``True`` if the message was enqueued or ``False`` when it was skipped
    because it has already been announced or the queue is not available.
    """

    if queue is None:
        return False

    try:
        state_data = json.loads(_DST_NOTICE_STATE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        state_data = {}
    except json.JSONDecodeError:
        state_data = {}

    key = change_date.isoformat()
    if state_data.get("last_date") == key:
        return False

    _DST_NOTICE_STATE.parent.mkdir(parents=True, exist_ok=True)
    try:
        await queue.enqueue(message, volume=volume)
    except Exception:  # pragma: no cover - defensive
        return False

    state_data["last_date"] = key
    _DST_NOTICE_STATE.write_text(json.dumps(state_data), encoding="utf-8")
    return True


__all__ = ["TZ_NAME", "current_time_payload", "maybe_tts_dst_notice", "next_transition_info"]
