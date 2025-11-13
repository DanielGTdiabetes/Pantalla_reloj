"""Tests para SatelliteSettings y normalización de labels_overlay."""
from __future__ import annotations

from backend.models_v2 import SatelliteLabelsOverlay, SatelliteSettings


def test_labels_overlay_defaults_to_enabled() -> None:
    settings = SatelliteSettings()
    assert isinstance(settings.labels_overlay, SatelliteLabelsOverlay)
    assert settings.labels_overlay.enabled is True
    assert settings.labels_overlay.opacity == 1.0
    assert settings.labels_overlay.layer_filter is not None


def test_labels_overlay_accepts_boolean() -> None:
    settings = SatelliteSettings(labels_overlay=False)
    assert isinstance(settings.labels_overlay, SatelliteLabelsOverlay)
    assert settings.labels_overlay.enabled is False


def test_labels_overlay_accepts_dict() -> None:
    settings = SatelliteSettings(
        labels_overlay={
            "enabled": True,
            "style_url": "https://api.maptiler.com/maps/streets-v4/style.json",
            "layer_filter": '["==", ["get", "layer"], "poi_label"]',
            "opacity": 0.4,
        }
    )
    overlay = settings.labels_overlay
    assert overlay.enabled is True
    assert overlay.style_url == "https://api.maptiler.com/maps/streets-v4/style.json"
    assert overlay.layer_filter == '["==", ["get", "layer"], "poi_label"]'
    assert overlay.opacity == 0.4


def test_labels_overlay_migrates_legacy_style_field() -> None:
    settings = SatelliteSettings(
        labels_overlay={"enabled": True},
        labels_style_url="https://api.maptiler.com/maps/hybrid/style.json",
    )
    overlay = settings.labels_overlay
    assert overlay.style_url == "https://api.maptiler.com/maps/hybrid/style.json"


def test_labels_overlay_clamps_opacity() -> None:
    settings = SatelliteSettings(labels_overlay={"enabled": True, "opacity": 5})
    assert settings.labels_overlay.opacity == 1.0
    settings_low = SatelliteSettings(labels_overlay={"enabled": True, "opacity": -3})
    assert settings_low.labels_overlay.opacity == 0.0


def test_labels_overlay_serialization_includes_nested_object() -> None:
    settings = SatelliteSettings(
        enabled=True,
        labels_overlay={"enabled": True, "style_url": "https://api.maptiler.com/maps/streets/style.json"},
    )
    payload = settings.model_dump(mode="json")
    assert isinstance(payload["labels_overlay"], dict)
    assert payload["labels_overlay"]["enabled"] is True
    assert payload["labels_overlay"]["style_url"] == "https://api.maptiler.com/maps/streets/style.json"
