#!/bin/bash
set -euo pipefail

PASSFILE="/var/lib/pantalla/ap_pass"
CON_NAME="Pantalla-Setup"
SSID="Pantalla-Setup"
DEFAULT_ADDR="10.42.0.1/24"

ensure_pass() {
  install -d -m 700 "$(dirname "$PASSFILE")"
  if [[ ! -f "$PASSFILE" ]]; then
    PASS=$(tr -dc 'A-HJ-NPR-Z2-9' </dev/urandom | head -c 12)
    echo "$PASS" >"$PASSFILE"
    chmod 600 "$PASSFILE"
  fi
}

resolve_interface() {
  if [[ -n "${PREFERRED_IFACE:-}" ]]; then
    echo "$PREFERRED_IFACE"
    return
  fi
  nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="wifi" {print $1; exit}'
}

start_ap() {
  ensure_pass
  local iface
  iface=$(resolve_interface)
  if [[ -z "$iface" ]]; then
    echo "No se encontró interfaz Wi-Fi" >&2
    exit 1
  fi
  local pass
  pass=$(<"$PASSFILE")
  nmcli device set "$iface" managed yes || true
  if ! nmcli connection show "$CON_NAME" >/dev/null 2>&1; then
    nmcli connection add type wifi ifname "$iface" mode ap con-name "$CON_NAME" ssid "$SSID"
  fi
  nmcli connection modify "$CON_NAME" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$pass"
  nmcli connection modify "$CON_NAME" ipv4.addresses "$DEFAULT_ADDR" ipv4.method shared ipv6.method ignore
  nmcli connection up "$CON_NAME"
}

stop_ap() {
  nmcli connection down "$CON_NAME" >/dev/null 2>&1 || true
}

case "${1:-}" in
  start)
    start_ap
    ;;
  stop)
    stop_ap
    ;;
  *)
    echo "Uso: $0 {start|stop}" >&2
    exit 1
    ;;
esac
