from datetime import datetime, timedelta
import logging
import httpx
from typing import List, Dict, Optional
from icalendar import Calendar
from ..secret_store import SecretStore

logger = logging.getLogger(__name__)
secret_store = SecretStore()

# In-memory cache
_events_cache = {
    "data": [],
    "last_fetch": datetime.min
}
CACHE_DURATION = timedelta(minutes=15)

async def fetch_calendar_events() -> List[Dict]:
    """
    Fetches events from the configured ICS URL (stored in secrets).
    Returns a list of dicts: {summary, start, end, location, ...}
    """
    global _events_cache
    now = datetime.now()
    
    # Check cache
    if now - _events_cache["last_fetch"] < CACHE_DURATION and _events_cache["data"]:
        return _events_cache["data"]

    # Get URL from secrets
    ics_url = secret_store.get_secret("calendar_ics_url")
    if not ics_url:
        logger.warning("No calendar_ics_url in secrets.")
        return []

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(ics_url, timeout=10.0)
            resp.raise_for_status()
            
            cal = Calendar.from_ical(resp.content)
            events = []
            
            for component in cal.walk('vevent'):
                # Extract basic fields
                summary = str(component.get('summary'))
                start = component.get('dtstart').dt
                end = component.get('dtend').dt if component.get('dtend') else start
                
                # Normalize types (datetime vs date)
                if not isinstance(start, datetime):
                     start = datetime.combine(start, datetime.min.time())
                if not isinstance(end, datetime):
                     end = datetime.combine(end, datetime.min.time())
                
                # Filter past events (keep today's)
                if end < now - timedelta(days=1):
                    continue
                    
                # Limit to 30 days ahead
                if start > now + timedelta(days=30):
                    continue

                events.append({
                    "summary": summary,
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "description": str(component.get('description', '')),
                    "location": str(component.get('location', ''))
                })
            
            # Sort by start date
            events.sort(key=lambda x: x['start'])
            
            # Update cache
            _events_cache = {
                "data": events,
                "last_fetch": now
            }
            
            return events

    except Exception as e:
        logger.error(f"Error fetching calendar: {e}")
        return []
