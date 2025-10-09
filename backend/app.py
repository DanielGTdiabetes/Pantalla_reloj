from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from .services.calendar import CalendarService, CalendarServiceError
from .services.config import AppConfig, read_config, update_config
from .services.tts import SpeechError, TTSService, TTSUnavailableError
from .services.weather import MissingApiKeyError, WeatherService, WeatherServiceError
from .services.wifi import WifiError, connect as wifi_connect, forget as wifi_forget, scan_networks, status as wifi_status

logger = logging.getLogger("pantalla.backend")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

app = FastAPI(title="Pantalla Dash Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8080", "http://localhost:8080", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


class WeatherResponse(BaseModel):
    temp: float
    condition: str
    icon: str
    precipProb: float
    humidity: int
    updatedAt: int


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


weather_service = WeatherService()
tts_service = TTSService()
calendar_service = CalendarService()


def get_config() -> AppConfig:
    return read_config()


@app.get("/api/weather/current", response_model=WeatherResponse)
async def get_current_weather(
    response: Response,
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lon: Optional[float] = Query(default=None, ge=-180, le=180),
    config: AppConfig = Depends(get_config),
):
    lat = lat if lat is not None else (config.weather.lat if config.weather else None)
    lon = lon if lon is not None else (config.weather.lon if config.weather else None)
    if lat is None or lon is None:
        raise HTTPException(status_code=400, detail="Latitud y longitud son requeridas")
    try:
        payload, cached = await weather_service.fetch_current(lat, lon)
    except MissingApiKeyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WeatherServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    response.headers["X-Weather-Cache"] = "HIT" if cached else "MISS"
    return WeatherResponse(**payload)


@app.get("/api/wifi/scan", response_model=list[WifiNetwork])
def wifi_scan():
    try:
        networks = scan_networks()
        return networks
    except WifiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/wifi/connect")
def wifi_connect_endpoint(payload: WifiConnectRequest = Body(...)):
    try:
        wifi_connect(payload.ssid, payload.psk)
    except WifiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/api/wifi/forget")
def wifi_forget_endpoint(payload: WifiForgetRequest = Body(...)):
    try:
        wifi_forget(payload.ssid)
    except WifiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.get("/api/wifi/status")
def wifi_status_endpoint():
    try:
        return wifi_status()
    except WifiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
        logger.error("Error updating config: %s", exc)
        raise HTTPException(status_code=400, detail="Configuración inválida") from exc
    return updated.public_view()


@app.on_event("shutdown")
async def shutdown_event():
    await weather_service.close()
    await calendar_service.close()
