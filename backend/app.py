from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
import subprocess
import sys
import time
from datetime import date as _date, datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, ConfigDict, Field
import shutil

from .services.aemet import MissingApiKeyError
from .services.ai_text import (
    AISummaryError,
    ai_summarize_weather,
    load_cached_brief,
    store_cached_brief,
)
from .services.backgrounds import BackgroundAsset, list_backgrounds, latest_background
from .services.calendar import CalendarService, CalendarServiceError
from .services.config import AppConfig, read_config as load_app_config
from .services.dayinfo import get_day_info
from .services.location import set_location
from .services.metrics import get_latency
from .services.seasonality import build_month_tip, get_current_month_season, get_month_season
from .services.dst import current_time_payload, next_transition_info
from .services.storms import get_radar_animation, get_radar_url, get_storm_status
from .services.tts import SpeechError, TTSService, TTSUnavailableError
from .services.weather import WeatherService, WeatherServiceError
from services.config_store import (
    has_openai_key,
    mask_secrets,
    read_config as read_store_config,
    read_secrets as read_store_secrets,
    secrets_metadata,
    write_config_patch,
    write_secrets_patch,
)
from services.wifi import wifi_connect, wifi_scan, wifi_status
from .services.wifi import WifiError, forget as wifi_forget
from .services.offline_state import get_offline_state, record_provider_failure, record_provider_success

logger = logging.getLogger("pantalla.backend")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")


SENSITIVE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"sk-[A-Za-z0-9]{8,}"), "sk-****"),
    (re.compile(r"(?i)(openai[_-]?api[_-]?key\s*[:=]\s*)([^\s\"']+)"), r"\1******"),
    (re.compile(r"(?i)(aemet[_-]?api[_-]?key\s*[:=]\s*)([^\s\"']+)"), r"\1******"),
    (re.compile(r"(?i)(api[_-]?key\s*[:=]\s*)([^\s\"']+)"), r"\1******"),
    (re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)([A-Za-z0-9._-]+)"), r"\1****"),
)


def _mask_sensitive(text: str) -> str:
    masked = text
    for pattern, replacement in SENSITIVE_PATTERNS:
        masked = pattern.sub(replacement, masked)
    return masked


class SensitiveDataFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # pragma: no cover - logging infra
        if isinstance(record.msg, str):
            record.msg = _mask_sensitive(record.msg)
        if record.args:
            record.args = tuple(
                _mask_sensitive(arg) if isinstance(arg, str) else arg for arg in record.args
            )
        return True


logging.getLogger().addFilter(SensitiveDataFilter())

app = FastAPI(title="Pantalla Dash Backend", version="2.0.0")

templates_dir = Path(__file__).resolve().parent / "templates"
templates = Jinja2Templates(directory=str(templates_dir))

AUTO_BACKGROUND_DIR = Path("/opt/dash/assets/backgrounds/auto")
AUTO_BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)

ALLOW_ON_DEMAND_BG = os.getenv("ALLOW_ON_DEMAND_BG", "").lower() in {"1", "true", "on", "yes"}
BG_GENERATOR_SCRIPT = Path("/opt/dash/scripts/generate_bg_daily.py")
BG_GENERATION_TIMEOUT = 15


def _parse_allowed_origins() -> list[str]:
    raw = os.getenv("PANTALLA_ALLOWED_ORIGINS", "")
    if raw.strip():
        origins = [item.strip() for item in raw.split(",") if item.strip()]
    else:
        origins = [
            "http://localhost",
            "http://127.0.0.1",
            "http://localhost:80",
            "http://127.0.0.1:80",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
        ]

    dedup: list[str] = []
    for origin in origins:
        if origin not in dedup:
            dedup.append(origin)
    return dedup


