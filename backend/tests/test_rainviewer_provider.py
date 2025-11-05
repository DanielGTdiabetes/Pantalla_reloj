"""Tests para RainViewerProvider - manejo del esquema v4."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Dict
from unittest.mock import MagicMock, patch

import pytest

from backend.global_providers import RainViewerProvider


def test_rainviewer_provider_handles_v4_format_with_dicts() -> None:
    """Test que RainViewerProvider maneja correctamente el formato v4 con objetos dict."""
    provider = RainViewerProvider()
    
    # Simular respuesta de RainViewer v4 con formato de objetos
    mock_response = {
        "version": "2.0",
        "generated": 1234567890,
        "host": "https://tilecache.rainviewer.com",
        "radar": {
            "past": [
                {"time": 1234567890, "path": "/v2/radar/1234567890"},
                {"time": 1234567891, "path": "/v2/radar/1234567891"},
                {"time": 1234567892, "path": "/v2/radar/1234567892"},
            ],
            "nowcast": [
                {"time": 1234567893, "path": "/v2/radar/1234567893"},
            ],
        }
    }
    
    with patch("backend.global_providers.requests.get") as mock_get:
        mock_response_obj = MagicMock()
        mock_response_obj.json.return_value = mock_response
        mock_response_obj.raise_for_status = MagicMock()
        mock_get.return_value = mock_response_obj
        
        frames = provider.get_available_frames(history_minutes=90, frame_step=5)
        
        # Debe retornar frames con timestamps
        assert len(frames) == 4
        assert all("timestamp" in f for f in frames)
        assert all("iso" in f for f in frames)
        assert all("path" in f for f in frames)
        
        # Verificar que los timestamps están ordenados
        timestamps = [f["timestamp"] for f in frames]
        assert timestamps == sorted(timestamps)


def test_rainviewer_provider_handles_legacy_format_with_ints() -> None:
    """Test que RainViewerProvider maneja correctamente el formato legacy con timestamps int."""
    provider = RainViewerProvider()
    
    # Simular respuesta legacy con timestamps directos
    mock_response = {
        "version": "2.0",
        "generated": 1234567890,
        "radar": {
            "past": [1234567890, 1234567891, 1234567892],
            "nowcast": [1234567893],
        }
    }
    
    with patch("backend.global_providers.requests.get") as mock_get:
        mock_response_obj = MagicMock()
        mock_response_obj.json.return_value = mock_response
        mock_response_obj.raise_for_status = MagicMock()
        mock_get.return_value = mock_response_obj
        
        frames = provider.get_available_frames(history_minutes=90, frame_step=5)
        
        # Debe retornar frames con timestamps
        assert len(frames) == 4
        assert all("timestamp" in f for f in frames)


def test_rainviewer_provider_filters_by_history_minutes() -> None:
    """Test que RainViewerProvider filtra frames por history_minutes."""
    provider = RainViewerProvider()
    
    now = datetime.now(timezone.utc)
    # Crear timestamps: uno muy antiguo, uno reciente
    old_timestamp = int((now.timestamp() - 120 * 60))  # 120 minutos atrás
    recent_timestamp = int(now.timestamp() - 30 * 60)  # 30 minutos atrás
    
    mock_response = {
        "version": "2.0",
        "generated": int(now.timestamp()),
        "radar": {
            "past": [
                {"time": old_timestamp, "path": f"/v2/radar/{old_timestamp}"},
                {"time": recent_timestamp, "path": f"/v2/radar/{recent_timestamp}"},
            ],
            "nowcast": [],
        }
    }
    
    with patch("backend.global_providers.requests.get") as mock_get:
        mock_response_obj = MagicMock()
        mock_response_obj.json.return_value = mock_response
        mock_response_obj.raise_for_status = MagicMock()
        mock_get.return_value = mock_response_obj
        
        # Con history_minutes=90, solo debe retornar el frame reciente
        frames = provider.get_available_frames(history_minutes=90, frame_step=5)
        
        # Solo debe retornar el frame reciente (dentro de 90 minutos)
        assert len(frames) == 1
        assert frames[0]["timestamp"] == recent_timestamp


def test_rainviewer_provider_combines_past_and_nowcast() -> None:
    """Test que RainViewerProvider combina correctamente past y nowcast."""
    provider = RainViewerProvider()
    
    mock_response = {
        "version": "2.0",
        "generated": 1234567890,
        "radar": {
            "past": [
                {"time": 1234567890, "path": "/v2/radar/1234567890"},
            ],
            "nowcast": [
                {"time": 1234567891, "path": "/v2/radar/1234567891"},
            ],
        }
    }
    
    with patch("backend.global_providers.requests.get") as mock_get:
        mock_response_obj = MagicMock()
        mock_response_obj.json.return_value = mock_response
        mock_response_obj.raise_for_status = MagicMock()
        mock_get.return_value = mock_response_obj
        
        frames = provider.get_available_frames(history_minutes=90, frame_step=5)
        
        # Debe retornar frames de past + nowcast
        assert len(frames) == 2
        timestamps = [f["timestamp"] for f in frames]
        assert 1234567890 in timestamps
        assert 1234567891 in timestamps


def test_rainviewer_provider_returns_empty_on_error() -> None:
    """Test que RainViewerProvider retorna lista vacía cuando hay error."""
    provider = RainViewerProvider()
    
    with patch("backend.global_providers.requests.get") as mock_get:
        mock_get.side_effect = Exception("Network error")
        
        frames = provider.get_available_frames(history_minutes=90, frame_step=5)
        
        # Debe retornar lista vacía sin lanzar excepción
        assert frames == []


def test_rainviewer_provider_get_tile_url() -> None:
    """Test que RainViewerProvider genera URLs de tiles correctas."""
    provider = RainViewerProvider()
    
    url = provider.get_tile_url(timestamp=1234567890, z=2, x=1, y=1)
    
    # Debe usar el formato v4 de tilecache
    assert url == "https://tilecache.rainviewer.com/v2/radar/1234567890/256/2/1/1/2/1_1.png"

