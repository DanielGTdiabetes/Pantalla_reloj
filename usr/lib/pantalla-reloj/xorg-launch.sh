#!/usr/bin/env bash
set -euo pipefail

USER_NAME=${KIOSK_USER:-dani}
STATE_DIR=${PANTALLA_STATE_DIR:-/var/lib/pantalla-reloj}
AUTH_FILE="${STATE_DIR}/.Xauthority"
LOCK_FILE="${STATE_DIR}/.Xauthority.lock"

log() {
  printf '[xorg-launch] %s\n' "$*"
}

install -d -m 0755 "$STATE_DIR"

# Serialise concurrent regeneration attempts
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Otro proceso está preparando el display, esperando lock"
  flock 9
fi

# Limpiar cookies previas del display :0
if [ -f "$AUTH_FILE" ]; then
  : >"$AUTH_FILE"
else
  touch "$AUTH_FILE"
fi

chown "$USER_NAME:$USER_NAME" "$AUTH_FILE"
chmod 0600 "$AUTH_FILE"

COOKIE=$(mcookie)
if [ -z "$COOKIE" ]; then
  log "No se pudo generar mcookie"
  exit 1
fi

xauth -f "$AUTH_FILE" add :0 . "$COOKIE"

exec /usr/lib/xorg/Xorg :0 -verbose 3 -nolisten tcp -background none vt7 -auth "$AUTH_FILE"
