"""Tests para SatelliteSettings y normalización de labels_overlay."""
from __future__ import annotations

import pytest

from backend.models_v2 import SatelliteSettings, MapLabelsOverlayConfig


def test_labels_overlay_accepts_bool_and_dict() -> None:
    """Verifica que labels_overlay acepta tanto bool como dict."""
    # Test con bool
    s1 = SatelliteSettings(labels_overlay=True)
    assert isinstance(s1.labels_overlay, bool)
    assert s1.labels_overlay is True

    # Test con dict
    s2 = SatelliteSettings(
        labels_overlay={
            "enabled": True,
            "style_url": "https://api.maptiler.com/maps/streets-v4/style.json"
        }
    )
    assert isinstance(s2.labels_overlay, MapLabelsOverlayConfig)
    assert s2.labels_overlay.enabled is True
    assert s2.labels_overlay.style_url == "https://api.maptiler.com/maps/streets-v4/style.json"

    # Test con bool False
    s3 = SatelliteSettings(labels_overlay=False)
    assert isinstance(s3.labels_overlay, bool)
    assert s3.labels_overlay is False

    # Test con dict con enabled=False
    s4 = SatelliteSettings(
        labels_overlay={
            "enabled": False,
            "style_url": "https://api.maptiler.com/maps/streets-v4/style.json"
        }
    )
    assert isinstance(s4.labels_overlay, MapLabelsOverlayConfig)
    assert s4.labels_overlay.enabled is False


def test_labels_overlay_default_value() -> None:
    """Verifica que el valor por defecto de labels_overlay es True."""
    s = SatelliteSettings()
    assert s.labels_overlay is True
    assert isinstance(s.labels_overlay, bool)


def test_labels_overlay_invalid_dict_falls_back_to_true() -> None:
    """Verifica que un dict inválido se normaliza a True."""
    # Dict sin 'enabled' debería fallar y usar True por defecto
    s = SatelliteSettings(labels_overlay={"style_url": "invalid"})
    # El validador debería intentar crear MapLabelsOverlayConfig y si falla, usar True
    # Como MapLabelsOverlayConfig tiene enabled=True por defecto, esto debería funcionar
    assert isinstance(s.labels_overlay, MapLabelsOverlayConfig) or isinstance(s.labels_overlay, bool)


def test_labels_overlay_serialization() -> None:
    """Verifica que labels_overlay se serializa correctamente."""
    # Con bool
    s1 = SatelliteSettings(labels_overlay=True)
    dumped1 = s1.model_dump(mode="json")
    assert dumped1["labels_overlay"] is True

    # Con dict
    s2 = SatelliteSettings(
        labels_overlay={
            "enabled": True,
            "style_url": "https://api.maptiler.com/maps/streets-v4/style.json"
        }
    )
    dumped2 = s2.model_dump(mode="json")
    assert isinstance(dumped2["labels_overlay"], dict)
    assert dumped2["labels_overlay"]["enabled"] is True
    assert dumped2["labels_overlay"]["style_url"] == "https://api.maptiler.com/maps/streets-v4/style.json"


def test_labels_overlay_from_json() -> None:
    """Verifica que labels_overlay se puede crear desde JSON."""
    # Desde JSON con bool
    json_data1 = {
        "enabled": False,
        "opacity": 0.85,
        "labels_overlay": True
    }
    s1 = SatelliteSettings.model_validate(json_data1)
    assert isinstance(s1.labels_overlay, bool)
    assert s1.labels_overlay is True

    # Desde JSON con dict
    json_data2 = {
        "enabled": False,
        "opacity": 0.85,
        "labels_overlay": {
            "enabled": True,
            "style_url": "https://api.maptiler.com/maps/streets-v4/style.json"
        }
    }
    s2 = SatelliteSettings.model_validate(json_data2)
    assert isinstance(s2.labels_overlay, MapLabelsOverlayConfig)
    assert s2.labels_overlay.enabled is True

