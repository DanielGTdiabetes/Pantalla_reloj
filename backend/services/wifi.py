from __future__ import annotations

import logging
import os
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .config import get_wifi_interface, read_config

logger = logging.getLogger(__name__)

NMCLI_BIN = os.environ.get("NMCLI_BIN", "nmcli")
AP_SERVICE = "pantalla-ap.service"

_STATE_PRIORITY_ORDER: Tuple[str, ...] = ("connected", "connecting", "disconnected", "unavailable")


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


class WifiNotSupportedError(WifiError):
    """Raised when no Wi-Fi capability is available on the device."""


def _needs_sudo(stderr: str) -> bool:
    lowered = stderr.lower()
    return any(keyword in lowered for keyword in ["not authorized", "permiso denegado", "permission denied"])


def _run_nmcli(args: List[str]) -> CommandResult:
    if shutil.which(NMCLI_BIN) is None:
        raise WifiError("nmcli no está instalado")

    # Mask password values for logging
    sanitized: List[str] = []
    i = 0
    while i < len(args):
        part = args[i]
        # Check if this argument is "password" and mask the next argument
        if i + 1 < len(args) and part.lower() == "password":
            sanitized.append(part)
            sanitized.append("****")
            i += 2  # Skip both password keyword and value
        else:
            sanitized.append(part)
            i += 1

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


def _state_priority(state: str) -> int:
    normalized = state.strip().lower()
    for index, prefix in enumerate(_STATE_PRIORITY_ORDER):
        if normalized.startswith(prefix):
            return len(_STATE_PRIORITY_ORDER) - index
    return -1


def _extract_wifi_devices(lines: Sequence[str]) -> Dict[str, Dict[str, Optional[str]]]:
    devices: Dict[str, Dict[str, Optional[str]]] = {}
    for raw_line in lines:
        if not raw_line:
            continue
        parts = (raw_line.split(":") + [None, None, None, None])[:4]
        device, dev_type, state, connection = parts
        if dev_type != "wifi":
            continue
        devices[device] = {
            "state": state or "",
            "connection": connection if connection not in {None, "", "--"} else None,
        }
    return devices


def list_wifi_interfaces() -> List[str]:
    result = _run_nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    if result.returncode != 0:
        message = result.stderr.strip() or "No se pudo enumerar interfaces Wi-Fi"
        raise WifiError(message, stderr=result.stderr, code=result.returncode)
    devices = _extract_wifi_devices(result.stdout.splitlines())
    if not devices:
        raise WifiNotSupportedError("No hay interfaces Wi-Fi disponibles en el sistema")
    return list(devices.keys())


def _validate_wifi_interface(interface: str) -> None:
    result = _run_nmcli(["-t", "-f", "TYPE", "device", "show", interface])
    if result.returncode != 0:
        message = result.stderr.strip() or f"No se pudo inspeccionar la interfaz '{interface}'"
        raise WifiError(message, stderr=result.stderr, code=result.returncode)

    for line in result.stdout.splitlines():
        if not line:
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        normalized_key = key.strip().lower()
        if normalized_key in {"type", "general.type"}:
            iface_type = value.strip().lower()
            if iface_type == "wifi":
                return
            raise WifiError(f"La interfaz configurada '{interface}' no es Wi-Fi (tipo: {iface_type or 'desconocido'})")

    raise WifiError(f"No se pudo determinar el tipo de interfaz '{interface}'")


def _autodetect_wifi_interface() -> str:
    result = _run_nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    if result.returncode != 0:
        message = result.stderr.strip() or "No se pudo enumerar interfaces Wi-Fi"
        raise WifiError(message, stderr=result.stderr, code=result.returncode)

    wifi_devices = _extract_wifi_devices(result.stdout.splitlines())
    if not wifi_devices:
        raise WifiNotSupportedError("No se encontró interfaz Wi-Fi disponible")

    best_device: Optional[str] = None
    best_score = -1
    for device, info in wifi_devices.items():
        score = _state_priority(info.get("state") or "")
        if score > best_score:
            best_device = device
            best_score = score

    if best_device is None:
        raise WifiNotSupportedError("No se encontró interfaz Wi-Fi disponible")
    return best_device


def get_wifi_iface() -> str:
    config = read_config()
    preferred = get_wifi_interface(config)
    if preferred:
        _validate_wifi_interface(preferred)
        return preferred

    detected = _autodetect_wifi_interface()
    if not detected:
        raise WifiNotSupportedError("No se encontró interfaz Wi-Fi disponible")
    return detected


def wifi_scan() -> Dict[str, Any]:
    interface = get_wifi_iface()
    logger.info("WiFi iface: %s", interface)

    rescan_result = _run_nmcli(["device", "wifi", "rescan", "ifname", interface])
    if rescan_result.returncode != 0:
        message = rescan_result.stderr.strip() or "No se pudo escanear redes Wi-Fi"
        raise WifiError(message, stderr=rescan_result.stderr, code=rescan_result.returncode)

    list_result = _run_nmcli(
        ["-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "ifname", interface]
    )
    raw_output = _truncate(
        "\n".join(
            part
            for part in [
                rescan_result.stdout,
                rescan_result.stderr,
                list_result.stdout,
                list_result.stderr,
            ]
            if part
        )
    )
    if list_result.returncode != 0:
        message = list_result.stderr.strip() or "No se pudo escanear redes Wi-Fi"
        raise WifiError(message, stderr=list_result.stderr, code=list_result.returncode)

    networks = _parse_networks(list_result.stdout)
    return {"networks": networks, "raw": raw_output}


def wifi_connect(ssid: str, psk: Optional[str] = None) -> Dict[str, Any]:
    if not ssid:
        raise WifiError("SSID requerido")

    interface = get_wifi_iface()
    logger.info("WiFi iface: %s", interface)

    args = ["device", "wifi", "connect", ssid]
    if psk:
        args.extend(["password", psk])
    args.extend(["ifname", interface])

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
    interface = get_wifi_iface()
    logger.info("WiFi iface: %s", interface)

    result = _run_nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    if result.returncode != 0:
        message = result.stderr.strip() or "No se pudo obtener el estado"
        raise WifiError(message, stderr=result.stderr, code=result.returncode)

    wifi_devices = _extract_wifi_devices(result.stdout.splitlines())
    current = wifi_devices.get(interface, {"state": "", "connection": None})

    state = current.get("state") or ""
    connection = current.get("connection")
    connected = bool(connection) and state.strip().lower().startswith("connected")

    ip_address = None
    if connected:
        show = _run_nmcli(["-t", "-f", "IP4.ADDRESS", "device", "show", interface])
        if show.returncode == 0:
            for line in show.stdout.splitlines():
                if not line.startswith("IP4.ADDRESS"):
                    continue
                _, value = line.split(":", 1)
                address = value.strip()
                if address:
                    ip_address = address.split("/")[0]
                    break
        else:
            logger.debug("No se pudo obtener la IP para %s: %s", interface, show.stderr.strip())

    return {
        "connected": connected,
        "ssid": connection,
        "interface": interface,
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
