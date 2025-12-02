import logging
import httpx
import asyncio
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Simple in-memory cache: { "Saint Name": { "data": {...}, "expires": datetime } }
_WIKIPEDIA_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL = timedelta(hours=24)

async def fetch_saint_info_wikipedia(name: str) -> Dict[str, Any]:
    """
    Fetches biography and image for a saint from Wikipedia API.
    """
    # Check cache
    if name in _WIKIPEDIA_CACHE:
        entry = _WIKIPEDIA_CACHE[name]
        if datetime.now() < entry["expires"]:
            return entry["data"]
        else:
            del _WIKIPEDIA_CACHE[name]

    # Clean name for search (remove parentheticals, etc.)
    clean_name = name.split(",")[0].strip()
    
    # Try different title variations
    # Wikipedia titles usually start with "San", "Santa", "Santo"
    # If the name already has it, try as is. If not, try adding prefixes.
    variations = []
    if any(clean_name.lower().startswith(p) for p in ["san ", "santa ", "santo "]):
        variations.append(clean_name)
        # Also try replacing spaces with underscores just in case, though API handles it
        variations.append(clean_name.replace(" ", "_"))
    else:
        variations.append(f"San {clean_name}")
        variations.append(f"Santa {clean_name}")
        variations.append(f"Santo {clean_name}")
        variations.append(clean_name) # Try raw name as last resort

    headers = {
        "User-Agent": "PantallaReloj/1.0 (daniel@example.com)"  # Replace with valid contact if possible, or generic but specific
    }

    async with httpx.AsyncClient(timeout=5.0, follow_redirects=True, headers=headers) as client:
        for title in variations:
            try:
                # Wikipedia Summary API
                url = f"https://es.wikipedia.org/api/rest_v1/page/summary/{title}"
                response = await client.get(url)
                
                if response.status_code == 200:
                    data = response.json()
                    
                    # Check if it's a disambiguation page
                    if data.get("type") == "disambiguation":
                        continue
                        
                    result = {
                        "name": name,
                        "bio": data.get("extract", "")[:300] + "..." if len(data.get("extract", "")) > 300 else data.get("extract", ""),
                        "image": data.get("originalimage", {}).get("source") if data.get("originalimage") else None,
                        "url": data.get("content_urls", {}).get("desktop", {}).get("page", "")
                    }
                    
                    # Cache result
                    _WIKIPEDIA_CACHE[name] = {
                        "data": result,
                        "expires": datetime.now() + CACHE_TTL
                    }
                    return result
                    
            except Exception as e:
                logger.warning(f"Error fetching Wikipedia info for {title}: {e}")
                continue

    # If nothing found, return basic info
    result = {"name": name, "bio": None, "image": None}
    _WIKIPEDIA_CACHE[name] = {
        "data": result,
        "expires": datetime.now() + CACHE_TTL
    }
    return result

async def enrich_saints(names: List[str]) -> List[Dict[str, Any]]:
    """
    Enriches a list of saint names with Wikipedia info.
    Limits concurrency to avoid rate limits.
    """
    results = []
    # Process only the first 3 saints to avoid UI clutter and API spam
    for name in names[:3]:
        info = await fetch_saint_info_wikipedia(name)
        results.append(info)
    
    # For the rest, just add basic info
    for name in names[3:]:
        results.append({"name": name, "bio": None, "image": None})
        
    return results
