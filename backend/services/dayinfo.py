from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import httpx

from .config import AppConfig, read_config

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / "storage" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_TTL_SECONDS = 24 * 60 * 60

SANTORAL_FALLBACK_PATH = PROJECT_ROOT / "data" / "santoral_es.json"

HTTP_TIMEOUT = httpx.Timeout(10.0, connect=10.0, read=10.0)
HTTP_HEADERS = {"User-Agent": "PantallaDash/1.0 (+https://github.com/pantalla-dash)"}

MONTH_NAMES = {
    1: "enero",
    2: "febrero",
    3: "marzo",
    4: "abril",
    5: "mayo",
    6: "junio",
    7: "julio",
    8: "agosto",
    9: "septiembre",
    10: "octubre",
    11: "noviembre",
    12: "diciembre",
}

SPANISH_REGIONS = {
    "ES-AN": "Andalucía",
    "ES-AR": "Aragón",
    "ES-AS": "Principado de Asturias",
    "ES-CN": "Canarias",
    "ES-CB": "Cantabria",
    "ES-CL": "Castilla y León",
    "ES-CM": "Castilla-La Mancha",
    "ES-CT": "Cataluña",
    "ES-EX": "Extremadura",
    "ES-GA": "Galicia",
    "ES-IB": "Islas Baleares",
    "ES-RI": "La Rioja",
    "ES-MD": "Comunidad de Madrid",
    "ES-MC": "Región de Murcia",
    "ES-NC": "Comunidad Foral de Navarra",
    "ES-PV": "País Vasco",
    "ES-VC": "Comunitat Valenciana",
    "ES-CE": "Ceuta",
    "ES-ML": "Melilla",
}

_NAGER_CACHE: dict[int, list[dict[str, Any]]] = {}
_SANTORAL_FALLBACK: Optional[dict[str, Any]] = None


@dataclass
class LocaleConfig:
    country: Optional[str] = None
    autonomousCommunity: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None


@dataclass
class PatronConfig:
    city: Optional[str] = None
    name: Optional[str] = None
    month: Optional[int] = None
    day: Optional[int] = None


def get_day_info(target_date: date) -> Dict[str, Any]:
    """Return historical efemerides, santoral and holidays for a date."""

    cached = _load_cache(target_date)
    if cached is not None:
        return cached

    config = read_config()
    locale_cfg = _extract_locale(config)
    patron_cfg = _extract_patron(config)

    result: Dict[str, Any] = {
        "date": target_date.isoformat(),
        "efemerides": [],
        "santoral": [],
        "holiday": {"is_holiday": False, "source": "nager.date", "scope": None, "region": None, "name": None},
        "patron": None,
    }

    try:
        result["efemerides"] = _fetch_wikipedia_efemerides(target_date.day, target_date.month)
    except Exception as exc:  # pragma: no cover - dependent on remote API
        logger.warning("No se pudieron obtener efemérides de Wikipedia: %s", exc)

    try:
        santoral_entries = _fetch_wikipedia_santoral(target_date.day, target_date.month)
        if not santoral_entries:
            raise ValueError("Respuesta de santoral vacía")
        result["santoral"] = santoral_entries
    except Exception as exc:  # pragma: no cover - dependent on remote API
        logger.warning("Fallo en santoral de Wikipedia: %s", exc)
        fallback = _from_local_santoral_fallback(target_date.day, target_date.month)
        if fallback:
            result["santoral"] = fallback

    try:
        result["holiday"] = _resolve_today_holiday(target_date, locale_cfg)
    except Exception as exc:  # pragma: no cover - dependent on remote API
        logger.warning("No se pudo resolver festivo: %s", exc)
        result["holiday"] = {"is_holiday": False, "scope": None, "region": None, "name": None, "source": "nager.date"}

    patron = _resolve_patron(target_date, patron_cfg)
    if patron:
        result["patron"] = patron

    _store_cache(target_date, result)
    return result


def _load_cache(target_date: date) -> Optional[Dict[str, Any]]:
    path = CACHE_DIR / f"dayinfo_{target_date.isoformat()}.json"
    if not path.exists():
        return None
    try:
        age = time.time() - path.stat().st_mtime
        if age > CACHE_TTL_SECONDS:
            return None
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        logger.debug("Caché de dayinfo inválida en %s: %s", path, exc)
        return None


