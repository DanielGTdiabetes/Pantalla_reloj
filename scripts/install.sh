#!/usr/bin/env bash
set -euo pipefail

umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NON_INTERACTIVE=0

usage() {
  cat <<USAGE
Pantalla_reloj installer
Usage: sudo bash install.sh [--non-interactive]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive)
      NON_INTERACTIVE=1
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

USER_NAME="dani"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  log_error "User '$USER_NAME' must exist before running the installer"
  exit 1
fi
USER_HOME="/home/${USER_NAME}"

PANTALLA_PREFIX=/opt/pantalla-reloj
BACKEND_DEST="${PANTALLA_PREFIX}/backend"
STATE_DIR=/var/lib/pantalla-reloj
STATE_RUNTIME="${STATE_DIR}/state"
LOG_DIR=/var/log/pantalla-reloj
WEB_ROOT=/var/www/html
NGINX_SITE=/etc/nginx/sites-available/pantalla-reloj.conf
NGINX_SITE_LINK=/etc/nginx/sites-enabled/pantalla-reloj.conf
NGINX_DEFAULT_LINK=/etc/nginx/sites-enabled/default
NGINX_DEFAULT_STATE="${STATE_RUNTIME}/nginx-default-enabled"
WEBROOT_MANIFEST="${STATE_RUNTIME}/webroot-manifest"
KIOSK_BIN_SRC="${REPO_ROOT}/usr/local/bin/pantalla-kiosk"
KIOSK_BIN_DST=/usr/local/bin/pantalla-kiosk
UDEV_RULE=/etc/udev/rules.d/70-pantalla-render.rules

install -d -m 0755 "$PANTALLA_PREFIX" "$STATE_DIR" "$STATE_RUNTIME" "$LOG_DIR"

log_info "Installing base packages"
APT_PACKAGES=(
  nginx
  xorg
  openbox
  x11-xserver-utils
  wmctrl
  xdotool
  dbus-x11
  curl
  unzip
  jq
  rsync
  file
  epiphany-browser
  python3-venv
)
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y "${APT_PACKAGES[@]}"

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

log_info "Preparing backend virtualenv"
python3 -m venv "$BACKEND_DEST/.venv"
"$BACKEND_DEST/.venv/bin/pip" install --upgrade pip wheel
if [[ -f "$BACKEND_DEST/requirements.txt" ]]; then
  "$BACKEND_DEST/.venv/bin/pip" install -r "$BACKEND_DEST/requirements.txt"
fi

CONFIG_FILE="$STATE_DIR/config.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
  install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$REPO_ROOT/backend/default_config.json" "$CONFIG_FILE"
fi
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$STATE_DIR/cache"

install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$USER_HOME/.config/openbox"
AUTO_FILE="$USER_HOME/.config/openbox/autostart"
AUTO_BACKUP="${AUTO_FILE}.pantalla-reloj.bak"
if [[ -f "$AUTO_FILE" && ! -f "$AUTO_BACKUP" ]]; then
  cp -p "$AUTO_FILE" "$AUTO_BACKUP"
fi
install -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$REPO_ROOT/openbox/autostart" "$AUTO_FILE"

install -m 0755 "$KIOSK_BIN_SRC" "$KIOSK_BIN_DST"

log_info "Building frontend"
pushd "$REPO_ROOT/dash-ui" >/dev/null
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
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

chown -R "$USER_NAME:$USER_NAME" "$PANTALLA_PREFIX" "$STATE_DIR" "$LOG_DIR"
touch "$LOG_DIR/backend.log"
chown "$USER_NAME:$USER_NAME" "$LOG_DIR/backend.log"

setup_nginx() {
  if ! command -v nginx >/dev/null 2>&1; then
    log_warn "nginx not installed; skipping web server setup"
    return
  fi

  install -m 0644 "$REPO_ROOT/etc/nginx/sites-available/pantalla-reloj.conf" "$NGINX_SITE"
  ln -sfn "$NGINX_SITE" "$NGINX_SITE_LINK"

  if [[ -L "$NGINX_DEFAULT_LINK" || -e "$NGINX_DEFAULT_LINK" ]]; then
    echo "enabled" >"$NGINX_DEFAULT_STATE"
    rm -f "$NGINX_DEFAULT_LINK"
  else
    echo "disabled" >"$NGINX_DEFAULT_STATE"
  fi

  if ! nginx -t; then
    log_error "nginx -t failed"
    exit 1
  fi
  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl restart nginx
}

log_info "Configuring nginx"
setup_nginx

log_info "Installing systemd units"
install -m 0644 "$REPO_ROOT/systemd/pantalla-xorg.service" /etc/systemd/system/pantalla-xorg.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-openbox@.service" /etc/systemd/system/pantalla-openbox@.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-kiosk@.service" /etc/systemd/system/pantalla-kiosk@.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-dash-backend@.service" /etc/systemd/system/pantalla-dash-backend@.service
systemctl daemon-reload

log_info "Enabling services"
for svc in \
  pantalla-xorg.service \
  pantalla-dash-backend@${USER_NAME}.service \
  pantalla-openbox@${USER_NAME}.service \
  pantalla-kiosk@${USER_NAME}.service
  do
    systemctl enable --now "$svc"
  done

log_info "Running quick health checks"
if curl -sS -m 1 http://127.0.0.1:8081/healthz >/dev/null 2>&1; then
  log_ok "Backend healthz reachable"
else
  log_warn "Backend healthz not responding yet"
fi

if pgrep -fa epiphany >/dev/null 2>&1; then
  log_ok "Epiphany process detected"
else
  log_warn "Epiphany process not detected"
fi

if WMCTRL_OUT=$(wmctrl -lG 2>&1); then
  log_ok "wmctrl -lG output:\n${WMCTRL_OUT}"
else
  log_warn "wmctrl failed: ${WMCTRL_OUT:-no output}"
fi

log_ok "Installation completed"
