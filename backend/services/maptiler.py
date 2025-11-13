from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

logger = logging.getLogger("pantalla.backend.maptiler")


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


