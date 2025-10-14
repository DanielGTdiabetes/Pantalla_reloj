"""Seasonality helpers for Spanish horticulture tips."""
from __future__ import annotations

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping, Sequence
import json

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "seasonality_es.json"
MONTH_NAMES_ES = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]


def _coerce_list(values: Any) -> list[str]:
    if isinstance(values, list) and all(isinstance(item, str) for item in values):
        return values
    if values is None:
        return []
    if isinstance(values, Sequence) and not isinstance(values, (str, bytes)):
        return [str(item) for item in values]
    if isinstance(values, str):
        return [values]
    return []


@lru_cache(maxsize=1)
def _load_dataset() -> dict[int, dict[str, Any]]:
    if not DATA_PATH.exists():
        return {}
    try:
        payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    result: dict[int, dict[str, Any]] = {}
    for key, value in payload.items():
        try:
            month = int(key)
        except (TypeError, ValueError):
            continue
        if not 1 <= month <= 12:
            continue
        if not isinstance(value, Mapping):
            continue
        result[month] = {
            "hortalizas": _coerce_list(value.get("hortalizas")),
            "frutas": _coerce_list(value.get("frutas")),
            "nota": value.get("nota") if isinstance(value.get("nota"), str) else None,
        }
    return result


def get_month_season(month: int) -> dict[str, Any]:
    """Return the seasonality information for the given month (1-12)."""
    if not 1 <= month <= 12:
        raise ValueError("Mes fuera de rango (1-12)")
    dataset = _load_dataset()
    data = dataset.get(month, {})
    hortalizas = data.get("hortalizas", []) if isinstance(data, Mapping) else []
    frutas = data.get("frutas", []) if isinstance(data, Mapping) else []
    nota = data.get("nota") if isinstance(data, Mapping) else None
    return {
        "month": month,
        "hortalizas": list(hortalizas),
        "frutas": list(frutas),
        "nota": nota,
    }


def get_current_month_season(today: date) -> dict[str, Any]:
    """Return seasonality information for the month that includes *today*."""
    return get_month_season(today.month)


def build_month_tip(payload: Mapping[str, Any]) -> str:
    """Create a compact textual tip for the provided seasonality payload."""
    try:
        month = int(payload.get("month", 0))
    except (TypeError, ValueError):
        month = 0
    month_name = MONTH_NAMES_ES[month - 1].capitalize() if 1 <= month <= 12 else "Este mes"

    hortalizas = _coerce_list(payload.get("hortalizas"))
    frutas = _coerce_list(payload.get("frutas"))

    parts: list[str] = []
    if hortalizas:
        parts.append(f"Siembra → {', '.join(hortalizas)}")
    if frutas:
        parts.append(f"Temporada → {', '.join(frutas)}")
    if not parts:
        parts.append("Consulta la huerta para más detalles.")
    return f"En {month_name}: {' | '.join(parts)}"


__all__ = [
    "build_month_tip",
    "get_current_month_season",
    "get_month_season",
]
