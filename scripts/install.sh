#!/usr/bin/env bash
set -euxo pipefail

umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NON_INTERACTIVE=0
SUMMARY=()

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

install -d -m 0755 "$REPO_ROOT/home/dani/.local/share/applications" >/dev/null 2>&1 || true

install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$USER_HOME"
install -d -m 0755 "$PANTALLA_PREFIX" "$SESSION_PREFIX"
install -d -m 0755 "$SESSION_PREFIX/bin" "$SESSION_PREFIX/openbox"
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" /opt/pantalla-reloj/frontend/static
install -d -m 0755 -o root -g root /var/lib/pantalla
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$KIOSK_LOG_DIR"
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$LOG_DIR"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$STATE_DIR"
install -d -m 0755 -o "$USER_NAME" -g "$USER_NAME" "$STATE_RUNTIME"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$PROFILE_DIR_DST"
if [[ -f "${PROFILE_DIR_SRC}/app-id" ]]; then
  install -o "$USER_NAME" -g "$USER_NAME" -m 0600 "${PROFILE_DIR_SRC}/app-id" "${PROFILE_DIR_DST}/app-id"
fi
if [[ -f "${PROFILE_DIR_SRC}/desktop-id" ]]; then
  install -o "$USER_NAME" -g "$USER_NAME" -m 0600 "${PROFILE_DIR_SRC}/desktop-id" "${PROFILE_DIR_DST}/desktop-id"
fi
chown -R "$USER_NAME:$USER_NAME" "$STATE_DIR"

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
install -D -m 0755 "$REPO_ROOT/usr/local/bin/pantalla-kiosk-verify" /usr/local/bin/pantalla-kiosk-verify
SUMMARY+=("[install] verificador de kiosk instalado en /usr/local/bin/pantalla-kiosk-verify")

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

write_pantalla_vhost() {
  local target="$1"
  tee "$target" >/dev/null <<'NG'
server {
  listen 80;
  listen [::]:80;
  server_name _;

  root /var/www/html;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:8081/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri /index.html;
  }
}
NG
}

