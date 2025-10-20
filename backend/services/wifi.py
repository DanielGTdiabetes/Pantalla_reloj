from __future__ import annotations

import logging
import os
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .config import get_wifi_interface, read_config

logger = logging.getLogger(__name__)

NMCLI_BIN = os.environ.get("NMCLI_BIN", "nmcli")
AP_SERVICE = "pantalla-ap.service"


@dataclass
class CommandResult:
    stdout: str
    stderr: str
    returncode: int


class WifiError(Exception):
    def __init__(self, message: str, *, stderr: str | None = None, code: int | None = None) -> None:
        super().__init__(message)
        self.stderr = stderr
        self.code = code


def _needs_sudo(stderr: str) -> bool:
    lowered = stderr.lower()
    return any(keyword in lowered for keyword in ["not authorized", "permiso denegado", "permission denied"])


def _run_nmcli(args: List[str]) -> CommandResult:
    if shutil.which(NMCLI_BIN) is None:
        raise WifiError("nmcli no está instalado")

    sanitized: List[str] = []
    mask_next = False
    for part in args:
        if mask_next:
            sanitized.append("****")
            mask_next = False
            continue
        sanitized.append(part)
        if part.lower() == "password":
            mask_next = True

    logger.debug("Ejecutando nmcli %s", " ".join(shlex.quote(part) for part in sanitized))

    base_cmd = [NMCLI_BIN, *args]
    result = subprocess.run(base_cmd, capture_output=True, text=True, check=False)

    if result.returncode != 0 and _needs_sudo(result.stderr) and os.geteuid() != 0:
        sudo_path = shutil.which("sudo")
        if sudo_path:
            logger.info("Reintentando nmcli con sudo")
            sudo_cmd = [sudo_path, NMCLI_BIN, *args]
            result = subprocess.run(sudo_cmd, capture_output=True, text=True, check=False)

    return CommandResult(stdout=result.stdout, stderr=result.stderr, returncode=result.returncode)


def _truncate(text: str, limit: int = 4096) -> str:
    if not text:
        return ""
    text = text.strip()
    return text[:limit]


def _parse_networks(output: str) -> List[Dict[str, Any]]:
    items: Dict[str, Dict[str, Any]] = {}
    for line in output.splitlines():
        if not line:
            continue
        parts = line.split(":")
        if len(parts) < 3:
            continue
        ssid = parts[0].strip()
        if not ssid:
            continue
        signal_raw = parts[1].strip()
        security = parts[2].strip() or "OPEN"
        entry = items.setdefault(ssid, {"ssid": ssid, "security": security})
        if signal_raw.isdigit():
            signal = int(signal_raw)
            previous = entry.get("signal")
            if not isinstance(previous, int) or signal > previous:
                entry["signal"] = signal
    ordered = sorted(
        items.values(),
        key=lambda data: data.get("signal") if isinstance(data.get("signal"), int) else -1,
        reverse=True,
    )
    return ordered


def wifi_scan() -> Dict[str, Any]:
    config = read_config()
    interface = get_wifi_interface(config)
    args = ["-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list"]
    if interface:
        args.extend(["ifname", interface])

    result = _run_nmcli(args)
    raw_output = _truncate("\n".join(part for part in [result.stdout, result.stderr] if part))
    if result.returncode != 0:
        message = result.stderr.strip() or "No se pudo escanear redes Wi-Fi"
        raise WifiError(message, stderr=result.stderr, code=result.returncode)

    networks = _parse_networks(result.stdout)
    return {"networks": networks, "raw": raw_output}


def wifi_connect(ssid: str, psk: Optional[str] = None) -> Dict[str, Any]:
    if not ssid:
        raise WifiError("SSID requerido")

    config = read_config()
    interface = get_wifi_interface(config)
    args = ["device", "wifi", "connect", ssid]
    if interface:
        args.extend(["ifname", interface])
    if psk:
        args.extend(["password", psk])

    result = _run_nmcli(args)
    if result.returncode != 0:
        message = result.stderr.strip() or "No se pudo conectar a la red"
        raise WifiError(message, stderr=result.stderr, code=result.returncode)

    try:
        stop_access_point_service()
    except Exception:  # pragma: no cover - defensivo
        logger.debug("No se pudo detener el servicio AP tras conectar", exc_info=True)

    return {
        "connected": True,
        "ssid": ssid,
        "stdout": _truncate(result.stdout),
    }


def wifi_status() -> Dict[str, Any]:
    config = read_config()
    preferred_interface = get_wifi_interface(config)
    result = _run_nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    if result.returncode != 0:
        message = result.stderr.strip() or "No se pudo obtener el estado"
        raise WifiError(message, stderr=result.stderr, code=result.returncode)

    active_device = None
    active_ssid = None
    for line in result.stdout.splitlines():
        if not line:
            continue
        device, dev_type, state, connection = (line.split(":") + [None, None, None, None])[:4]
        if dev_type != "wifi":
            continue
        if state == "connected":
            active_device = device
            active_ssid = connection
            break

    if preferred_interface and active_device and active_device != preferred_interface:
        active_ssid = None

    ip_address = None
    device_name = preferred_interface or active_device
    if active_ssid and device_name:
        show = _run_nmcli(["-t", "-f", "GENERAL.STATE,IP4.ADDRESS[1]", "device", "show", device_name])
        if show.returncode == 0:
            for line in show.stdout.splitlines():
                if line.startswith("GENERAL.STATE"):
                    continue
                if line:
                    ip_address = line.split("/")[0]
                    break

    return {
        "connected": bool(active_ssid),
        "ssid": active_ssid,
        "interface": device_name,
        "ip": ip_address,
    }


def forget(ssid: str) -> None:
    if not ssid:
        raise WifiError("SSID requerido")
    result = _run_nmcli(["connection", "delete", "id", ssid])
    if result.returncode != 0:
        message = result.stderr.strip() or "No se pudo olvidar la red"
        raise WifiError(message, stderr=result.stderr, code=result.returncode)


def stop_access_point_service() -> None:
    result = subprocess.run(
        ["systemctl", "stop", AP_SERVICE],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if stderr:
            logger.debug("No se pudo detener %s: %s", AP_SERVICE, stderr)