class SpeechQueue:
    def __init__(self, service: TTSService) -> None:
        self._service = service
        self._queue: "asyncio.Queue[object]" = asyncio.Queue()
        self._worker: asyncio.Task[None] | None = None
        self._sentinel = object()

    def start(self) -> None:
        if self._worker is None:
            self._worker = asyncio.create_task(self._run())

    async def close(self) -> None:
        if self._worker is None:
            return
        await self._queue.put(self._sentinel)
        try:
            await self._worker
        finally:
            self._worker = None

    async def enqueue(self, text: str, volume: float = 1.0) -> None:
        if not text.strip():
            raise SpeechError("Texto requerido")
        loop = asyncio.get_running_loop()
        future: "asyncio.Future[None]" = loop.create_future()
        await self._queue.put((text, volume, future))
        return await future

    async def _run(self) -> None:
        while True:
            item = await self._queue.get()
            if item is self._sentinel:
                self._queue.task_done()
                break
            text, volume, future = item  # type: ignore[misc]
            try:
                await asyncio.to_thread(self._service.speak, "", text, volume)
                future.set_result(None)
            except Exception as exc:  # pragma: no cover - defensivo
                future.set_exception(exc)
            finally:
                self._queue.task_done()
        while not self._queue.empty():
            try:
                pending = self._queue.get_nowait()
            except asyncio.QueueEmpty:  # pragma: no cover - vaciado rápido
                break
            self._queue.task_done()
            if pending is self._sentinel:
                continue
            _, _, future = pending  # type: ignore[misc]
            future.cancel()


def _is_local_host(host: Optional[str]) -> bool:
    if not host:
        return False
    if host in {"127.0.0.1", "::1"} or host.startswith("127."):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private


