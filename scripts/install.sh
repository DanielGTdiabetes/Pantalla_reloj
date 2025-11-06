#!/usr/bin/env bash
set -euxo pipefail

umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NON_INTERACTIVE=0
DIAG_MODE=0
SUMMARY=()

usage() {
  cat <<USAGE
Pantalla_reloj installer
Usage: sudo bash install.sh [--non-interactive] [--diag-mode]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    --diag-mode)
      DIAG_MODE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] This installer must be run as root" >&2
  exit 1
fi

log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*"; }
log_ok()   { printf '[OK] %s\n' "$*"; }
log_error(){ printf '[ERROR] %s\n' "$*" >&2; }

wait_for_backend_ready() {
  local max_wait=60
  local sleep_interval=5
  local waited=0
  local backend_url="http://127.0.0.1:8081/api/health"
  local backend_service="pantalla-dash-backend@${USER_NAME}.service"

  log_info "Esperando backend en ${backend_url} (timeout ${max_wait}s, interval ${sleep_interval}s)"
  while [[ $waited -lt $max_wait ]]; do
    # Verificar que health responde con status=ok
    if HEALTH_RESPONSE=$(curl -sfS --max-time 5 "$backend_url" 2>/dev/null); then
      if echo "$HEALTH_RESPONSE" | jq -e '.status == "ok"' >/dev/null 2>&1; then
        log_ok "Backend health responde con status=ok"
        SUMMARY+=('[install] backend /api/health responde')
        return 0
      else
        log_info "Backend responde pero status != ok; esperando..."
      fi
    else
      log_info "Backend aún no responde tras ${waited}s; esperando..."
    fi
    
    sleep "$sleep_interval"
    waited=$((waited + sleep_interval))
  done

  # Timeout alcanzado
  log_error "Backend no responde correctamente en 127.0.0.1:8081 tras ${max_wait}s"
  log_warn "Estado del servicio:"
  systemctl --no-pager -l status "$backend_service" | sed -n '1,30p' || true
  log_warn "Últimos 150 registros de systemd (${backend_service}):"
  journalctl -u "$backend_service" -n 150 -o short-iso || true
  return 1
}

USERNAME="${USERNAME:-${SUDO_USER:-$USER}}"
if [[ -z "${USERNAME:-}" ]]; then
  log_error "Unable to determine target user"
  exit 1
fi

USER_NAME="$USERNAME"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  log_error "User '$USER_NAME' must exist before running the installer"
  exit 1
fi
USER_HOME="/home/${USER_NAME}"
USER_UID="$(id -u "$USER_NAME")"

PANTALLA_PREFIX=/opt/pantalla-reloj
SESSION_PREFIX=/opt/pantalla
BACKEND_DEST="${PANTALLA_PREFIX}/backend"
STATE_DIR=/var/lib/pantalla-reloj
STATE_RUNTIME="${STATE_DIR}/state"
LOG_DIR=/var/log/pantalla-reloj
KIOSK_LOG_DIR=/var/log/pantalla
INSTALL_LOG=/tmp/install.log
WEB_ROOT=/var/www/html
WEBROOT_MANIFEST="${STATE_RUNTIME}/webroot-manifest"
WIFI_CONFIG_SRC="${REPO_ROOT}/deploy/network/wifi.conf"
WIFI_CONFIG_DST="/etc/pantalla-reloj/wifi.conf"
KIOSK_BIN_SRC="${REPO_ROOT}/usr/local/bin/pantalla-kiosk"
KIOSK_BIN_DST=/usr/local/bin/pantalla-kiosk
CHROMIUM_KIOSK_BIN_SRC="${REPO_ROOT}/usr/local/bin/pantalla-kiosk-chromium"
CHROMIUM_KIOSK_BIN_DST=/usr/local/bin/pantalla-kiosk-chromium
BACKEND_LAUNCHER_SRC="${REPO_ROOT}/usr/local/bin/pantalla-backend-launch"
BACKEND_LAUNCHER_DST=/usr/local/bin/pantalla-backend-launch
UDEV_RULE=/etc/udev/rules.d/70-pantalla-render.rules
APP_ID=org.gnome.Epiphany.WebApp_PantallaReloj
PROFILE_DIR_SRC="${REPO_ROOT}/var/lib/pantalla-reloj/state/${APP_ID}"
PROFILE_DIR_DST="${STATE_RUNTIME}/${APP_ID}"
NGINX_TEMPLATE="${REPO_ROOT}/deploy/nginx/pantalla-reloj.conf"

install -d -m 0755 "$REPO_ROOT/home/dani/.local/share/applications" >/dev/null 2>&1 || true

install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$USER_HOME"
install -d -m 0755 "$PANTALLA_PREFIX" "$SESSION_PREFIX"
install -d -m 0755 "$SESSION_PREFIX/bin" "$SESSION_PREFIX/openbox"
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" /opt/pantalla-reloj/frontend/static
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$KIOSK_LOG_DIR"
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$LOG_DIR"
# Asegurar directorio principal con permisos 700 (alineado con StateDirectory)
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$STATE_DIR"
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$STATE_RUNTIME"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "${STATE_RUNTIME}/chromium-kiosk"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "${STATE_RUNTIME}/firefox-kiosk"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$PROFILE_DIR_DST"
KIOSK_ENV_FILE="${STATE_RUNTIME}/kiosk.env"
DEFAULT_KIOSK_URL="http://127.0.0.1/"
DIAG_KIOSK_URL="${DEFAULT_KIOSK_URL}diagnostics/auto-pan"
ACTIVE_KIOSK_URL="$DEFAULT_KIOSK_URL"
if (( DIAG_MODE == 1 )); then
  ACTIVE_KIOSK_URL="$DIAG_KIOSK_URL"
  SUMMARY+=("[install] modo diagnóstico habilitado (${ACTIVE_KIOSK_URL})")
fi

# Inicializar variables de navegador (se definirán más adelante)
CHROME_FOUND=0
CHROME_BIN=""
CHROMIUM_FOUND=0
CHROMIUM_BIN=""
if [[ ! -f "$KIOSK_ENV_FILE" ]]; then
  cat >"$KIOSK_ENV_FILE" <<EOF
# Pantalla_reloj kiosk configuration
KIOSK_URL=${ACTIVE_KIOSK_URL}
CHROMIUM_PROFILE_DIR=/var/lib/pantalla-reloj/state/chromium-kiosk
#FIREFOX_PROFILE_DIR=/var/lib/pantalla-reloj/state/firefox-kiosk
#CHROME_BIN_OVERRIDE=
#FIREFOX_BIN_OVERRIDE=
EOF
  chown "$USER_NAME:$USER_NAME" "$KIOSK_ENV_FILE"
  chmod 0644 "$KIOSK_ENV_FILE"
  SUMMARY+=("[install] kiosk.env inicializado en ${KIOSK_ENV_FILE}")
else
  log_info "Preservando kiosk.env existente (${KIOSK_ENV_FILE})"
  SUMMARY+=("[install] kiosk.env preservado (sin cambios)")
fi

# Directorios estándar XDG para Chromium (no Snap)
CHROMIUM_HOME_DATA_DIR="${USER_HOME}/.local/share/pantalla-reloj/chromium"
CHROMIUM_HOME_CACHE_DIR="${USER_HOME}/.cache/pantalla-reloj/chromium"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$CHROMIUM_HOME_DATA_DIR"
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$CHROMIUM_HOME_CACHE_DIR"
if [[ -f "${PROFILE_DIR_SRC}/app-id" ]]; then
  install -o "$USER_NAME" -g "$USER_NAME" -m 0600 "${PROFILE_DIR_SRC}/app-id" "${PROFILE_DIR_DST}/app-id"
fi
if [[ -f "${PROFILE_DIR_SRC}/desktop-id" ]]; then
  install -o "$USER_NAME" -g "$USER_NAME" -m 0600 "${PROFILE_DIR_SRC}/desktop-id" "${PROFILE_DIR_DST}/desktop-id"
fi
chown -R "$USER_NAME:$USER_NAME" "$STATE_DIR"

install -d -m 0755 /etc/pantalla-reloj
if [[ -f "$WIFI_CONFIG_SRC" ]]; then
  if [[ ! -f "$WIFI_CONFIG_DST" ]]; then
    install -m 0644 "$WIFI_CONFIG_SRC" "$WIFI_CONFIG_DST"
  elif ! grep -q '^WIFI_INTERFACE=' "$WIFI_CONFIG_DST"; then
    printf 'WIFI_INTERFACE=wlp2s0\n' >>"$WIFI_CONFIG_DST"
  fi
  wifi_iface="$(grep -E '^WIFI_INTERFACE=' "$WIFI_CONFIG_DST" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  SUMMARY+=("[install] Wi-Fi interface en ${WIFI_CONFIG_DST}: ${wifi_iface:-<no definida>}")
fi

