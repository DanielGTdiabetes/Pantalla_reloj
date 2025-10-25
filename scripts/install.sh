#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NON_INTERACTIVE=0
WITH_FIREFOX=0
AUTO_REBOOT=0

for arg in "$@"; do
  case "$arg" in
    --non-interactive)
      NON_INTERACTIVE=1
      ;;
    --with-firefox)
      WITH_FIREFOX=1
      ;;
    --auto-reboot)
      AUTO_REBOOT=1
      ;;
    --help|-h)
      echo "Pantalla_reloj installer"
      echo "Usage: sudo bash install.sh [--non-interactive] [--with-firefox] [--auto-reboot]"
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

log_info() {
  printf '[INFO] %s\n' "$*"
}

log_ok() {
  printf '[OK] %s\n' "$*"
}

log_error() {
  printf '[ERROR] %s\n' "$*" >&2
}

USER_NAME="dani"
USER_HOME="/home/${USER_NAME}"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  log_error "El usuario ${USER_NAME} no existe en el sistema"
  exit 1
fi
PANTALLA_ROOT=/opt/pantalla
BACKEND_DEST="$PANTALLA_ROOT/backend"
STATE_DIR=/var/lib/pantalla
STATE_CACHE_DIR="$STATE_DIR/cache"
CONFIG_FILE="$STATE_DIR/config.json"
LOG_DIR=/var/log/pantalla
WEB_ROOT=/var/www/html
FIREFOX_URL="https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=es-ES"
FIREFOX_DEST=/opt/firefox
SYSTEMD_DIR=/etc/systemd/system
NGINX_SITE=/etc/nginx/sites-available/pantalla-reloj.conf
NGINX_SITE_LINK=/etc/nginx/sites-enabled/pantalla-reloj.conf
PR_STATE_DIR=/var/lib/pantalla-reloj
PR_STATE_STATE_DIR="$PR_STATE_DIR/state"
DISPLAY_MANAGER_MARK="$PR_STATE_STATE_DIR/display-manager.masked"

log_info "Desactivando display managers en conflicto"
systemctl disable --now lightdm gdm sddm 2>/dev/null || true
install -d -m 0755 "$PR_STATE_STATE_DIR"
DISPLAY_MANAGER_PRE_MASKED=0
DISPLAY_MANAGER_STATUS="$(systemctl is-enabled display-manager.service 2>/dev/null || true)"
if [[ "$DISPLAY_MANAGER_STATUS" == "masked" ]]; then
  DISPLAY_MANAGER_PRE_MASKED=1
fi
systemctl disable --now display-manager.service 2>/dev/null || true
systemctl mask display-manager.service 2>/dev/null || true
if [[ $DISPLAY_MANAGER_PRE_MASKED -eq 0 ]]; then
  DISPLAY_MANAGER_STATUS="$(systemctl is-enabled display-manager.service 2>/dev/null || true)"
  if [[ "$DISPLAY_MANAGER_STATUS" == "masked" ]]; then
    touch "$DISPLAY_MANAGER_MARK"
  fi
fi

log_info "Actualizando lista de paquetes"
apt-get update -y

APT_PACKAGES=(
  python3-venv
  python3-pip
  python3-dev
  nginx
  xorg
  openbox
  epiphany-browser
  x11-xserver-utils
  wmctrl
  xdotool
  dbus-x11
  curl
  unzip
  jq
  rsync
  file
)
log_info "Instalando dependencias base con APT"
DEBIAN_FRONTEND=noninteractive apt-get install -y "${APT_PACKAGES[@]}"

if ! command -v node >/dev/null 2>&1; then
  log_info "Node.js no encontrado. Instalando Node.js 20.x desde NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
else
  log_info "Node.js detectado ($(node -v)). Se omite instalación."
fi

if ! command -v corepack >/dev/null 2>&1; then
  log_error "Node.js 20.x debería incluir Corepack. Verifique la instalación de Node."
  exit 1
fi

log_info "Habilitando Corepack y npm latest"
corepack enable >/dev/null 2>&1 || true
corepack prepare npm@latest --activate

if ! command -v npm >/dev/null 2>&1; then
  log_error "npm no está disponible después de activar Corepack"
  exit 1
fi

