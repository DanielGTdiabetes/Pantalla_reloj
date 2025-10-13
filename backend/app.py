from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, ConfigDict, Field
import shutil

from .services.aemet import MissingApiKeyError
from .services.backgrounds import BackgroundAsset, list_backgrounds, latest_background
from .services.calendar import CalendarService, CalendarServiceError
from .services.config import AppConfig, read_config, update_config
from .services.location import set_location
from .services.metrics import get_latency
from .services.storms import get_radar_animation, get_radar_url, get_storm_status
from .services.tts import SpeechError, TTSService, TTSUnavailableError
from .services.weather import WeatherService, WeatherServiceError
from .services.wifi import WifiError, connect as wifi_connect, forget as wifi_forget, scan_networks, status as wifi_status

logger = logging.getLogger("pantalla.backend")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

app = FastAPI(title="Pantalla Dash Backend", version="2.0.0")

templates_dir = Path(__file__).resolve().parent / "templates"
templates = Jinja2Templates(directory=str(templates_dir))

AUTO_BACKGROUND_DIR = Path("/opt/dash/assets/backgrounds/auto")
AUTO_BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)

ALLOW_ON_DEMAND_BG = os.getenv("ALLOW_ON_DEMAND_BG", "").lower() in {"1", "true", "on", "yes"}
BG_GENERATOR_SCRIPT = Path("/opt/dash/scripts/generate_bg_daily.py")
BG_GENERATION_TIMEOUT = 15


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8080", "http://localhost:8080", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class StormStatusResponse(BaseModel):
    storm_prob: float
    near_activity: bool
    radar_url: Optional[str] = None
    updated_at: int


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


weather_service = WeatherService()
tts_service = TTSService()
calendar_service = CalendarService()


def get_config() -> AppConfig:
    return read_config()


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
        today, days, cached = await weather_service.get_forecast(config.aemet.municipioId, city_hint=city_hint)
    except MissingApiKeyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WeatherServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    payload = today.as_dict()
    payload["cached"] = cached
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
        today, days, cached = await weather_service.get_forecast(config.aemet.municipioId, city_hint=city_hint)
    except MissingApiKeyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WeatherServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    payload = [WeatherDayEntry(**entry.as_dict()) for entry in days[:limit]]
    return WeatherWeeklyResponse(days=payload, updated_at=int(today.updated_at.timestamp() * 1000), cached=cached)


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


@app.get("/api/wifi/scan", response_model=list[WifiNetwork])
def wifi_scan():
    try:
        networks = scan_networks()
        return [WifiNetwork(**network) for network in networks]
    except WifiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/wifi/connect")
def wifi_connect_endpoint(payload: WifiConnectRequest = Body(...)):
    try:
        wifi_connect(payload.ssid, payload.psk)
    except WifiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "ssid": payload.ssid}


@app.post("/api/wifi/forget")
def wifi_forget_endpoint(payload: WifiForgetRequest = Body(...)):
    try:
        wifi_forget(payload.ssid)
    except WifiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "ssid": payload.ssid}


@app.get("/api/network/status")
def network_status():
    try:
        return wifi_status()
    except WifiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/location/override")
def location_override(payload: LocationOverrideRequest):
    set_location(payload.lat, payload.lon)
    return {"ok": True}


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


@app.get("/api/config")
def get_config_endpoint(config: AppConfig = Depends(get_config)):
    return config.public_view()


@app.post("/api/config")
def update_config_endpoint(payload: dict = Body(...)):
    try:
        updated = update_config(payload)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Error actualizando config: %s", exc)
        raise HTTPException(status_code=400, detail="Configuración inválida") from exc
    return updated.public_view()


@app.on_event("shutdown")
async def shutdown_event():
    await weather_service.close()
    await calendar_service.close()


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

