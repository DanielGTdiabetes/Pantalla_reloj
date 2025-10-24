#!/usr/bin/env bash
set -euo pipefail

# ==========================
# Pantalla Futurista - Uninstaller
# Ejecutar desde: Pantalla_reloj/scripts/uninstall.sh
# Ubuntu/Debian + systemd · idempotente
# ==========================

log(){ printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
err(){ printf "\033[1;31m[ERR ]\033[0m %s\n" "$*" >&2; }
die(){ err "$*"; exit 1; }

APP_USER="${SUDO_USER:-${USER}}"
REPO_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/dash-ui"

ENV_DIR="/etc/pantalla-dash"
ASSETS_ROOT="/opt/dash"
ASSETS_DIR="$ASSETS_ROOT/assets/backgrounds/auto"
LOG_DIR="/var/log/pantalla-dash"

SYSTEMD_DIR="/etc/systemd/system"
BACKEND_SVC_BASENAME="pantalla-dash-backend"
BACKEND_SVC_TEMPLATE="$SYSTEMD_DIR/${BACKEND_SVC_BASENAME}@.service"
BG_SVC_FILE="$SYSTEMD_DIR/pantalla-bg-generate.service"
BG_TIMER_FILE="$SYSTEMD_DIR/pantalla-bg-generate.timer"
BG_TIMER_OVERRIDE_DIR="$SYSTEMD_DIR/pantalla-bg-generate.timer.d"
BG_SYNC_SERVICE_FILE="$SYSTEMD_DIR/pantalla-bg-sync.service"
BG_SYNC_PATH_FILE="$SYSTEMD_DIR/pantalla-bg-sync.path"
BG_SYNC_SCRIPT="/usr/local/sbin/pantalla-bg-sync-timer"

NGINX_SITE_AV="/etc/nginx/sites-available/pantalla"
NGINX_SITE_EN="/etc/nginx/sites-enabled/pantalla"
WEB_ROOT="/var/www/html"

PURGE_CONFIG=0
PURGE_ASSETS=0
PURGE_LOGS=0
PURGE_VENV=0
PURGE_NODE=0
PURGE_WEBROOT=0
PURGE_OPENBOX_BLOCK=0
PURGE_ALL=0

usage() {
  cat <<EOF
Uso: sudo ./scripts/uninstall.sh [opciones]

Opciones de borrado (por defecto NO se borran):
  --purge-config     Borra /etc/pantalla-dash (claves y config)
  --purge-assets     Borra /opt/dash/assets (fondos generados)
  --purge-logs       Borra /var/log/pantalla-dash
  --purge-venv       Borra venv del backend (backend/.venv)
  --purge-node       Borra node_modules del frontend (dash-ui/node_modules)
  --purge-webroot    Vacía /var/www/html
  --purge-openbox-block  Elimina el bloque gestionado de autostart Openbox
  --purge-all        Hace todo lo anterior

Ayuda:
  -h, --help         Muestra esta ayuda

Siempre:
  - Detiene/inhabilita y elimina los servicios systemd (backend y fondos IA)
  - Elimina el vhost de Nginx (pantalla)
  - Recarga systemd y Nginx
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-config) PURGE_CONFIG=1; shift;;
    --purge-assets) PURGE_ASSETS=1; shift;;
    --purge-logs) PURGE_LOGS=1; shift;;
    --purge-venv) PURGE_VENV=1; shift;;
    --purge-node) PURGE_NODE=1; shift;;
    --purge-webroot) PURGE_WEBROOT=1; shift;;
    --purge-openbox-block) PURGE_OPENBOX_BLOCK=1; shift;;
    --purge-all) PURGE_ALL=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "Opción desconocida: $1";;
  esac
done

if [[ "$PURGE_ALL" -eq 1 ]]; then
  PURGE_CONFIG=1
  PURGE_ASSETS=1
  PURGE_LOGS=1
  PURGE_VENV=1
  PURGE_NODE=1
  PURGE_WEBROOT=1
  PURGE_OPENBOX_BLOCK=1
