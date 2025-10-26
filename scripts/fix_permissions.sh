#!/usr/bin/env bash
set -euo pipefail

PANTALLA_ROOT=/opt/pantalla
STATE_ROOT=/var/lib/pantalla-reloj
STATE_RUNTIME=${STATE_ROOT}/state
CONFIG_ROOT=/var/lib/pantalla
LOG_ROOT=/var/log/pantalla
APP_LOG_DIR=/var/log/pantalla-reloj
WEB_ROOT=/var/www/html
USER=${1:-dani}
GROUP=${2:-$USER}

if [[ $EUID -ne 0 ]]; then
  echo "Este script requiere privilegios de root" >&2
  exit 1
fi

install -d -m 0700 -o "$USER" -g "$GROUP" "$STATE_ROOT"
install -d -m 0755 -o "$USER" -g "$GROUP" "$STATE_RUNTIME"
install -d -m 0755 -o root -g root "$CONFIG_ROOT"
install -d -m 0755 -o "$USER" -g "$GROUP" "$LOG_ROOT"
install -d -m 0755 -o "$USER" -g "$GROUP" "$APP_LOG_DIR" 2>/dev/null || true

chown -R "$USER:$GROUP" "$PANTALLA_ROOT" "$STATE_ROOT" "$APP_LOG_DIR" "$LOG_ROOT" 2>/dev/null || true
chown -R www-data:www-data "$WEB_ROOT" 2>/dev/null || true

chmod 755 "$PANTALLA_ROOT" 2>/dev/null || true
chmod 700 "$STATE_ROOT" 2>/dev/null || true
chmod 755 "$STATE_RUNTIME" "$STATE_ROOT/cache" 2>/dev/null || true

APP_ID=org.gnome.Epiphany.WebApp_PantallaReloj
PROFILE_DIR="${STATE_RUNTIME}/${APP_ID}"
install -d -m 0700 -o "$USER" -g "$GROUP" "$PROFILE_DIR" 2>/dev/null || true
for marker in app-id desktop-id; do
  marker_path="${PROFILE_DIR}/${marker}"
  if [[ -f "$marker_path" ]]; then
    chown "$USER:$GROUP" "$marker_path" 2>/dev/null || true
    chmod 600 "$marker_path" 2>/dev/null || true
  fi
done

chown "$USER:$GROUP" "$LOG_ROOT" 2>/dev/null || true
chmod 755 "$LOG_ROOT" 2>/dev/null || true

if [[ -d "$APP_LOG_DIR" ]]; then
  find "$APP_LOG_DIR" -maxdepth 1 -type f -name "*.log" -exec chmod 664 {} + 2>/dev/null || true
fi

echo "Permisos corregidos para Pantalla_reloj"
