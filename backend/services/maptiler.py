from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

logger = logging.getLogger("pantalla.backend.maptiler")


def resolve_maptiler_style_url(style: Optional[str], api_key: Optional[str] = None) -> str:
    """Resuelve la URL de estilo de MapTiler desde el nombre del estilo.
    
    Args:
        style: Nombre del estilo ("streets-v4", "hybrid", "satellite", "vector-dark", etc.)
        api_key: API key opcional para firmar la URL
        
    Returns:
        URL completa del estilo con ?key= si se proporciona api_key
        
    Nota:
        - Si style="hybrid", retorna streets-v4 como base porque el modo híbrido
          se maneja mediante satellite.enabled y MapHybrid añade la capa satelital encima.
        - Si style="satellite", retorna streets-v4 como base por la misma razón.
    """
    style_map = {
        "streets-v4": "https://api.maptiler.com/maps/streets-v4/style.json",
        "hybrid": "https://api.maptiler.com/maps/streets-v4/style.json",  # Base vectorial para modo híbrido
        "satellite": "https://api.maptiler.com/maps/streets-v4/style.json",  # Base vectorial para modo satélite
        "vector-dark": "https://api.maptiler.com/maps/basic-dark/style.json",
        "vector-bright": "https://api.maptiler.com/maps/basic/style.json",
        "vector-light": "https://api.maptiler.com/maps/basic-light/style.json",
        "basic": "https://api.maptiler.com/maps/basic/style.json",
        "basic-dark": "https://api.maptiler.com/maps/basic-dark/style.json",
    }
    
    # Valor por defecto si style no está en el mapa
    base_url = style_map.get(style or "", style_map.get("streets-v4"))
    
    # Si hay api_key, firmar la URL
    if api_key and api_key.strip():
        return normalize_maptiler_style_url(api_key.strip(), base_url) or base_url
    
    return base_url


def normalize_maptiler_style_url(api_key: Optional[str], raw_url: Optional[str]) -> Optional[str]:
    """Normaliza una URL de estilo de MapTiler sin romper firmas existentes.

    - Respeta URLs ya firmadas (?key=...).
    - Añade ?key= cuando falta y se proporciona api_key.
    - Mantiene URLs no MapTiler tal cual.
    - Deja intactas las rutas satélite/híbrido configuradas por el usuario.
    """

    if raw_url is None:
        logger.debug("[MapTiler] normalize styleUrl: input=None, output=None, apiKey_present=%s", bool(api_key and api_key.strip()))
        return None

    trimmed = raw_url.strip()
    api_key_clean = api_key.strip() if api_key else None
    api_key_present = bool(api_key_clean)
    normalized = trimmed

    if not trimmed:
        logger.debug(
            "[MapTiler] normalize styleUrl: input=%s, output=%s, apiKey_present=%s",
            raw_url,
            normalized,
            api_key_present,
        )
        return normalized

    try:
        parsed = urlparse(trimmed)
    except ValueError:
        logger.debug(
            "[MapTiler] normalize styleUrl: input=%s, output=%s, apiKey_present=%s",
            raw_url,
            normalized,
            api_key_present,
        )
        return normalized

    hostname = parsed.hostname or ""
    if "maptiler.com" in hostname:
        query_items = parse_qsl(parsed.query, keep_blank_values=True)
        has_key = any(k.lower() == "key" for k, _ in query_items)

        if not has_key and api_key_clean:
            query_items.append(("key", api_key_clean))
            new_query = urlencode(query_items, doseq=True)
            normalized = urlunparse(
                (
                    parsed.scheme,
                    parsed.netloc,
                    parsed.path,
                    parsed.params,
                    new_query,
                    parsed.fragment,
                )
            )

    logger.debug(
        "[MapTiler] normalize styleUrl: input=%s, output=%s, apiKey_present=%s",
        raw_url,
        normalized,
        api_key_present,
    )
    return normalized


