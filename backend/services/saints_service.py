import logging
import httpx
import re
import asyncio
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Simple in-memory cache: { "Saint Name": { "data": {...}, "expires": datetime } }
_WIKIPEDIA_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL = timedelta(hours=24)

MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
]

async def fetch_daily_saints_from_wiki(date_obj: datetime) -> List[str]:
    """
    Fetches the list of saints for a given date from Wikipedia's 'Santoral católico' section.
    URL format: https://es.wikipedia.org/wiki/10_de_diciembre
    """
    day = date_obj.day
    month_name = MONTHS_ES[date_obj.month - 1]
    url = f"https://es.wikipedia.org/wiki/{day}_de_{month_name}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; PantallaReloj/1.0; +http://example.com)"
    }

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, headers=headers) as client:
        try:
            response = await client.get(url)
            if response.status_code != 200:
                logger.warning(f"Wikipedia returned {response.status_code} for {url}")
                return []

            soup = BeautifulSoup(response.content, "html.parser")
            
            # Find the "Santoral" headline
            # It usually has an ID like "Santoral" or "Santoral_católico"
            # We look for a span with that ID, then find the parent h2, then the next sibling ul
            
            santoral_node = soup.find(id=lambda x: x and "antoral" in x)
            if not santoral_node:
                # Try finding h2 directly containing text "Santoral"
                for h2 in soup.find_all("h2"):
                    if "Santoral" in h2.get_text():
                        santoral_node = h2
                        break
            
            if not santoral_node:
                logger.warning(f"Could not find 'Santoral' section in {url}")
                return []

            # If we found the span/id, get the parent heading
            heading = santoral_node
            if santoral_node.name != "h2":
                heading = santoral_node.find_parent("h2") or santoral_node.find_parent("h3")

            if not heading:
                logger.warning("Found Santoral ID but no heading parent")
                return []

            # Determine if we are looking at standard Wikipedia structure
            # The structure is usually <h2>...</h2> <ul>...</ul>
            # Sometimes there is introductory text or dl before ul
            
            saints = []
            next_elem = heading.find_next_sibling()
            
            # Traverse siblings until we find a UL or hit another H2
            while next_elem and next_elem.name != "h2":
                if next_elem.name == "ul":
                    for li in next_elem.find_all("li"):
                        text = li.get_text()
                        # Clean up text: "San Fulano, obispo" -> "San Fulano"
                        # Often details follow a comma or are in parentheses
                        # We want the name mostly.
                        
                        # Remove citations [1], [2]
                        text = re.sub(r'\[\d+\]', '', text).strip()
                        
                        # Strategy: Take the first part before comma if commonly formatted
                        # But some names are "San Juan de la Cruz".
                        # Let's keep the full name before the comma if a comma exists and the second part looks like a title
                        
                        if "," in text:
                            parts = text.split(",")
                            # Heuristic: if first part is long, keep it. 
                            name_part = parts[0].strip()
                            saints.append(name_part)
                        else:
                            saints.append(text)
                    
                    # Usually only one UL follows, or multiple ULs for different regions?
                    # Typically one UL for the list.
                    break
                next_elem = next_elem.find_next_sibling()

            return saints

        except Exception as e:
            logger.error(f"Error scraping saints from Wikipedia: {e}")
            return []


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
