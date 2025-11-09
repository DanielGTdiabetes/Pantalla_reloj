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

DEFAULT_AISSTREAM_WS_URL = "wss://stream.aisstream.io/v0/stream"
_DEFAULT_MAPTILER_STYLE_URL = (
    "https://api.maptiler.com/maps/streets-v4/style.json?key=fBZDqPrUD4EwoZLV4L6A"
)
_OLD_OPENSKY_TOKEN_URLS = {
    "https://auth.opensky-network.org/oauth/token",
    "https://auth.opensky-network.org/oauth/token/",
}
_NEW_OPENSKY_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
)


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
            if isinstance(maptiler_cfg, dict) and not maptiler_cfg.get("styleUrl"):
                maptiler_cfg["styleUrl"] = _DEFAULT_MAPTILER_STYLE_URL
            provider = ui_map.get("provider")
            if provider == "maptiler_vector" and isinstance(maptiler_cfg, dict):
                maptiler_cfg.setdefault("styleUrl", _DEFAULT_MAPTILER_STYLE_URL)
            if provider == "maptiler_vector" and not ui_map.get("maptiler"):
                ui_map["maptiler"] = {"apiKey": None, "styleUrl": _DEFAULT_MAPTILER_STYLE_URL}

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

    legacy_map = data.get("map")
    if isinstance(legacy_map, dict):
        provider = legacy_map.get("provider")
        if provider == "maptiler":
            legacy_map.setdefault("styleUrl", _DEFAULT_MAPTILER_STYLE_URL)

    return data


def _normalize_opensky_token_url(value: Any) -> str | None:


def _normalize_opensky_token_url(value: Any) -> str | None:
    if value is None:
        return _NEW_OPENSKY_TOKEN_URL
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned or cleaned in _OLD_OPENSKY_TOKEN_URLS:
            return _NEW_OPENSKY_TOKEN_URL
        return cleaned
    return _NEW_OPENSKY_TOKEN_URL