fi

log "Parando y deshabilitando servicios…"
# Fondos IA
systemctl stop pantalla-bg-generate.service 2>/dev/null || true
systemctl disable pantalla-bg-generate.service 2>/dev/null || true
systemctl stop pantalla-bg-generate.timer 2>/dev/null || true
systemctl disable pantalla-bg-generate.timer 2>/dev/null || true
systemctl stop pantalla-bg-sync.service 2>/dev/null || true
systemctl disable pantalla-bg-sync.service 2>/dev/null || true
systemctl stop pantalla-bg-sync.path 2>/dev/null || true
systemctl disable pantalla-bg-sync.path 2>/dev/null || true

# Backend (templated por usuario)
systemctl stop "${BACKEND_SVC_BASENAME}@$APP_USER" 2>/dev/null || true
systemctl disable "${BACKEND_SVC_BASENAME}@$APP_USER" 2>/dev/null || true

# UI service (systemd user service)
USER_SYSTEMD_DIR="/etc/systemd/user"
UI_SERVICE_NAME="pantalla-ui.service"
if [[ -f "$USER_SYSTEMD_DIR/$UI_SERVICE_NAME" ]]; then
  log "Deshabilitando servicio de UI de usuario..."
  UI_UID="$(id -u "$APP_USER" 2>/dev/null)" || true
  if [[ -n "$UI_UID" ]]; then
    UI_RUNTIME_DIR="/run/user/$UI_UID"
    UI_SYSTEMD_ENV=("XDG_RUNTIME_DIR=$UI_RUNTIME_DIR" "DBUS_SESSION_BUS_ADDRESS=unix:path=$UI_RUNTIME_DIR/bus")
    sudo -u "$APP_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user stop "$UI_SERVICE_NAME" 2>/dev/null || true
    sudo -u "$APP_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user disable "$UI_SERVICE_NAME" 2>/dev/null || true
  fi
fi

echo "[INFO] Deshabilitando UI por systemd (si existe)…"
UI_KIOSK_USER="${PANTALLA_UI_USER:-$APP_USER}"
if [[ "$UI_KIOSK_USER" == "root" ]]; then
  UI_KIOSK_USER="dani"
fi
UI_KIOSK_HOME="$(getent passwd "$UI_KIOSK_USER" | cut -d: -f6)"
if [[ -n "$UI_KIOSK_HOME" ]]; then
  sudo -u "$UI_KIOSK_USER" systemctl --user disable --now "pantalla-ui@${UI_KIOSK_USER}.service" 2>/dev/null || true
  rm -f "$UI_KIOSK_HOME/.config/systemd/user/pantalla-ui@.service" 2>/dev/null || true
  sudo -u "$UI_KIOSK_USER" systemctl --user daemon-reload 2>/dev/null || true
fi

# Kiosk service (legacy system service si existe)
KIOSK_SERVICE="pantalla-kiosk.service"
if [[ -f "$SYSTEMD_DIR/$KIOSK_SERVICE" ]]; then
  systemctl stop "$KIOSK_SERVICE" 2>/dev/null || true
  systemctl disable "$KIOSK_SERVICE" 2>/dev/null || true
fi

log "Eliminando unit files systemd…"
rm -f "$BG_SVC_FILE" "$BG_TIMER_FILE" "$BG_SYNC_SERVICE_FILE" "$BG_SYNC_PATH_FILE"
rm -rf "$BG_TIMER_OVERRIDE_DIR"
rm -f "$BG_SYNC_SCRIPT"
rm -f /opt/dash/scripts/generate_bg_daily.py 2>/dev/null || true
rm -f /etc/logrotate.d/pantalla-bg 2>/dev/null || true
rm -f "$BACKEND_SVC_TEMPLATE"
rm -f "$SYSTEMD_DIR/$KIOSK_SERVICE" 2>/dev/null || true
rm -f "$USER_SYSTEMD_DIR/$UI_SERVICE_NAME" 2>/dev/null || true

