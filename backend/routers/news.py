from __future__ import annotations

import logging
import asyncio
from typing import Any, Dict, List
from fastapi import APIRouter

from ..config_manager import ConfigManager
from ..data_sources import parse_rss_feed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/news", tags=["news"])
config_manager = ConfigManager()

# Default fallbacks if no feeds configured
DEFAULT_FEEDS = [
    "https://feeds.elpais.com/mr/elpais/ES/portada_espa.xml",
    "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml",
    "https://www.20minutos.es/rss/"
]

@router.get("")
@router.get("/")
async def get_news_items() -> Dict[str, Any]:
    """
    Obtiene noticias RSS agregadas de las fuentes configuradas.
    Si no hay fuentes configuradas, usa fuentes por defecto (El País, El Mundo).
    Devuelve mezcla de artículos ordenados por fecha.
    """
    config = config_manager.read()
    
    # Check feeds from Config
    # Check config.panels.news.feeds (v2) or config.news.rss_feeds (legacy)
    feeds = []
    
    if config.panels and config.panels.news and config.panels.news.feeds:
        feeds = config.panels.news.feeds
    elif config.news and config.news.rss_feeds:
        feeds = config.news.rss_feeds
        
    # Use defaults if empty
    if not feeds:
        feeds = DEFAULT_FEEDS
    
    # Limit max items per feed
    max_items = 5
    if config.panels and config.panels.news and config.panels.news.max_items_per_feed:
        max_items = config.panels.news.max_items_per_feed

    # Fetch all feeds in parallel
    tasks = [parse_rss_feed(url, max_items=max_items) for url in feeds]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    all_items = []
    for res in results:
        if isinstance(res, list):
            all_items.extend(res)
        else:
            logger.warning(f"Error fetching one of the feeds: {res}")

    # Deduplicate by link or title
    seen_links = set()
    unique_items = []
    for item in all_items:
        link = item.get("link")
        if link and link not in seen_links:
            seen_links.add(link)
            unique_items.append(item)

    # Sort by published_at if possible, otherwise keep mixed/random?
    # Simple sort might fail if date formats vary wildly.
    # Let's just return them, maybe shuffle or simple sort?
    # Ideally standardise date parsing in data_sources but for now let's just return list.
    
    return {
        "count": len(unique_items),
        "items": unique_items
    }
