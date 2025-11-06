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
  
  # Función para verificar si un binario es desde snap
  is_snap_binary() {
    local bin_path="$1"
    if [[ -z "$bin_path" ]]; then
      return 1
    fi
    local realpath
    realpath="$(readlink -f "$bin_path" 2>/dev/null || echo "$bin_path")"
    if [[ "$realpath" == *"/snap/"* ]]; then
      return 0
    fi
    return 1
  }
  
  # Desinstalar chromium-browser transicional si apunta a snap
  if command -v chromium-browser >/dev/null 2>&1; then
    if is_snap_binary "$(command -v chromium-browser)"; then
      log "Desinstalando chromium-browser transicional (snap)..."
      sudo apt-get remove -y chromium-browser 2>/dev/null || true
    fi
  fi
  
  # Intentar instalar chromium real
  CHROMIUM_INSTALLED=0
  if ! command -v chromium >/dev/null 2>&1 || (command -v chromium >/dev/null 2>&1 && is_snap_binary "$(command -v chromium)"); then
    log "Instalando chromium desde repositorios..."
    if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium 2>&1; then
      if command -v chromium >/dev/null 2>&1 && ! is_snap_binary "$(command -v chromium)"; then
        CHROMIUM_INSTALLED=1
        log "✓ Chromium instalado desde repositorios"
      fi
    fi
    
    # Si falla, intentar desde PPA
    if [[ $CHROMIUM_INSTALLED -eq 0 ]]; then
      log "Intentando instalar desde PPA de Chromium..."
      sudo add-apt-repository -y ppa:saiarcot895/chromium-beta 2>/dev/null || true
      sudo apt-get update
      if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium 2>&1; then
        if command -v chromium >/dev/null 2>&1 && ! is_snap_binary "$(command -v chromium)"; then
          CHROMIUM_INSTALLED=1
          log "✓ Chromium instalado desde PPA"
        fi
      fi
    fi
  else
    # Verificar que el chromium existente no es snap
    if command -v chromium >/dev/null 2>&1 && ! is_snap_binary "$(command -v chromium)"; then
      CHROMIUM_INSTALLED=1
      log "✓ Chromium ya está instalado (no snap)"
    fi
  fi
  
  if [[ $CHROMIUM_INSTALLED -eq 0 ]]; then
    log_err "No fue posible instalar Chromium real (no snap)"
    log_err "El paquete chromium-browser es transicional a snap y no es compatible"
    exit 1
  fi
}

find_chromium_bin() {
  # Función para verificar si un binario es desde snap
  is_snap_binary() {
    local bin_path="$1"
    if [[ -z "$bin_path" ]]; then
      return 1
    fi
    local realpath
    realpath="$(readlink -f "$bin_path" 2>/dev/null || echo "$bin_path")"
    if [[ "$realpath" == *"/snap/"* ]]; then
      return 0
    fi
    return 1
  }
  
  # Priorizar binarios reales (no snap)
  local candidate
  for candidate in chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      local bin_path
      bin_path="$(command -v "$candidate")"
      if ! is_snap_binary "$bin_path"; then
        echo "$bin_path"
        return 0
      fi
    fi
  done
  
  # Fallback a snap solo si no hay alternativa
  if [[ -x /snap/bin/chromium ]]; then
    log "⚠ Usando Chromium desde snap (no recomendado)"
    echo "/snap/bin/chromium"
    return 0
  fi
  
  return 1
}

prepare_dirs() {
  log "Preparando directorios de estado/caché…"
  sudo install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$STATE_DIR" "$CACHE_DIR"
  sudo install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$CHROMIUM_STATE"
  sudo install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$CHROMIUM_CACHE"
  
  # Limpiar archivos de bloqueo residuales
  log "Limpiando archivos de bloqueo residuales..."
  find "$CHROMIUM_STATE" -type f \( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" -o -name "LOCK" \) -delete 2>/dev/null || true
  find "$CHROMIUM_CACHE" -type f -name "LOCK" -delete 2>/dev/null || true
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
