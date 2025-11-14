"""
Servicio para sanitizar y migrar valores legacy/inválidos en configuración.
Evita que el backend no arranque con valores no soportados.
"""
from __future__ import annotations

import logging
import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict

from .maptiler import normalize_maptiler_style_url

log = logging.getLogger("config_sanitize")

_ALLOWED_RENDER = {"auto", "symbol", "circle", "symbol_custom"}

_DEFAULT_CONFIG_V2_PATH = Path(__file__).resolve().parent.parent / "default_config_v2.json"
try:
    _DEFAULT_CONFIG_V2 = json.loads(_DEFAULT_CONFIG_V2_PATH.read_text(encoding="utf-8"))
except Exception as exc:  # noqa: BLE001
    log.warning("[config] Could not load default_config_v2.json: %s", exc)
    _DEFAULT_CONFIG_V2 = {}

DEFAULT_AISSTREAM_WS_URL = "wss://stream.aisstream.io/v0/stream"
_DEFAULT_MAPTILER_STYLE_URL = "https://api.maptiler.com/maps/streets-v4/style.json"
_OLD_OPENSKY_TOKEN_URLS = {
    "https://auth.opensky-network.org/oauth/token",
    "https://auth.opensky-network.org/oauth/token/",
}
_NEW_OPENSKY_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
)

