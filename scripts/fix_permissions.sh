#!/usr/bin/env bash
set -euo pipefail

PANTALLA_ROOT=/opt/pantalla
STATE_DIR=/var/lib/pantalla
LOG_DIR=/var/log/pantalla
WEB_ROOT=/var/www/html
USER=${1:-dani}
GROUP=${2:-$USER}

if [[ $EUID -ne 0 ]]; then
  echo "Este script requiere privilegios de root" >&2
  exit 1
fi

chown -R "$USER:$GROUP" "$PANTALLA_ROOT" "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
chown -R www-data:www-data "$WEB_ROOT" 2>/dev/null || true
chmod 755 "$PANTALLA_ROOT" 2>/dev/null || true
chmod 755 "$STATE_DIR" "$STATE_DIR/cache" 2>/dev/null || true
if [[ -d "$LOG_DIR" ]]; then
  find "$LOG_DIR" -maxdepth 1 -type f -name "*.log" -exec chmod 664 {} + 2>/dev/null || true
fi

echo "Permisos corregidos para Pantalla_reloj"
