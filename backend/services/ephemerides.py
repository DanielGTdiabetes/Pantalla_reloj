"""
Servicio para obtener efemérides históricas desde Wikimedia Feed API - OnThisDay.
Proporciona un endpoint REST /api/ephemerides con formato JSON normalizado.
"""
from __future__ import annotations

import datetime
import logging
from functools import lru_cache
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

from ..cache import CacheStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ephemerides", tags=["ephemerides"])

WIKI_API_BASE = "https://api.wikimedia.org/feed/v1/wikipedia/{lang}/onthisday/{type}/{month}/{day}"
API_USER_AGENT = "PantallaReloj/1.0 (https://github.com/DanielGTdiabetes/Pantalla_reloj; contact@example.com)"

# Cache store global (se inicializará en main.py)
cache_store: Optional[CacheStore] = None


@lru_cache(maxsize=2)
def _today() -> tuple[int, int]:
    """Obtiene mes y día de hoy (cacheado para evitar llamadas repetidas)."""
    now = datetime.date.today()
    return now.month, now.day


def _normalize_wikimedia_item(
    item: Dict[str, Any], 
    category: str,
    lang: str
) -> Dict[str, Any]:
    """
    Normaliza un item de la respuesta de Wikimedia a nuestro formato.
    
    Args:
        item: Item de la respuesta de Wikimedia
        category: Categoría del item ("event", "birth", "death", "holiday")
        lang: Idioma usado para construir URLs
        
    Returns:
        Diccionario normalizado con year, text, category, page_title, page_url, thumbnail
    """
    # Obtener página (si existe)
    pages = item.get("pages", [])
    page = pages[0] if pages else {}
    
    # Extraer información de la página
    titles = page.get("titles", {})
    page_title = titles.get("normalized") or titles.get("display") or ""
    
    # Construir URL de la página
    content_urls = page.get("content_urls", {})
    lang_urls = content_urls.get(lang, {})
    page_url = lang_urls.get("page") or ""
    
    # Obtener thumbnail
    thumbnail_obj = page.get("thumbnail", {})
    thumbnail = thumbnail_obj.get("source", "") if thumbnail_obj else ""
    
    return {
        "year": item.get("year"),
        "text": item.get("text", ""),
        "category": category,
        "page_title": page_title,
        "page_url": page_url,
        "thumbnail": thumbnail,
    }


async def _fetch_wikimedia_api(
    month: int,
    day: int,
    lang: str = "es",
    event_type: str = "all",
    retry_en: bool = True
) -> Dict[str, Any]:
    """
    Obtiene datos de la API de Wikimedia OnThisDay.
    
    Args:
        month: Mes (1-12)
        day: Día (1-31)
        lang: Idioma ISO ("es", "en", etc.)
        event_type: Tipo de eventos ("all", "events", "births", "deaths", "holidays")
        retry_en: Si falla en el idioma solicitado, intentar en inglés
        
    Returns:
        Diccionario con la respuesta de la API
        
    Raises:
        httpx.HTTPStatusError: Si la petición falla
    """
    url = WIKI_API_BASE.format(
        lang=lang,
        type=event_type,
        month=f"{month:02d}",
        day=f"{day:02d}"
    )
    
    headers = {
        "Api-User-Agent": API_USER_AGENT,
        "Accept": "application/json"
    }
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            # Si falla y no es inglés, intentar en inglés
            if retry_en and lang != "en" and e.response.status_code >= 400:
                logger.warning(f"Fallo obteniendo efemérides en {lang}, intentando inglés...")
                return await _fetch_wikimedia_api(month, day, lang="en", event_type=event_type, retry_en=False)
            raise
        except httpx.RequestError as e:
            logger.error(f"Error de red obteniendo efemérides: {e}")
            raise


def _parse_wikimedia_response(
    data: Dict[str, Any],
    event_type: str,
    lang: str
) -> List[Dict[str, Any]]:
    """
    Parsea la respuesta de Wikimedia y normaliza a nuestro formato.
    
    Args:
        data: Respuesta JSON de la API
        event_type: Tipo solicitado ("all", "events", "births", "deaths", "holidays")
        lang: Idioma usado
        
    Returns:
        Lista de items normalizados
    """
    items = []
    
    # Mapeo de tipos de Wikimedia a nuestras categorías
    type_mapping = {
        "events": "event",
        "births": "birth",
        "deaths": "death",
        "holidays": "holiday"
    }
    
    if event_type == "all":
        # Procesar todos los tipos
        for wiki_type, category in type_mapping.items():
            wiki_items = data.get(wiki_type, [])
            for item in wiki_items:
                normalized = _normalize_wikimedia_item(item, category, lang)
                items.append(normalized)
    else:
        # Procesar solo el tipo solicitado
        wiki_type = event_type
        category = type_mapping.get(wiki_type, "event")
        wiki_items = data.get(wiki_type, [])
        for item in wiki_items:
            normalized = _normalize_wikimedia_item(item, category, lang)
            items.append(normalized)
    
    return items


