#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Este script debe ejecutarse con sudo/root" >&2
  exit 1
fi

KIOSK_USER=${KIOSK_USER:-dani}
REPO_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
SYSTEMD_DIR=/etc/systemd/system

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { printf '%s [INFO] %s\n' "$(ts)" "$*"; }
err() { printf '%s [ERR ] %s\n' "$(ts)" "$*" >&2; }

if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  err "El usuario ${KIOSK_USER} no existe"
  exit 1
fi

USER_UID=$(id -u "$KIOSK_USER")
USER_GID=$(id -g "$KIOSK_USER")
USER_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)
if [[ -z "$USER_HOME" ]]; then
  err "No fue posible obtener el home de ${KIOSK_USER}"
  exit 1
fi

log "Corrigiendo directorio /run/user/${USER_UID}"
install -d -m 0700 -o "$KIOSK_USER" -g "$KIOSK_USER" "/run/user/${USER_UID}"

log "Garantizando ~/.Xauthority"
touch "${USER_HOME}/.Xauthority"
chown "$KIOSK_USER:$KIOSK_USER" "${USER_HOME}/.Xauthority"
chmod 0600 "${USER_HOME}/.Xauthority"

log "Creando perfil Firefox pantalla-kiosk"
profile_dir="${USER_HOME}/.mozilla/pantalla-kiosk"
install -d -m 0700 -o "$KIOSK_USER" -g "$KIOSK_USER" "$profile_dir"
cat >"${profile_dir}/user.js" <<'EOF'
user_pref("gfx.webrender.enabled", false);
user_pref("gfx.webrender.force-disabled", true);
user_pref("layers.acceleration.disabled", true);
user_pref("browser.startup.homepage", "http://127.0.0.1");
user_pref("browser.startup.page", 1);
user_pref("browser.shell.checkDefaultBrowser", false);
EOF
chown "$KIOSK_USER:$KIOSK_USER" "${profile_dir}/user.js"
chmod 0644 "${profile_dir}/user.js"

log "Actualizando Openbox autostart"
install -d -m 0755 -o "$KIOSK_USER" -g "$KIOSK_USER" "${USER_HOME}/.config/openbox"
install -m 0644 -o "$KIOSK_USER" -g "$KIOSK_USER" \
  "$REPO_DIR/openbox/autostart" "${USER_HOME}/.config/openbox/autostart"

log "Instalando target y servicios systemd"
install -D -m 0644 "$REPO_DIR/systemd/pantalla-session.target" \
  "${SYSTEMD_DIR}/pantalla-session.target"
sed "s/__KIOSK_USER__/${KIOSK_USER}/g" "$REPO_DIR/systemd/pantalla-xorg.service" > \
  "${SYSTEMD_DIR}/pantalla-xorg.service"
install -m 0644 "$REPO_DIR/systemd/pantalla-openbox@.service" \
  "${SYSTEMD_DIR}/pantalla-openbox@.service"

log "Recargando systemd"
systemctl daemon-reload

log "Habilitando target y servicios de kiosk"
systemctl enable pantalla-session.target >/dev/null 2>&1 || true
systemctl enable pantalla-xorg.service >/dev/null 2>&1 || true
systemctl enable "pantalla-openbox@${KIOSK_USER}.service" >/dev/null 2>&1 || true

log "Entorno kiosk corregido"