install_firefox() {
  log_info "Descargando Firefox"
  mkdir -p /opt
  local temp_archive
  temp_archive="$(mktemp /tmp/firefox.XXXXXX.tar)"
  if ! curl -fsSL "$FIREFOX_URL" -o "$temp_archive"; then
    rm -f "$temp_archive"
    log_error "No se pudo descargar Firefox desde $FIREFOX_URL"
    exit 1
  fi

  local mime_type
  mime_type="$(file -b --mime-type "$temp_archive")"
  local tar_flag
  case "$mime_type" in
    application/x-bzip2)
      tar_flag="j"
      ;;
    application/x-xz)
      tar_flag="J"
      ;;
    application/gzip|application/x-gzip)
      tar_flag="z"
      ;;
    *)
      rm -f "$temp_archive"
      log_error "El archivo descargado de Firefox no es un tar comprimido válido (tipo: $mime_type)"
      exit 1
      ;;
  esac

  if ! tar -t"${tar_flag}"f "$temp_archive" >/dev/null 2>&1; then
    rm -f "$temp_archive"
    log_error "El archivo descargado de Firefox está corrupto o no se pudo leer"
    exit 1
  fi

  local temp_dir
  temp_dir="$(mktemp -d /tmp/firefox.XXXXXX)"
  tar -x"${tar_flag}"f "$temp_archive" -C "$temp_dir"
  local extracted_dir
  extracted_dir="$(find "$temp_dir" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  if [[ -z "$extracted_dir" ]]; then
    rm -rf "$temp_dir" "$temp_archive"
    log_error "No se pudo determinar el directorio de Firefox extraído"
    exit 1
  fi

  rm -rf "$FIREFOX_DEST"
  mv "$extracted_dir" "$FIREFOX_DEST"
  rm -rf "$temp_dir" "$temp_archive"
  ln -sfn "$FIREFOX_DEST/firefox" /usr/local/bin/firefox
  chmod 755 -R "$FIREFOX_DEST"
  log_info "Firefox instalado en $FIREFOX_DEST"
}

if [[ $WITH_FIREFOX -eq 1 ]]; then
  install_firefox
else
  log_info "Firefox omitido (usa --with-firefox para instalarlo)"
fi

log_info "Preparando estructura en $PANTALLA_ROOT y $STATE_DIR"
install -d -m 0755 "$PANTALLA_ROOT" "$BACKEND_DEST"
install -d -m 0755 "$STATE_DIR" "$STATE_CACHE_DIR"
install -d -m 0755 "$LOG_DIR"
install -d -m 0755 "$PR_STATE_STATE_DIR"

GROUPS_CHANGED=0
if ! id -nG "$USER_NAME" | grep -qw render; then
  usermod -aG render "$USER_NAME"
  GROUPS_CHANGED=1
fi
if ! id -nG "$USER_NAME" | grep -qw video; then
  usermod -aG video "$USER_NAME"
  GROUPS_CHANGED=1
fi

log_info "Sincronizando backend"
rsync -a --delete --exclude '.venv/' "$REPO_ROOT/backend/" "$BACKEND_DEST/"

log_info "Creando entorno virtual del backend"
rm -rf "$BACKEND_DEST/.venv"
python3 -m venv "$BACKEND_DEST/.venv"
"$BACKEND_DEST/.venv/bin/pip" install --upgrade pip wheel
if [[ -f "$BACKEND_DEST/requirements.txt" ]]; then
  "$BACKEND_DEST/.venv/bin/pip" install -r "$BACKEND_DEST/requirements.txt"
else
  "$BACKEND_DEST/.venv/bin/pip" install fastapi uvicorn[standard]
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  log_info "Instalando configuración por defecto en $CONFIG_FILE"
  install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$REPO_ROOT/backend/default_config.json" "$CONFIG_FILE"
fi

touch "$LOG_DIR/backend.log"
chown -R "$USER_NAME:$USER_NAME" "$PANTALLA_ROOT" "$STATE_DIR" "$LOG_DIR" || true

log_info "Instalando autostart de Openbox"
if [[ ! -d "$USER_HOME" ]]; then
  log_error "El usuario $USER_NAME no existe o no tiene HOME en $USER_HOME"
  exit 1
fi
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$USER_HOME/.config/openbox"
install -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$REPO_ROOT/openbox/autostart" "$USER_HOME/.config/openbox/autostart"

log_info "Construyendo frontend"
pushd "$REPO_ROOT/dash-ui" >/dev/null
export VITE_DEFAULT_LAYOUT=${VITE_DEFAULT_LAYOUT:-full}
export VITE_SIDE_PANEL=${VITE_SIDE_PANEL:-right}
export VITE_SHOW_CONFIG=${VITE_SHOW_CONFIG:-0}
export VITE_ENABLE_DEMO=${VITE_ENABLE_DEMO:-0}
export VITE_CAROUSEL=${VITE_CAROUSEL:-0}
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
npm run build
popd >/dev/null

log_info "Publicando frontend en $WEB_ROOT"
install -d -m 0755 "$WEB_ROOT"
rsync -a --delete "$REPO_ROOT/dash-ui/dist/" "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"

log_info "Configurando Nginx"
install -m 0644 "$REPO_ROOT/etc/nginx/sites-available/pantalla-reloj.conf" "$NGINX_SITE"
ln -sfn "$NGINX_SITE" "$NGINX_SITE_LINK"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

