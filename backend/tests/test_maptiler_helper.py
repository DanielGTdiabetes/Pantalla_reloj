from __future__ import annotations

from backend.services.maptiler import normalize_maptiler_style_url


def test_normalize_maptiler_style_url_adds_key_when_missing() -> None:
    url = "https://api.maptiler.com/maps/streets-v4/style.json"
    result = normalize_maptiler_style_url("abc123", url)
    assert result == "https://api.maptiler.com/maps/streets-v4/style.json?key=abc123"


def test_normalize_maptiler_style_url_preserves_existing_key() -> None:
    url = "https://api.maptiler.com/maps/streets-v4/style.json?key=existing"
    result = normalize_maptiler_style_url("abc123", url)
    assert result == url


def test_normalize_maptiler_style_url_handles_non_maptiler_url() -> None:
    url = "https://example.com/style.json"
    result = normalize_maptiler_style_url("abc123", url)
    assert result == url


def test_normalize_maptiler_style_url_returns_none_for_none() -> None:
    result = normalize_maptiler_style_url("abc123", None)
    assert result is None


