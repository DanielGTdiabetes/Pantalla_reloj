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
    """
    try:
        # Get basic saint names
        saints_basic = get_saints_today(include_info=False) # returns List[str]
        
        # Enrich the first few ones with Wikipedia info
        enriched_saints = await enrich_saints(saints_basic)
        
        return enriched_saints
    except Exception as e:
        logger.error(f"Error fetching saints: {e}")
        # Build a safe fallback
        try:
             return get_saints_today(include_info=False)
        except:
             return []
