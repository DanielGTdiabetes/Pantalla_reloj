from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from openai import OpenAI

try:  # pragma: no cover - compat con distintas versiones del SDK
    from openai import OpenAIError  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - compatibilidad
    from openai.error import OpenAIError  # type: ignore

logger = logging.getLogger(__name__)

ENV_PATH = Path("/etc/pantalla-dash/env")
CACHE_PATH = Path(__file__).resolve().parents[1] / "storage" / "cache" / "ai_brief.json"
CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)

DEFAULT_MODEL = os.getenv("OPENAI_WEATHER_MODEL", "gpt-4o-mini")
CACHE_TTL_SECONDS = 30 * 60
MAX_TIP_LENGTH = 280


class AISummaryError(Exception):
    """Generic AI summarization error."""


def _read_env_file(path: Path) -> Dict[str, str]:
    data: Dict[str, str] = {}
    if not path.exists():
        return data
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                data[key.strip()] = value.strip().strip('"')
    except OSError as exc:
        logger.debug("No se pudo leer %s: %s", path, exc)
    return data


def _get_openai_key() -> Optional[str]:
    env = _read_env_file(ENV_PATH)
    key = env.get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
    return key.strip() if key else None


_client: Optional[OpenAI] = None
_client_key: Optional[str] = None


def _get_client() -> OpenAI:
    global _client, _client_key  # pylint: disable=global-statement
    api_key = _get_openai_key()
    if not api_key:
        raise AISummaryError("Falta OPENAI_API_KEY en el entorno")
    if _client is None or _client_key != api_key:
        _client = OpenAI(api_key=api_key, max_retries=1)
        _client_key = api_key
    return _client


def load_cached_brief(now: Optional[datetime] = None) -> tuple[Optional[Dict[str, Any]], bool]:
    if not CACHE_PATH.exists():
        return None, False
    try:
        with CACHE_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        logger.debug("No se pudo leer caché AI: %s", exc)
        return None, False
    if not isinstance(payload, dict):
        return None, False
    expires_at = int(payload.get("expires_at", 0))
    cached_data = payload.get("data") if isinstance(payload.get("data"), dict) else None
    if not cached_data:
        return None, False
    reference = now or datetime.now(timezone.utc)
    is_fresh = reference.timestamp() < expires_at
    if "cached_at" not in cached_data:
        approx = (expires_at - CACHE_TTL_SECONDS) * 1000
        if approx > 0:
            cached_data["cached_at"] = int(approx)
        else:
            try:
                cached_data["cached_at"] = int(CACHE_PATH.stat().st_mtime * 1000)
            except OSError:
                cached_data["cached_at"] = int(reference.timestamp() * 1000)
    cached_data.setdefault("source", "cache")
    return cached_data, is_fresh


def store_cached_brief(data: Dict[str, Any]) -> None:
    now_dt = datetime.now(timezone.utc)
    now_ts = now_dt.timestamp()
    expires = int(now_ts + CACHE_TTL_SECONDS)
    cached_at_ms = int(data.get("cached_at") or (now_ts * 1000))
    payload = {
        "expires_at": expires,
        "data": {
            **data,
            "cached_at": cached_at_ms,
            "source": data.get("source", "live"),
        },
    }
    tmp_path = CACHE_PATH.with_suffix(".tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        tmp_path.replace(CACHE_PATH)
    except OSError as exc:
        logger.debug("No se pudo guardar caché AI: %s", exc)


def _sanitize_tips(tips: Iterable[str]) -> List[str]:
    cleaned: List[str] = []
    for tip in tips:
        if not isinstance(tip, str):
            continue
        text = tip.strip()
        if not text:
            continue
        if len(text) > MAX_TIP_LENGTH:
            text = text[:MAX_TIP_LENGTH - 1].rstrip() + "…"
        cleaned.append(text)
    return cleaned[:5]


def _prepare_prompt(today: Dict[str, Any], weekly: List[Dict[str, Any]], locale: str) -> List[Dict[str, Any]]:
    system_text = (
        "Eres un asistente meteorológico que resume datos de la AEMET de forma breve y útil. "
        "Responde en JSON con las claves 'title' (máx 60 caracteres) y 'tips' (lista de 2 a 4 frases). "
        "Cada tip debe tener un máximo de 280 caracteres y debe ser accionable para el público general."
    )
    context = {
        "locale": locale,
        "today": today,
        "week": weekly[:5],
    }
    user_text = (
        "Genera un titular y recomendaciones para el clima actual basándote en estos datos. "
        "Incluye recordatorios sobre lluvia o tormenta si las probabilidades superan el 50%. "
        "Formato requerido: {\"title\": str, \"tips\": [str, ...]}."
    )
    return [
        {"role": "system", "content": system_text},
        {"role": "user", "content": f"{user_text}\n\nDatos:\n{json.dumps(context, ensure_ascii=False)}"},
    ]


def ai_summarize_weather(
    today: Dict[str, Any],
    weekly: List[Dict[str, Any]],
    locale: str = "es-ES",
) -> Dict[str, Any]:
    client = _get_client()
    messages = _prepare_prompt(today, weekly, locale)
    try:
        response = client.responses.create(
            model=DEFAULT_MODEL,
            input=messages,
            response_format={"type": "json_object"},
            max_output_tokens=400,
            timeout=12.0,
        )
    except OpenAIError as exc:
        raise AISummaryError("Fallo al obtener resumen meteorológico") from exc

    try:
        first_item = response.output[0]
        parts = getattr(first_item, "content", [])
        text = "".join(getattr(part, "text", "") for part in parts)
        data = json.loads(text)
    except (IndexError, AttributeError, json.JSONDecodeError) as exc:
        logger.warning("Respuesta AI inesperada: %s", exc)
        raise AISummaryError("Respuesta AI inválida") from exc

    title = str(data.get("title") or "Resumen meteorológico").strip()
    if len(title) > 60:
        title = title[:59].rstrip() + "…"
    tips = _sanitize_tips(data.get("tips") or [])
    if not tips:
        tips = ["Condiciones meteorológicas estables. Consulta el parte completo si necesitas más detalles."]

    return {
        "title": title,
        "tips": tips,
    }


__all__ = ["ai_summarize_weather", "load_cached_brief", "store_cached_brief", "AISummaryError"]
