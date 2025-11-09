from __future__ import annotations

import logging
from typing import Optional

import requests

logger = logging.getLogger(__name__)


def refresh_ui_if_possible(timeout: float = 2.0, url: Optional[str] = None) -> bool:
    """
    Intenta notificar al frontend para refrescar la UI sin reiniciar el kiosk.

    Args:
        timeout: Tiempo máximo de espera para la petición HTTP.
        url: URL personalizada del endpoint de refresco. Si no se especifica,
             se usa `http://127.0.0.1/api/kiosk/refresh`.

    Returns:
        True si la notificación se envió correctamente, False en caso contrario.
    """

    target_url = url or "http://127.0.0.1/api/kiosk/refresh"

    try:
        response = requests.post(target_url, timeout=timeout)
        response.raise_for_status()
        logger.info("[kiosk] UI refresh triggered via %s", target_url)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[kiosk] refresh via %s failed: %s", target_url, exc)
        return False