configure_nginx() {
  set -euxo pipefail
  log_info "Configurando Nginx"

  local sa="/etc/nginx/sites-available"
  local se="/etc/nginx/sites-enabled"
  local vhost="$sa/pantalla-reloj.conf"

  if ! command -v nginx >/dev/null 2>&1; then
    log_warn "nginx no está instalado; se omite la configuración del servidor web"
    return
  fi

  mkdir -p "$sa" "$se"

  write_pantalla_vhost "$vhost"

  ln -sfn "$vhost" "$se/pantalla-reloj.conf"

  local nginx_test_output
  if ! nginx_test_output=$(nginx -t 2>&1); then
    printf '%s\n' "$nginx_test_output"
    if [[ "$nginx_test_output" == *"duplicate default server"* ]]; then
      log_warn "nginx -t falló por default_server duplicado. Ejecutando diagnóstico…"

      log_info "---- default_server refs ----"
      local default_refs
      default_refs="$(grep -nR "default_server" /etc/nginx/sites-enabled /etc/nginx/sites-available 2>/dev/null || true)"
      if [[ -n "$default_refs" ]]; then
        printf '%s\n' "$default_refs"
      else
        log_info "(sin coincidencias)"
      fi

      log_info "---- listen :80 refs ----"
      local listen_refs
      listen_refs="$(grep -nR "listen .*80" /etc/nginx/sites-enabled /etc/nginx/sites-available 2>/dev/null || true)"
      if [[ -n "$listen_refs" ]]; then
        printf '%s\n' "$listen_refs"
      else
        log_info "(sin coincidencias)"
      fi

      if grep -Eq 'listen[[:space:]]+80[[:space:]]+default_server;' "$vhost" || \
         grep -Eq 'listen[[:space:]]+\[::\]:80[[:space:]]+default_server;' "$vhost"; then
        log_warn "Nuestro vhost contenía default_server; reescribiéndolo sin el flag."
        write_pantalla_vhost "$vhost"
        ln -sfn "$vhost" "$se/pantalla-reloj.conf"
      fi

      default_refs="$(grep -nR "default_server" /etc/nginx/sites-enabled /etc/nginx/sites-available 2>/dev/null || true)"

      if ! nginx_test_output=$(nginx -t 2>&1); then
        printf '%s\n' "$nginx_test_output"
        if [[ "$nginx_test_output" == *"duplicate default server"* ]]; then
          local conflict_file
          conflict_file="$(printf '%s\n' "$default_refs" | awk -F: '$1 !~ /pantalla-reloj\.conf/ && $1 != "" {print $1; exit}')"
          if [[ -z "$conflict_file" ]]; then
            conflict_file="otro archivo en /etc/nginx/sites-enabled"
          fi
          log_error "Nginx sigue detectando un default_server duplicado en: $conflict_file"
          log_error "Deshabilítelo manualmente (por ejemplo: sudo rm /etc/nginx/sites-enabled/default) y vuelva a ejecutar el instalador."
        else
          log_error "nginx -t sigue fallando: $nginx_test_output"
        fi
        exit 1
      fi
    else
      log_error "nginx -t falló: $nginx_test_output"
      exit 1
    fi
  fi

  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl reload nginx
  log_info "Nginx recargado correctamente"

  local front_status
  front_status="$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1/ || true)"
  front_status="${front_status:-000}"
  echo "FRONT:${front_status}"

  local api_status
  api_status="$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1/api/health || true)"
  api_status="${api_status:-000}"
  echo "API:${api_status}"

  if [[ "$front_status" != "200" ]]; then
    log_warn "Frontend aún no responde correctamente (HTTP $front_status)"
  else
    log_info "Frontend OK (HTTP 200)"
  fi

  if [[ "$api_status" != "200" ]]; then
    log_warn "Backend aún no responde (HTTP $api_status); se levantará vía systemd."
  else
    log_info "Backend OK (HTTP 200)"
  fi
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

DROPIN_DIR="/etc/systemd/system/pantalla-kiosk-chromium@${USER_NAME}.service.d"
install -d -m 0755 "$DROPIN_DIR"
cat >"${DROPIN_DIR}/override.conf" <<'EOF'
[Service]
# Limpiar y fijar entorno de X (evita “Missing X server or $DISPLAY”)
Environment=
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/%i/.Xauthority

# Escala por defecto (ajustable sin tocar binarios)
Environment=CHROMIUM_SCALE=0.58

# Reemplaza ExecStart e inyecta la escala
ExecStart=
ExecStart=/bin/sh -lc "chromium-browser \
  --class=pantalla-kiosk \
  --kiosk --start-fullscreen \
  --app=http://127.0.0.1 \
  --no-first-run --no-default-browser-check \
  --disable-translate --disable-infobars \
  --disable-session-crashed-bubble --noerrdialogs \
  --disable-features=InfiniteSessionRestore,Translate,HardwareMediaKeyHandling \
  --hide-scrollbars --overscroll-history-navigation=0 \
  --password-store=basic \
  --test-type \
  --ozone-platform=x11 \
  --disable-gpu \
  --force-device-scale-factor=${CHROMIUM_SCALE} \
  --disk-cache-dir=/var/lib/pantalla-reloj/cache/chromium \
  --user-data-dir=/var/lib/pantalla-reloj/state/chromium"
EOF

if [[ $units_changed -eq 1 ]]; then
  log_info "Systemd units updated"
else
  log_info "Systemd units unchanged"
fi

log_info "Reloading systemd daemon"
systemctl daemon-reload

log_info "Disabling portal service"
systemctl disable --now "pantalla-portal@${USER_NAME}.service" 2>/dev/null || true
systemctl mask "pantalla-portal@${USER_NAME}.service" 2>/dev/null || true

log_info "Enabling services"
systemctl enable --now pantalla-xorg.service || true
systemctl enable --now pantalla-dash-backend@${USER_NAME}.service || true
systemctl enable --now "pantalla-openbox@${USER_NAME}.service" || true

# Crear /run/user/<uid> correcto para el usuario kiosk (no asumir 1000)
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "/run/user/${USER_UID}"

# Asegurar XAUTHORITY real (no symlink) con la cookie actual
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "/home/${USER_NAME}"
if [ -f /var/lib/pantalla-reloj/.Xauthority ]; then
  cp -f /var/lib/pantalla-reloj/.Xauthority "/home/${USER_NAME}/.Xauthority"
  chown "$USER_NAME:$USER_NAME" "/home/${USER_NAME}/.Xauthority"
  chmod 600 "/home/${USER_NAME}/.Xauthority"
fi

systemctl daemon-reload
systemctl enable --now "pantalla-kiosk-chromium@${USER_NAME}.service"

log_info "Ensuring watchdog disabled"
systemctl disable --now "pantalla-kiosk-watchdog@${USER_NAME}.timer" "pantalla-kiosk-watchdog@${USER_NAME}.service" 2>/dev/null || true

log_info "Restarting Pantalla services"
systemctl restart pantalla-xorg.service
if stat_output=$(stat -c '%U:%G %a %n' /var/lib/pantalla-reloj/.Xauthority 2>/dev/null); then
  SUMMARY+=("[install] permisos XAUTHORITY: ${stat_output}")
else
  SUMMARY+=('[install] permisos XAUTHORITY: no disponible')
fi
systemctl restart pantalla-openbox@${USER_NAME}.service
sleep 1
systemctl restart pantalla-kiosk-chromium@${USER_NAME}.service
sleep 2

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

systemctl restart pantalla-dash-backend@${USER_NAME}.service
sleep 1

if curl -fsS -m 2 http://127.0.0.1:8081/api/health | grep -q '"status":"ok"'; then
  log_ok "Backend health responde (/api/health)"
  SUMMARY+=('[install] backend /api/health responde')
else
  log_warn "Backend /api/health not responding yet"
  SUMMARY+=('[install] backend /api/health no responde')
fi

if DISPLAY=:0 XAUTHORITY=/home/${USER_NAME}/.Xauthority wmctrl -lx | grep -q 'chromium-browser\.pantalla-kiosk'; then
  log_ok "Ventana de Chromium detectada"
  SUMMARY+=('[install] ventana de Chromium detectada')
else
  log_warn "No se detectó ventana de Chromium"
  SUMMARY+=('[install] ventana de Chromium no detectada')
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
