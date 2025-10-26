#!/usr/bin/env bash
set -euo pipefail

USER_NAME="dani"
DISPLAY_NUM=":0"
XAUTH="/var/lib/pantalla-reloj/.Xauthority"
STATE_DIR="/var/lib/pantalla-reloj/state"
CACHE_DIR="/var/lib/pantalla-reloj/cache"
CHROMIUM_STATE="${STATE_DIR}/chromium"
CHROMIUM_CACHE="${CACHE_DIR}/chromium"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_SRC="${REPO_ROOT}/systemd/pantalla-kiosk-chromium@.service"
LAUNCHER_SRC="${REPO_ROOT}/usr/local/bin/pantalla-kiosk-chromium"

log() { printf '[chromium-setup] %s\n' "$*"; }
log_err() { printf '[chromium-setup][ERROR] %s\n' "$*" >&2; }

ensure_packages() {
  log "Asegurando paquetes (Chromium, utilidades X11)…"
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y x11-xserver-utils wmctrl
  if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium-browser; then
    log "chromium-browser no disponible; intentando con paquete chromium"
    if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium; then
      log_err "No fue posible instalar chromium-browser ni chromium"
      exit 1
    fi
  fi
}

find_chromium_bin() {
  local candidate
  for candidate in chromium-browser chromium /snap/bin/chromium; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

prepare_dirs() {
  log "Preparando directorios de estado/caché…"
  sudo install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$STATE_DIR" "$CACHE_DIR"
  sudo install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$CHROMIUM_STATE"
  sudo install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$CHROMIUM_CACHE"
}

disable_epiphany() {
  log "Deshabilitando Epiphany/portal anteriores (si existen)…"
  sudo systemctl disable --now "pantalla-kiosk@${USER_NAME}.service" 2>/dev/null || true
  sudo systemctl disable --now "pantalla-kiosk-watchdog@${USER_NAME}.timer" 2>/dev/null || true
  sudo systemctl stop "pantalla-portal@${USER_NAME}.service" 2>/dev/null || true
  pkill -u "$USER_NAME" -x epiphany-browser 2>/dev/null || true
  pkill -u "$USER_NAME" -f "/usr/bin/epiphany-browser" 2>/dev/null || true
}

install_artifacts() {
  local chromium_bin
  if [[ ! -f "$SERVICE_SRC" ]]; then
    log_err "No se encontró la unidad systemd en ${SERVICE_SRC}"
    exit 1
  fi
  if [[ ! -f "$LAUNCHER_SRC" ]]; then
    log_err "No se encontró el lanzador Chromium en ${LAUNCHER_SRC}"
    exit 1
  fi

  if ! chromium_bin="$(find_chromium_bin)"; then
    log_err "No se encontró el binario de Chromium tras la instalación"
    exit 1
  fi
  log "Usando Chromium en: ${chromium_bin}"

  log "Instalando unidad systemd y lanzador…"
  sudo install -D -m 0644 "$SERVICE_SRC" /etc/systemd/system/pantalla-kiosk-chromium@.service
  sudo install -D -m 0755 "$LAUNCHER_SRC" /usr/local/bin/pantalla-kiosk-chromium

  sudo systemctl daemon-reload
}

enable_services() {
  log "Habilitando servicios base…"
  sudo systemctl enable pantalla-xorg.service
  sudo systemctl enable "pantalla-openbox@${USER_NAME}.service"

  log "Reiniciando Xorg/Openbox…"
  sudo systemctl restart pantalla-xorg.service
  sleep 0.5
  sudo systemctl restart "pantalla-openbox@${USER_NAME}.service"
  sleep 1

  log "Habilitando e iniciando Chromium kiosk…"
  sudo systemctl enable --now "pantalla-kiosk-chromium@${USER_NAME}.service"
}

post_checks() {
  log "Comprobación rápida:"
  DISPLAY="$DISPLAY_NUM" XAUTHORITY="$XAUTH" xrandr --query | sed -n '1,12p' || true
  DISPLAY="$DISPLAY_NUM" XAUTHORITY="$XAUTH" wmctrl -lx || true
  sudo systemctl --no-pager -l status "pantalla-kiosk-chromium@${USER_NAME}.service" | sed -n '1,35p' || true
  log "Si ves current 480 x 1920 y una ventana chromium.* en wmctrl, el kiosk está operativo."
}

ensure_packages
prepare_dirs
disable_epiphany
install_artifacts
enable_services
post_checks
