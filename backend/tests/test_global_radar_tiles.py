"""Tests para el endpoint de tiles de radar global."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Tuple
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from fastapi import HTTPException


def _enable_global_radar(config_file: Path) -> None:
    """Helper para habilitar radar global en la configuración."""
    config_data = json.loads(config_file.read_text(encoding="utf-8"))
    layers = config_data.setdefault("layers", {})
    key = "global" if "global" in layers else "global_"
    layers.setdefault(key, {}).setdefault("radar", {})
    layers[key]["radar"]["enabled"] = True
    layers[key]["radar"]["provider"] = "rainviewer"
    if key == "global_":
        layers.setdefault("global", json.loads(json.dumps(layers[key])))
        layers["global"].setdefault("radar", {})
        layers["global"]["radar"]["enabled"] = True
        layers["global"]["radar"]["provider"] = "rainviewer"
    config_file.write_text(json.dumps(config_data), encoding="utf-8")


def test_global_radar_tile_http_404_returns_404_not_500(
    app_module: Tuple[object, Path]
) -> None:
    """Test que un error 404 del proveedor devuelve 404, no 500."""
    module, config_file = app_module
    _enable_global_radar(config_file)
    
    # Mock de httpx.AsyncClient que simula un HTTPStatusError con 404
    mock_response = MagicMock()
    mock_response.status_code = 404
    
    # Crear una excepción que tenga el atributo response
    class MockHTTPStatusError(Exception):
        def __init__(self, *args, **kwargs):
            super().__init__(*args)
            self.response = mock_response
    
    mock_http_status_error = MockHTTPStatusError("Not Found")
    
    async def mock_get(*args, **kwargs):
        raise mock_http_status_error
    
    mock_client = AsyncMock()
    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    
    with patch("backend.main.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            import asyncio
            asyncio.run(module.get_global_radar_tile(
                timestamp=1234567890,
                z=6,
                x=31,
                y=24,
                request=MagicMock()
            ))
        
        # Debe ser 404, no 500
        assert exc_info.value.status_code == 404
        assert "tile_not_available" in exc_info.value.detail


def test_global_radar_tile_http_500_returns_502_not_500(
    app_module: Tuple[object, Path]
) -> None:
    """Test que un error 500 del proveedor devuelve 502, no 500."""
    module, config_file = app_module
    _enable_global_radar(config_file)
    
    # Mock de httpx.AsyncClient que simula un HTTPStatusError con 500
    mock_response = MagicMock()
    mock_response.status_code = 500
    
    class MockHTTPStatusError(Exception):
        def __init__(self, *args, **kwargs):
            super().__init__(*args)
            self.response = mock_response
    
    mock_http_status_error = MockHTTPStatusError("Internal Server Error")
    
    async def mock_get(*args, **kwargs):
        raise mock_http_status_error
    
    mock_client = AsyncMock()
    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    
    with patch("backend.main.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            import asyncio
            asyncio.run(module.get_global_radar_tile(
                timestamp=1234567890,
                z=6,
                x=31,
                y=24,
                request=MagicMock()
            ))
        
        # Debe ser 502, no 500
        assert exc_info.value.status_code == 502
        assert "upstream error" in exc_info.value.detail


def test_global_radar_tile_request_error_returns_502_not_500(
    app_module: Tuple[object, Path]
) -> None:
    """Test que un RequestError devuelve 502, no 500."""
    module, config_file = app_module
    _enable_global_radar(config_file)
    
    # Mock de httpx.AsyncClient que simula un RequestError (timeout, etc.)
    # RequestError no tiene response, así que no tiene status_code
    class MockRequestError(Exception):
        pass
    
    mock_request_error = MockRequestError("Connection timeout")
    
    async def mock_get(*args, **kwargs):
        raise mock_request_error
    
    mock_client = AsyncMock()
    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    
    with patch("backend.main.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            import asyncio
            asyncio.run(module.get_global_radar_tile(
                timestamp=1234567890,
                z=6,
                x=31,
                y=24,
                request=MagicMock()
            ))
        
        # Debe ser 502, no 500
        assert exc_info.value.status_code == 502
        assert "upstream error" in exc_info.value.detail