@router.get("")
async def get_ephemerides(
    date: Optional[str] = Query(None, description="Fecha en formato MM-DD (por defecto: hoy)"),
    lang: str = Query("es", description="Idioma ISO (por defecto: 'es', fallback a 'en' si no hay datos)"),
    type: str = Query("all", description="Tipo: 'all', 'events', 'births', 'deaths', 'holidays'")
) -> Dict[str, Any]:
    """
    Obtiene efemérides históricas del día desde Wikimedia Feed API - OnThisDay.
    
    Args:
        date: Fecha en formato MM-DD (por defecto: fecha actual)
        lang: Idioma ISO (por defecto: "es", fallback automático a "en" si no hay datos)
        type: Tipo de eventos (por defecto: "all")
        
    Returns:
        JSON normalizado con date, lang, source, count, items
    """
    try:
        # Validar parámetros
        if type not in ["all", "events", "births", "deaths", "holidays"]:
            raise HTTPException(
                status_code=400,
                detail=f"Tipo inválido: '{type}'. Debe ser: 'all', 'events', 'births', 'deaths', 'holidays'"
            )
        
        # Parsear fecha
        if date:
            try:
                parts = date.split("-")
                if len(parts) != 2:
                    raise ValueError("Formato de fecha inválido")
                month = int(parts[0])
                day = int(parts[1])
                if not (1 <= month <= 12):
                    raise ValueError("Mes debe estar entre 1 y 12")
                if not (1 <= day <= 31):
                    raise ValueError("Día debe estar entre 1 y 31")
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Formato de fecha inválido: '{date}'. Debe ser MM-DD. Error: {e}"
                )
        else:
            month, day = _today()
        
        # Verificar caché
        cache_key = f"ephemerides_{lang}_{type}_{month:02d}_{day:02d}"
        cache_hours = 12  # TODO: obtener de configuración si está disponible
        
        if cache_store:
            cached = cache_store.load(cache_key, max_age_minutes=cache_hours * 60)
            if cached and cached.payload:
                logger.debug(f"Cache hit para efemérides: {cache_key}")
                return cached.payload
        
        # Obtener datos de la API
        try:
            data = await _fetch_wikimedia_api(month, day, lang=lang, event_type=type)
        except httpx.HTTPStatusError as e:
            logger.error(f"Error HTTP obteniendo efemérides: {e}")
            # Si falla en español, intentar inglés automáticamente
            if lang != "en":
                logger.warning(f"Fallo obteniendo efemérides en {lang}, intentando inglés...")
                try:
                    data = await _fetch_wikimedia_api(month, day, lang="en", event_type=type, retry_en=False)
                    lang = "en"  # Actualizar lang usado
                except Exception:
                    # Si también falla en inglés, devolver error
                    raise HTTPException(
                        status_code=502,
                        detail=f"Error obteniendo efemérides desde Wikimedia API: {e}"
                    )
            else:
                raise HTTPException(
                    status_code=502,
                    detail=f"Error obteniendo efemérides desde Wikimedia API: {e}"
                )
        except httpx.RequestError as e:
            logger.error(f"Error de red obteniendo efemérides: {e}")
            raise HTTPException(
                status_code=503,
                detail=f"Error de conexión con Wikimedia API: {e}"
            )
        
        # Parsear y normalizar respuesta
        items = _parse_wikimedia_response(data, type, lang)
        
        # Construir respuesta
        result = {
            "date": f"{month:02d}-{day:02d}",
            "lang": lang,
            "source": "wikimedia",
            "count": len(items),
            "items": items
        }
        
        # Guardar en caché
        if cache_store:
            cache_store.store(cache_key, result)
            logger.debug(f"Cache guardado para efemérides: {cache_key}")
        
        return result
        
    except HTTPException:
        # Re-lanzar excepciones HTTP
        raise
    except Exception as e:
        logger.exception("Error obteniendo efemérides")
        return {
            "error": str(e),
            "source": "wikimedia",
            "items": [],
            "count": 0
        }


def init_cache(store: CacheStore) -> None:
    """
    Inicializa el caché del servicio.
    
    Args:
        store: Instancia de CacheStore a usar
    """
    global cache_store
    cache_store = store

