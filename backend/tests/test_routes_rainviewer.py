"""Tests para endpoints de RainViewer."""
from __future__ import annotations

from typing import Dict, Tuple
from unittest.mock import MagicMock, patch

import pytest

from backend.global_providers import RainViewerProvider


def test_rainviewer_frames_endpoint(app_module: Tuple[object, object]) -> None:
    """Test que /api/rainviewer/frames retorna array de timestamps."""
    module, _ = app_module
    
    # Mock de RainViewerProvider
    mock_frames = [
        {"timestamp": 1234567890, "iso": "2024-01-01T00:00:00+00:00", "path": "/v2/radar/1234567890"},
        {"timestamp": 1234567891, "iso": "2024-01-01T00:01:00+00:00", "path": "/v2/radar/1234567891"},
    ]
    
    with patch("backend.main.RainViewerProvider") as mock_provider_class:
        mock_provider = MagicMock()
        mock_provider.get_available_frames.return_value = mock_frames
        mock_provider_class.return_value = mock_provider
        
        response = module.get_rainviewer_frames(history_minutes=90, frame_step=5)
        
        # Debe retornar array de timestamps
        assert isinstance(response, list)
        assert response == [1234567890, 1234567891]
        assert response == sorted(response)  # Debe estar ordenado


def test_rainviewer_frames_endpoint_returns_empty_on_error(app_module: Tuple[object, object]) -> None:
    """Test que /api/rainviewer/frames retorna [] cuando hay error."""
    module, _ = app_module
    
    with patch("backend.main.RainViewerProvider") as mock_provider_class:
        mock_provider = MagicMock()
        mock_provider.get_available_frames.side_effect = Exception("Error")
        mock_provider_class.return_value = mock_provider
        
        response = module.get_rainviewer_frames(history_minutes=90, frame_step=5)
        
        # Debe retornar lista vacía sin lanzar excepción
        assert response == []


def test_rainviewer_test_endpoint_success(app_module: Tuple[object, object]) -> None:
    """Test que /api/rainviewer/test retorna ok:true cuando hay frames."""
    module, _ = app_module
    
    mock_frames = [
        {"timestamp": 1234567890, "iso": "2024-01-01T00:00:00+00:00", "path": "/v2/radar/1234567890"},
    ]
    
    with patch("backend.main.RainViewerProvider") as mock_provider_class:
        mock_provider = MagicMock()
        mock_provider.get_available_frames.return_value = mock_frames
        mock_provider_class.return_value = mock_provider
        
        response = module.test_rainviewer()
        
        assert response == {"ok": True, "frames_count": 1}


def test_rainviewer_test_endpoint_no_frames(app_module: Tuple[object, object]) -> None:
    """Test que /api/rainviewer/test retorna ok:false cuando no hay frames."""
    module, _ = app_module
    
    with patch("backend.main.RainViewerProvider") as mock_provider_class:
        mock_provider = MagicMock()
        mock_provider.get_available_frames.return_value = []
        mock_provider_class.return_value = mock_provider
        
        response = module.test_rainviewer()
        
        assert response == {"ok": False, "frames_count": 0, "reason": "no_frames_available"}


def test_rainviewer_test_endpoint_error(app_module: Tuple[object, object]) -> None:
    """Test que /api/rainviewer/test maneja errores correctamente."""
    module, _ = app_module
    
    with patch("backend.main.RainViewerProvider") as mock_provider_class:
        mock_provider = MagicMock()
        mock_provider.get_available_frames.side_effect = Exception("Network error")
        mock_provider_class.return_value = mock_provider
        
        response = module.test_rainviewer()
        
        assert response["ok"] is False
        assert response["frames_count"] == 0
        assert "reason" in response