log_info "Installing base packages"
APT_PACKAGES=(
  nginx
  xorg
  openbox
  x11-xserver-utils
  wmctrl
  epiphany-browser
  xdg-desktop-portal
  xdg-desktop-portal-gtk
  xdotool
  procps
  dbus-x11
  curl
  unzip
  jq
  rsync
  file
  xauth
  python3-venv
  unclutter-xfixes
)
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y "${APT_PACKAGES[@]}"
SUMMARY+=("[install] paquetes asegurados: ${APT_PACKAGES[*]}")

log_info "Navegador kiosk predeterminado: Chromium (fallback a Firefox si está disponible)"
SUMMARY+=("[install] navegador kiosk predeterminado=chromium (fallback firefox)")

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local version major
    version="$(node -v | sed 's/^v//')"
    major="${version%%.*}"
    if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 20 )); then
      log_info "Detected Node.js $(node -v)"
      return
    fi
    log_warn "Node.js $(node -v) is older than required (>=20). Upgrading."
  else
    log_info "Node.js not found. Installing Node.js 20.x"
  fi

  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
}

ensure_node
SUMMARY+=('[install] entorno Node.js 20+ disponible')

if ! command -v corepack >/dev/null 2>&1; then
  log_error "Corepack not available after installing Node.js"
  exit 1
fi

log_info "Configuring npm via Corepack"
corepack enable >/dev/null 2>&1 || true
corepack prepare npm@latest --activate

if ! command -v npm >/dev/null 2>&1; then
  log_error "npm not available after activating Corepack"
  exit 1
fi

log_info "Ensuring user ${USER_NAME} belongs to render/video"
if ! id -nG "$USER_NAME" | grep -qw render; then
  usermod -aG render "$USER_NAME"
fi
if ! id -nG "$USER_NAME" | grep -qw video; then
  usermod -aG video "$USER_NAME"
fi

log_info "Installing udev rules for GPU access"
cat <<'RULE' >"$UDEV_RULE"
KERNEL=="renderD*", GROUP="render", MODE="0660"
KERNEL=="card[0-9]*", GROUP="video", MODE="0660"
RULE
udevadm control --reload
udevadm trigger

log_info "Syncing backend into $BACKEND_DEST"
install -d -m 0755 "$BACKEND_DEST"
rsync -a --delete --exclude '.venv/' "$REPO_ROOT/backend/" "$BACKEND_DEST/"
SUMMARY+=("[install] backend sincronizado en ${BACKEND_DEST}")

log_info "Preparing backend virtualenv"
python3 -m venv "$BACKEND_DEST/.venv"
"$BACKEND_DEST/.venv/bin/pip" install --upgrade pip wheel
if [[ -f "$BACKEND_DEST/requirements.txt" ]]; then
  "$BACKEND_DEST/.venv/bin/pip" install -r "$BACKEND_DEST/requirements.txt"
fi

# Validar dependencias críticas después de la instalación
log_info "Validating backend dependencies"
PYTHON_BIN="$BACKEND_DEST/.venv/bin/python"
MISSING_DEPS=()
if ! "$PYTHON_BIN" -c "import fastapi" 2>/dev/null; then
  MISSING_DEPS+=("fastapi")
fi
if ! "$PYTHON_BIN" -c "import uvicorn" 2>/dev/null; then
  MISSING_DEPS+=("uvicorn")
fi
if ! "$PYTHON_BIN" -c "import shapely" 2>/dev/null; then
  MISSING_DEPS+=("shapely")
  log_warn "shapely no está instalado - modo 'both' de cine_focus usará fallback"
fi
if ! "$PYTHON_BIN" -c "import multipart" 2>/dev/null; then
  MISSING_DEPS+=("python-multipart")
fi
if ! "$PYTHON_BIN" -c "import icalendar" 2>/dev/null; then
  MISSING_DEPS+=("icalendar")
fi
if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
  log_error "Dependencias faltantes: ${MISSING_DEPS[*]}"
  log_error "El backend puede fallar. Reintenta la instalación."
  exit 1
fi
SUMMARY+=("[install] dependencias Python validadas")

# Estado de directorio ya creado arriba con permisos 0700
CONFIG_FILE="$STATE_DIR/config.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
  # Crear config.json desde default_config_v2.json si existe, sino default_config.json
  if [[ -f "$REPO_ROOT/backend/default_config_v2.json" ]]; then
    install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$REPO_ROOT/backend/default_config_v2.json" "$CONFIG_FILE"
    log_info "Config creado desde default_config_v2.json en ${CONFIG_FILE}"
  elif [[ -f "$REPO_ROOT/backend/default_config.json" ]]; then
    install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$REPO_ROOT/backend/default_config.json" "$CONFIG_FILE"
    log_info "Config creado desde default_config.json en ${CONFIG_FILE}"
  else
    log_error "No se encontró default_config.json ni default_config_v2.json"
    exit 1
  fi
  SUMMARY+=("[install] config.json creado en ${CONFIG_FILE}")
else
  # Asegurar permisos correctos del config existente
  chown "$USER_NAME:$USER_NAME" "$CONFIG_FILE" 2>/dev/null || true
  chmod 0644 "$CONFIG_FILE" 2>/dev/null || true
  log_info "Config existente preservado en ${CONFIG_FILE} (permisos ajustados)"
fi
ICS_DIR="$STATE_DIR/ics"
SAMPLE_ICS="$ICS_DIR/personal.ics"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$ICS_DIR"
if [[ ! -f "$SAMPLE_ICS" ]]; then
  cat <<'EOF' >"$SAMPLE_ICS"
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Pantalla Reloj//ES
BEGIN:VEVENT
UID:sample-event@pantalla-reloj.local
DTSTAMP:20240101T000000Z
DTSTART:20240101T090000Z
DTEND:20240101T093000Z
SUMMARY:Ejemplo de evento
DESCRIPTION:Actualiza este archivo desde el panel de configuración.
LOCATION:Pantalla Reloj
END:VEVENT
END:VCALENDAR
EOF
  chown "$USER_NAME:$USER_NAME" "$SAMPLE_ICS" 2>/dev/null || true
  chmod 0644 "$SAMPLE_ICS" 2>/dev/null || true
  SUMMARY+=("[install] ICS de ejemplo creado en ${SAMPLE_ICS}")
else
  chown "$USER_NAME:$USER_NAME" "$SAMPLE_ICS" 2>/dev/null || true
  chmod 0644 "$SAMPLE_ICS" 2>/dev/null || true
fi
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$STATE_DIR/cache"
# Crear directorios de caché para layers (flights/ships) y focus masks
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 /var/cache/pantalla
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 /var/cache/pantalla/focus
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 /var/cache/pantalla/global
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 /var/cache/pantalla/global/satellite
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 /var/cache/pantalla/global/radar
SUMMARY+=("[install] directorios de caché creados en /var/cache/pantalla/")

# Instalar tmpfiles.d para asegurar permisos al boot
log_info "Instalando tmpfiles.d para /var/lib/pantalla-reloj"
TMPFILES_SRC="${REPO_ROOT}/etc/tmpfiles.d/pantalla-reloj.conf"
TMPFILES_DST="/etc/tmpfiles.d/pantalla-reloj.conf"
if [[ -f "$TMPFILES_SRC" ]]; then
  install -D -m 0644 "$TMPFILES_SRC" "$TMPFILES_DST"
  systemd-tmpfiles --create "$TMPFILES_DST" 2>/dev/null || true
  log_ok "tmpfiles.d instalado en ${TMPFILES_DST}"
  SUMMARY+=("[install] tmpfiles.d instalado para asegurar permisos al boot")
else
  log_warn "tmpfiles.d template no encontrado en ${TMPFILES_SRC}"
fi

install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$USER_HOME/.config/openbox"
AUTO_FILE="$USER_HOME/.config/openbox/autostart"
AUTO_BACKUP="${AUTO_FILE}.pantalla-reloj.bak"
if [[ -f "$AUTO_FILE" && ! -f "$AUTO_BACKUP" ]]; then
  cp -p "$AUTO_FILE" "$AUTO_BACKUP"
fi
install -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$REPO_ROOT/openbox/autostart" "$AUTO_FILE"

if [[ ! -f "${STATE_DIR}/.Xauthority" ]]; then
  install -m 0600 -o "$USER_NAME" -g "$USER_NAME" /dev/null "${STATE_DIR}/.Xauthority"
fi

