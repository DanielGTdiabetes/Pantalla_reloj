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
log "Instalando/Reparando Firefox (script dedicado)"
FIREFOX_LANG="$FIREFOX_LANG" FIREFOX_URL="$FIREFOX_URL" \
  "$REPO_DIR/scripts/install_firefox.sh"

# ---------------------------------------------------------------------------
# 4) Units de systemd
# ---------------------------------------------------------------------------
log "Instalando unidad pantalla-dash-backend@.service"
backend_service_template="$REPO_DIR/system/pantalla-dash-backend@.service"
backend_service_target="/etc/systemd/system/pantalla-dash-backend@.service"
sed "s#__REPO_DIR__#${REPO_DIR}#g" "$backend_service_template" > "$backend_service_target"
chmod 0644 "$backend_service_target"
systemctl daemon-reload

# ---------------------------------------------------------------------------
# 5) Reparación del entorno kiosk (target/autostart/permisos)
# ---------------------------------------------------------------------------
log "Aplicando scripts/fix_kiosk_env.sh"
KIOSK_USER="$KIOSK_USER" "$REPO_DIR/scripts/fix_kiosk_env.sh"

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