def _trigger_background_generation() -> Optional[subprocess.Popen]:
    if not ALLOW_ON_DEMAND_BG:
        return None
    if not BG_GENERATOR_SCRIPT.exists():
        logger.warning("Script de generación de fondos no encontrado en %s", BG_GENERATOR_SCRIPT)
        return None
    python = sys.executable or "python3"
    try:
        process = subprocess.Popen(
            [python, str(BG_GENERATOR_SCRIPT)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return process
    except OSError as exc:  # pragma: no cover - dependiente del entorno
        logger.error("No se pudo lanzar generate_bg_daily.py: %s", exc)
        return None


def _ensure_background(timeout: int = BG_GENERATION_TIMEOUT) -> Optional[BackgroundAsset]:
    asset = latest_background()
    if asset:
        return asset
    process = _trigger_background_generation()
    if not process and not ALLOW_ON_DEMAND_BG:
        return None
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(1)
        asset = latest_background()
        if asset:
            return asset
        if process and process.poll() is not None and process.returncode not in (0, None):
            break
    return latest_background()


async def raise_weather_alerts() -> None:
    global _last_alert_ts  # pylint: disable=global-statement
    try:
        status = get_storm_status()
    except Exception as exc:  # pylint: disable=broad-except
        logger.debug("No se pudo obtener estado de tormentas: %s", exc)
        return
    if not status.get("near_activity"):
        return
    now = time.time()
    if now - _last_alert_ts < ALERT_COOLDOWN_SECONDS:
        return
    try:
        await speech_queue.enqueue(ALERT_TEXT)
    except (SpeechError, TTSUnavailableError) as exc:
        logger.warning("No se pudo locutar alerta meteorológica: %s", exc)
        return
    _last_alert_ts = now


async def _alerts_daemon() -> None:
    while True:
        try:
            await raise_weather_alerts()
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Error en ciclo de alertas: %s", exc)
        await asyncio.sleep(300)


def _read_cpu_temp() -> Optional[float]:
    candidates = [
        Path("/sys/class/thermal/thermal_zone0/temp"),
        Path("/sys/devices/virtual/thermal/thermal_zone0/temp"),
    ]
    for path in candidates:
        try:
            value = path.read_text(encoding="utf-8").strip()
            if not value:
                continue
            temp = float(value) / 1000.0
            return round(temp, 2)
        except (OSError, ValueError):
            continue
    return None


def _read_loadavg() -> Optional[float]:
    try:
        return os.getloadavg()[0]
    except OSError:
        return None


def _read_mem_used_bytes() -> Optional[int]:
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            info = {line.split(":", 1)[0]: line.split(":", 1)[1].strip() for line in handle if ":" in line}
        mem_total = int(info.get("MemTotal", "0 kB").split()[0])
        mem_available = int(info.get("MemAvailable", "0 kB").split()[0])
        used_kb = max(mem_total - mem_available, 0)
        return used_kb * 1024
    except (OSError, ValueError):
        return None


def _read_disk_free_bytes(path: str = "/") -> Optional[int]:
    try:
        usage = shutil.disk_usage(path)
        return usage.free
    except OSError:
        return None

app.mount(
    "/backgrounds/auto",
    StaticFiles(directory=AUTO_BACKGROUND_DIR, html=False),
    name="auto-backgrounds",
)

ALLOWED_CORS_ORIGINS = _parse_allowed_origins()
logger.info("CORS permitido para orígenes: %s", ", ".join(ALLOWED_CORS_ORIGINS))

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


START_TIME = time.monotonic()


@app.get("/api/health")
def healthcheck() -> Dict[str, Any]:
    uptime = time.monotonic() - START_TIME
    return {
        "status": "ok",
        "uptime": round(uptime, 2),
        "version": app.version,
    }


@app.get("/api/system/offline-state")
def system_offline_state() -> Dict[str, Any]:
    return get_offline_state()


class WeatherTodayResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    temp: float = Field(description="Temperatura aproximada actual")
    min: float = Field(description="Mínima diaria")
    max: float = Field(description="Máxima diaria")
    rain_prob: float = Field(alias="rain_prob")
    condition: str
    icon: str
    city: str
    updated_at: int = Field(alias="updated_at")
    cached: bool = False
    source: str = Field(default="live")
    cached_at: Optional[int] = Field(default=None, alias="cached_at")


class WeatherDayEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    day: str
    date: str
    min: float
    max: float
    rain_prob: float = Field(alias="rain_prob")
    storm_prob: float = Field(alias="storm_prob")
    condition: str
    icon: str


class WeatherWeeklyResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    days: list[WeatherDayEntry]
    updated_at: int
    cached: bool = False
    source: str = Field(default="live")
    cached_at: Optional[int] = Field(default=None, alias="cached_at")


class StormStatusResponse(BaseModel):
    storm_prob: float
    near_activity: bool
    radar_url: Optional[str] = None
    updated_at: int
    source: str = Field(default="live")
    cached_at: Optional[int] = Field(default=None, alias="cached_at")


class WifiNetwork(BaseModel):
    ssid: str
    signal: Optional[int] = None
    security: Optional[str] = None


class WifiConnectRequest(BaseModel):
    ssid: str
    psk: Optional[str] = Field(default=None, repr=False)


class WifiForgetRequest(BaseModel):
    ssid: str


class TTSSpeakRequest(BaseModel):
    voice: Optional[str] = None
    text: str
    volume: float = Field(default=1.0, ge=0.0, le=1.0)


class CalendarEventResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str
    start: datetime
    end: Optional[datetime] = None
    all_day: bool = Field(default=False, alias="allDay", serialization_alias="allDay")
    notify: bool = False


class LocationOverrideRequest(BaseModel):
    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)


class BackgroundAssetResponse(BaseModel):
    filename: str
    url: str
    generated_at: int = Field(alias="generatedAt")
    mode: Optional[str] = None
    prompt: Optional[str] = None
    weather_key: Optional[str] = Field(default=None, alias="weatherKey")
    etag: Optional[str] = None
    last_modified: Optional[int] = Field(default=None, alias="lastModified")
    openai_latency_ms: Optional[float] = Field(default=None, alias="openaiLatencyMs")
    context: Optional[dict] = None


class WeatherBriefResponse(BaseModel):
    title: str
    tips: list[str]
    updated_at: int = Field(alias="updated_at")
    cached: bool = False
    source: str = Field(default="live")
    cached_at: Optional[int] = Field(default=None, alias="cached_at")


class AlertTTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class CalendarPeekResponse(BaseModel):
    title: str
    start: datetime


weather_service = WeatherService()
tts_service = TTSService()
calendar_service = CalendarService()
speech_queue = SpeechQueue(tts_service)

ALERT_COOLDOWN_SECONDS = 60 * 60
ALERT_TEXT = "Tormenta cercana. Precaución."
_last_alert_ts: float = 0.0
_alert_task: asyncio.Task[None] | None = None


def get_config() -> AppConfig:
    return load_app_config()


@app.get("/setup", response_class=HTMLResponse)
async def setup_page(request: Request):
    try:
        network = wifi_status()
    except WifiError:
        network = {"connected": False, "ssid": None, "ip": None}
    return templates.TemplateResponse("setup.html", {"request": request, "network": network})


@app.get("/api/weather/today", response_model=WeatherTodayResponse)
async def weather_today(config: AppConfig = Depends(get_config)):
    if not config.aemet:
        raise HTTPException(status_code=503, detail="Servicio AEMET no configurado")
    city_hint = config.weather.city if config.weather else None
    try:
        today, days, meta = await weather_service.get_forecast(
            config.aemet.municipioId, city_hint=city_hint
        )
    except MissingApiKeyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WeatherServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    payload = today.as_dict()
    payload["cached"] = meta.cached
    payload["source"] = meta.source
    payload["cached_at"] = (
        int(meta.cached_at.timestamp() * 1000) if meta.cached_at else None
    )
    if days:
        payload.setdefault("min", round(days[0].min_temp, 1))
        payload.setdefault("max", round(days[0].max_temp, 1))
    return WeatherTodayResponse(**payload)


@app.get("/api/weather/weekly", response_model=WeatherWeeklyResponse)
async def weather_weekly(
    limit: int = Query(default=7, ge=1, le=7),
    config: AppConfig = Depends(get_config),
):
    if not config.aemet:
        raise HTTPException(status_code=503, detail="Servicio AEMET no configurado")
    city_hint = config.weather.city if config.weather else None
    try:
        today, days, meta = await weather_service.get_forecast(
            config.aemet.municipioId, city_hint=city_hint
        )
    except MissingApiKeyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WeatherServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    payload_days = [WeatherDayEntry(**entry.as_dict()) for entry in days[:limit]]
    cached_at = int(meta.cached_at.timestamp() * 1000) if meta.cached_at else None
    return WeatherWeeklyResponse(
        days=payload_days,
        updated_at=int(meta.fetched_at.timestamp() * 1000),
        cached=meta.cached,
        source=meta.source,
        cached_at=cached_at,
    )


@app.get("/api/ai/weather/brief", response_model=WeatherBriefResponse)
async def weather_brief(config: AppConfig = Depends(get_config)):
    now = datetime.now(timezone.utc)
    cached_payload, fresh = load_cached_brief(now)
    if fresh and cached_payload:
        payload = {**cached_payload, "cached": True}
        payload.setdefault("source", "cache")
        payload.setdefault("cached_at", cached_payload.get("cached_at"))
        return WeatherBriefResponse(**payload)

    if not config.aemet:
        if cached_payload:
            payload = {**cached_payload, "cached": True}
            payload.setdefault("source", "cache")
            return WeatherBriefResponse(**payload)
        raise HTTPException(status_code=503, detail="Servicio AEMET no configurado")

    city_hint = config.weather.city if config.weather else None
    try:
        today, days, meta = await weather_service.get_forecast(
            config.aemet.municipioId, city_hint=city_hint
        )
    except MissingApiKeyError as exc:
        if cached_payload:
            payload = {**cached_payload, "cached": True}
            payload.setdefault("source", "cache")
            return WeatherBriefResponse(**payload)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WeatherServiceError as exc:
        if cached_payload:
            payload = {**cached_payload, "cached": True}
            payload.setdefault("source", "cache")
            return WeatherBriefResponse(**payload)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    today_dict = today.as_dict()
    weekly_dicts = [entry.as_dict() for entry in days]

    try:
        summary = await asyncio.to_thread(ai_summarize_weather, today_dict, weekly_dicts, "es-ES")
        record_provider_success("openai")
        summary_source = "live"
    except AISummaryError as exc:
        logger.warning("Fallo al generar resumen AI: %s", exc)
        record_provider_failure("openai", str(exc))
        if cached_payload:
            payload = {**cached_payload, "cached": True}
            payload.setdefault("source", "cache")
            return WeatherBriefResponse(**payload)

        condition = today_dict.get("condition") or "Clima"
        rain_prob = float(today_dict.get("rain_prob") or 0)
        tips = [
            f"Condición predominante: {condition}.",
            f"Temperaturas entre {today_dict.get('min', '--')}º y {today_dict.get('max', '--')}º.",
        ]
        if rain_prob >= 50:
            tips.append("Lleva paraguas o chubasquero: alta probabilidad de lluvia hoy.")
        elif rain_prob >= 20:
            tips.append("Podría haber chubascos aislados. Considera ropa repelente al agua.")
        summary = {"title": f"Resumen del día: {condition}", "tips": tips[:3]}
        summary_source = "fallback"

    updated_at_ms = int(meta.fetched_at.timestamp() * 1000)
    cached_at_ms = int(meta.cached_at.timestamp() * 1000) if meta.cached_at else None
    payload = {
        "title": summary["title"],
        "tips": summary["tips"],
        "updated_at": updated_at_ms,
        "cached": meta.cached or summary_source != "live",
        "source": summary_source if summary_source != "fallback" else summary_source,
        "cached_at": cached_at_ms if summary_source != "fallback" else updated_at_ms,
    }
    store_cached_brief(
        {
            key: payload[key]
            for key in ("title", "tips", "updated_at", "source", "cached_at")
        }
    )
    return WeatherBriefResponse(**payload)


@app.get("/api/storms/status", response_model=StormStatusResponse)
async def storms_status():
    try:
        payload = get_storm_status()
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return StormStatusResponse(**payload)


@app.get("/api/storms/radar")
async def storms_radar():
    url = get_radar_url()
    if not url:
        return Response(status_code=204)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            response.raise_for_status()
    except httpx.HTTPError:
        return Response(status_code=204)
    media_type = response.headers.get("content-type", "image/png")
    return Response(content=response.content, media_type=media_type)


@app.get("/api/storms/radar/animation")
def storms_radar_animation(limit: int = Query(default=8, ge=3, le=24)):
    data = get_radar_animation(limit)
    frames = []
    base_ts = int(data.get("updated_at", int(time.time() * 1000)))
    raw_frames = data.get("frames") or []
    for idx, url in enumerate(raw_frames):
        ts = base_ts - (len(raw_frames) - idx - 1) * 60_000
        frames.append({"url": url, "timestamp": ts})
    return {"frames": frames, "updated_at": base_ts}


@app.get("/api/backgrounds/current", response_model=BackgroundAssetResponse)
def current_background(request: Request):
    asset = latest_background()
    if not asset:
        asset = _ensure_background()
    if not asset:
        raise HTTPException(status_code=404, detail="Sin fondos disponibles")
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and asset.etag and if_none_match.strip() == asset.etag:
        response = Response(status_code=304)
        response.headers["ETag"] = asset.etag
        if asset.last_modified:
            dt = datetime.fromtimestamp(asset.last_modified, tz=timezone.utc)
            response.headers["Last-Modified"] = format_datetime(dt, usegmt=True)
        return response
    return _background_json_response(asset)


@app.get("/api/backgrounds/auto", response_model=list[BackgroundAssetResponse])
def auto_backgrounds(limit: int = Query(default=6, ge=1, le=30)):
    assets = list_backgrounds(limit=limit)
    return [_serialize_background(asset) for asset in assets]


@app.get("/api/health/full")
def health_full():
    cpu_temp = _read_cpu_temp()
    load1 = _read_loadavg()
    mem_used = _read_mem_used_bytes()
    disk_free = _read_disk_free_bytes("/opt") or _read_disk_free_bytes("/")
    aemet_sample = get_latency("aemet")
    aemet_latency = round(aemet_sample.duration_ms, 2) if aemet_sample else None
    openai_latency = None
    last_bg_ts = None
    asset = latest_background()
    if asset:
        last_bg_ts = asset.generated_at
        openai_latency = asset.openai_latency_ms
    return {
        "cpu_temp": cpu_temp,
        "load1": load1,
        "mem_used": mem_used,
        "disk_free": disk_free,
        "aemet_latency_ms": aemet_latency,
        "openai_latency_ms": openai_latency,
        "last_bg_ts": last_bg_ts,
    }


@app.get("/api/wifi/scan")
def wifi_scan_endpoint() -> Dict[str, Any]:
    try:
        return wifi_scan()
    except WifiError as exc:
        detail = {"message": str(exc)}
        if exc.stderr:
            detail["stderr"] = exc.stderr.strip()
        if exc.code is not None:
            detail["code"] = exc.code
        raise HTTPException(status_code=502, detail=detail) from exc


@app.post("/api/wifi/connect")
def wifi_connect_endpoint(payload: WifiConnectRequest = Body(...)) -> Dict[str, Any]:
    try:
        return wifi_connect(payload.ssid, payload.psk)
    except WifiError as exc:
        detail = {"message": str(exc)}
        if exc.stderr:
            detail["stderr"] = exc.stderr.strip()
        if exc.code is not None:
            detail["code"] = exc.code
        raise HTTPException(status_code=400, detail=detail) from exc


@app.post("/api/wifi/forget")
def wifi_forget_endpoint(payload: WifiForgetRequest = Body(...)):
    try:
        wifi_forget(payload.ssid)
    except WifiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "ssid": payload.ssid}


