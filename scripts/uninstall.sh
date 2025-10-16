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

NGINX_SITE_AV="/etc/nginx/sites-available/pantalla"
NGINX_SITE_EN="/etc/nginx/sites-enabled/pantalla"
WEB_ROOT="/var/www/html"

PURGE_CONFIG=0
PURGE_ASSETS=0
PURGE_LOGS=0
PURGE_VENV=0
PURGE_NODE=0
PURGE_WEBROOT=0
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
fi

log "Parando y deshabilitando servicios…"
# Fondos IA
systemctl stop pantalla-bg-generate.service 2>/dev/null || true
systemctl disable pantalla-bg-generate.service 2>/dev/null || true
systemctl stop pantalla-bg-generate.timer 2>/dev/null || true
systemctl disable pantalla-bg-generate.timer 2>/dev/null || true

# Backend (templated por usuario)
systemctl stop "${BACKEND_SVC_BASENAME}@$APP_USER" 2>/dev/null || true
systemctl disable "${BACKEND_SVC_BASENAME}@$APP_USER" 2>/dev/null || true

log "Eliminando unit files systemd…"
rm -f "$BG_SVC_FILE" "$BG_TIMER_FILE"
rm -f "$BACKEND_SVC_TEMPLATE"

log "Recargando systemd…"
systemctl daemon-reload

log "Eliminando vhost de Nginx…"
rm -f "$NGINX_SITE_EN" "$NGINX_SITE_AV"
nginx -t >/dev/null 2>&1 && systemctl restart nginx || warn "nginx -t falló (quizá ya no está instalado)"

# Purges opcionales
if [[ "$PURGE_WEBROOT" -eq 1 ]]; then
  log "Vaciando $WEB_ROOT…"
  rm -rf "${WEB_ROOT:?}/"* 2>/dev/null || true
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

