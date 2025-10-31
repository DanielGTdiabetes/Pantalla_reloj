from __future__ import annotations

from typing import Dict, Tuple

import pytest

def _prepare_wifi_environment(module: object, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "_get_wifi_interface", lambda: "wlp2s0")
    monkeypatch.setattr(module, "_validate_wifi_interface", lambda _: (True, None))


def test_wifi_scan_failure_returns_ok_false(
    monkeypatch: pytest.MonkeyPatch, app_module: Tuple[object, object]
) -> None:
    module, _ = app_module
    _prepare_wifi_environment(module, monkeypatch)

    captured: Dict[int, Tuple[list[str], int]] = {}

    def fake_run_nmcli(args: list[str], timeout: int = 30) -> Tuple[str, str, int]:
        call_index = len(captured)
        captured[call_index] = (args, timeout)
        if args[:3] == ["radio", "wifi", "on"]:
            return "", "", 0
        return "", "forced failure", 10

    monkeypatch.setattr(module, "_run_nmcli", fake_run_nmcli)

    result = module.wifi_scan()

    assert result == {
        "ok": False,
        "count": 0,
        "networks": [],
        "meta": {
            "stderr": "forced failure",
            "stdout": "",
            "reason": "scan_failed",
            "attempt": "fallback",
        },
    }

    # Ensure nmcli is called without --ifname and with the dev alias
    assert captured[1][0] == ["dev", "wifi", "rescan", "ifname", "wlp2s0"]
    assert captured[2][0] == ["dev", "wifi", "rescan"]


def test_wifi_networks_empty_payload(
    monkeypatch: pytest.MonkeyPatch, app_module: Tuple[object, object]
) -> None:
    module, _ = app_module
    _prepare_wifi_environment(module, monkeypatch)

    def fake_run_nmcli(args: list[str], timeout: int = 30) -> Tuple[str, str, int]:
        if "rescan" in args:
            return "", "", 0
        if "list" in args:
            return "", "", 0
        return "", "", 0

    monkeypatch.setattr(module, "_run_nmcli", fake_run_nmcli)

    result = module.wifi_networks()

    assert result["interface"] == "wlp2s0"
    assert result["networks"] == []
    assert result["count"] == 0
    assert "meta" in result
    assert result["meta"]["attempt"] in {"ifname", "fallback"}