install -m 0755 "$REPO_ROOT/opt/pantalla/bin/xorg-openbox-env.sh" "$SESSION_PREFIX/bin/xorg-openbox-env.sh"
install -m 0755 "$REPO_ROOT/opt/pantalla/bin/wait-x.sh" "$SESSION_PREFIX/bin/wait-x.sh"
install -m 0755 "$REPO_ROOT/opt/pantalla/bin/pantalla-geometry.sh" "$SESSION_PREFIX/bin/pantalla-geometry.sh"
install -m 0755 "$REPO_ROOT/opt/pantalla/bin/pantalla-kiosk-sanitize.sh" "$SESSION_PREFIX/bin/pantalla-kiosk-sanitize.sh"
install -m 0755 "$REPO_ROOT/opt/pantalla/bin/pantalla-kiosk-watchdog.sh" "$SESSION_PREFIX/bin/pantalla-kiosk-watchdog.sh"
install -m 0755 "$REPO_ROOT/opt/pantalla/bin/pantalla-portal-launch.sh" "$SESSION_PREFIX/bin/pantalla-portal-launch.sh"
install -m 0755 "$REPO_ROOT/opt/pantalla/openbox/autostart" "$SESSION_PREFIX/openbox/autostart"
if ! grep -q 'xsetroot -solid black' "$SESSION_PREFIX/openbox/autostart" 2>/dev/null; then
  echo 'xsetroot -solid black' >>"$SESSION_PREFIX/openbox/autostart"
fi

install -D -m 0755 "$KIOSK_BIN_SRC" "$KIOSK_BIN_DST"
install -D -m 0755 "$CHROMIUM_KIOSK_BIN_SRC" "$CHROMIUM_KIOSK_BIN_DST"
SUMMARY+=("[install] launcher de kiosk instalado en ${KIOSK_BIN_DST}")
SUMMARY+=("[install] launcher Chromium kiosk disponible en ${CHROMIUM_KIOSK_BIN_DST}")

# Esta verificación se hace más adelante en el script durante la instalación de Chromium

install -D -m 0755 "$BACKEND_LAUNCHER_SRC" "$BACKEND_LAUNCHER_DST"
SUMMARY+=("[install] launcher de backend instalado en ${BACKEND_LAUNCHER_DST}")
install -D -m 0644 "$REPO_ROOT/usr/local/share/applications/${APP_ID}.desktop" \
  /usr/local/share/applications/${APP_ID}.desktop
install -D -o "$USER_NAME" -g "$USER_NAME" -m 0644 \
  "$REPO_ROOT/home/dani/.local/share/applications/${APP_ID}.desktop" \
  "$USER_HOME/.local/share/applications/${APP_ID}.desktop"
install -D -o "$USER_NAME" -g "$USER_NAME" -m 0644 \
  "$REPO_ROOT/home/dani/.local/share/xdg-desktop-portal/applications/${APP_ID}.desktop" \
  "$USER_HOME/.local/share/xdg-desktop-portal/applications/${APP_ID}.desktop"
SUMMARY+=("[install] desktop file ${APP_ID} instalado")
install -D -m 0755 "$REPO_ROOT/scripts/pantalla-kiosk-verify" /usr/local/bin/pantalla-kiosk-verify
if ! bash -n /usr/local/bin/pantalla-kiosk-verify; then
  echo "[ERROR] Syntax check failed for pantalla-kiosk-verify" >&2
  exit 1
fi
SUMMARY+=("[install] verificador de kiosk instalado en /usr/local/bin/pantalla-kiosk-verify")

install -D -m 0755 "$REPO_ROOT/scripts/diag_kiosk.sh" /usr/local/bin/diag_kiosk.sh
if ! bash -n /usr/local/bin/diag_kiosk.sh; then
  echo "[ERROR] Syntax check failed for diag_kiosk.sh" >&2
  exit 1
fi
SUMMARY+=("[install] diag_kiosk.sh disponible en /usr/local/bin/diag_kiosk.sh")

install -D -m 0755 "$REPO_ROOT/scripts/kiosk-url-helper" /usr/local/bin/kiosk-ui
install -D -m 0755 "$REPO_ROOT/scripts/kiosk-url-helper" /usr/local/bin/kiosk-diag
for helper in /usr/local/bin/kiosk-ui /usr/local/bin/kiosk-diag; do
  if ! bash -n "$helper"; then
    echo "[ERROR] Syntax check failed for ${helper}" >&2
    exit 1
  fi
done
SUMMARY+=("[install] helpers kiosk-ui y kiosk-diag instalados")

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/local/share/applications || true
  runuser -u "$USER_NAME" -- update-desktop-database "$USER_HOME/.local/share/applications" || true
  runuser -u "$USER_NAME" -- update-desktop-database "$USER_HOME/.local/share/xdg-desktop-portal/applications" || true
  SUMMARY+=("[install] update-desktop-database ejecutado")
else
  SUMMARY+=("[install] update-desktop-database no disponible")
fi

if runuser -u "$USER_NAME" -- env XDG_DATA_DIRS="/usr/local/share:/usr/share" \
  gio info "application://${APP_ID}.desktop" >/dev/null 2>&1; then
  SUMMARY+=("[install] desktop id visible para ${USER_NAME}")
else
  SUMMARY+=("[install] desktop id no visible para ${USER_NAME}")
fi
install -d -m 0755 /usr/lib/pantalla-reloj
install -m 0755 "$REPO_ROOT/usr/lib/pantalla-reloj/xorg-launch.sh" /usr/lib/pantalla-reloj/xorg-launch.sh

log_info "Building frontend"
pushd "$REPO_ROOT/dash-ui" >/dev/null
npm install --no-audit --no-fund
npm run build
popd >/dev/null

