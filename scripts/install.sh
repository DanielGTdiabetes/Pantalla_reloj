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
  xorg openbox x11-xserver-utils unclutter dbus-x11 curl ca-certificates nginx xdg-utils wmctrl rsync python3-venv

# ---------------------------------------------------------------------------
# 3) Firefox clásico desde tarball oficial
# ---------------------------------------------------------------------------
log "Verificando instalación de Firefox clásico"
installed_firefox_version=""
if [[ -f /opt/firefox/application.ini ]]; then
  installed_firefox_version=$(grep -E '^Version=' /opt/firefox/application.ini | head -n1 | cut -d= -f2- 2>/dev/null || true)
fi

resolved_url=$(curl -fsI -o /dev/null -w '%{url_effective}' -L "$FIREFOX_URL" || true)
if [[ -n "$resolved_url" ]]; then
  log "Firefox URL resuelto: ${resolved_url}"
else
  warn "No se pudo resolver URL final de Firefox; usando valor original"
  resolved_url="$FIREFOX_URL"
fi

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
  if ! curl -fsSL -o "$firefox_tar" "$resolved_url"; then
    err "No se pudo descargar Firefox desde ${resolved_url}"
    exit 1
  fi
  if [[ ! -s "$firefox_tar" ]]; then
    err "Descarga de Firefox vacía"
    exit 1
  fi

  log "Extrayendo Firefox en entorno temporal"
  if ! tar -xJf "$firefox_tar" -C "$TMP_ROOT"; then
    err "Fallo al extraer el tarball de Firefox"
    exit 1
  fi
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

if [ -x /opt/firefox/firefox ]; then
  if [ ! -L /usr/local/bin/firefox ] || [ "$(readlink -f /usr/local/bin/firefox 2>/dev/null)" != "/opt/firefox/firefox" ]; then
    ln -sf /opt/firefox/firefox /usr/local/bin/firefox
    echo "[INFO] Symlink firefox -> /opt/firefox/firefox creado en /usr/local/bin"
  fi
  log "Firefox operativo: $(/opt/firefox/firefox --version 2>&1)"
else
  warn "Firefox no se encontró en /opt/firefox"
fi

# ---------------------------------------------------------------------------
# 4) Units de systemd
# ---------------------------------------------------------------------------
log "Instalando unidades systemd"
xorg_unit_tmp="${TMP_ROOT}/pantalla-xorg.service"
sed "s/__KIOSK_USER__/${KIOSK_USER}/g" "$REPO_DIR/systemd/pantalla-xorg.service" > "$xorg_unit_tmp"
install -D -m 0644 "$xorg_unit_tmp" /etc/systemd/system/pantalla-xorg.service
install -D -m 0644 "$REPO_DIR/systemd/pantalla-openbox@.service" /etc/systemd/system/pantalla-openbox@.service

backend_service_template="$REPO_DIR/system/pantalla-dash-backend@.service"
backend_service_target="/etc/systemd/system/pantalla-dash-backend@.service"
if [[ ! -f "$backend_service_target" ]]; then
  install -D -m 0644 "$backend_service_template" "$backend_service_target"
fi

if grep -q "__REPO_DIR__" "$backend_service_target" 2>/dev/null; then
  sed "s#__REPO_DIR__#${REPO_DIR}#g" "$backend_service_template" | \
    tee "$backend_service_target" >/dev/null
  systemctl daemon-reload
  echo "[INFO] Actualizado pantalla-dash-backend@.service con REPO_DIR=${REPO_DIR}"
else
  systemctl daemon-reload
fi

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
log "Creando directorios de runtime"
groupadd -f pantalla
install -d -o "${KIOSK_USER}" -g pantalla -m 0775 /opt/dash
install -d -o "${KIOSK_USER}" -g pantalla -m 0775 /etc/pantalla-dash || true
install -d -o "${KIOSK_USER}" -g pantalla -m 0775 /var/cache/pantalla-dash /var/cache/pantalla-dash/radar

log "Provisionando entorno Python del backend"
(
  cd "$REPO_DIR/backend"
  python3 -m venv .venv 2>/dev/null || true
  # shellcheck disable=SC1091
  . .venv/bin/activate
  pip install -U pip >/dev/null
  pip install -r requirements.txt
)

log "Configurando backend y nginx"
systemctl enable "pantalla-dash-backend@${KIOSK_USER}.service" nginx

# ---------------------------------------------------------------------------
# 7) Objetivo gráfico y reinicio de servicios
# ---------------------------------------------------------------------------
log "Estableciendo arranque en graphical.target"
systemctl set-default graphical.target

log "Configurando sitio de nginx"
install -D -m 0644 "$REPO_DIR/etc/nginx/sites-available/pantalla" /etc/nginx/sites-available/pantalla
ln -sf /etc/nginx/sites-available/pantalla /etc/nginx/sites-enabled/pantalla
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm no está disponible en PATH; instale Node.js/npm antes de continuar"
  exit 1
fi

log "Construyendo frontend (dash-ui)"
(
  cd "$REPO_DIR/dash-ui"
  npm ci --no-audit --no-fund
  npm run build
)

log "Publicando frontend en /var/www/html"
if [[ ! -d "$REPO_DIR/dash-ui/dist" ]]; then
  err "La build del frontend no generó el directorio dist/"
  exit 1
fi
install -d -m 0755 /var/www/html
rsync -a --delete "$REPO_DIR/dash-ui/dist/" /var/www/html/

log "Verificando configuración de nginx"
nginx -t
systemctl reload nginx

systemctl enable "pantalla-dash-backend@${KIOSK_USER}.service" >/dev/null 2>&1 || true
systemctl restart "pantalla-dash-backend@${KIOSK_USER}.service"

sleep 2
FRONT_CODE="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1 || true)"
API_CODE_DIRECT="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/api/health || true)"
API_CODE_NGX="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1/api/health || true)"

echo "[CHECK] Frontend       http://127.0.0.1         => ${FRONT_CODE}"
echo "[CHECK] Backend direct http://127.0.0.1:8081    => ${API_CODE_DIRECT}"
echo "[CHECK] Backend via NG http://127.0.0.1/api/... => ${API_CODE_NGX}"

if [[ "$FRONT_CODE" == "200" && "$API_CODE_DIRECT" == "200" && "$API_CODE_NGX" == "200" ]]; then
  echo "[OK] Instalación completada con éxito."
  exit 0
else
  echo "[WARN] Instalación terminada con incidencias (ver códigos arriba)."
  exit 1
fi
