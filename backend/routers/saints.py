from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any, Union
import logging
from ..data_sources import get_saints_today
from ..services.saints_service import enrich_saints

router = APIRouter(
    prefix="/api/saints",
    tags=["saints"]
)

logger = logging.getLogger(__name__)

@router.get("", response_model=List[Union[str, Dict[str, Any]]])
async def get_saints():
    """
    Get saints for today.
    Tries to fetch from Wikipedia first (comprehensive 365-day coverage).
    Falls back to static list if offline or API fails.
    """
    from datetime import datetime
    try:
        # Try dynamic fetch first (Source of Truth)
        from ..services.saints_service import fetch_daily_saints_from_wiki, enrich_saints
        
        wiki_saints = await fetch_daily_saints_from_wiki(datetime.now())
        
        if wiki_saints:
            # Enrich the first few
            return await enrich_saints(wiki_saints)
            
        # Fallback to static data
        logger.info("Wikipedia saints fetch returned empty, using fallback.")
        saints_basic = get_saints_today(include_info=False) 
        return await enrich_saints(saints_basic)

    except Exception as e:
        logger.error(f"Error fetching saints: {e}")
        # Build a safe fallback
        try:
             return get_saints_today(include_info=False)
        except:
             return []