log "Recargando systemd…"
systemctl daemon-reload
# También recargar systemd de usuario si es posible
if [[ -n "${APP_USER:-}" ]]; then
  UI_UID="$(id -u "$APP_USER" 2>/dev/null)" || true
  if [[ -n "$UI_UID" ]]; then
    UI_RUNTIME_DIR="/run/user/$UI_UID"
    UI_SYSTEMD_ENV=("XDG_RUNTIME_DIR=$UI_RUNTIME_DIR" "DBUS_SESSION_BUS_ADDRESS=unix:path=$UI_RUNTIME_DIR/bus")
    sudo -u "$APP_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user daemon-reload 2>/dev/null || true
  fi
fi

log "Eliminando vhost de Nginx…"
rm -f "$NGINX_SITE_EN" "$NGINX_SITE_AV"
# Verificar si nginx está instalado antes de intentar reiniciar
if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/dev/null 2>&1; then
    systemctl restart nginx 2>/dev/null || service nginx restart 2>/dev/null || warn "No se pudo reiniciar nginx"
  else
    warn "nginx -t falló, saltando reinicio"
  fi
else
  log "nginx no está instalado, saltando configuración"
fi

log "Eliminando launcher de UI…"
UI_LAUNCHER="/usr/local/bin/pantalla-ui-launch.sh"
if [[ -f "$UI_LAUNCHER" ]]; then
  rm -f "$UI_LAUNCHER"
  log "  Eliminado $UI_LAUNCHER"
fi

log "Eliminando configuración de sudoers…"
SUDOERS_FILE="/etc/sudoers.d/pantalla-wifi"
if [[ -f "$SUDOERS_FILE" ]]; then
  rm -f "$SUDOERS_FILE"
  log "  Eliminado $SUDOERS_FILE"
fi

# Purges opcionales
if [[ "$PURGE_WEBROOT" -eq 1 ]]; then
  # Verificación de seguridad: asegurar que WEB_ROOT no está vacío y es una ruta válida
  if [[ -n "$WEB_ROOT" ]] && [[ "$WEB_ROOT" != "/" ]] && [[ -d "$WEB_ROOT" ]]; then
    log "Vaciando $WEB_ROOT…"
    rm -rf "${WEB_ROOT:?}/"* 2>/dev/null || true
  else
    warn "WEB_ROOT no válido o vacío, saltando limpieza de webroot"
  fi
fi

if [[ "$PURGE_VENV" -eq 1 ]]; then
  if [[ -d "$BACKEND_DIR/.venv" ]]; then
    log "Borrando venv backend… ($BACKEND_DIR/.venv)"
    rm -rf "$BACKEND_DIR/.venv"
  fi
fi

if [[ "$PURGE_NODE" -eq 1 ]]; then
  if [[ -d "$FRONTEND_DIR/node_modules" ]]; then
    log "Borrando node_modules frontend… ($FRONTEND_DIR/node_modules)"
    rm -rf "$FRONTEND_DIR/node_modules"
  fi
  # También podemos limpiar dist (artefactos de build)
  if [[ -d "$FRONTEND_DIR/dist" ]]; then
    log "Borrando dist frontend… ($FRONTEND_DIR/dist)"
    rm -rf "$FRONTEND_DIR/dist"
  fi
fi

if [[ "$PURGE_LOGS" -eq 1 ]]; then
  log "Borrando logs… ($LOG_DIR)"
  rm -rf "$LOG_DIR"
fi

if [[ "$PURGE_ASSETS" -eq 1 ]]; then
  log "Borrando assets… ($ASSETS_ROOT)"
  rm -rf "$ASSETS_ROOT"
fi