_FALLBACK_ROTATOR_ORDER = [
    "clock",
    "weather",
    "astronomy",
    "santoral",
    "calendar",
    "harvest",
    "news",
    "historicalEvents",
]
_FALLBACK_ROTATOR_DURATIONS = {
    "clock": 10,
    "weather": 12,
    "astronomy": 10,
    "santoral": 8,
    "calendar": 12,
    "harvest": 10,
    "news": 12,
    "historicalEvents": 6,
}
_FALLBACK_OVERLAY = {
    "rotator": {
        "enabled": True,
        "order": list(_FALLBACK_ROTATOR_ORDER),
        "durations_sec": dict(_FALLBACK_ROTATOR_DURATIONS),
        "transition_ms": 400,
        "pause_on_alert": False,
    }
}
_FALLBACK_PANEL_HARVEST = {"enabled": True}
_FALLBACK_HARVEST_CONFIG = {"enabled": True, "custom_items": []}


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

        ui_map = data.get("ui_map")
        if isinstance(ui_map, dict):
            maptiler_cfg = ui_map.get("maptiler")
            if isinstance(maptiler_cfg, dict):
                # Normalizar apiKey → api_key (eliminar apiKey legacy)
                if "apiKey" in maptiler_cfg:
                    api_key_value = maptiler_cfg.pop("apiKey")
                    if "api_key" not in maptiler_cfg or maptiler_cfg["api_key"] is None:
                        maptiler_cfg["api_key"] = api_key_value
                
                api_key_in_cfg = maptiler_cfg.get("api_key")
                style_raw = maptiler_cfg.get("style")
                style_url_raw = maptiler_cfg.get("styleUrl")
                
                # Normalizar style: respetar valores válidos (hybrid, satellite, streets-v4, etc.)
                # Solo usar default si está vacío o inválido
                if isinstance(style_raw, str) and style_raw.strip():
                    normalized_style = style_raw.strip()
                    # Validar que sea un estilo conocido
                    valid_styles = {"hybrid", "satellite", "streets-v4", "vector-dark", "vector-bright", "vector-light", "basic", "basic-dark"}
                    if normalized_style not in valid_styles:
                        log.warning("[config-sanitize] Unknown maptiler.style=%r, defaulting to streets-v4", normalized_style)
                        normalized_style = "streets-v4"
                    maptiler_cfg["style"] = normalized_style
                elif not style_raw or (isinstance(style_raw, str) and not style_raw.strip()):
                    maptiler_cfg.setdefault("style", "streets-v4")
                
                # Resolver styleUrl según style y styleUrl existente
                current_style = maptiler_cfg.get("style", "streets-v4")
                
                # Si hay styleUrl, respetarlo pero asegurar que esté firmado
                if isinstance(style_url_raw, str) and style_url_raw.strip():
                    normalized = normalize_maptiler_style_url(api_key_in_cfg, style_url_raw.strip())
                    maptiler_cfg["styleUrl"] = normalized or style_url_raw.strip()
                # Si no hay styleUrl pero hay style, resolver desde style
                elif isinstance(current_style, str) and current_style.strip():
                    from .maptiler import resolve_maptiler_style_url
                    resolved_url = resolve_maptiler_style_url(current_style.strip(), api_key_in_cfg)
                    maptiler_cfg["styleUrl"] = resolved_url
                # Si no hay ni styleUrl ni style, usar default
                else:
                    from .maptiler import resolve_maptiler_style_url
                    default_url = resolve_maptiler_style_url("streets-v4", api_key_in_cfg)
                    maptiler_cfg["styleUrl"] = default_url
                    maptiler_cfg.setdefault("style", "streets-v4")

                # Limpiar urls.styleUrl* legacy si existen, conservando objeto si hay data útil
                urls_cfg = maptiler_cfg.get("urls")
                if isinstance(urls_cfg, dict):
                    for legacy_key in ("styleUrl", "styleUrlDark", "styleUrlLight", "styleUrlBright"):
                        urls_cfg.pop(legacy_key, None)
                    if not urls_cfg or all(value in (None, "") for value in urls_cfg.values()):
                        maptiler_cfg.pop("urls", None)
            
            provider = ui_map.get("provider")
            if provider == "maptiler_vector" and isinstance(maptiler_cfg, dict):
                maptiler_cfg.setdefault("styleUrl", _DEFAULT_MAPTILER_STYLE_URL)
                maptiler_cfg.setdefault("style", "streets-v4")
                maptiler_cfg.setdefault("api_key", None)
            if provider == "maptiler_vector" and not ui_map.get("maptiler"):
                ui_map["maptiler"] = {
                    "style": "streets-v4",
                    "api_key": None,
                    "styleUrl": _DEFAULT_MAPTILER_STYLE_URL
                }
            
            # Eliminar claves legacy de ui_map si existen
            legacy_ui_map_keys = ["labelsOverlay", "local", "customXyz"]
            for legacy_key in legacy_ui_map_keys:
                if legacy_key in ui_map and legacy_key.lower() != legacy_key:
                    # Si es camelCase y existe una versión lowercase, eliminar la camelCase
                    ui_map.pop(legacy_key, None)

            satellite_cfg = ui_map.get("satellite")
            if isinstance(satellite_cfg, dict):
                raster_legacy = satellite_cfg.pop("raster_style_url", None)
                if raster_legacy and not satellite_cfg.get("style_raster"):
                    satellite_cfg["style_raster"] = raster_legacy

                labels_overlay_raw = satellite_cfg.get("labels_overlay")
                overlay_obj: Dict[str, Any]
                if isinstance(labels_overlay_raw, dict):
                    overlay_obj = dict(labels_overlay_raw)
                elif isinstance(labels_overlay_raw, bool):
                    overlay_obj = {"enabled": labels_overlay_raw}
                else:
                    overlay_obj = {}

                overlay_obj.setdefault("enabled", satellite_cfg.get("labels_enabled", True))
                legacy_style = satellite_cfg.get("style_labels") or satellite_cfg.get("labels_style_url")
                overlay_style = overlay_obj.get("style_url") or legacy_style or "https://api.maptiler.com/maps/streets-v4/style.json"
                if isinstance(overlay_style, str):
                    overlay_obj["style_url"] = overlay_style.strip() or "https://api.maptiler.com/maps/streets-v4/style.json"
                else:
                    overlay_obj["style_url"] = "https://api.maptiler.com/maps/streets-v4/style.json"

                layer_filter_value = overlay_obj.get("layer_filter")
                if isinstance(layer_filter_value, list):
                    try:
                        overlay_obj["layer_filter"] = json.dumps(layer_filter_value)
                    except Exception:
                        overlay_obj["layer_filter"] = None
                elif isinstance(layer_filter_value, str):
                    overlay_obj["layer_filter"] = layer_filter_value.strip() or None
                elif layer_filter_value is None:
                    overlay_obj["layer_filter"] = None
                else:
                    try:
                        overlay_obj["layer_filter"] = json.dumps(layer_filter_value)
                    except Exception:
                        overlay_obj["layer_filter"] = None

                if overlay_obj.get("layer_filter") is None:
                    overlay_obj["layer_filter"] = '["==", ["get", "layer"], "poi_label"]'

                opacity_value = overlay_obj.get("opacity")
                if isinstance(opacity_value, (int, float)):
                    overlay_obj["opacity"] = max(0.0, min(1.0, float(opacity_value)))
                else:
                    overlay_obj["opacity"] = 1.0

                api_key_overlay = maptiler_cfg.get("api_key") if isinstance(maptiler_cfg, dict) else None
                if overlay_obj.get("style_url"):
                    overlay_obj["style_url"] = normalize_maptiler_style_url(api_key_overlay, overlay_obj["style_url"]) or overlay_obj["style_url"]
                elif api_key_overlay:
                    # Si no hay style_url pero hay api_key, usar streets-v4 por defecto
                    from .maptiler import resolve_maptiler_style_url
                    overlay_obj["style_url"] = resolve_maptiler_style_url("streets-v4", api_key_overlay)

                satellite_cfg["labels_overlay"] = overlay_obj
                satellite_cfg["labels_enabled"] = overlay_obj.get("enabled", True)
                satellite_cfg["labels_style_url"] = overlay_obj.get("style_url")

                satellite_cfg.setdefault("enabled", False)
                satellite_cfg.setdefault("provider", "maptiler")
                if isinstance(satellite_cfg.get("opacity"), (int, float)):
                    satellite_cfg["opacity"] = max(0.0, min(1.0, float(satellite_cfg["opacity"])))
                else:
                    satellite_cfg["opacity"] = 1.0
                # Asegurar que style_url esté firmado si hay api_key
                satellite_style_url = satellite_cfg.get("style_url")
                if satellite_style_url and api_key_overlay:
                    satellite_cfg["style_url"] = normalize_maptiler_style_url(api_key_overlay, satellite_style_url) or satellite_style_url
                elif not satellite_style_url:
                    satellite_cfg.setdefault("style_url", "https://api.maptiler.com/maps/satellite/style.json")
                    if api_key_overlay:
                        satellite_cfg["style_url"] = normalize_maptiler_style_url(api_key_overlay, satellite_cfg["style_url"]) or satellite_cfg["style_url"]
                satellite_cfg.setdefault("style_raster", "https://api.maptiler.com/maps/satellite/style.json")

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

            opensky_cfg = flights.get("opensky")
            if isinstance(opensky_cfg, dict):
                token_url = opensky_cfg.get("token_url")
                normalized_token_url = _normalize_opensky_token_url(token_url)
                if normalized_token_url is not None:
                    if token_url != normalized_token_url:
                        log.info(
                            "[config-migrate] Actualizado opensky.token_url → %s",
                            normalized_token_url,
                        )
                    opensky_cfg["token_url"] = normalized_token_url

            # Asegurar configuración symbol por defecto (icono avión) y migrar render_mode
            default_symbol_cfg = {}
            if isinstance(flights_defaults, dict):
                candidate_symbol = flights_defaults.get("symbol")
                if isinstance(candidate_symbol, dict):
                    default_symbol_cfg = dict(candidate_symbol)
            if not default_symbol_cfg:
                default_symbol_cfg = {"size_vh": 2.0, "allow_overlap": True}

            symbol_cfg = flights.get("symbol")
            if isinstance(symbol_cfg, dict):
                for key, value in default_symbol_cfg.items():
                    symbol_cfg.setdefault(key, value)
            else:
                flights["symbol"] = dict(default_symbol_cfg)

            render_mode_raw = flights.get("render_mode")
            if isinstance(render_mode_raw, str):
                normalized_mode = render_mode_raw.strip().lower()
            else:
                normalized_mode = ""
            if normalized_mode not in {"auto", "symbol", "symbol_custom", "circle"}:
                flights["render_mode"] = "symbol_custom"
            elif normalized_mode == "circle":
                log.info("[config-migrate] flights.render_mode circle → symbol_custom")
                flights["render_mode"] = "symbol_custom"
    
        ships = layers.get("ships")
        if isinstance(ships, dict):
            provider_raw = ships.get("provider")
            provider = str(provider_raw).strip().lower() if isinstance(provider_raw, str) else "aisstream"
            if provider not in {"aisstream", "aishub", "ais_generic", "custom"}:
                provider = "aisstream"
            ships["provider"] = provider

            ships.setdefault("enabled", False)

            if provider == "aisstream":
                aisstream_cfg = ships.get("aisstream")
                if not isinstance(aisstream_cfg, dict):
                    aisstream_cfg = {}
                    ships["aisstream"] = aisstream_cfg
                ws_url = aisstream_cfg.get("ws_url")
                if not isinstance(ws_url, str) or not ws_url.strip():
                    aisstream_cfg["ws_url"] = DEFAULT_AISSTREAM_WS_URL

    panels = data.get("panels")
    if not isinstance(panels, dict):
        panels = {}
        data["panels"] = panels

    panel_calendar = panels.get("calendar")
    if not isinstance(panel_calendar, dict):
        panel_calendar = {}
        panels["calendar"] = panel_calendar

    panel_provider_raw = panel_calendar.get("provider")
    panel_provider = str(panel_provider_raw).strip().lower() if isinstance(panel_provider_raw, str) else "google"
    if panel_provider == "disabled":
        panel_calendar["enabled"] = False
        panel_provider = "google"
    if panel_provider not in {"google", "ics"}:
        panel_provider = "google"
    panel_calendar["provider"] = panel_provider
    panel_calendar.setdefault("enabled", False)
    if "ics_path" in panel_calendar and isinstance(panel_calendar["ics_path"], str):
        panel_calendar["ics_path"] = panel_calendar["ics_path"].strip() or None

    top_opensky = data.get("opensky")
    if isinstance(top_opensky, dict):
        oauth2_cfg = top_opensky.get("oauth2")
        if isinstance(oauth2_cfg, dict):
            token_url = oauth2_cfg.get("token_url")
            normalized_token_url = _normalize_opensky_token_url(token_url)
            if normalized_token_url is not None:
                if token_url != normalized_token_url:
                    log.info(
                        "[config-migrate] Actualizado opensky.oauth2.token_url → %s",
                        normalized_token_url,
                    )
                oauth2_cfg["token_url"] = normalized_token_url

    calendar_top = data.get("calendar")
    if not isinstance(calendar_top, dict):
        calendar_top = {}
        data["calendar"] = calendar_top

    top_provider_raw = calendar_top.get("source") or calendar_top.get("provider")
    top_provider = str(top_provider_raw).strip().lower() if isinstance(top_provider_raw, str) else "google"
    if top_provider == "disabled":
        calendar_top["enabled"] = False
        top_provider = "google"
    if top_provider not in {"google", "ics"}:
        top_provider = "google"
    calendar_top["source"] = top_provider
    calendar_top["provider"] = top_provider
    calendar_top.setdefault("enabled", False)
    if "ics_path" in calendar_top and isinstance(calendar_top["ics_path"], str):
        calendar_top["ics_path"] = calendar_top["ics_path"].strip() or None

    _ensure_overlay_defaults(data)
    _ensure_harvest_panel_defaults(data)
    
    # Eliminar claves v1 legacy si existen
    _remove_v1_keys(data)
    
    legacy_map = data.get("map")
    if isinstance(legacy_map, dict):
        provider = legacy_map.get("provider")
        if provider == "maptiler":
            legacy_map.setdefault("styleUrl", _DEFAULT_MAPTILER_STYLE_URL)

    return data