def _wifi_status_payload() -> Dict[str, Any]:
    try:
        return wifi_status()
    except WifiError as exc:
        detail = {"message": str(exc)}
        if exc.stderr:
            detail["stderr"] = exc.stderr.strip()
        if exc.code is not None:
            detail["code"] = exc.code
        raise HTTPException(status_code=502, detail=detail) from exc


@app.get("/api/wifi/status")
def wifi_status_endpoint() -> Dict[str, Any]:
    return _wifi_status_payload()


@app.get("/api/network/status")
def network_status():
    return _wifi_status_payload()


@app.get("/api/season/month")
async def season_month(month: int | None = Query(default=None, ge=1, le=12)):
    today = _date.today()
    try:
        season = get_current_month_season(today) if month is None else get_month_season(month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = dict(season)
    payload["tip"] = build_month_tip(payload)
    return payload


@app.post("/api/location/override")
def location_override(payload: LocationOverrideRequest):
    set_location(payload.lat, payload.lon)
    return {"ok": True}


@app.get("/api/time/dst/next")
async def dst_next():
    return next_transition_info(_date.today())


@app.get("/api/time/now")
async def time_now():
    return current_time_payload()


@app.get("/api/time/sync_status")
def time_sync_status():
    try:
        result = subprocess.run(
            ["timedatectl", "show-timesync"],
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="timedatectl no disponible") from exc
    if result.returncode != 0:
        raise HTTPException(status_code=502, detail=result.stderr.strip() or "No disponible")
    data: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in {"SystemClockSynchronized", "NTPService", "ServerName", "PollIntervalUSec"}:
            data[key] = value
    return data


@app.get("/api/tts/voices")
def list_voices():
    try:
        return tts_service.voices()
    except TTSUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/tts/speak")
def speak(payload: TTSSpeakRequest):
    try:
        tts_service.speak(payload.voice or "", payload.text, payload.volume)
    except (SpeechError, TTSUnavailableError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/api/alerts/tts")
async def alerts_tts(payload: AlertTTSRequest, request: Request):
    host = request.client.host if request.client else None
    if not _is_local_host(host):
        raise HTTPException(status_code=403, detail="Solo disponible en la red local")
    try:
        await speech_queue.enqueue(payload.text)
    except TTSUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SpeechError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Fallo en cola TTS de alertas: %s", exc)
        raise HTTPException(status_code=500, detail="No se pudo reproducir el aviso") from exc
    return {"status": "queued"}


@app.get("/api/calendar/today", response_model=list[CalendarEventResponse])
async def calendar_today(config: AppConfig = Depends(get_config)):
    if not config.calendar or not config.calendar.enabled or not config.calendar.icsUrl:
        return []

    try:
        events = await calendar_service.events_for_today(config.calendar)
    except CalendarServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    now = datetime.now().astimezone()
    notify_window = timedelta(minutes=config.calendar.notifyMinutesBefore or 0)
    payload: list[CalendarEventResponse] = []

    for event in events:
        start = event.start.astimezone(now.tzinfo)
        end = event.end.astimezone(now.tzinfo) if event.end else None
        notify = False
        if not event.all_day:
            if end and start <= now <= end:
                notify = True
            elif now <= start <= now + notify_window:
                notify = True

        payload.append(
            CalendarEventResponse(
                title=event.title,
                start=start,
                end=end,
                all_day=event.all_day,
                notify=notify,
            )
        )

    return payload


@app.get("/api/calendar/peek", response_model=CalendarPeekResponse)
async def calendar_peek(config: AppConfig = Depends(get_config)):
    if not config.calendar or not config.calendar.enabled or not config.calendar.icsUrl:
        raise HTTPException(status_code=404, detail="Calendario no configurado")
    try:
        events = await calendar_service.events_for_today(config.calendar)
    except CalendarServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not events:
        raise HTTPException(status_code=204, detail="Sin eventos para hoy")

    now = datetime.now().astimezone()
    tzinfo = now.tzinfo
    selected_title = None
    selected_start = None
    for event in events:
        start = event.start.astimezone(tzinfo)
        if start >= now:
            selected_title = event.title
            selected_start = start
            break
    if selected_title is None:
        first = events[0]
        selected_title = first.title
        selected_start = first.start.astimezone(tzinfo)

    return CalendarPeekResponse(title=selected_title, start=selected_start)


@app.get("/api/day/brief")
async def day_brief(date: str | None = None) -> Dict[str, Any]:
    """Devuelve efemérides, santoral y festivos para la fecha indicada."""

    try:
        if date:
            year, month, day = map(int, date.split("-"))
            target = _date(year, month, day)
        else:
            target = _date.today()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Fecha inválida") from exc

    try:
        return get_day_info(target)
    except Exception as exc:  # pragma: no cover - dependencias externas
        logger.exception("Error al generar day brief para %s", target)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/config/status")
def config_status() -> Dict[str, Any]:
    _, config_path = read_store_config()
    _, secrets_path = read_store_secrets()
    return {
        "hasOpenAI": has_openai_key(),
        "configPath": config_path,
        "secretsPath": secrets_path,
    }


def _config_response(
    config_data: Dict[str, Any],
    secrets_data: Dict[str, Any],
    *,
    config_path: str | None = None,
    secrets_path: str | None = None,
) -> Dict[str, Any]:
    if config_path is None:
        _, config_path = read_store_config()
    if secrets_path is None:
        _, secrets_path = read_store_secrets()
    return {
        "config": config_data,
        "paths": {"config": config_path, "secrets": secrets_path},
        "secrets": mask_secrets(secrets_data),
    }


@app.get("/api/config")
def get_config_endpoint() -> Dict[str, Any]:
    config_data, config_path = read_store_config()
    secrets_data, secrets_path = read_store_secrets()
    return _config_response(
        config_data or {},
        secrets_data or {},
        config_path=config_path,
        secrets_path=secrets_path,
    )


@app.put("/api/config")
def update_config_endpoint(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    if not isinstance(payload, dict) or not payload:
        raise HTTPException(status_code=400, detail="Payload debe ser un objeto JSON con cambios")

    try:
        updated_config, config_path = write_config_patch(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    secrets_data, secrets_path = read_store_secrets()
    return _config_response(
        updated_config,
        secrets_data,
        config_path=config_path,
        secrets_path=secrets_path,
    )


@app.put("/api/secrets")
def update_secrets(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    if not isinstance(payload, dict) or not payload:
        raise HTTPException(status_code=400, detail="Payload debe ser un objeto JSON")

    try:
        secrets_data, secrets_path = write_secrets_patch(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    config_data, config_path = read_store_config()
    return _config_response(
        config_data or {},
        secrets_data,
        config_path=config_path,
        secrets_path=secrets_path,
    )


@app.get("/api/secrets/meta")
def secrets_meta() -> Dict[str, Any]:
    return secrets_metadata()


@app.on_event("startup")
async def startup_event():
    global _alert_task  # pylint: disable=global-statement
    speech_queue.start()
    if _alert_task is None:
        _alert_task = asyncio.create_task(_alerts_daemon())


@app.on_event("shutdown")
async def shutdown_event():
    global _alert_task  # pylint: disable=global-statement
    if _alert_task is not None:
        _alert_task.cancel()
        try:
            await _alert_task
        except asyncio.CancelledError:  # pragma: no cover - esperado en apagado
            pass
        _alert_task = None
    await weather_service.close()
    await calendar_service.close()
    await speech_queue.close()


def _serialize_background(asset: BackgroundAsset) -> BackgroundAssetResponse:
    return BackgroundAssetResponse(
        filename=asset.filename,
        url=asset.url,
        generatedAt=asset.generated_at,
        mode=asset.mode,
        prompt=asset.prompt,
        weatherKey=asset.weather_key,
        etag=asset.etag,
        lastModified=asset.last_modified,
        openaiLatencyMs=asset.openai_latency_ms,
        context=asset.context,
    )


def _background_json_response(asset: BackgroundAsset) -> JSONResponse:
    payload = _serialize_background(asset)
    response = JSONResponse(content=payload.model_dump(by_alias=True))
    if asset.etag:
        response.headers["ETag"] = asset.etag
    if asset.last_modified:
        dt = datetime.fromtimestamp(asset.last_modified, tz=timezone.utc)
        response.headers["Last-Modified"] = format_datetime(dt, usegmt=True)
    response.headers.setdefault("Cache-Control", "public, max-age=300")
    return response

