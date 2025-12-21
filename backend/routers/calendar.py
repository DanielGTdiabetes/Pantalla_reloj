from fastapi import APIRouter
from typing import List, Dict, Any
from ..services.calendar_service import fetch_calendar_events

router = APIRouter(
    prefix="/api/calendar",
    tags=["calendar"]
)

@router.get("/events")
async def get_events():
    """Get upcoming calendar events."""
    return await fetch_calendar_events()
