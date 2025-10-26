#!/usr/bin/env bash
set -euxo pipefail

USER_NAME=${KIOSK_USER:-dani}
STATE_DIR=${PANTALLA_STATE_DIR:-/var/lib/pantalla-reloj}
AUTH_FILE="${STATE_DIR}/.Xauthority"
LOCK_FILE="${STATE_DIR}/.Xauthority.lock"
LOG_FILE=/tmp/xorg-launch.log

prepare_only=0
if [[ "${1:-}" == "--prepare-only" ]]; then
  prepare_only=1
  shift || true
fi

log() {
  printf '[xorg-launch] %s\n' "$*"
}

install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$STATE_DIR"

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
  install -m 0600 -o "$USER_NAME" -g "$USER_NAME" /dev/null "$AUTH_FILE"
fi

COOKIE=$(mcookie)
if [ -z "$COOKIE" ]; then
  log "No se pudo generar mcookie"
  exit 1
fi

xauth -f "$AUTH_FILE" add :0 . "$COOKIE"

chown "$USER_NAME:$USER_NAME" "$AUTH_FILE"
chmod 0600 "$AUTH_FILE"

printf '[xorg-launch] cookie %s owner=%s perms=%s\n' \
  "$AUTH_FILE" "$(stat -c '%U:%G' "$AUTH_FILE")" "$(stat -c '%a' "$AUTH_FILE")" \
  >>"$LOG_FILE"

if auth_stat=$(stat -c '%U:%G %a' "$AUTH_FILE" 2>/dev/null); then
  log "AUTH_FILE=$AUTH_FILE -> $auth_stat"
else
  log "No se pudo obtener stat de $AUTH_FILE"
fi

HOME_AUTH="/home/${USER_NAME}/.Xauthority"

if [ -L "$HOME_AUTH" ]; then
  log "Eliminando symlink previo ${HOME_AUTH}"
  rm -f "$HOME_AUTH"
fi

install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "/home/${USER_NAME}" >/dev/null 2>&1 || true
install -m 0600 -o "$USER_NAME" -g "$USER_NAME" "$AUTH_FILE" "$HOME_AUTH"

if (( prepare_only )); then
  exit 0
fi

exec /usr/lib/xorg/Xorg :0 -verbose 3 -nolisten tcp -background none vt7 -auth "$AUTH_FILE"