def _store_cache(target_date: date, payload: Dict[str, Any]) -> None:
    path = CACHE_DIR / f"dayinfo_{target_date.isoformat()}.json"
    try:
        with path.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
    except OSError as exc:
        logger.warning("No se pudo escribir la caché de dayinfo: %s", exc)


def _http_get_json(url: str, *, params: Optional[dict[str, Any]] = None) -> Any:
    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            response = httpx.get(url, params=params, timeout=HTTP_TIMEOUT, headers=HTTP_HEADERS)
            response.raise_for_status()
            return response.json()
        except (httpx.TimeoutException, httpx.HTTPError) as exc:
            last_exc = exc
            if attempt == 0:
                time.sleep(0.5)
            else:
                raise
    raise RuntimeError("Unreachable") from last_exc


def _fetch_wikipedia_efemerides(day: int, month: int) -> List[Dict[str, Any]]:
    url = f"https://es.wikipedia.org/api/rest_v1/feed/onthisday/events/{month:02d}/{day:02d}"
    payload = _http_get_json(url)
    events = payload.get("events") if isinstance(payload, dict) else None
    if not isinstance(events, list):
        return []

    filtered = [event for event in events if isinstance(event, dict) and event.get("text")]
    filtered.sort(key=lambda item: item.get("year", 0))

    if len(filtered) <= 5:
        selected = filtered
    else:
        candidate_indices = {0, len(filtered) - 1}
        thirds = [len(filtered) // 3, len(filtered) // 2, (2 * len(filtered)) // 3]
        candidate_indices.update(index for index in thirds if 0 <= index < len(filtered))
        selected = [filtered[i] for i in sorted(candidate_indices)[:5]]

    result: List[Dict[str, Any]] = []
    for event in selected:
        text = str(event.get("text", "")).strip()
        if not text:
            continue
        year = event.get("year")
        try:
            year_value = int(year)
        except (TypeError, ValueError):
            year_value = None
        result.append({"text": text, "year": year_value, "source": "wikipedia"})
    return result[:5]


def _fetch_wikipedia_santoral(day: int, month: int) -> List[Dict[str, Any]]:
    month_name = MONTH_NAMES.get(month)
    if not month_name:
        return []
    page = f"{day} de {month_name}"

    sections_payload = _http_get_json(
        "https://es.wikipedia.org/w/api.php",
        params={
            "action": "parse",
            "format": "json",
            "page": page,
            "prop": "sections",
            "redirects": 1,
        },
    )
    sections = sections_payload.get("parse", {}).get("sections", []) if isinstance(sections_payload, dict) else []
    section_index = None
    for section in sections:
        if not isinstance(section, dict):
            continue
        title = str(section.get("line", "")).lower()
        if "santoral" in title or "onom" in title:
            section_index = section.get("index")
            break
    if section_index is None:
        return []

    santoral_payload = _http_get_json(
        "https://es.wikipedia.org/w/api.php",
        params={
            "action": "parse",
            "format": "json",
            "page": page,
            "prop": "wikitext",
            "section": section_index,
            "redirects": 1,
        },
    )
    wikitext = santoral_payload.get("parse", {}).get("wikitext", {}).get("*", "") if isinstance(santoral_payload, dict) else ""
    if not wikitext:
        return []

    entries: List[Dict[str, Any]] = []
    for line in wikitext.splitlines():
        stripped = line.strip()
        if not stripped.startswith("*"):
            continue
        cleaned = _clean_wiki_line(stripped.lstrip("*").strip())
        if cleaned:
            entries.append({"name": cleaned, "source": "wikipedia"})
        if len(entries) >= 5:
            break
    return entries


def _clean_wiki_line(text: str) -> str:
    text = re.sub(r"<ref[^>]*?>.*?</ref>", "", text, flags=re.DOTALL)
    text = re.sub(r"<.*?>", "", text)
    text = re.sub(r"\{\{.*?\}\}", "", text)
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", text)
    text = text.replace("'''", "").replace("''", "")
    text = text.strip("-–—· ")
    return text.strip()


def _from_local_santoral_fallback(day: int, month: int) -> List[Dict[str, Any]]:
    global _SANTORAL_FALLBACK
    if _SANTORAL_FALLBACK is None:
        try:
            with SANTORAL_FALLBACK_PATH.open("r", encoding="utf-8") as fh:
                _SANTORAL_FALLBACK = json.load(fh)
        except FileNotFoundError:
            logger.info("Santoral local no disponible en %s", SANTORAL_FALLBACK_PATH)
            _SANTORAL_FALLBACK = {}
        except json.JSONDecodeError as exc:
            logger.warning("Santoral local corrupto: %s", exc)
            _SANTORAL_FALLBACK = {}
    month_data = {}
    if isinstance(_SANTORAL_FALLBACK, dict):
        month_data = _SANTORAL_FALLBACK.get(str(month), {})
    if not isinstance(month_data, dict):
        return []
    candidates = month_data.get(str(day), [])
    if not isinstance(candidates, list):
        return []
    result = []
    for name in candidates[:5]:
        if isinstance(name, str) and name.strip():
            result.append({"name": name.strip(), "source": "local"})
    return result


def _fetch_nager_holidays(year: int) -> list[dict[str, Any]]:
    if year in _NAGER_CACHE:
        return _NAGER_CACHE[year]
    url = f"https://date.nager.at/api/v3/PublicHolidays/{year}/ES"
    payload = _http_get_json(url)
    if not isinstance(payload, list):
        holidays: list[dict[str, Any]] = []
    else:
        holidays = [item for item in payload if isinstance(item, dict)]
    _NAGER_CACHE[year] = holidays
    return holidays


def _resolve_today_holiday(target_date: date, locale_cfg: LocaleConfig) -> Dict[str, Any]:
    holidays = _fetch_nager_holidays(target_date.year)
    iso = target_date.isoformat()
    match = next((item for item in holidays if item.get("date") == iso), None)
    if not match:
        return {"is_holiday": False, "scope": None, "region": None, "name": None, "source": "nager.date"}

    counties = match.get("counties") if isinstance(match, dict) else None
    scope = "national"
    region = None
    if counties:
        scope = "regional"
        region = _match_region(counties, locale_cfg)
        if region is None and isinstance(counties, list) and counties:
            region = SPANISH_REGIONS.get(counties[0], counties[0])
    elif not match.get("global", True):
        scope = "regional"
        region = locale_cfg.autonomousCommunity

    return {
        "is_holiday": True,
        "name": match.get("localName") or match.get("name"),
        "scope": scope,
        "region": region,
        "source": "nager.date",
    }


def _match_region(counties: Iterable[str], locale_cfg: LocaleConfig) -> Optional[str]:
    target = locale_cfg.autonomousCommunity
    if not target:
        return None
    normalized_target = _normalize_str(target)
    for code in counties:
        if not isinstance(code, str):
            continue
        name = SPANISH_REGIONS.get(code)
        if name and _normalize_str(name) == normalized_target:
            return name
    return None


def _normalize_str(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return normalized.lower().strip()


def _resolve_patron(target_date: date, patron_cfg: PatronConfig | None) -> Optional[Dict[str, Any]]:
    if not patron_cfg or patron_cfg.month is None or patron_cfg.day is None:
        return None
    if patron_cfg.month == target_date.month and patron_cfg.day == target_date.day:
        return {
            "place": patron_cfg.city,
            "name": patron_cfg.name,
            "source": "config",
        }
    return None


def _extract_locale(config: AppConfig) -> LocaleConfig:
    locale = getattr(config, "locale", None)
    if locale is None:
        return LocaleConfig()
    return LocaleConfig(
        country=getattr(locale, "country", None),
        autonomousCommunity=getattr(locale, "autonomousCommunity", None),
        province=getattr(locale, "province", None),
        city=getattr(locale, "city", None),
    )


def _extract_patron(config: AppConfig) -> PatronConfig | None:
    patron = getattr(config, "patron", None)
    if patron is None:
        return None
    return PatronConfig(
        city=getattr(patron, "city", None),
        name=getattr(patron, "name", None),
        month=getattr(patron, "month", None),
        day=getattr(patron, "day", None),
    )


__all__ = ["get_day_info"]
