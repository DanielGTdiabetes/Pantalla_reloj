from __future__ import annotations

import logging
import shlex
import shutil
import subprocess
from typing import Dict, List, Optional

from .config import get_wifi_interface, read_config

logger = logging.getLogger(__name__)

NMCLI_BIN = "nmcli"
AP_SERVICE = "pantalla-ap.service"


class WifiError(Exception):
    pass


def _run_nmcli(args: List[str]) -> subprocess.CompletedProcess:
    cmd = [NMCLI_BIN] + args
    sanitized: List[str] = []
    mask_next = False
    for part in cmd:
        if mask_next:
            sanitized.append("****")
            mask_next = False
            continue
        sanitized.append(part)
        if part.lower() == "password":
            mask_next = True
    logger.debug("Executing nmcli command: %s", " ".join(shlex.quote(part) for part in sanitized))
    return subprocess.run(cmd, check=False, capture_output=True, text=True)


def _truncate(text: str, limit: int = 4096) -> str:
    if not text:
        return ""
    text = text.strip()
    if len(text) > limit:
        return text[:limit]
    return text


def scan_networks() -> List[Dict[str, Optional[str]]]:
    config = read_config()
    interface = get_wifi_interface(config)
    args = ["-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list"]
    if interface:
        args.extend(["ifname", interface])
    result = _run_nmcli(args)
    if result.returncode != 0:
        logger.error("nmcli scan failed: %s", result.stderr.strip())
        raise WifiError(result.stderr.strip() or "No se pudo escanear redes Wi-Fi")

    networks: List[Dict[str, Optional[str]]] = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        parts = line.split(":")
        if len(parts) < 3:
            continue
        ssid = parts[0].strip()
        signal = parts[1].strip()
        security = parts[2].strip() or "OPEN"
        networks.append(
            {
                "ssid": ssid,
                "signal": int(signal) if signal.isdigit() else None,
                "security": security,
            }
        )
    # Deduplicate by SSID keeping highest signal
    dedup: Dict[str, Dict[str, Optional[str]]] = {}
    for net in networks:
        existing = dedup.get(net["ssid"])
        if not existing or (net["signal"] or 0) > (existing["signal"] or 0):
            dedup[net["ssid"]] = net
    ordered = sorted(
        dedup.values(),
        key=lambda item: item.get("signal") if item.get("signal") is not None else -1,
        reverse=True,
    )
    return ordered


def connect(ssid: str, psk: Optional[str] = None) -> None:
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
        stderr = result.stderr.strip()
        logger.error("Error al conectar a Wi-Fi: %s", stderr)
        raise WifiError(stderr or "No se pudo conectar a la red")

    stop_access_point_service()


def forget(ssid: str) -> None:
    if not ssid:
        raise WifiError("SSID requerido")
    args = ["connection", "delete", "id", ssid]
    result = _run_nmcli(args)
    if result.returncode != 0:
        stderr = result.stderr.strip()
        logger.error("Error al olvidar red Wi-Fi: %s", stderr)
        raise WifiError(stderr or "No se pudo olvidar la red")


def status() -> Dict[str, Optional[str]]:
    config = read_config()
    preferred_interface = get_wifi_interface(config)
    args = ["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"]
    result = _run_nmcli(args)
    if result.returncode != 0:
        logger.error("nmcli status failed: %s", result.stderr.strip())
        raise WifiError(result.stderr.strip() or "No se pudo obtener el estado")

    active_ssid = None
    active_device = None
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
    if active_ssid:
        device = preferred_interface or active_device
        if device:
            show = _run_nmcli(["-t", "-f", "IP4.ADDRESS[1]", "device", "show", device])
            if show.returncode == 0:
                for line in show.stdout.splitlines():
                    if line:
                        ip_address = line.split("/")[0]
                        break

    return {
        "connected": bool(active_ssid),
        "ssid": active_ssid,
        "ip": ip_address,
    }


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


def wifi_scan() -> Dict[str, object]:
    if shutil.which(NMCLI_BIN) is None:
        return {"items": [], "raw": "nmcli not found"}

    config = read_config()
    interface = get_wifi_interface(config)
    args = ["-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list"]
    if interface:
        args.extend(["ifname", interface])

    result = _run_nmcli(args)
    raw_parts = [part for part in (result.stdout, result.stderr) if part]
    raw_output = _truncate("\n".join(raw_parts))

    if result.returncode != 0:
        if not raw_output:
            raw_output = f"nmcli exited with code {result.returncode}"
        return {"items": [], "raw": raw_output}

    items: List[Dict[str, object]] = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        parts = line.split(":")
        if len(parts) < 3:
            continue
        ssid = parts[0].strip()
        signal = parts[1].strip()
        security = parts[2].strip() or "OPEN"
        entry: Dict[str, object] = {"ssid": ssid, "security": security}
        if signal.isdigit():
            entry["signal"] = int(signal)
        items.append(entry)

    # Deduplicate by SSID keeping highest signal strength
    dedup: Dict[str, Dict[str, object]] = {}
    for item in items:
        existing = dedup.get(item["ssid"])
        current_signal = item.get("signal")
        existing_signal = existing.get("signal") if isinstance(existing, dict) else None
        if existing is None or (
            isinstance(current_signal, int)
            and (not isinstance(existing_signal, int) or current_signal > existing_signal)
        ):
            dedup[item["ssid"]] = item

    ordered = sorted(
        dedup.values(),
        key=lambda entry: entry.get("signal") if isinstance(entry.get("signal"), int) else -1,
        reverse=True,
    )
    return {"items": ordered, "raw": raw_output}


def wifi_connect(ssid: str, psk: Optional[str] = None) -> Dict[str, object]:
    if not ssid:
        return {"ok": False, "stdout": "", "stderr": "SSID requerido"}

    if shutil.which(NMCLI_BIN) is None:
        return {"ok": False, "stdout": "", "stderr": "nmcli not found"}

    config = read_config()
    interface = get_wifi_interface(config)
    args = ["device", "wifi", "connect", ssid]
    if interface:
        args.extend(["ifname", interface])
    if psk:
        args.extend(["password", psk])

    result = _run_nmcli(args)
    stdout = _truncate(result.stdout)
    stderr = _truncate(result.stderr)
    ok = result.returncode == 0

    if ok:
        try:
            stop_access_point_service()
        except Exception:  # pragma: no cover - defensivo
            logger.debug("Fallo al detener AP tras conectar", exc_info=True)

    return {"ok": ok, "stdout": stdout, "stderr": stderr}
