from __future__ import annotations

import importlib
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from backend.services.layers import flights, radar, satellite, ships

router = APIRouter(prefix="/api/layers", tags=["layers"])


def _load_main_module():
    """
    Carga diferida del módulo principal para evitar dependencias circulares
    en el momento de importar el router.
    """

    return importlib.import_module("backend.main")


@router.get("/flights/test")
async def flights_test():
    try:
        data = await flights.get_status()
        return {"ok": True, "layer": "flights", **data}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/flights")
async def flights_data(request: Request, bbox: Optional[str] = None, extended: Optional[int] = None) -> JSONResponse:
    main = _load_main_module()

    def _call():
        return main.get_flights(request, bbox, extended)

    return await run_in_threadpool(_call)


@router.get("/ships/test")
async def ships_test():
    try:
        data = await ships.get_status()
        return {"ok": True, "layer": "ships", **data}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/ships")
async def ships_data(request: Request, bbox: Optional[str] = None, max_items_view: Optional[int] = None):
    main = _load_main_module()

    def _call():
        return main.ships_service.get_ships_in_bbox(bbox, max_items_view)

    return await run_in_threadpool(_call)


@router.get("/global/radar/test")
async def radar_test():
    try:
        data = await radar.test()
        return {"ok": True, "layer": "radar", **data}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/global/satellite/test")
async def satellite_test():
    try:
        data = await satellite.test()
        return {"ok": True, "layer": "satellite", **data}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/lightning")
async def lightning_data(request: Request, bbox: Optional[str] = None) -> JSONResponse:
    main = _load_main_module()

    def _call():
        return main.get_lightning(request, bbox)

    return await run_in_threadpool(_call)