log_info "Instalando unidades systemd"
install -m 0644 "$REPO_ROOT/systemd/pantalla-xorg.service" "$SYSTEMD_DIR/pantalla-xorg.service"
install -m 0644 "$REPO_ROOT/systemd/pantalla-openbox@.service" "$SYSTEMD_DIR/pantalla-openbox@.service"
install -m 0644 "$REPO_ROOT/systemd/pantalla-dash-backend@.service" "$SYSTEMD_DIR/pantalla-dash-backend@.service"
systemctl daemon-reload

for svc in pantalla-xorg.service pantalla-dash-backend@${USER_NAME}.service pantalla-openbox@${USER_NAME}.service; do
  systemctl enable "$svc"
  systemctl restart "$svc"
done

log_info "Esperando healthchecks de Nginx y backend"
ROOT_OK=0
API_OK=0
for attempt in $(seq 1 30); do
  if [[ $ROOT_OK -eq 0 ]] && curl -sf http://127.0.0.1/ >/dev/null 2>&1; then
    ROOT_OK=1
  fi
  if [[ $API_OK -eq 0 ]] && curl -sf http://127.0.0.1/api/health >/dev/null 2>&1; then
    API_OK=1
  fi
  if [[ $ROOT_OK -eq 1 && $API_OK -eq 1 ]]; then
    break
  fi
  sleep 1
done

XORG_ACTIVE=0
OPENBOX_ACTIVE=0
BACKEND_ACTIVE=0
NGINX_ACTIVE=0
FAILED=0

if command -v epiphany-browser >/dev/null 2>&1; then
  EPIPHANY_VERSION="$(epiphany-browser --version 2>/dev/null | head -n1 || echo 'desconocida')"
  log_info "Epiphany: OK (${EPIPHANY_VERSION})"
else
  log_error "Epiphany: no instalado"
  FAILED=1
fi

if [[ $WITH_FIREFOX -eq 1 ]]; then
  if [[ -x /usr/local/bin/firefox ]]; then
    FIREFOX_VERSION="$(/usr/local/bin/firefox --version 2>/dev/null | head -n1 || echo 'desconocida')"
    log_info "Firefox: OK (${FIREFOX_VERSION})"
  else
    log_error "Firefox: no instalado (se solicitó --with-firefox)"
    FAILED=1
  fi
else
  if [[ -x /usr/local/bin/firefox ]]; then
    FIREFOX_VERSION="$(/usr/local/bin/firefox --version 2>/dev/null | head -n1 || echo 'desconocida')"
    log_info "Firefox: detectado (${FIREFOX_VERSION})"
  else
    log_info "Firefox: omitido"
  fi
fi

if [[ $ROOT_OK -eq 1 ]]; then
  log_info "Nginx: OK (http://127.0.0.1/ responde 200)"
else
  log_error "Nginx: fallo health check (http://127.0.0.1/)"
  FAILED=1
fi

if [[ $API_OK -eq 1 ]]; then
  log_info "Backend: OK (/api/health 200 vía Nginx)"
else
  log_error "Backend: fallo health check (http://127.0.0.1/api/health)"
  FAILED=1
fi

if [[ -f "$WEB_ROOT/index.html" ]]; then
  log_info "Frontend: OK (dist publicado en $WEB_ROOT)"
else
  log_error "Frontend: no se encontró index.html en $WEB_ROOT"
  FAILED=1
fi

if systemctl is-active --quiet nginx; then
  NGINX_ACTIVE=1
else
  log_error "Nginx no está activo"
  FAILED=1
fi

if systemctl is-active --quiet pantalla-xorg.service; then
  XORG_ACTIVE=1
fi
if systemctl is-active --quiet pantalla-openbox@${USER_NAME}.service; then
  OPENBOX_ACTIVE=1
fi
if systemctl is-active --quiet pantalla-dash-backend@${USER_NAME}.service; then
  BACKEND_ACTIVE=1
fi

if [[ $XORG_ACTIVE -eq 1 && $OPENBOX_ACTIVE -eq 1 && $BACKEND_ACTIVE -eq 1 ]]; then
  log_info "Systemd: Xorg/Openbox/Backend activos"
else
  log_error "Systemd: Servicios no activos (Xorg=$XORG_ACTIVE, Openbox=$OPENBOX_ACTIVE, Backend=$BACKEND_ACTIVE)"
  FAILED=1
fi

if [[ $FAILED -eq 0 ]]; then
  log_ok "Instalación completada"
  if [[ $GROUPS_CHANGED -eq 1 ]]; then
    echo "Se requiere reinicio para aplicar grupos"
    if [[ $AUTO_REBOOT -eq 1 ]]; then
      if [[ $NON_INTERACTIVE -eq 1 ]]; then
        echo "reiniciar ahora"
        systemctl reboot
      else
        read -r -p "¿Reiniciar ahora? [s/N]: " resp
        if [[ "$resp" =~ ^[sS]$ ]]; then
          echo "reiniciar ahora"
          systemctl reboot
        else
          log_info "Reinicio omitido por el usuario"
        fi
      fi
    fi
  fi
  exit 0
else
  log_error "Instalación con errores"
  exit 1
fi