def _remove_v1_keys(data: Dict[str, Any]) -> None:
    """Elimina claves v1 legacy que no deben persistirse en v2."""
    # Eliminar ui.map (v1)
    if "ui" in data and isinstance(data["ui"], dict):
        ui_dict = data["ui"]
        if "map" in ui_dict:
            log.warning("[config-sanitize] Removing legacy v1 key: ui.map")
            del ui_dict["map"]
        # Si ui quedó vacío, eliminarlo
        if not ui_dict:
            del data["ui"]
    
    # Eliminar claves top-level v1
    v1_top_level_keys = ["maptiler", "cinema", "global"]
    for key in v1_top_level_keys:
        if key in data:
            log.warning("[config-sanitize] Removing legacy v1 key: %s", key)
            del data[key]


def _normalize_opensky_token_url(value: Any) -> str | None:
    if value is None:
        return _NEW_OPENSKY_TOKEN_URL
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned or cleaned in _OLD_OPENSKY_TOKEN_URLS:
            return _NEW_OPENSKY_TOKEN_URL
        return cleaned
    return _NEW_OPENSKY_TOKEN_URL


def _ensure_overlay_defaults(data: Dict[str, Any]) -> None:
    """
    Garantiza que ui_global.overlay.rotator exista y contenga los paneles esperados,
    incluso si default_config_v2.json no pudo cargarse o la configuración recibida
    no incluye el bloque.
    """
    ui_global = data.setdefault("ui_global", {})
    overlay_current = ui_global.get("overlay")

    overlay_defaults_source = _DEFAULT_CONFIG_V2.get("ui_global", {}).get("overlay")
    overlay_defaults = (
        deepcopy(overlay_defaults_source)
        if isinstance(overlay_defaults_source, dict)
        else deepcopy(_FALLBACK_OVERLAY)
    )

    if isinstance(overlay_current, dict):
        ui_global["overlay"] = _merge_with_defaults(overlay_defaults, overlay_current)
    else:
        ui_global["overlay"] = overlay_defaults

    overlay = ui_global["overlay"]
    rotator_current = overlay.get("rotator")
    if isinstance(rotator_current, dict):
        rotator = _merge_with_defaults(_FALLBACK_OVERLAY["rotator"], rotator_current)
    else:
        rotator = deepcopy(_FALLBACK_OVERLAY["rotator"])

    # Normalizar order y asegurarse de que todos los paneles requeridos estén presentes
    order_raw = rotator.get("order")
    normalized_order = []
    if isinstance(order_raw, list):
        for entry in order_raw:
            if not isinstance(entry, str):
                continue
            cleaned = entry.strip()
            if not cleaned:
                continue
            key = cleaned
            if key not in normalized_order:
                normalized_order.append(key)
    for required in _FALLBACK_ROTATOR_ORDER:
        if required not in normalized_order:
            normalized_order.append(required)
    rotator["order"] = normalized_order

    durations = rotator.get("durations_sec")
    if not isinstance(durations, dict):
        rotator["durations_sec"] = dict(_FALLBACK_ROTATOR_DURATIONS)
    else:
        for key, value in _FALLBACK_ROTATOR_DURATIONS.items():
            durations.setdefault(key, value)
    rotator.setdefault("transition_ms", 400)
    rotator.setdefault("pause_on_alert", False)
    rotator["enabled"] = bool(rotator.get("enabled", True))

    overlay["rotator"] = rotator


def _ensure_harvest_panel_defaults(data: Dict[str, Any]) -> None:
    """
    Asegura que exista la configuración de cosechas tanto en `panels` como en la raíz.
    """
    panels = data.setdefault("panels", {})
    panels_defaults_source = _DEFAULT_CONFIG_V2.get("panels")
    if isinstance(panels_defaults_source, dict):
        panels.update(_merge_with_defaults(panels_defaults_source, panels))

    harvest_panel = panels.get("harvest")
    if isinstance(harvest_panel, dict):
        harvest_panel.setdefault("enabled", True)
    else:
        panels["harvest"] = deepcopy(_FALLBACK_PANEL_HARVEST)

    harvest_cfg = data.get("harvest")
    if isinstance(harvest_cfg, dict):
        harvest_cfg.setdefault("enabled", True)
        if not isinstance(harvest_cfg.get("custom_items"), list):
            harvest_cfg["custom_items"] = []
    else:
        data["harvest"] = deepcopy(_FALLBACK_HARVEST_CONFIG)