if [[ "$PURGE_CONFIG" -eq 1 ]]; then
  log "Borrando configuración y secretos… ($ENV_DIR)"
  rm -rf "$ENV_DIR"
  
  # Limpiar configuraciones de LightDM si existen
  log "Limpiando configuraciones de LightDM y Openbox…"
  rm -f /etc/lightdm/lightdm.conf.d/50-autologin.conf 2>/dev/null || true
  rm -f /etc/lightdm/lightdm.conf.d/60-session.conf 2>/dev/null || true
  
  # Limpiar políticas de Chromium
  log "Limpiando políticas de geolocalización de Chromium…"
  rm -f /etc/chromium/policies/managed/allow_geolocation.json 2>/dev/null || true
  rm -f /var/snap/chromium/common/chromium/policies/managed/allow_geolocation.json 2>/dev/null || true
  
  # Restaurar autostart de Openbox
  if [[ -n "${APP_USER:-}" ]]; then
    APP_HOME="$(getent passwd "$APP_USER" 2>/dev/null | cut -d: -f6)" || true
    if [[ -n "$APP_HOME" ]] && [[ -f "${APP_HOME}/.config/openbox/autostart" ]]; then
      log "Eliminando autostart de Openbox para ${APP_USER}…"
      rm -f "${APP_HOME}/.config/openbox/autostart"
    fi
    # Restaurar .desktop deshabilitados
    if [[ -d "${APP_HOME}/.config/autostart" ]]; then
      find "${APP_HOME}/.config/autostart" -name '*.desktop.disabled' -type f 2>/dev/null | while read -r disabled; do
        mv "$disabled" "${disabled%.disabled}" 2>/dev/null || true
      done
    fi
  fi
fi

if [[ "$PURGE_OPENBOX_BLOCK" -eq 1 ]]; then
  AUTOSTART_FILE=""
  if [[ -n "$UI_KIOSK_HOME" ]]; then
    AUTOSTART_FILE="$UI_KIOSK_HOME/.config/openbox/autostart"
  fi
  if [[ -f "$AUTOSTART_FILE" ]]; then
    awk '
      BEGIN { skip=0 }
      /--- BEGIN Pantalla_reloj AUTOSTART \(managed\) ---/ { skip=1; next }
      /--- END Pantalla_reloj AUTOSTART \(managed\) ---/ { skip=0; next }
      skip==0 { print }
    ' "$AUTOSTART_FILE" > "${AUTOSTART_FILE}.clean" && mv -f "${AUTOSTART_FILE}.clean" "$AUTOSTART_FILE"
    chown "$UI_KIOSK_USER":"$UI_KIOSK_USER" "$AUTOSTART_FILE" 2>/dev/null || true
    chmod 0755 "$AUTOSTART_FILE" 2>/dev/null || true
    echo "[INFO] Bloque de autostart purgado."
  fi
fi

# Limpieza del grupo si quedó sin uso (best-effort)
if getent group pantalla >/dev/null 2>&1; then
  warn "Grupo 'pantalla' seguirá existiendo. Puedes borrarlo con: sudo groupdel pantalla (si no tiene miembros)."
fi

echo
log "Desinstalación completada."
echo "Resumen:"
[[ "$PURGE_WEBROOT" -eq 1 ]] && echo "  - /var/www/html vaciado" || echo "  - /var/www/html conservado"
[[ "$PURGE_VENV" -eq 1 ]] && echo "  - backend/.venv eliminado" || echo "  - backend/.venv conservado"
[[ "$PURGE_NODE" -eq 1 ]] && echo "  - dash-ui/node_modules y dist eliminados" || echo "  - dash-ui/node_modules/dist conservados"
[[ "$PURGE_LOGS" -eq 1 ]] && echo "  - logs eliminados" || echo "  - logs conservados"
[[ "$PURGE_ASSETS" -eq 1 ]] && echo "  - assets eliminados" || echo "  - assets conservados"
[[ "$PURGE_CONFIG" -eq 1 ]] && echo "  - config/env eliminados" || echo "  - config/env conservados"

