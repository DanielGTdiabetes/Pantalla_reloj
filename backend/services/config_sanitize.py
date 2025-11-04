"""
Servicio para sanitizar y migrar valores legacy/inválidos en configuración.
Evita que el backend no arranque con valores no soportados.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

log = logging.getLogger("config_sanitize")

_ALLOWED_RENDER = {"auto", "symbol", "circle", "symbol_custom"}


def sanitize_config(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normaliza valores legacy/inválidos sin perder intención del usuario.
    
    Args:
        raw: Configuración en bruto (puede tener valores inválidos)
        
    Returns:
        Configuración sanitizada (con valores migrados si es necesario)
    """
    data = dict(raw or {})
    
    # Navegar hasta layers.flights.render_mode si existe
    layers = data.get("layers")
    if isinstance(layers, dict):
        flights = layers.get("flights")
        if isinstance(flights, dict):
            rm = flights.get("render_mode")
            if isinstance(rm, str) and rm not in _ALLOWED_RENDER:
                # Migración conservadora: mapear a 'symbol' si parece un custom,
                # si no, a 'auto'. Registrar advertencia.
                new_val = "symbol" if "custom" in rm.lower() else "auto"
                log.warning(
                    "[config-migrate] flights.render_mode=%r no soportado → %r",
                    rm,
                    new_val
                )
                flights["render_mode"] = new_val
                
                # Si hay un icono custom almacenado en otra clave legacy, muévelo:
                # ej.: flights.icon_url_legacy -> flights.custom_icon_url
                if "icon_url_legacy" in flights and "custom_icon_url" not in flights:
                    flights["custom_icon_url"] = flights.pop("icon_url_legacy")
                    log.info(
                        "[config-migrate] Migrated icon_url_legacy → custom_icon_url"
                    )
    
    return data

