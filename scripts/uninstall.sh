#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Este script debe ejecutarse con sudo/root" >&2
  exit 1
fi

KIOSK_USER=${KIOSK_USER:-dani}
LOG_DIR=/var/log/pantalla
UNINSTALL_LOG=${LOG_DIR}/uninstall.log

mkdir -p "$LOG_DIR"
touch "$UNINSTALL_LOG"
chmod 0644 "$UNINSTALL_LOG"

exec > >(tee -a "$UNINSTALL_LOG") 2>&1

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { printf '%s [INFO] %s\n' "$(ts)" "$*"; }
warn() { printf '%s [WARN] %s\n' "$(ts)" "$*" >&2; }

PURGE_USER_AUTOSTART=0
if [[ $# -gt 0 && "$1" == "--purge-user" ]]; then
  PURGE_USER_AUTOSTART=1
fi

log "Iniciando uninstall.sh (kiosk)"

log "Deteniendo servicios pantalla-xorg y pantalla-openbox"
systemctl stop "pantalla-openbox@${KIOSK_USER}.service" pantalla-xorg.service 2>/dev/null || true
systemctl disable "pantalla-openbox@${KIOSK_USER}.service" pantalla-xorg.service 2>/dev/null || true

log "Eliminando unidades systemd"
rm -f /etc/systemd/system/pantalla-openbox@.service
rm -f /etc/systemd/system/pantalla-xorg.service
systemctl daemon-reload

log "Eliminando Firefox clásico"
rm -f /usr/local/bin/firefox
rm -rf /opt/firefox

if [[ $PURGE_USER_AUTOSTART -eq 1 ]]; then
  USER_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)
  if [[ -n "$USER_HOME" ]]; then
    log "Eliminando autostart de Openbox para ${KIOSK_USER}"
    rm -f "$USER_HOME/.config/openbox/autostart"
  else
    warn "No se encontró el home del usuario ${KIOSK_USER}"
  fi
fi

log "Desinstalación completada"
