#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Este script debe ejecutarse con sudo/root" >&2
  exit 1
fi

KIOSK_USER=${KIOSK_USER:-dani}
FIREFOX_LANG=${FIREFOX_LANG:-es-ES}
FIREFOX_URL=${FIREFOX_URL:-"https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=${FIREFOX_LANG}"}
REPO_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
LOG_DIR=/var/log/pantalla
INSTALL_LOG=${LOG_DIR}/install.log
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "${TMP_ROOT}"' EXIT

mkdir -p "$LOG_DIR"
touch "$INSTALL_LOG"
chmod 0644 "$INSTALL_LOG"

exec > >(tee -a "$INSTALL_LOG") 2>&1

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { printf '%s [INFO] %s\n' "$(ts)" "$*"; }
warn() { printf '%s [WARN] %s\n' "$(ts)" "$*" >&2; }
err() { printf '%s [ERR ] %s\n' "$(ts)" "$*" >&2; }

log "Iniciando install.sh (kiosk Firefox/Openbox)"

# ---------------------------------------------------------------------------
# 1) Limpieza de Snap y PPAs conflictivos
# ---------------------------------------------------------------------------
log "Purga de Snap y PPAs relacionados con Chromium"
if command -v snap >/dev/null 2>&1; then
  snap remove --purge firefox chromium 2>/dev/null || true
fi
apt purge -y snapd 2>/dev/null || true
rm -rf /var/cache/snapd /root/snap /home/*/snap 2>/dev/null || true
rm -f /etc/apt/sources.list.d/*chromium*.list /etc/apt/sources.list.d/*ungoogled*.list 2>/dev/null || true
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop snapd snapd.apparmor 2>/dev/null || true
  systemctl disable snapd snapd.apparmor 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 2) Paquetes base
# ---------------------------------------------------------------------------
log "Actualizando índices de APT"
apt update -y
log "Instalando paquetes base (Xorg/Openbox/firefox deps)"
apt install -y --no-install-recommends \
  xorg openbox x11-xserver-utils unclutter dbus-x11 curl ca-certificates nginx xdg-utils wmctrl

# ---------------------------------------------------------------------------
# 3) Firefox clásico desde tarball oficial
# ---------------------------------------------------------------------------
log "Verificando instalación de Firefox clásico"
installed_firefox_version=""
if [[ -f /opt/firefox/application.ini ]]; then
  installed_firefox_version=$(grep -E '^Version=' /opt/firefox/application.ini | head -n1 | cut -d= -f2- 2>/dev/null || true)
fi

resolved_url=$(curl -fsI -o /dev/null -w '%{url_effective}' -L "$FIREFOX_URL" || true)
resolved_version=""
if [[ -n "$resolved_url" ]]; then
  resolved_file=${resolved_url##*/}
  resolved_file=${resolved_file%.tar.xz}
  resolved_version=${resolved_file#firefox-}
fi

firefox_tar="${TMP_ROOT}/firefox.tar.xz"
need_download=1
if [[ -x /opt/firefox/firefox && -n "$installed_firefox_version" && -n "$resolved_version" && "$installed_firefox_version" == "$resolved_version" ]]; then
  need_download=0
  log "Firefox ${installed_firefox_version} ya instalado; no se requiere descarga"
fi

new_firefox_version="$installed_firefox_version"
if (( need_download )); then
  log "Descargando Firefox desde Mozilla (${FIREFOX_LANG})"
  curl -fsSL -o "$firefox_tar" "$FIREFOX_URL"
  if [[ ! -s "$firefox_tar" ]]; then
    err "Descarga de Firefox vacía"
    exit 1
  fi

  log "Extrayendo Firefox en entorno temporal"
  tar -xJf "$firefox_tar" -C "$TMP_ROOT"
  if [[ ! -d "${TMP_ROOT}/firefox" ]]; then
    err "No se encontró directorio firefox tras la extracción"
    exit 1
  fi
  if [[ -f "${TMP_ROOT}/firefox/application.ini" ]]; then
    new_firefox_version=$(grep -E '^Version=' "${TMP_ROOT}/firefox/application.ini" | head -n1 | cut -d= -f2- 2>/dev/null || true)
  fi
  if [[ -z "$new_firefox_version" ]]; then
    new_firefox_version=$(${TMP_ROOT}/firefox/firefox --version 2>/dev/null || true)
  fi
  if [[ -z "$new_firefox_version" ]]; then
    err "No se pudo obtener la versión de Firefox descargada"
    exit 1
  fi

  log "Instalando Firefox (${new_firefox_version}) en /opt/firefox"
  rm -rf /opt/firefox
  mkdir -p /opt
  mv "${TMP_ROOT}/firefox" /opt/firefox
  chown -R root:root /opt/firefox
  chmod -R 0755 /opt/firefox
fi

wrapper_tmp="${TMP_ROOT}/firefox-wrapper"
cat <<'WRAPPER' > "$wrapper_tmp"
#!/usr/bin/env bash
exec /opt/firefox/firefox "$@"
WRAPPER

if ! cmp -s "$wrapper_tmp" /usr/local/bin/firefox 2>/dev/null; then
  log "Actualizando wrapper de Firefox en /usr/local/bin/firefox"
  install -D -m 0755 "$wrapper_tmp" /usr/local/bin/firefox
fi

log "Firefox operativo: $(/usr/local/bin/firefox --version)"

# ---------------------------------------------------------------------------
# 4) Units de systemd
# ---------------------------------------------------------------------------
log "Instalando unidades systemd"
install -D -m 0644 "$REPO_DIR/systemd/pantalla-xorg.service" /etc/systemd/system/pantalla-xorg.service
install -D -m 0644 "$REPO_DIR/systemd/pantalla-openbox@.service" /etc/systemd/system/pantalla-openbox@.service
systemctl daemon-reload
systemctl enable pantalla-xorg.service "pantalla-openbox@${KIOSK_USER}.service"

# ---------------------------------------------------------------------------
# 5) Autostart de Openbox para el usuario kiosk
# ---------------------------------------------------------------------------
USER_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)
if [[ -z "$USER_HOME" ]]; then
  err "El usuario ${KIOSK_USER} no existe"
  exit 1