publish_webroot() {
  install -d -m 0755 "$WEB_ROOT"

  if [[ -f "$WEBROOT_MANIFEST" ]]; then
    mapfile -t previous <"$WEBROOT_MANIFEST" || previous=()
    if [[ ${#previous[@]} -gt 0 ]]; then
      log_info "Removing previously deployed web assets"
      # Remove files first, directories afterwards
      mapfile -t sorted_previous < <(printf '%s\n' "${previous[@]}" | awk 'NF' | sort -r)
      for rel in "${sorted_previous[@]}"; do
        rm -rf "$WEB_ROOT/$rel"
      done
    fi
  fi

  rsync -a "$REPO_ROOT/dash-ui/dist/" "$WEB_ROOT/"

  pushd "$REPO_ROOT/dash-ui/dist" >/dev/null
  find . -mindepth 1 -print | sed 's#^\./##' >"$WEBROOT_MANIFEST"
  popd >/dev/null

  chown -R www-data:www-data "$WEB_ROOT"
}

log_info "Publishing frontend to $WEB_ROOT"
publish_webroot

chown -R "$USER_NAME:$USER_NAME" "$PANTALLA_PREFIX" "$STATE_DIR" "$LOG_DIR" "$KIOSK_LOG_DIR"
touch "$LOG_DIR/backend.log"
chown "$USER_NAME:$USER_NAME" "$LOG_DIR/backend.log"

configure_nginx() {
  set -euxo pipefail
  log_info "Configurando Nginx"

  local sa="/etc/nginx/sites-available"
  local se="/etc/nginx/sites-enabled"
  local vhost="$sa/pantalla-reloj.conf"

  if ! command -v nginx >/dev/null 2>&1; then
    log_error "nginx no está instalado pero es requerido para el frontend"
    exit 1
  fi

  mkdir -p "$sa" "$se"

  if [[ ! -f "$NGINX_TEMPLATE" ]]; then
    log_error "No se encontró la plantilla de Nginx en: $NGINX_TEMPLATE"
    exit 1
  fi

  install -D -m 0644 "$NGINX_TEMPLATE" "$vhost"

  ln -sfn "$vhost" "$se/pantalla-reloj.conf"

  local trailing_files
  trailing_files="$(grep -RIl 'location /api/ {' /etc/nginx/sites-available /etc/nginx/sites-enabled 2>/dev/null || true)"
  if [[ -n "${trailing_files// }" ]]; then
    log_warn "Corrigiendo bloques location /api/ { residuales"
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      sed -i 's#location /api/ {#location /api {#' "$file"
    done <<<"$trailing_files"
  fi

  systemctl enable --now nginx >/dev/null 2>&1 || true

  if ! nginx -t 2>/dev/null; then
    log_error "nginx -t falló - la configuración de Nginx tiene errores"
    exit 1
  fi

  if ! systemctl reload nginx 2>/dev/null; then
    log_error "systemctl reload nginx falló - Nginx no se pudo recargar"
    exit 1
  fi

  log_info "Nginx recargado correctamente"
  SUMMARY+=("[install] Nginx configurado y validado")
}

configure_nginx

log_info "Installing systemd units"
units_changed=0
deploy_unit() {
  local src="$1" dest="$2"
  if [[ ! -f "$dest" ]] || ! cmp -s "$src" "$dest"; then
    install -D -m 0644 "$src" "$dest"
    units_changed=1
  fi
}

# Instalar scripts necesarios ANTES de instalar servicios systemd
log_info "Instalando scripts necesarios para servicios systemd"

# Asegurar que xorg-launch.sh esté instalado antes de instalar el servicio pantalla-xorg
if [[ -f "$REPO_ROOT/usr/lib/pantalla-reloj/xorg-launch.sh" ]]; then
  install -D -m 0755 "$REPO_ROOT/usr/lib/pantalla-reloj/xorg-launch.sh" /usr/lib/pantalla-reloj/xorg-launch.sh
  log_ok "xorg-launch.sh instalado"
else
  log_error "No se encontró xorg-launch.sh en $REPO_ROOT/usr/lib/pantalla-reloj/xorg-launch.sh"
  exit 1
fi

# Instalar servicios systemd
log_info "Instalando servicios systemd"
deploy_unit "$REPO_ROOT/systemd/pantalla-xorg.service" /etc/systemd/system/pantalla-xorg.service
deploy_unit "$REPO_ROOT/systemd/pantalla-openbox@.service" /etc/systemd/system/pantalla-openbox@.service
deploy_unit "$REPO_ROOT/systemd/pantalla-kiosk@.service" /etc/systemd/system/pantalla-kiosk@.service
deploy_unit "$REPO_ROOT/systemd/pantalla-kiosk-chromium@.service" /etc/systemd/system/pantalla-kiosk-chromium@.service
deploy_unit "$REPO_ROOT/systemd/pantalla-dash-backend@.service" /etc/systemd/system/pantalla-dash-backend@.service
deploy_unit "$REPO_ROOT/systemd/pantalla-portal@.service" /etc/systemd/system/pantalla-portal@.service
deploy_unit "$REPO_ROOT/systemd/pantalla-kiosk-watchdog@.service" /etc/systemd/system/pantalla-kiosk-watchdog@.service
deploy_unit "$REPO_ROOT/systemd/pantalla-kiosk-watchdog@.timer" /etc/systemd/system/pantalla-kiosk-watchdog@.timer

install -D -m 0644 "$REPO_ROOT/systemd/pantalla-kiosk@.service.d/10-sanitize-rollback.conf" \
  /etc/systemd/system/pantalla-kiosk@.service.d/10-sanitize-rollback.conf
install -D -m 0644 "$REPO_ROOT/systemd/pantalla-kiosk-watchdog@.service.d/10-rollback.conf" \
  /etc/systemd/system/pantalla-kiosk-watchdog@.service.d/10-rollback.conf

# Instalar unit user para Chrome kiosk (si Chrome está disponible)
if [[ ${CHROME_FOUND:-0} -eq 1 ]]; then
  log_info "Instalando unit user para Chrome kiosk..."
  USER_SYSTEMD_DIR="${USER_HOME}/.config/systemd/user"
  install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$USER_SYSTEMD_DIR"
  
  CHROME_UNIT_SRC="${REPO_ROOT}/systemd/pantalla-kiosk-chrome@.service"
  CHROME_UNIT_DST="${USER_SYSTEMD_DIR}/pantalla-kiosk-chrome@.service"
  
  if [[ -f "$CHROME_UNIT_SRC" ]]; then
    install -m 0644 -o "$USER_NAME" -g "$USER_NAME" "$CHROME_UNIT_SRC" "$CHROME_UNIT_DST"
    log_ok "Unit user Chrome kiosk instalado en ${CHROME_UNIT_DST}"
    SUMMARY+=("[install] unit user Chrome kiosk instalado")
  else
    log_warn "No se encontró el unit user Chrome kiosk en ${CHROME_UNIT_SRC}"
  fi
fi

# Recargar systemd DESPUÉS de instalar todos los servicios
log_info "Recargando systemd después de instalar servicios"
systemctl daemon-reload
if [[ ${CHROME_FOUND:-0} -eq 1 ]]; then
  # Recargar systemd user también
  sudo -u "$USER_NAME" systemctl --user daemon-reload 2>/dev/null || true
fi
log_ok "systemd recargado"

# Verificar que los servicios se instalaron correctamente
log_info "Verificando que los servicios se instalaron correctamente"
XORG_SERVICE_FILE="/etc/systemd/system/pantalla-xorg.service"
if [[ ! -f "$XORG_SERVICE_FILE" ]]; then
  log_error "ERROR: pantalla-xorg.service no se instaló correctamente en $XORG_SERVICE_FILE"
  exit 1
fi
log_ok "Servicios systemd instalados y verificados"

DROPIN_DIR="/etc/systemd/system/pantalla-kiosk-chromium@${USER_NAME}.service.d"
DROPIN_OVERRIDE_SRC="${REPO_ROOT}/deploy/systemd/pantalla-kiosk-chromium@dani.service.d/override.conf"
DROPIN_OVERRIDE_DST="${DROPIN_DIR}/override.conf"
install -d -m 0755 "$DROPIN_DIR"

if [[ -d "$DROPIN_DIR" ]]; then
  while IFS= read -r -d '' dropin; do
    if grep -q 'KIOSK_URL' "$dropin"; then
      rm -f "$dropin"
    fi
  done < <(find "$DROPIN_DIR" -maxdepth 1 -type f ! -name 'override.conf' -print0 2>/dev/null)
fi

install -D -m 0644 "$DROPIN_OVERRIDE_SRC" "$DROPIN_OVERRIDE_DST"

escaped_url="$(printf '%s\n' "$ACTIVE_KIOSK_URL" | sed 's/[\/&]/\\&/g')"
if grep -q '^Environment=KIOSK_URL=' "$DROPIN_OVERRIDE_DST"; then
  sed -i "s#^Environment=KIOSK_URL=.*#Environment=KIOSK_URL=${escaped_url}#" "$DROPIN_OVERRIDE_DST"
else
  printf 'Environment=KIOSK_URL=%s\n' "$ACTIVE_KIOSK_URL" >>"$DROPIN_OVERRIDE_DST"
fi

log_info "KIOSK_URL definido en ${DROPIN_OVERRIDE_DST}"
SUMMARY+=("[install] override kiosk-chromium actualizado (${ACTIVE_KIOSK_URL})")

if [[ $units_changed -eq 1 ]]; then
  log_info "Systemd units updated"
else
  log_info "Systemd units unchanged"
fi

log_info "Reloading systemd daemon"
systemctl daemon-reload
# Configurar logrotate para logs de pantalla
log_info "Installing logrotate configuration"
if [[ -f "$REPO_ROOT/etc/logrotate.d/pantalla-reloj" ]]; then
  install -D -m 0644 "$REPO_ROOT/etc/logrotate.d/pantalla-reloj" /etc/logrotate.d/pantalla-reloj
  SUMMARY+=("[install] logrotate configurado para /var/log/pantalla/")
else
  log_warn "No se encontró configuración de logrotate en $REPO_ROOT/etc/logrotate.d/pantalla-reloj"
fi

# Configurar snapshots diarios de config.json
log_info "Installing config snapshot script and timer"
if [[ -f "$REPO_ROOT/scripts/config-snapshot.sh" ]]; then
  install -D -m 0755 "$REPO_ROOT/scripts/config-snapshot.sh" /usr/local/bin/pantalla-config-snapshot
  SUMMARY+=("[install] script de snapshots de config instalado")
  
  # Crear timer systemd para snapshots diarios
  cat > /etc/systemd/system/pantalla-config-snapshot.timer <<'EOF'
[Unit]
Description=Daily snapshot of pantalla-reloj config.json
After=network-online.target

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=3600

[Install]
WantedBy=timers.target
EOF
  
  cat > /etc/systemd/system/pantalla-config-snapshot.service <<'EOF'
[Unit]
Description=Create snapshot of pantalla-reloj config.json
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pantalla-config-snapshot
User=root
StandardOutput=journal
StandardError=journal
EOF
  
  systemctl daemon-reload
  systemctl enable --now pantalla-config-snapshot.timer
  SUMMARY+=("[install] timer de snapshots diarios habilitado")
else
  log_warn "No se encontró script de snapshots en $REPO_ROOT/scripts/config-snapshot.sh"
fi

log_info "Disabling portal service"
systemctl disable --now "pantalla-portal@${USER_NAME}.service" 2>/dev/null || true
systemctl mask "pantalla-portal@${USER_NAME}.service" 2>/dev/null || true

# Validar que Nginx esté funcionando antes de habilitar servicios
log_info "Verificando que Nginx esté funcionando"
if ! systemctl is-active --quiet nginx 2>/dev/null; then
  log_error "Nginx no está activo. Iniciando..."
  if ! systemctl start nginx 2>/dev/null; then
    log_error "No se pudo iniciar Nginx. Revisa los logs: journalctl -u nginx"
    exit 1
  fi
fi

# Validar que Nginx responde
if ! curl -sf --max-time 5 http://127.0.0.1/ui-healthz >/dev/null 2>&1; then
  log_warn "Nginx no responde en http://127.0.0.1/ui-healthz, pero continuando..."
else
  log_ok "Nginx responde correctamente"
fi

# Instalar y validar Chromium (evitar paquetes transicionales a snap)
log_info "Instalando y verificando Chromium (evitando paquetes transicionales a snap)"

# Función para verificar si un binario es desde snap
is_snap_binary() {
  local bin_path="$1"
  if [[ -z "$bin_path" ]]; then
    return 1
  fi
  local realpath
  realpath="$(readlink -f "$bin_path" 2>/dev/null || echo "$bin_path")"
  if [[ "$realpath" == *"/snap/"* ]]; then
    return 0
  fi
  return 1
}

# Desinstalar Snap Chromium si existe
log_info "Desinstalando Snap Chromium si existe..."
if snap list chromium >/dev/null 2>&1; then
  log_info "Desinstalando chromium desde snap..."
  snap remove chromium 2>/dev/null || true
  SUMMARY+=("[install] Snap Chromium desinstalado")
fi

# Función para instalar Chromium real (no snap)
install_chromium_real() {
  log_info "Instalando Chromium real (no snap)..."
  
  # Desinstalar chromium-browser transicional si existe y apunta a snap
  if command -v chromium-browser >/dev/null 2>&1; then
    if is_snap_binary "$(command -v chromium-browser)"; then
      log_info "Desinstalando chromium-browser transicional (snap)..."
      apt remove -y chromium-browser 2>/dev/null || true
    fi
  fi
  
  # Intentar instalar chromium-browser desde repositorios (.deb estable)
  log_info "Instalando chromium-browser desde repositorios (.deb)..."
  apt update
  if apt install -y chromium-browser 2>&1; then
    if command -v chromium-browser >/dev/null 2>&1 && ! is_snap_binary "$(command -v chromium-browser)"; then
      log_ok "chromium-browser instalado desde repositorios: $(command -v chromium-browser)"
      return 0
    fi
  fi
  
  # Si chromium-browser no está disponible, intentar chromium
  if ! command -v chromium-browser >/dev/null 2>&1; then
    log_info "chromium-browser no disponible, intentando chromium..."
    if apt install -y chromium 2>&1; then
      if command -v chromium >/dev/null 2>&1 && ! is_snap_binary "$(command -v chromium)"; then
        log_ok "chromium instalado desde repositorios: $(command -v chromium)"
        return 0
      fi
    fi
  fi
  
  return 1
}

# Función para instalar Google Chrome .deb (preferido sobre Chromium)
install_google_chrome() {
  log_info "Instalando Google Chrome .deb..."
  
  # Verificar si ya está instalado
  if command -v google-chrome >/dev/null 2>&1; then
    if [[ -x /usr/bin/google-chrome ]]; then
      log_ok "Google Chrome ya está instalado: $(command -v google-chrome)"
      return 0
    fi
  fi
  
  # Descargar .deb oficial
  CHROME_DEB_URL="https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
  CHROME_DEB_TMP="/tmp/google-chrome-stable_current_amd64.deb"
  
  log_info "Descargando Google Chrome desde ${CHROME_DEB_URL}..."
  if curl -L -o "$CHROME_DEB_TMP" "$CHROME_DEB_URL" 2>&1; then
    log_ok "Google Chrome .deb descargado"
    
    # Instalar dependencias necesarias
    apt update
    apt install -y wget gnupg ca-certificates 2>/dev/null || true
    
    # Instalar el .deb
    log_info "Instalando Google Chrome .deb..."
    if dpkg -i "$CHROME_DEB_TMP" 2>&1; then
      # Resolver dependencias faltantes
      apt -y -f install 2>&1 || true
      
      if command -v google-chrome >/dev/null 2>&1 && [[ -x /usr/bin/google-chrome ]]; then
        log_ok "Google Chrome instalado correctamente: $(command -v google-chrome)"
        rm -f "$CHROME_DEB_TMP"
        return 0
      fi
    fi
  fi
  
  log_warn "No se pudo instalar Google Chrome .deb"
  rm -f "$CHROME_DEB_TMP"
  return 1
}

# Función para arreglar permisos del perfil de Chromium
fix_chromium_profile_permissions() {
  local profile_dir="$1"
  local cache_dir="$2"
  
  if [[ -d "$profile_dir" ]]; then
    log_info "Arreglando permisos del perfil de Chromium: $profile_dir"
    # Eliminar archivos de bloqueo residuales
    find "$profile_dir" -type f \( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" -o -name "LOCK" \) -delete 2>/dev/null || true
    # Cambiar propietario y permisos
    chown -R "${USER_NAME}:${USER_NAME}" "$profile_dir" 2>/dev/null || true
    chmod -R u+rwX "$profile_dir" 2>/dev/null || true
    log_ok "Permisos del perfil arreglados"
  fi
  
  if [[ -d "$cache_dir" ]]; then
    log_info "Arreglando permisos del cache de Chromium: $cache_dir"
    find "$cache_dir" -type f -name "LOCK" -delete 2>/dev/null || true
    chown -R "${USER_NAME}:${USER_NAME}" "$cache_dir" 2>/dev/null || true
    chmod -R u+rwX "$cache_dir" 2>/dev/null || true
    log_ok "Permisos del cache arreglados"
  fi
}

# Prioridad 1: Intentar instalar Google Chrome .deb (preferido)
log_info "Verificando/instalando Google Chrome .deb (preferido sobre Chromium)..."
if install_google_chrome; then
  if command -v google-chrome >/dev/null 2>&1 && [[ -x /usr/bin/google-chrome ]]; then
    CHROME_BIN="/usr/bin/google-chrome"
    CHROME_FOUND=1
    log_ok "Google Chrome disponible para kiosk: $CHROME_BIN"
    SUMMARY+=("[install] Google Chrome .deb instalado y disponible")
  fi
fi

# Prioridad 2: Verificar si ya hay un Chromium real instalado (fallback)
if [[ ${CHROME_FOUND:-0} -eq 0 ]]; then
  log_info "Google Chrome no disponible, verificando Chromium..."
  if command -v chromium-browser >/dev/null 2>&1; then
    if ! is_snap_binary "$(command -v chromium-browser)"; then
      CHROMIUM_BIN="$(command -v chromium-browser)"
      CHROMIUM_FOUND=1
      log_ok "chromium-browser encontrado (no snap): $CHROMIUM_BIN"
    fi
  fi
fi

if [[ ${CHROMIUM_FOUND:-0} -eq 0 ]] && command -v chromium >/dev/null 2>&1; then
  if ! is_snap_binary "$(command -v chromium)"; then
    CHROMIUM_BIN="$(command -v chromium)"
    CHROMIUM_FOUND=1
    log_ok "chromium encontrado (no snap): $CHROMIUM_BIN"
  fi
fi

# Si no hay Chromium real, intentar instalarlo
if [[ ${CHROMIUM_FOUND:-0} -eq 0 ]]; then
  if install_chromium_real; then
    if command -v chromium >/dev/null 2>&1 && ! is_snap_binary "$(command -v chromium)"; then
      CHROMIUM_BIN="$(command -v chromium)"
      CHROMIUM_FOUND=1
      log_ok "Chromium instalado y verificado: $CHROMIUM_BIN"
    fi
  fi
fi

# Fallback a snap solo si no hay alternativa (no recomendado)
if [[ ${CHROMIUM_FOUND:-0} -eq 0 ]]; then
  if [[ -x /snap/bin/chromium ]]; then
    CHROMIUM_BIN="/snap/bin/chromium"
    CHROMIUM_FOUND=1
    log_warn "Usando Chromium desde snap (no recomendado): $CHROMIUM_BIN"
  elif [[ -x /snap/chromium/current/usr/lib/chromium-browser/chrome ]]; then
    CHROMIUM_BIN="/snap/chromium/current/usr/lib/chromium-browser/chrome"
    CHROMIUM_FOUND=1
    log_warn "Usando Chromium desde snap (no recomendado): $CHROMIUM_BIN"
  fi
fi

if [[ ${CHROMIUM_FOUND:-0} -eq 0 ]]; then
  log_warn "No se encontró Chromium instalado"
  log_warn "El servicio kiosk no funcionará hasta que se instale Chromium"
  SUMMARY+=('[install] WARN: Chromium no encontrado - servicio kiosk no funcionará')
else
  log_ok "Chromium disponible para kiosk: $CHROMIUM_BIN"
  SUMMARY+=('[install] Chromium verificado y disponible')
  
  # Arreglar permisos del perfil de Chromium
  fix_chromium_profile_permissions "$CHROMIUM_HOME_DATA_DIR" "$CHROMIUM_HOME_CACHE_DIR"
  
  # Configurar kiosk.env con CHROMIUM_BIN_OVERRIDE si no está configurado
  KIOSK_ENV="/var/lib/pantalla-reloj/state/kiosk.env"
  if [[ -n "$CHROMIUM_BIN" ]] && ! is_snap_binary "$CHROMIUM_BIN"; then
    mkdir -p "$(dirname "$KIOSK_ENV")"
    if [[ -f "$KIOSK_ENV" ]]; then
      if ! grep -q "^CHROMIUM_BIN_OVERRIDE=" "$KIOSK_ENV"; then
        echo "CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN" >> "$KIOSK_ENV"
        log_ok "CHROMIUM_BIN_OVERRIDE agregado a kiosk.env"
      else
        sed -i "s|^CHROMIUM_BIN_OVERRIDE=.*|CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN|" "$KIOSK_ENV"
        log_ok "CHROMIUM_BIN_OVERRIDE actualizado en kiosk.env"
      fi
    else
      echo "CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN" > "$KIOSK_ENV"
      log_ok "kiosk.env creado con CHROMIUM_BIN_OVERRIDE"
    fi
  fi
fi

# Validar permisos de caché
log_info "Verificando permisos de directorios de caché"
if [[ ! -w /var/cache/pantalla ]]; then
  log_warn "No se puede escribir en /var/cache/pantalla, corrigiendo permisos..."
  chown -R "$USER_NAME:$USER_NAME" /var/cache/pantalla 2>/dev/null || true
fi

log_info "Enabling services"

# Verificar que los servicios existen antes de intentar iniciarlos
XORG_SERVICE="pantalla-xorg.service"
XORG_SERVICE_INSTANCE="pantalla-xorg@${USER_NAME}.service"
BACKEND_SERVICE_INSTANCE="pantalla-dash-backend@${USER_NAME}.service"

# Verificar que pantalla-xorg.service existe (servicio simple, no template)
if ! systemctl list-units --full --all "$XORG_SERVICE" >/dev/null 2>&1; then
  log_error "ERROR: Servicio $XORG_SERVICE no encontrado después de la instalación"
  log_error "Verifica que pantalla-xorg.service se instaló correctamente"
  exit 1
fi

if ! systemctl list-units --full --all "$BACKEND_SERVICE_INSTANCE" >/dev/null 2>&1; then
  log_error "ERROR: Servicio $BACKEND_SERVICE_INSTANCE no encontrado después de la instalación"
  log_error "Verifica que pantalla-dash-backend@.service se instaló correctamente"
  exit 1
fi

# Crear directorios necesarios antes de iniciar servicios
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" /var/lib/pantalla-reloj || true
install -d -m 0755 -o root -g root /var/log/pantalla || true

# Crear .Xauthority correcto y permisos antes de iniciar Xorg
log_info "Preparando .Xauthority..."
STATE_XAUTH="/var/lib/pantalla-reloj/.Xauthority"
HOME_XAUTH="/home/${USER_NAME}/.Xauthority"

# Asegurar que el directorio existe
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "/var/lib/pantalla-reloj" || true
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "/home/${USER_NAME}" || true

# Crear .Xauthority vacío si no existe (Xorg lo generará)
if [[ ! -f "$STATE_XAUTH" ]]; then
  install -m 0600 -o "$USER_NAME" -g "$USER_NAME" /dev/null "$STATE_XAUTH" || true
  log_info ".Xauthority inicial creado en $STATE_XAUTH"
fi

# Iniciar servicios en orden: 1. Xorg, 2. Openbox, 3. Chromium
log_info "Iniciando pantalla-xorg.service"
if systemctl enable --now "$XORG_SERVICE" 2>&1; then
  log_ok "pantalla-xorg.service habilitado e iniciado"
  SUMMARY+=("[install] pantalla-xorg.service habilitado e iniciado")
  
  # Esperar a que Xorg esté completamente iniciado y genere .Xauthority
  log_info "Esperando a que Xorg esté completamente iniciado..."
  XORG_READY=0
  for i in {1..15}; do
    sleep 1
    # Verificar que el servicio está activo
    if systemctl is-active --quiet "$XORG_SERVICE" 2>/dev/null; then
      # Verificar que .Xauthority existe y no está vacío
      if [[ -f "$STATE_XAUTH" ]] && [[ -s "$STATE_XAUTH" ]]; then
        # Verificar que DISPLAY :0 funciona
        if DISPLAY=:0 XAUTHORITY="$STATE_XAUTH" xset q >/dev/null 2>&1; then
          XORG_READY=1
          log_ok "Xorg está completamente iniciado y DISPLAY :0 funciona"
          break
        fi
      fi
    fi
  done
  
  if [[ $XORG_READY -eq 0 ]]; then
    log_warn "Xorg puede no estar completamente listo, pero continuando..."
    log_warn "Si hay problemas, espera unos segundos más y reinicia los servicios"
  fi
  
  # Copiar .Xauthority a home del usuario (esperar un poco más si no existe)
  if [[ ! -f "$STATE_XAUTH" ]] || [[ ! -s "$STATE_XAUTH" ]]; then
    log_info "Esperando adicional para que Xorg genere .Xauthority..."
    sleep 3
  fi
  
  if [[ -f "$STATE_XAUTH" ]] && [[ -s "$STATE_XAUTH" ]]; then
    cp -f "$STATE_XAUTH" "$HOME_XAUTH"
    chown "$USER_NAME:$USER_NAME" "$HOME_XAUTH"
    chmod 600 "$HOME_XAUTH"
    log_ok ".Xauthority copiado a $HOME_XAUTH"
    
    # Verificar que el archivo es legible
    if [[ ! -r "$HOME_XAUTH" ]]; then
      log_error "ERROR: .Xauthority no es legible por $USER_NAME"
      exit 1
    fi
    
    # Verificar que DISPLAY funciona con el .Xauthority del usuario
    if DISPLAY=:0 XAUTHORITY="$HOME_XAUTH" xset q >/dev/null 2>&1; then
      log_ok "DISPLAY :0 funciona correctamente con .Xauthority del usuario"
      SUMMARY+=("[install] .Xauthority configurado correctamente y DISPLAY verificado")
    else
      log_warn "DISPLAY :0 no funciona con .Xauthority del usuario (puede tardar unos segundos más)"
    fi
  else
    log_error "ERROR: .Xauthority no se generó después de esperar"
    log_error "Verificando estado de Xorg..."
    systemctl status "$XORG_SERVICE" --no-pager -l | head -20
    journalctl -u "$XORG_SERVICE" -n 30 --no-pager | sed 's/^/  /' || true
    exit 1
  fi
else
  log_error "ERROR: No se pudo iniciar pantalla-xorg.service"
  log_error "Logs del servicio:"
  journalctl -u "$XORG_SERVICE" -n 30 --no-pager | sed 's/^/  /' || true
  exit 1
fi

log_info "Iniciando pantalla-dash-backend@${USER_NAME}.service"
if systemctl enable --now "$BACKEND_SERVICE_INSTANCE" 2>&1; then
  log_ok "pantalla-dash-backend@${USER_NAME}.service habilitado e iniciado"
else
  log_error "ERROR: No se pudo iniciar pantalla-dash-backend@${USER_NAME}.service"
  log_error "Logs del servicio:"
  journalctl -u "$BACKEND_SERVICE_INSTANCE" -n 30 --no-pager | sed 's/^/  /' || true
  exit 1
fi

# Crear /run/user/<uid> correcto para el usuario kiosk (no asumir 1000)
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "/run/user/${USER_UID}"

# Verificar que DISPLAY funciona antes de iniciar Openbox
log_info "Verificando que DISPLAY :0 funciona antes de iniciar Openbox..."
if DISPLAY=:0 XAUTHORITY="$HOME_XAUTH" xset q >/dev/null 2>&1; then
  log_ok "DISPLAY :0 funciona correctamente"
else
  log_warn "DISPLAY :0 no funciona aún, esperando 3 segundos más..."
  sleep 3
  if ! DISPLAY=:0 XAUTHORITY="$HOME_XAUTH" xset q >/dev/null 2>&1; then
    log_error "ERROR: DISPLAY :0 no funciona después de esperar"
    log_error "Verificando estado de Xorg..."
    systemctl status "$XORG_SERVICE" --no-pager -l | head -20
    exit 1
  fi
fi

# Verificar que openbox service existe antes de iniciarlo
OPENBOX_SERVICE_INSTANCE="pantalla-openbox@${USER_NAME}.service"
if systemctl list-units --full --all "$OPENBOX_SERVICE_INSTANCE" >/dev/null 2>&1; then
  log_info "Iniciando pantalla-openbox@${USER_NAME}.service"
  if systemctl enable --now "$OPENBOX_SERVICE_INSTANCE" 2>&1; then
    log_ok "pantalla-openbox@${USER_NAME}.service habilitado e iniciado"
    sleep 2
    SUMMARY+=("[install] pantalla-openbox@${USER_NAME}.service habilitado e iniciado")
    
    # Verificar que Openbox está corriendo
    if systemctl is-active --quiet "$OPENBOX_SERVICE_INSTANCE" 2>/dev/null; then
      log_ok "pantalla-openbox@${USER_NAME}.service está activo"
    else
      log_warn "pantalla-openbox@${USER_NAME}.service puede no estar completamente iniciado"
    fi
  else
    log_error "ERROR: No se pudo iniciar pantalla-openbox@${USER_NAME}.service"
    journalctl -u "$OPENBOX_SERVICE_INSTANCE" -n 30 --no-pager | sed 's/^/  /' || true
    exit 1
  fi
else
  log_error "ERROR: Servicio $OPENBOX_SERVICE_INSTANCE no encontrado"
  exit 1
fi

# Asegurar que solo uno de los servicios kiosk esté habilitado
systemctl disable --now "pantalla-kiosk@${USER_NAME}.service" 2>/dev/null || true

# Habilitar y arrancar unit user de Chrome kiosk (preferido)
if [[ ${CHROME_FOUND:-0} -eq 1 ]]; then
  log_info "Habilitando unit user Chrome kiosk..."
  CHROME_USER_UNIT="pantalla-kiosk-chrome@${USER_NAME}.service"
  
  # Asegurar que Openbox está habilitado primero
  if systemctl is-enabled --quiet "pantalla-openbox@${USER_NAME}.service" 2>/dev/null; then
    log_ok "pantalla-openbox@${USER_NAME}.service ya está habilitado"
  else
    log_info "Habilitando pantalla-openbox@${USER_NAME}.service..."
    if systemctl enable --now "pantalla-openbox@${USER_NAME}.service" 2>&1; then
      log_ok "pantalla-openbox@${USER_NAME}.service habilitado e iniciado"
      sleep 2
    else
      log_warn "No se pudo habilitar pantalla-openbox@${USER_NAME}.service"
    fi
  fi
  
  # Asegurar que el usuario tenga una sesión persistente de systemd user
  log_info "Asegurando sesión persistente de systemd user..."
  if command -v loginctl >/dev/null 2>&1; then
    if loginctl enable-linger "$USER_NAME" 2>&1; then
      log_ok "Sesión persistente de systemd user habilitada para $USER_NAME"
    else
      log_warn "No se pudo habilitar sesión persistente de systemd user (puede no estar disponible)"
    fi
  else
    log_warn "loginctl no disponible, no se puede habilitar sesión persistente"
  fi
  
  # Asegurar que el bus D-Bus del usuario esté disponible
  log_info "Asegurando que el bus D-Bus del usuario esté disponible..."
  USER_RUNTIME_DIR="/run/user/${USER_UID}"
  install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$USER_RUNTIME_DIR"
  
  # Iniciar el bus D-Bus del usuario si no está disponible
  DBUS_BUS="${USER_RUNTIME_DIR}/bus"
  if [[ ! -S "$DBUS_BUS" ]]; then
    log_info "Iniciando bus D-Bus del usuario..."
    sudo -u "$USER_NAME" dbus-daemon --session --fork --print-address --address="unix:path=${DBUS_BUS}" 2>/dev/null || true
    sleep 2
  fi
  
  # Verificar que el bus D-Bus funciona
  if sudo -u "$USER_NAME" DBUS_SESSION_BUS_ADDRESS="unix:path=${DBUS_BUS}" dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
    log_ok "Bus D-Bus del usuario está disponible"
  else
    log_warn "Bus D-Bus del usuario puede no estar completamente disponible"
    log_warn "Intentando iniciar systemd user manager..."
    # Iniciar systemd user manager si no está disponible
    sudo -u "$USER_NAME" systemd-run --user --unit=systemd-user-manager -- systemd --user 2>/dev/null || true
    sleep 2
  fi
  
  # Habilitar y arrancar unit user de Chrome
  log_info "Habilitando unit user Chrome kiosk..."
  CHROME_USER_STARTED=0
  
  # Intentar con variables de entorno explícitas
  if sudo -u "$USER_NAME" XDG_RUNTIME_DIR="$USER_RUNTIME_DIR" DBUS_SESSION_BUS_ADDRESS="unix:path=${DBUS_BUS}" systemctl --user daemon-reload 2>/dev/null; then
    log_ok "systemd user recargado"
    
    if sudo -u "$USER_NAME" XDG_RUNTIME_DIR="$USER_RUNTIME_DIR" DBUS_SESSION_BUS_ADDRESS="unix:path=${DBUS_BUS}" systemctl --user enable --now "$CHROME_USER_UNIT" 2>&1; then
      log_ok "Unit user Chrome kiosk habilitado e iniciado: ${CHROME_USER_UNIT}"
      SUMMARY+=("[install] unit user Chrome kiosk habilitado e iniciado")
      CHROME_USER_STARTED=1
    fi
  fi
  
  # Si falla, intentar iniciar el servicio directamente (sin systemctl --user)
  if [[ $CHROME_USER_STARTED -eq 0 ]]; then
    log_info "Intentando iniciar unit user Chrome kiosk directamente..."
    # El unit user se habilitará y se iniciará automáticamente cuando el usuario tenga sesión
    # Por ahora, solo habilitarlo
    if sudo -u "$USER_NAME" XDG_RUNTIME_DIR="$USER_RUNTIME_DIR" DBUS_SESSION_BUS_ADDRESS="unix:path=${DBUS_BUS}" systemctl --user enable "$CHROME_USER_UNIT" 2>/dev/null; then
      log_ok "Unit user Chrome kiosk habilitado (se iniciará automáticamente con sesión)"
      SUMMARY+=("[install] unit user Chrome kiosk habilitado (inicio automático)")
      CHROME_USER_STARTED=1
    fi
  fi
  
  # Si aún falla, usar Chromium fallback o intentar iniciar Chrome manualmente
  if [[ $CHROME_USER_STARTED -eq 0 ]]; then
    log_warn "No se pudo iniciar unit user Chrome kiosk (puede requerir sesión activa)"
    log_warn "El unit user está habilitado y se iniciará automáticamente cuando haya sesión"
    log_warn "Por ahora, usando Chromium fallback para asegurar que el kiosk funcione..."
    SUMMARY+=('[install] WARN: unit user Chrome kiosk habilitado pero no iniciado, usando Chromium fallback')
    
    # Fallback a Chromium
    KIOSK_SERVICE_INSTANCE="pantalla-kiosk-chromium@${USER_NAME}.service"
    if [[ ${CHROMIUM_FOUND:-0} -eq 1 ]]; then
      if systemctl list-units --full --all "$KIOSK_SERVICE_INSTANCE" >/dev/null 2>&1; then
        log_info "Iniciando pantalla-kiosk-chromium@${USER_NAME}.service (fallback temporal)"
        if systemctl enable --now "$KIOSK_SERVICE_INSTANCE" 2>&1; then
          log_ok "pantalla-kiosk-chromium@${USER_NAME}.service habilitado e iniciado (fallback temporal)"
          SUMMARY+=("[install] pantalla-kiosk-chromium@${USER_NAME}.service habilitado e iniciado (fallback temporal)")
          log_info "NOTA: El unit user Chrome kiosk está habilitado y tomará el control cuando haya sesión activa"
        else
          log_error "ERROR: No se pudo iniciar pantalla-kiosk-chromium@${USER_NAME}.service"
          journalctl -u "$KIOSK_SERVICE_INSTANCE" -n 30 --no-pager | sed 's/^/  /' || true
          SUMMARY+=('[install] ERROR: fallo al iniciar pantalla-kiosk-chromium')
        fi
      fi
    else
      log_warn "Chromium no disponible, el unit user Chrome kiosk se iniciará cuando haya sesión activa"
    fi
  fi
else
  log_warn "No se habilitó unit user Chrome kiosk - Chrome no disponible"
  SUMMARY+=('[install] WARN: unit user Chrome kiosk NO habilitado - Chrome no disponible')
  
  # Fallback: Solo habilitar kiosk-chromium si Chromium está disponible
  KIOSK_SERVICE_INSTANCE="pantalla-kiosk-chromium@${USER_NAME}.service"
  if [[ ${CHROMIUM_FOUND:-0} -eq 1 ]]; then
    if systemctl list-units --full --all "$KIOSK_SERVICE_INSTANCE" >/dev/null 2>&1; then
      log_info "Iniciando pantalla-kiosk-chromium@${USER_NAME}.service (fallback)"
      if systemctl enable --now "$KIOSK_SERVICE_INSTANCE" 2>&1; then
        log_ok "pantalla-kiosk-chromium@${USER_NAME}.service habilitado e iniciado"
        SUMMARY+=("[install] pantalla-kiosk-chromium@${USER_NAME}.service habilitado e iniciado (fallback)")
      else
        log_error "ERROR: No se pudo iniciar pantalla-kiosk-chromium@${USER_NAME}.service"
        journalctl -u "$KIOSK_SERVICE_INSTANCE" -n 30 --no-pager | sed 's/^/  /' || true
        SUMMARY+=('[install] ERROR: fallo al iniciar pantalla-kiosk-chromium')
      fi
    else
      log_error "ERROR: Servicio $KIOSK_SERVICE_INSTANCE no encontrado"
      SUMMARY+=('[install] ERROR: servicio kiosk-chromium no encontrado')
    fi
  else
    log_warn "No se habilitó pantalla-kiosk-chromium@${USER_NAME}.service - Chromium no disponible"
    systemctl disable --now "$KIOSK_SERVICE_INSTANCE" 2>/dev/null || true
    SUMMARY+=('[install] WARN: servicio kiosk-chromium NO habilitado - Chromium no disponible')
  fi
fi

log_info "Ensuring watchdog disabled"
systemctl disable --now "pantalla-kiosk-watchdog@${USER_NAME}.timer" "pantalla-kiosk-watchdog@${USER_NAME}.service" 2>/dev/null || true

log_info "Restarting Pantalla services"

# Verificar que Xorg está funcionando antes de reiniciar
log_info "Verificando estado de pantalla-xorg.service"
if systemctl is-active --quiet "$XORG_SERVICE" 2>/dev/null; then
  log_ok "pantalla-xorg.service está activo"
  # Esperar a que Xorg genere .Xauthority si aún no existe
  if [[ ! -f "$STATE_XAUTH" ]] || [[ ! -s "$STATE_XAUTH" ]]; then
    log_info "Esperando a que Xorg genere .Xauthority..."
    for i in {1..10}; do
      sleep 1
      if [[ -f "$STATE_XAUTH" ]] && [[ -s "$STATE_XAUTH" ]]; then
        break
      fi
    done
  fi
  
  # Copiar .Xauthority si existe
  if [[ -f "$STATE_XAUTH" ]] && [[ -s "$STATE_XAUTH" ]]; then
    cp -f "$STATE_XAUTH" "$HOME_XAUTH"
    chown "$USER_NAME:$USER_NAME" "$HOME_XAUTH"
    chmod 600 "$HOME_XAUTH"
    log_ok "XAUTHORITY copiado a ${HOME_XAUTH}"
  else
    log_warn "XAUTHORITY aún no existe o está vacío en ${STATE_XAUTH} (puede tardar unos segundos más)"
  fi
else
  log_error "ERROR: pantalla-xorg.service NO está activo"
  log_error "Logs del servicio:"
  journalctl -u "$XORG_SERVICE" -n 50 --no-pager | sed 's/^/  /' || true
  SUMMARY+=('[install] ERROR: pantalla-xorg no está activo')
fi

if stat_output=$(stat -c '%U:%G %a %n' /var/lib/pantalla-reloj/.Xauthority 2>/dev/null); then
  SUMMARY+=("[install] permisos XAUTHORITY: ${stat_output}")
else
  SUMMARY+=('[install] permisos XAUTHORITY: no disponible')
fi

# Restart backend y esperar a que esté listo
log_info "Reiniciando pantalla-dash-backend@${USER_NAME}.service"
if systemctl restart pantalla-dash-backend@${USER_NAME}.service; then
  log_ok "pantalla-dash-backend@${USER_NAME}.service reiniciado"
  # Esperar a que el backend responda
  log_info "Esperando a que el backend esté listo..."
  if wait_for_backend_ready; then
    log_ok "Backend está listo y respondiendo"
  else
    log_error "Backend no responde tras la espera configurada"
    log_error "La instalación no puede completarse sin un backend funcional"
    SUMMARY+=('[install] ERROR: backend /api/health no responde tras la espera configurada')
    exit 1
  fi
else
  log_error "No se pudo reiniciar pantalla-dash-backend@${USER_NAME}.service"
  log_error "La instalación no puede completarse sin un backend funcional"
  SUMMARY+=('[install] ERROR: fallo al reiniciar pantalla-dash-backend')
  exit 1
fi

# Restart Openbox
log_info "Reiniciando pantalla-openbox@${USER_NAME}.service"
if systemctl restart pantalla-openbox@${USER_NAME}.service; then
  log_ok "pantalla-openbox@${USER_NAME}.service reiniciado"
  sleep 2
else
  log_error "No se pudo reiniciar pantalla-openbox@${USER_NAME}.service"
  SUMMARY+=('[install] ERROR: fallo al reiniciar pantalla-openbox')
fi

# Restart kiosk solo si Chromium está disponible y el backend está listo
if [[ ${CHROMIUM_FOUND:-0} -eq 1 ]]; then
  log_info "Reiniciando pantalla-kiosk-chromium@${USER_NAME}.service"
  if systemctl restart pantalla-kiosk-chromium@${USER_NAME}.service; then
    log_ok "pantalla-kiosk-chromium@${USER_NAME}.service reiniciado"
    sleep 2
  else
    log_error "No se pudo reiniciar pantalla-kiosk-chromium@${USER_NAME}.service"
    SUMMARY+=('[install] ERROR: fallo al reiniciar pantalla-kiosk-chromium')
  fi
else
  log_warn "No se reinició pantalla-kiosk-chromium@${USER_NAME}.service - Chromium no disponible"
fi

log_info "Running post-install checks"

if DISPLAY=:0 XAUTHORITY=/home/${USER_NAME}/.Xauthority xset q >/dev/null 2>&1; then
  log_ok "Servidor X activo (xset q)"
  SUMMARY+=('[install] xset q ejecutado correctamente')
else
  log_warn "xset q falló"
  SUMMARY+=('[install] xset q falló')
fi

if DISPLAY=:0 XAUTHORITY=/home/${USER_NAME}/.Xauthority xrandr --query | grep -q 'HDMI-1 connected primary 480x1920+0+0'; then
  if DISPLAY=:0 XAUTHORITY=/home/${USER_NAME}/.Xauthority xrandr --verbose --output HDMI-1 | grep -q 'Rotation: left'; then
    log_ok "Geometría HDMI-1 480x1920 left configurada"
    SUMMARY+=('[install] geometría HDMI-1 480x1920 left OK')
  else
    log_warn "Rotación HDMI-1 no es left"
    SUMMARY+=('[install] geometría HDMI-1 rotación inesperada')
  fi
else
  log_warn "Geometría HDMI-1 esperada no detectada"
  SUMMARY+=('[install] geometría HDMI-1 no detectada')
fi

# Este reinicio ya se hace arriba con mejor manejo de errores
# Eliminamos esta línea duplicada para evitar reinicios innecesarios

log_info "Ejecutando verificador post-deploy"
if ! VERIFY_USER="$USER_NAME" "$REPO_ROOT/scripts/verify_api.sh"; then
  log_error "La verificación de Nginx/API falló"
  exit 1
fi
log_info "Verificador de API completado"

VERIFY_STATUS=0
if ! VERIFY_OUTPUT="$(VERIFY_USER="$USER_NAME" /usr/local/bin/pantalla-kiosk-verify 2>&1)"; then
  VERIFY_STATUS=$?
fi
printf '%s\n' "$VERIFY_OUTPUT"
if [[ $VERIFY_STATUS -ne 0 ]]; then
  if ! grep -q ' - ui=ok' <<<"$VERIFY_OUTPUT"; then
    log_error "pantalla-kiosk-verify: UI health check failed"
    exit 1
  fi
  if ! grep -q ' - backend=ok' <<<"$VERIFY_OUTPUT"; then
    log_error "pantalla-kiosk-verify: backend health check failed"
    exit 1
  fi
  log_error "pantalla-kiosk-verify detectó problemas"
  exit 1
fi
SUMMARY+=('[install] pantalla-kiosk-verify completado')

# Ejecutar verificador de kiosk (Chrome o Chromium)
log_info "Ejecutando verificador de kiosk..."
if [[ -f "$REPO_ROOT/scripts/verify_kiosk.sh" ]]; then
  chmod +x "$REPO_ROOT/scripts/verify_kiosk.sh"
  if OUTPUT=$(DISPLAY=:0 XAUTHORITY=/home/${USER_NAME}/.Xauthority "$REPO_ROOT/scripts/verify_kiosk.sh" "$USER_NAME" 2>&1); then
    printf '%s\n' "$OUTPUT"
    SUMMARY+=('[install] ventana de Chrome kiosk detectada')
    log_ok "Verificador de kiosk: OK"
  else
    printf '%s\n' "$OUTPUT"
    log_warn 'ventana de Chrome kiosk no detectada'
    SUMMARY+=('[install] ventana de Chrome kiosk no detectada')
  fi
else
  log_warn "Verificador de kiosk no encontrado en $REPO_ROOT/scripts/verify_kiosk.sh"
fi

if DISPLAY=:0 XAUTHORITY=/home/${USER_NAME}/.Xauthority xprop -root _NET_ACTIVE_WINDOW >/dev/null 2>&1; then
  log_ok "xprop _NET_ACTIVE_WINDOW ejecutado"
  SUMMARY+=('[install] xprop activo ejecutado')
else
  log_warn "xprop _NET_ACTIVE_WINDOW falló"
  SUMMARY+=('[install] xprop activo falló')
fi

log_ok "Installation completed"

{
  echo "[install] $(date -Is) resumen"
  for entry in "${SUMMARY[@]}"; do
    echo "$entry"
  done
} >"$INSTALL_LOG"
