"""
Servicio para sanitizar y migrar valores legacy/inválidos en configuración.
Evita que el backend no arranque con valores no soportados.
"""
from __future__ import annotations

import logging
import json
from pathlib import Path
from typing import Any, Dict

log = logging.getLogger("config_sanitize")

_ALLOWED_RENDER = {"auto", "symbol", "circle", "symbol_custom"}

_DEFAULT_CONFIG_V2_PATH = Path(__file__).resolve().parent.parent / "default_config_v2.json"
try:
    _DEFAULT_CONFIG_V2 = json.loads(_DEFAULT_CONFIG_V2_PATH.read_text(encoding="utf-8"))
except Exception as exc:  # noqa: BLE001
    log.warning("[config] Could not load default_config_v2.json: %s", exc)
    _DEFAULT_CONFIG_V2 = {}


def _merge_with_defaults(defaults: Dict[str, Any], current: Any) -> Dict[str, Any]:
    """Merge dict `current` over `defaults`, preserving nested defaults."""
    merged: Dict[str, Any] = {}
    if isinstance(defaults, dict):
        merged.update(defaults)
    if isinstance(current, dict):
        for key, value in current.items():
            if (
                isinstance(value, dict)
                and isinstance(merged.get(key), dict)
            ):
                merged[key] = _merge_with_defaults(merged.get(key, {}), value)
            else:
                merged[key] = value
    return merged


def sanitize_config(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normaliza valores legacy/inválidos sin perder intención del usuario.
    
    Args:
        raw: Configuración en bruto (puede tener valores inválidos)
        
    Returns:
        Configuración sanitizada (con valores migrados si es necesario)
    """
    data = dict(raw or {})

    # Asegurar versión v2
    default_version = _DEFAULT_CONFIG_V2.get("version", 2)
    if data.get("version") != default_version:
        data["version"] = default_version

    # Rellenar secciones obligatorias con defaults si existen
    if _DEFAULT_CONFIG_V2:
        if "ui_map" not in data or not isinstance(data.get("ui_map"), dict):
            data["ui_map"] = _DEFAULT_CONFIG_V2.get("ui_map", {})
        else:
            data["ui_map"] = _merge_with_defaults(
                _DEFAULT_CONFIG_V2.get("ui_map", {}),
                data["ui_map"],
            )

        if "ui_global" not in data or not isinstance(data.get("ui_global"), dict):
            data["ui_global"] = _DEFAULT_CONFIG_V2.get("ui_global", {})
        else:
            data["ui_global"] = _merge_with_defaults(
                _DEFAULT_CONFIG_V2.get("ui_global", {}),
                data["ui_global"],
            )

        if "panels" not in data or not isinstance(data.get("panels"), dict):
            data["panels"] = _DEFAULT_CONFIG_V2.get("panels", {})
        else:
            data["panels"] = _merge_with_defaults(
                _DEFAULT_CONFIG_V2.get("panels", {}),
                data["panels"],
            )

        default_layers = _DEFAULT_CONFIG_V2.get("layers", {})
        if "layers" not in data or not isinstance(data.get("layers"), dict):
            data["layers"] = default_layers
        else:
            layers = data["layers"]
            data["layers"] = _merge_with_defaults(default_layers, layers)

            # Asegurar sub-bloques críticos
            ships_defaults = default_layers.get("ships", {})
            if isinstance(layers.get("ships"), dict):
                layers["ships"] = _merge_with_defaults(ships_defaults, layers["ships"])
            else:
                layers["ships"] = ships_defaults

            flights_defaults = default_layers.get("flights", {})
            if isinstance(layers.get("flights"), dict):
                layers["flights"] = _merge_with_defaults(flights_defaults, layers["flights"])
            else:
                layers["flights"] = flights_defaults

            global_defaults = default_layers.get("global", default_layers.get("global_", {}))
            if isinstance(global_defaults, dict):
                key = "global" if "global" in default_layers else "global_"
                if isinstance(layers.get(key), dict):
                    layers[key] = _merge_with_defaults(global_defaults, layers[key])
                else:
                    layers[key] = global_defaults

            data["layers"] = layers
    
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

