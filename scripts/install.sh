#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NON_INTERACTIVE=0

for arg in "$@"; do
  case "$arg" in
    --non-interactive)
      NON_INTERACTIVE=1
      ;;
    --help|-h)
      echo "Pantalla_reloj installer"
      echo "Usage: sudo bash install.sh [--non-interactive]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] This installer must be run as root" >&2
  exit 1
fi

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

PANTALLA_ROOT=/opt/pantalla
BACKEND_DIR="$PANTALLA_ROOT/backend"
CONFIG_DIR="$PANTALLA_ROOT/config"
CACHE_DIR="$PANTALLA_ROOT/cache"
LOG_DIR=/var/log/pantalla
WEB_ROOT=/var/www/html
FIREFOX_URL="https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=es-ES"
FIREFOX_DEST=/opt/firefox

log "Deteniendo servicios previos si existen"
systemctl stop pantalla-xorg.service pantalla-openbox@dani.service pantalla-dash-backend@dani.service 2>/dev/null || true
systemctl disable --now lightdm gdm sddm display-manager.service 2>/dev/null || true

log "Limpiando estructura previa"
rm -rf "$PANTALLA_ROOT" "$LOG_DIR" "$WEB_ROOT"/*
mkdir -p "$BACKEND_DIR" "$CONFIG_DIR" "$CACHE_DIR" "$LOG_DIR" "$WEB_ROOT"

log "Actualizando paquetes"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  python3-venv python3-pip python3-dev \
  nginx xorg openbox x11-xserver-utils wmctrl xdotool dbus-x11 \
  curl unzip jq nodejs npm rsync

log "Instalando Firefox en modo kiosk"
rm -rf "$FIREFOX_DEST"
mkdir -p /opt
TEMP_ARCHIVE="$(mktemp /tmp/firefox.XXXXXX.tar.bz2)"
curl -L "$FIREFOX_URL" -o "$TEMP_ARCHIVE"
tar -xjf "$TEMP_ARCHIVE" -C /opt
EXTRACTED_DIR="$(tar -tjf "$TEMP_ARCHIVE" | head -n1 | cut -d/ -f1)"
if [[ -z "$EXTRACTED_DIR" ]]; then
  echo "[ERROR] No se pudo determinar el directorio de Firefox" >&2
  exit 1
fi
mv "/opt/${EXTRACTED_DIR}" "$FIREFOX_DEST"
rm -f "$TEMP_ARCHIVE"
ln -sf "$FIREFOX_DEST/firefox" /usr/local/bin/firefox

log "Copiando backend"
rsync -a --delete "$REPO_ROOT/backend/" "$BACKEND_DIR/"
python3 -m venv "$BACKEND_DIR/.venv"
source "$BACKEND_DIR/.venv/bin/activate"
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"
deactivate

log "Copiando configuración base"
install -m 0644 "$REPO_ROOT/backend/default_config.json" "$CONFIG_DIR/config.json"

log "Preparando cache y logs"
chmod 755 "$PANTALLA_ROOT" "$CACHE_DIR"
touch "$LOG_DIR/backend.log"
chown -R dani:dani "$PANTALLA_ROOT" || true
chown -R dani:dani "$LOG_DIR" || true

log "Construyendo frontend"
cd "$REPO_ROOT/dash-ui"
npm install
npm run build
rm -rf "$WEB_ROOT"/*
cp -r dist/* "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"
cd "$REPO_ROOT"

log "Configurando Nginx"
install -m 0644 "$REPO_ROOT/etc/nginx/sites-available/pantalla-reloj.conf" /etc/nginx/sites-available/pantalla-reloj.conf
ln -sf /etc/nginx/sites-available/pantalla-reloj.conf /etc/nginx/sites-enabled/pantalla-reloj.conf
rm -f /etc/nginx/sites-enabled/default
systemctl reload nginx

log "Instalando unidades systemd"
install -m 0644 "$REPO_ROOT/systemd/pantalla-xorg.service" /etc/systemd/system/pantalla-xorg.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-openbox@.service" /etc/systemd/system/pantalla-openbox@.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-dash-backend@.service" /etc/systemd/system/pantalla-dash-backend@.service
systemctl daemon-reload
systemctl enable pantalla-xorg.service pantalla-openbox@dani.service pantalla-dash-backend@dani.service
systemctl restart pantalla-xorg.service pantalla-openbox@dani.service pantalla-dash-backend@dani.service

log "Forzando rotación de pantalla"
DISPLAY=:0 xrandr --output HDMI-1 --rotate left --primary || true

log "Validando servicios"
SERVICE_STATUS_LOG="$LOG_DIR/services_status.log"
INSTALL_HTML="$LOG_DIR/install_report.html"
mkdir -p "$LOG_DIR"

systemctl --no-pager --full status pantalla-xorg.service pantalla-openbox@dani.service pantalla-dash-backend@dani.service > "$SERVICE_STATUS_LOG" 2>&1 || true
if ! curl -sS -o /tmp/api_health.json http://127.0.0.1:8081/api/health; then
  echo '{"status":"fail"}' > /tmp/api_health.json
fi

{
  echo "<html><head><meta charset='UTF-8'><title>Pantalla_reloj - Estado instalación</title></head>"
  echo "<body style='font-family:monospace;background:#111;color:#0f0;'>"
  echo "<h2>Informe de instalación Pantalla_reloj</h2>"
  echo "<pre>"
  cat "$SERVICE_STATUS_LOG"
  echo "</pre><hr><h3>API /health:</h3><pre>"
  cat /tmp/api_health.json
  echo "</pre><hr><p>Fecha: $(date)</p></body></html>"
} > "$INSTALL_HTML"

log "Informe generado en $INSTALL_HTML"
log "Instalación completada"