fi
log "Configurando autostart de Openbox para ${KIOSK_USER}"
install -d -m 0755 -o "$KIOSK_USER" -g "$KIOSK_USER" "$USER_HOME/.config/openbox"
autostart_dest="$USER_HOME/.config/openbox/autostart"
if ! cmp -s "$REPO_DIR/openbox/autostart" "$autostart_dest" 2>/dev/null; then
  install -m 0644 -o "$KIOSK_USER" -g "$KIOSK_USER" "$REPO_DIR/openbox/autostart" "$autostart_dest"
fi

# ---------------------------------------------------------------------------
# 6) Servicios de backend y nginx
# ---------------------------------------------------------------------------
log "Habilitando servicios de backend y nginx"
systemctl enable "pantalla-dash-backend@${KIOSK_USER}.service" nginx

# ---------------------------------------------------------------------------
# 7) Objetivo gráfico y reinicio de servicios
# ---------------------------------------------------------------------------
log "Estableciendo arranque en graphical.target"
systemctl set-default graphical.target

log "Reiniciando servicios principales"
systemctl restart nginx "pantalla-dash-backend@${KIOSK_USER}.service"
systemctl restart pantalla-xorg.service
sleep 6

# ---------------------------------------------------------------------------
# 8) Comprobaciones finales
# ---------------------------------------------------------------------------
log "Realizando comprobaciones finales"
HTTP_ROOT=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1 || true)
HTTP_API=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/api/health || true)
XORG_OK=FAIL
OPENBOX_OK=FAIL
FIREFOX_OK=FAIL
if pgrep -x Xorg >/dev/null 2>&1; then
  XORG_OK=OK
fi
if pgrep -x openbox >/dev/null 2>&1; then
  OPENBOX_OK=OK
fi
if pgrep -f 'firefox.*--kiosk' >/dev/null 2>&1; then
  FIREFOX_OK=OK
fi
log "[CHECK] / => ${HTTP_ROOT} | /api/health => ${HTTP_API} | Xorg=${XORG_OK} | Openbox=${OPENBOX_OK} | Firefox=${FIREFOX_OK}"

if [[ "${HTTP_ROOT}" != "200" || "${HTTP_API}" != "200" || "${XORG_OK}" != "OK" || "${OPENBOX_OK}" != "OK" || "${FIREFOX_OK}" != "OK" ]]; then
  err "Fallaron las comprobaciones finales"
  if command -v journalctl >/dev/null 2>&1; then
    journalctl -u pantalla-xorg -u "pantalla-openbox@${KIOSK_USER}" -u "pantalla-dash-backend@${KIOSK_USER}" --no-pager -n 120 || true
  fi
  exit 1
fi

log "Instalación completada con éxito"
