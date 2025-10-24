#!/usr/bin/env bash
set -euo pipefail

# ==========================
# Pantalla Futurista - Installer (hardened)
# Ejecutar desde: Pantalla_reloj/scripts/install.sh
# Ubuntu/Debian + systemd · idempotente
# ==========================

# ----- Utilidades de log -----
log(){ printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
err(){ printf "\033[1;31m[ERR ]\033[0m %s\n" "$*" >&2; }
die(){ err "$*"; exit 1; }

systemctl_safe(){
  if systemctl is-system-running >/dev/null 2>&1; then
    systemctl "$@"
  else
    warn "D-Bus no disponible (instalación en chroot o headless). Omitido: systemctl $*"
    return 0
  fi
}

# ----- Paths base (script dentro de /scripts -> raíz es su padre) -----
APP_USER="${SUDO_USER:-${USER}}"
REPO_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/dash-ui"
ENV_DIR="/etc/pantalla-dash"
ASSETS_DIR="/opt/dash/assets/backgrounds/auto"
LOG_DIR="/var/log/pantalla-dash"
NGINX_SITE="/etc/nginx/sites-available/pantalla"
SYSTEMD_DIR="/etc/systemd/system"
USER_SYSTEMD_DIR="/etc/systemd/user"
UI_SERVICE_NAME="pantalla-ui.service"
UI_SERVICE_SRC="$REPO_DIR/system/$UI_SERVICE_NAME"
OPENBOX_SERVICE_NAME="pantalla-openbox.service"
OPENBOX_SERVICE_SRC="$REPO_DIR/system/user/$OPENBOX_SERVICE_NAME"
UI_LAUNCHER_SRC="$REPO_DIR/scripts/pantalla-ui-launch.sh"
UI_LAUNCHER_DST="/usr/local/bin/pantalla-ui-launch.sh"

BACKEND_SVC_BASENAME="pantalla-dash-backend"
BACKEND_SVC_TEMPLATE="${BACKEND_SVC_BASENAME}@.service"
XORG_SERVICE_NAME="pantalla-xorg@.service"
XORG_SERVICE_SRC="$REPO_DIR/system/$XORG_SERVICE_NAME"
BG_SVC="pantalla-bg-generate.service"
BG_TIMER="pantalla-bg-generate.timer"
BG_SYNC_SERVICE="pantalla-bg-sync.service"
BG_SYNC_PATH="pantalla-bg-sync.path"
BG_SYNC_SCRIPT_SRC="$REPO_DIR/scripts/pantalla-bg-sync-timer"
BG_SYNC_SCRIPT_DST="/usr/local/sbin/pantalla-bg-sync-timer"

# ----- Defaults de configuración -----
TZ_DEFAULT="${TZ_DEFAULT:-Europe/Madrid}"
AEMET_MUNICIPIO_ID="${AEMET_MUNICIPIO_ID:-12138}"   # Vila-real
AEMET_MUNICIPIO_NAME="${AEMET_MUNICIPIO_NAME:-Vila-real}"
AEMET_POSTAL_CODE="${AEMET_POSTAL_CODE:-12540}"
AEMET_PROVINCE="${AEMET_PROVINCE:-Castellón}"
CITY_NAME="${CITY_NAME:-Vila-real}"

# ----- Flags CLI / entorno -----
OPENAI_KEY="${OPENAI_KEY:-}"
AEMET_KEY="${AEMET_KEY:-}"
NON_INTERACTIVE="0"
ENV_FILE=""
INSTALL_NODE="1"    # instala Node LTS si falta

usage() {
  cat <<EOF
Uso: sudo ./scripts/install.sh [opciones]
  --openai-key KEY        Clave OpenAI (fondos IA)
  --aemet-key KEY         Clave AEMET
  --municipio-id ID       (por defecto: ${AEMET_MUNICIPIO_ID})
  --municipio-name NAME   (por defecto: ${AEMET_MUNICIPIO_NAME})
  --postal-code CP        (por defecto: ${AEMET_POSTAL_CODE})
  --province NAME         (por defecto: ${AEMET_PROVINCE})
  --city NAME             (por defecto: ${CITY_NAME})
  --env FILE              Cargar variables (.env con OPENAI_KEY=..., AEMET_KEY=...)
  --no-node               No instalar Node LTS
  --non-interactive       Sin preguntas
  -h, --help              Ayuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --openai-key) OPENAI_KEY="$2"; shift 2;;
    --aemet-key) AEMET_KEY="$2"; shift 2;;
    --municipio-id) AEMET_MUNICIPIO_ID="$2"; shift 2;;
    --municipio-name) AEMET_MUNICIPIO_NAME="$2"; shift 2;;
    --postal-code) AEMET_POSTAL_CODE="$2"; shift 2;;
    --province) AEMET_PROVINCE="$2"; shift 2;;
    --city) CITY_NAME="$2"; shift 2;;
    --env) ENV_FILE="$2"; shift 2;;
    --no-node) INSTALL_NODE="0"; shift;;
    --non-interactive) NON_INTERACTIVE="1"; shift;;
    -h|--help) usage; exit 0;;
    *) die "Opción desconocida: $1";;
  esac
done

[[ -f "$BACKEND_DIR/app.py" ]] || die "No encuentro backend en $BACKEND_DIR"
[[ -d "$FRONTEND_DIR" ]] || warn "No encuentro dash-ui en $FRONTEND_DIR (se saltará el build)"

if [[ -n "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  OPENAI_KEY="${OPENAI_KEY:-${OPENAI_API_KEY:-$OPENAI_KEY}}"
  AEMET_KEY="${AEMET_KEY:-${AEMET_API_KEY:-$AEMET_KEY}}"
fi

if [[ "$NON_INTERACTIVE" != "1" ]]; then
  if [[ -z "$OPENAI_KEY" ]]; then read -rp "OPENAI_API_KEY (enter para dejar vacío): " OPENAI_KEY || true; fi
  if [[ -z "$AEMET_KEY" ]]; then read -rp "AEMET_API_KEY (enter para dejar vacío): " AEMET_KEY || true; fi
  read -rp "Municipio ID AEMET [${AEMET_MUNICIPIO_ID}]: " _i || true; AEMET_MUNICIPIO_ID="${_i:-$AEMET_MUNICIPIO_ID}"
  read -rp "Municipio nombre [${AEMET_MUNICIPIO_NAME}]: " _n || true; AEMET_MUNICIPIO_NAME="${_n:-$AEMET_MUNICIPIO_NAME}"
  read -rp "Código postal [${AEMET_POSTAL_CODE}]: " _p || true; AEMET_POSTAL_CODE="${_p:-$AEMET_POSTAL_CODE}"
  read -rp "Provincia [${AEMET_PROVINCE}]: " _pr || true; AEMET_PROVINCE="${_pr:-$AEMET_PROVINCE}"
  read -rp "Ciudad (UI) [${CITY_NAME}]: " _c || true; CITY_NAME="${_c:-$CITY_NAME}"
fi

log "Instalando paquetes base…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx curl jq unzip ca-certificates espeak-ng network-manager rsync

log "Asegurando NetworkManager activo…"
systemctl_safe enable --now NetworkManager || true

# --- X stack mínimo y sesión ligera (idempotente) ---
log "Instalando Xorg + Openbox en modo mínimo…"
apt-get update -y
apt-get install -y xserver-xorg-core xserver-xorg-video-all xserver-xorg-input-all xinit openbox x11-xserver-utils
# Opcional para kiosko puro (ocultar cursor); queda comentado en autostart
apt-get install -y unclutter || true

log "Verificando disponibilidad de Chromium (snap)…"
if [[ ! -x /snap/bin/chromium ]]; then
  if command -v snap >/dev/null 2>&1; then
    if snap install chromium; then
      log "Chromium (snap) instalado."
    else
      warn "No se pudo instalar Chromium vía snap automáticamente."
    fi
  else
    warn "snapd no está disponible; instala Chromium manualmente para el modo kiosko."
  fi
else
  log "Chromium snap detectado."
fi

# APP_USER ya está definido en línea 17, no redefinir
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ -n "$APP_HOME" ]] || die "No se pudo determinar HOME para $APP_USER"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -z "$LAN_IP" ]]; then
  warn "No se pudo detectar IP LAN. Ajusta PANTALLA_ALLOWED_ORIGINS manualmente si es necesario."
fi

ALLOWED_ORIGINS="http://localhost,http://127.0.0.1"
if [[ -n "$LAN_IP" ]]; then
  ALLOWED_ORIGINS+=",http://${LAN_IP}"
fi

# --- Autostart de Openbox con rotación automática si está en vertical (480x1920) ---
log "Preparando autostart de Openbox con rotación automática (480x1920 -> horizontal)..."
sudo -u "${APP_USER}" mkdir -p "${APP_HOME}/.config/openbox"

sudo tee "${APP_HOME}/.config/openbox/autostart" >/dev/null <<'EOF'
#!/bin/bash
# Rotar Wisecoco 8.8" a horizontal si el servidor X arranca en 480x1920 (portrait)
OUT="$(xrandr --query | awk '/ connected primary| connected/{print $1; exit}')"
if xrandr | grep -qE "$OUT[[:space:]]+connected[[:space:]]+480x1920"; then
  # Cambia "left" por "right" si tu panel concreto invierte el sentido
  xrandr --output "$OUT" --rotate left
fi

# Mantén la pantalla despierta en kiosko
xset -dpms
xset s off
xset s noblank

# Ocultar cursor en kiosko (descomenta si quieres):
# unclutter -idle 0.5 &

# El servicio systemd pantalla-ui.service se encarga de lanzar Chromium en modo kiosko.
EOF

log "Preparando /etc/Xwrapper.config para permitir Xorg sin sesión gráfica…"
cat >/etc/Xwrapper.config <<'EOF'
allowed_users=anybody
needs_root_rights=yes
EOF

log "Deshabilitando autostart XDG de Chromium (si existen)…"
disable_autostart_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    if grep -qiE 'chromium|google-chrome' "$file"; then
      if [[ "$file" == *.disabled ]]; then
        log "  Autostart ya deshabilitado: $file"
      else
        mv "$file" "$file.disabled"
        log "  Movido $file -> $file.disabled"
      fi
    fi
  fi
}

setup_blitzortung_relay() {
  local REAL_USER="${SUDO_USER:-$USER}"
  local TARGET_BASE="/opt/blitzortung"
  local RELAY_DIR="$TARGET_BASE/ws_relay"
  local VENV="$TARGET_BASE/.venv"
  local SERVICE_DIR="/home/${REAL_USER}/.config/systemd/user"
  local SERVICE_DST="$SERVICE_DIR/blitz_relay.service"
  local RELAY_SRC="$REPO_DIR/backend/extras/blitz_relay.py"
  local SERVICE_SRC="$REPO_DIR/backend/extras/blitz_relay.service"

  echo "[INFO] Configurando Blitzortung (relay WS→MQTT real)..."

  sudo mkdir -p "$RELAY_DIR" /var/log/pantalla
  sudo chown -R "$REAL_USER:$REAL_USER" "$TARGET_BASE" /var/log/pantalla

  if [[ ! -d "$VENV" ]]; then
    echo "[INFO] Creando entorno virtual Blitzortung..."
    sudo -u "$REAL_USER" python3 -m venv "$VENV"
    sudo -u "$REAL_USER" "$VENV/bin/pip" install -q --upgrade pip
    sudo -u "$REAL_USER" "$VENV/bin/pip" install -q aiohttp paho-mqtt
  else
    sudo -u "$REAL_USER" "$VENV/bin/pip" install -q --upgrade aiohttp paho-mqtt || true
  fi

  install -m 755 "$RELAY_SRC" "$RELAY_DIR/relay.py"
  sudo chown "$REAL_USER:$REAL_USER" "$RELAY_DIR/relay.py"

  sudo -u "$REAL_USER" mkdir -p "$SERVICE_DIR"
  sudo -u "$REAL_USER" install -m 644 "$SERVICE_SRC" "$SERVICE_DST"

  sudo loginctl enable-linger "$REAL_USER" >/dev/null 2>&1 || true
  sudo -u "$REAL_USER" --login systemctl --user daemon-reload || true
  sudo -u "$REAL_USER" --login systemctl --user enable --now blitz_relay.service || true

  echo "[CHECK] MQTT Blitzortung relay:"
  mosquitto_sub -h 127.0.0.1 -t 'blitzortung/#' -C 1 -W 3 | jq . || echo "⚠️ Esperando primeros strikes (puede tardar unos minutos)"
}

if [[ -d "${APP_HOME}/.config/autostart" ]]; then
  while IFS= read -r -d '' desktop; do
    disable_autostart_file "$desktop"
  done < <(find "${APP_HOME}/.config/autostart" -maxdepth 1 -type f -name '*.desktop' -print0)
fi

if [[ -d "/etc/xdg/autostart" ]]; then
  while IFS= read -r -d '' desktop; do
    disable_autostart_file "$desktop"
  done < <(find /etc/xdg/autostart -maxdepth 1 -type f -name '*.desktop' -print0)
fi

log "Desactivando servicios automáticos del snap de Chromium…"
systemctl_safe stop snap.chromium.daemon.service || true
systemctl_safe disable snap.chromium.daemon.service || true
if command -v snap >/dev/null 2>&1; then
  snap set chromium daemon.autostart=false || true
fi

log "Instalando lanzador de Chromium para systemd (${UI_LAUNCHER_DST})…"
install -m 755 "$UI_LAUNCHER_SRC" "$UI_LAUNCHER_DST"

log "Instalando servicio systemd de usuario ${UI_SERVICE_NAME}…"
# Asegurar que UI_USER esté correctamente definido
if [[ -n "${PANTALLA_UI_USER:-}" ]]; then
  UI_USER="$PANTALLA_UI_USER"
else
  UI_USER="$APP_USER"
fi

if ! id "$UI_USER" >/dev/null 2>&1; then
  die "El usuario $UI_USER no existe; ajusta PANTALLA_UI_USER antes de continuar"
fi

if [[ -f "$SYSTEMD_DIR/$UI_SERVICE_NAME" ]]; then
  warn "  Detectado servicio de sistema legacy; se deshabilita y elimina."
  systemctl_safe disable --now "$UI_SERVICE_NAME" || true
  rm -f "$SYSTEMD_DIR/$UI_SERVICE_NAME"
  systemctl_safe daemon-reload || true
fi

# Asegurar que el directorio systemd de usuario existe
mkdir -p "$USER_SYSTEMD_DIR"
install -D -m 644 "$UI_SERVICE_SRC" "$USER_SYSTEMD_DIR/$UI_SERVICE_NAME"
if [[ -f "$OPENBOX_SERVICE_SRC" ]]; then
  install -D -m 644 "$OPENBOX_SERVICE_SRC" "$USER_SYSTEMD_DIR/$OPENBOX_SERVICE_NAME"
fi

UI_UID="$(id -u "$UI_USER")"
UI_RUNTIME_DIR="/run/user/$UI_UID"
sudo loginctl enable-linger "$UI_USER" || true

if [[ ! -d "$UI_RUNTIME_DIR" ]]; then
  sudo mkdir -p "$UI_RUNTIME_DIR"
  sudo chown "$UI_USER":"$UI_USER" "$UI_RUNTIME_DIR"
fi

UI_SYSTEMD_ENV=("XDG_RUNTIME_DIR=$UI_RUNTIME_DIR" "DBUS_SESSION_BUS_ADDRESS=unix:path=$UI_RUNTIME_DIR/bus")

sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user daemon-reload || true
sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user enable "$OPENBOX_SERVICE_NAME" || true
sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user enable "$UI_SERVICE_NAME" || true

sudo chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}/.config/openbox"
sudo chmod +x "${APP_HOME}/.config/openbox/autostart"

log "Aplicando políticas de geolocalización para Chromium…"
LAN_IP_VALUE="$LAN_IP" python3 <<'PY'
import json
import os

lan_ip = os.environ.get("LAN_IP_VALUE", "").strip()
urls = ["http://localhost", "http://127.0.0.1"]
if lan_ip:
    urls.append(f"http://{lan_ip}")

policy = {
    "DefaultGeolocationSetting": 1,
    "GeolocationAllowedUrls": urls,
}

paths = [
    "/etc/chromium/policies/managed/allow_geolocation.json",
    "/var/snap/chromium/common/chromium/policies/managed/allow_geolocation.json",
]

for target in paths:
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(policy, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
PY

NODE_MAJ=0
NODE_VERSION=""
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -v)"
  NODE_MAJ="$(printf '%s' "$NODE_VERSION" | sed 's/v\([0-9]\+\).*/\1/')"
fi

if [[ "$INSTALL_NODE" == "1" ]]; then
  if [[ "$NODE_MAJ" -lt 20 ]]; then
    log "Instalando Node 20 LTS (Nodesource)…"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    NODE_VERSION="$(node -v)"
    NODE_MAJ="$(printf '%s' "$NODE_VERSION" | sed 's/v\([0-9]\+\).*/\1/')"
  else
    log "Node ${NODE_VERSION:-desconocido} detectado (>=20)."
  fi
else
  if [[ "$NODE_MAJ" -lt 20 ]]; then
    warn "Node <20 detectado y --no-node; la build del frontend podría fallar."
  fi
fi

log "Creando grupos/rutas y permisos…"
groupadd -f pantalla
install -d -m 2770 -o root -g pantalla "$ENV_DIR"
mkdir -p "$ASSETS_DIR" "$LOG_DIR" /opt/dash/assets
install -d -m 755 -o root -g root "$ENV_DIR/calendar"
chmod 755 "$LOG_DIR"
touch "$LOG_DIR/calendar.log"
chown root:root "$LOG_DIR/calendar.log"
chmod 644 "$LOG_DIR/calendar.log"
chown -R "$APP_USER:$APP_USER" /opt/dash
chmod 755 /opt/dash /opt/dash/assets
touch "$LOG_DIR/bg.log"
chown "$APP_USER:$APP_USER" "$LOG_DIR/bg.log"
chmod 664 "$LOG_DIR/bg.log"
touch "$LOG_DIR/bg-sync.log"
chown root:root "$LOG_DIR/bg-sync.log"
chmod 640 "$LOG_DIR/bg-sync.log"
usermod -aG pantalla "$APP_USER" || true
log "Si acabamos de añadir '$APP_USER' al grupo 'pantalla', es necesario reiniciar sesión o ejecutar 'newgrp pantalla' para que tome efecto."
log "Sugerencia: verifica pertenencia al grupo con 'id $APP_USER'."

log "Configurando sudoers para nmcli sin contraseña…"
SUDOERS_FILE="/etc/sudoers.d/pantalla-wifi"
printf "%s ALL=(root) NOPASSWD:/usr/bin/nmcli\n" "$APP_USER" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"

log "Escribiendo $ENV_DIR/env …"
# Normaliza formato: si se pasó clave sin prefijo, la convertimos
if [[ -n "${OPENAI_KEY:-}" ]]; then
  printf "OPENAI_API_KEY=%s\n" "$OPENAI_KEY" > "$ENV_DIR/env"
else
  if [[ ! -f "$ENV_DIR/env" ]]; then echo "# OPENAI_API_KEY=" > "$ENV_DIR/env"; fi
fi
chown "$APP_USER":pantalla "$ENV_DIR/env"
chmod 660 "$ENV_DIR/env"

log "Escribiendo $ENV_DIR/config.json …"
cat > "$ENV_DIR/config.json" <<JSON
{
  "aemet": {
    "apiKey": "${AEMET_KEY:-AEMET_API_KEY_PLACEHOLDER}",
    "municipioId": "${AEMET_MUNICIPIO_ID}",
    "municipioName": "${AEMET_MUNICIPIO_NAME}",
    "postalCode": "${AEMET_POSTAL_CODE}",
    "province": "${AEMET_PROVINCE}"
  },
  "weather": { "units": "metric", "city": "${CITY_NAME}" },
  "storm": { "threshold": 0.6, "enableExperimentalLightning": false },
  "wifi": { "preferredInterface": "wlp2s0" },
  "background": { "intervalMinutes": 60, "mode": "daily", "retainDays": 7 },
  "locale": { "country": "ES", "autonomousCommunity": "Comunitat Valenciana", "province": "Castellón", "city": "${CITY_NAME}" }
}
JSON
chown "$APP_USER":pantalla "$ENV_DIR/config.json"
chmod 660 "$ENV_DIR/config.json"

log "Escribiendo $ENV_DIR/secrets.json …"
SECRETS_PATH="$ENV_DIR/secrets.json" OPENAI_SECRET_VALUE="$OPENAI_KEY" python3 <<'PY'
import json
import os

path = os.environ["SECRETS_PATH"]
key = os.environ.get("OPENAI_SECRET_VALUE", "").strip()
data = {}
if key:
    data["openai"] = {"apiKey": key}

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
chown "$APP_USER":pantalla "$ENV_DIR/secrets.json"
chmod 660 "$ENV_DIR/secrets.json"

log "Escribiendo $ENV_DIR/backend.env …"
cat > "$ENV_DIR/backend.env" <<EOF
PANTALLA_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
EOF
chown "$APP_USER":pantalla "$ENV_DIR/backend.env"
chmod 660 "$ENV_DIR/backend.env"

chgrp -R pantalla "$ENV_DIR"

log "Permisos actuales en $ENV_DIR:"
ls -ld "$ENV_DIR"
ls -l "$ENV_DIR"
id "$APP_USER" || true
if sudo -u "$APP_USER" bash -lc "echo ok > '$ENV_DIR/.write_test' && ls -l '$ENV_DIR/.write_test'"; then
  log "Prueba de escritura en $ENV_DIR exitosa."
else
  warn "No se pudo crear el archivo de prueba en $ENV_DIR; revisa la pertenencia al grupo."
fi

log "Preparando backend (venv + deps)…"

log "Asegurando directorios de caché y almacenamiento…"
install -d -m 775 -o "$APP_USER" -g pantalla /var/cache/pantalla-dash
install -d -m 775 -o "$APP_USER" -g pantalla /var/cache/pantalla-dash/radar
install -d -m 775 -o "$APP_USER" -g pantalla "$BACKEND_DIR/storage"
install -d -m 775 -o "$APP_USER" -g pantalla "$BACKEND_DIR/storage/cache"

cd "$BACKEND_DIR"
sudo -u "$APP_USER" bash -lc "python3 -m venv .venv"
# Verificar que requirements.txt existe, sino instalar manualmente
if [[ -f "requirements.txt" ]]; then
  sudo -u "$APP_USER" bash -lc "source .venv/bin/activate && pip install -U pip && pip install -r requirements.txt"
else
  log "requirements.txt no encontrado, instalando dependencias manualmente..."
  sudo -u "$APP_USER" bash -lc "source .venv/bin/activate && pip install -U pip && pip install fastapi uvicorn httpx pydantic python-multipart requests python-dateutil Jinja2 openai pillow"
fi

log "Servicio backend templated…"
# Migra posible unidad antigua
if [[ -f "$SYSTEMD_DIR/${BACKEND_SVC_BASENAME}.service" ]]; then
  mv "$SYSTEMD_DIR/${BACKEND_SVC_BASENAME}.service" "$SYSTEMD_DIR/${BACKEND_SVC_TEMPLATE}"
fi
if [[ -f "$REPO_DIR/system/${BACKEND_SVC_TEMPLATE}" ]]; then
  install -D -m 644 "$REPO_DIR/system/${BACKEND_SVC_TEMPLATE}" "$SYSTEMD_DIR/${BACKEND_SVC_TEMPLATE}"
  sed -i "s|__REPO_DIR__|$REPO_DIR|g" "$SYSTEMD_DIR/${BACKEND_SVC_TEMPLATE}"
else
  die "No se encontró plantilla de servicio en $REPO_DIR/system/${BACKEND_SVC_TEMPLATE}"
fi

if [[ -f "$XORG_SERVICE_SRC" ]]; then
  install -D -m 644 "$XORG_SERVICE_SRC" "$SYSTEMD_DIR/$XORG_SERVICE_NAME"
fi

systemctl_safe daemon-reload
systemctl_safe enable --now "${BACKEND_SVC_BASENAME}@$APP_USER" || true
systemctl_safe enable --now "pantalla-xorg@$UI_USER" || true
sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user start "$OPENBOX_SERVICE_NAME" || true
sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user start "$UI_SERVICE_NAME" || true

echo "[INFO] Instalando Mosquitto (loopback seguro)…"
sudo apt install -y mosquitto mosquitto-clients >/dev/null 2>&1 || true

# Configuración loopback limpia
sudo bash -c 'cat > /etc/mosquitto/conf.d/loopback.conf <<EOF
listener 1883 127.0.0.1
allow_anonymous true
persistence false
connection_messages false
EOF'
if systemctl is-system-running >/dev/null 2>&1; then
  sudo systemctl enable mosquitto
  sudo systemctl restart mosquitto
else
  warn "D-Bus no disponible (instalación en chroot o headless). Omitido: systemctl enable/restart mosquitto"
fi

echo "[INFO] Mosquitto activo en loopback."
if systemctl is-system-running >/dev/null 2>&1; then
  systemctl is-active mosquitto && echo "  ✅ OK" || echo "  ❌ ERROR"
else
  warn "D-Bus no disponible para verificar mosquitto."
fi

setup_blitzortung_relay || { echo "[ERR] Falló la configuración de Blitzortung"; exit 1; }

# Refrescar permisos de logs tras la instalación del relay
sudo mkdir -p /var/log/mosquitto /var/log/pantalla
sudo chown -R mosquitto:mosquitto /var/log/mosquitto
sudo chown -R "${APP_USER}:${APP_USER}" /var/log/pantalla

# --- Hardening generador IA: corrige parámetros del script ---
GEN_SCRIPT="$REPO_DIR/opt/dash/scripts/generate_bg_daily.py"
if [[ -f "$GEN_SCRIPT" ]]; then
  log "Parcheando $GEN_SCRIPT (response_format / size)…"
  # Crear backup antes de modificar
  cp "$GEN_SCRIPT" "$GEN_SCRIPT.bak"
  if sed -i -E 's/,?\s*response_format\s*=\s*["'\''][^"'\'']*["'\'']//g' "$GEN_SCRIPT" && \
     sed -i -E 's/size\s*=\s*["'\''][^"'\'']*["'\'']/size="1536x1024"/g' "$GEN_SCRIPT"; then
    log "  Parches aplicados correctamente"
    rm -f "$GEN_SCRIPT.bak"
  else
    warn "  Fallo aplicando parches, restaurando desde backup"
    mv "$GEN_SCRIPT.bak" "$GEN_SCRIPT"
  fi
else
  warn "Script generador no encontrado: $GEN_SCRIPT"
fi

# ----- Frontend -----
if [[ -f "$FRONTEND_DIR/package.json" ]]; then
  log "Construyendo frontend (dash-ui)…"
  cd "$FRONTEND_DIR"

  # Limpieza previa opcional
  rm -rf node_modules 2>/dev/null || true

  # Intento 1: npm ci
  if sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && npm ci"; then
    log "npm ci OK"
  else
    warn "npm ci falló (lock desincronizado). Intentando npm install…"
    rm -rf node_modules 2>/dev/null || true
    if sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && npm install"; then
      log "npm install OK (lock actualizado)"
    else
      die "Fallo en npm install. Revisa package.json/package-lock.json."
    fi
  fi

  # Asegura react-router-dom para la mini web de configuración (HashRouter)
  # Primero verificar si jq está instalado
  if command -v jq >/dev/null 2>&1; then
    log "Verificando dependencias obligatorias con jq..."
    if sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && jq \".dependencies += {\\\"react-router-dom\\\":\\\"^6\\\"}\" package.json > package.tmp.json && mv package.tmp.json package.json" 2>/dev/null; then
      if sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && npm install"; then
        log "npm install de dependencias obligatorias OK"
      else
        die "Fallo en npm install tras ajustar dependencias obligatorias."
      fi
    else
      warn "jq falló al modificar package.json, continuando sin cambios..."
    fi
  else
    warn "jq no está disponible, saltando verificación de react-router-dom"
  fi

  if sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && npm run build"; then
    log "Build frontend OK"
  else
    die "Fallo en 'npm run build'"
  fi

  log "Actualizando /var/www/html con el build generado…"
  install -d -m 0755 /var/www/html
  rm -rf /var/www/html/*
  cp -a dist/. /var/www/html/
  chown -R root:root /var/www/html
  chmod 755 /var/www/html
  find /var/www/html -mindepth 1 -type d -exec chmod 755 {} +
  find /var/www/html -type f -exec chmod 644 {} +

  if [[ -f /var/www/html/index.html ]] && ! grep -q 'index-.*css?v=transparent-1' /var/www/html/index.html; then
    sed -i 's|\(/assets/index-[^"]*\.css\)|\1?v=transparent-1|' /var/www/html/index.html || true
  fi
else
  warn "dash-ui no encontrado; saltando build"
fi

log "Configurando Nginx…"
cat > "$NGINX_SITE" <<'NGINX'
server {
  listen 80 default_server;
  server_name _;
  root /var/www/html;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
  }

  location / {
    try_files $uri /index.html;
  }

  location /assets/backgrounds/auto/ {
    alias /opt/dash/assets/backgrounds/auto/;
    access_log off;
  }
}
NGINX
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/pantalla
find /etc/nginx/sites-enabled -maxdepth 1 -type f -name 'pantalla.bak*' -delete 2>/dev/null || true
rm -f /etc/nginx/sites-enabled/default || true
nginx -t
if systemctl is-system-running >/dev/null 2>&1; then
  if ! systemctl reload nginx; then
    service nginx reload
  fi
else
  warn "D-Bus no disponible para recargar nginx vía systemctl."
  service nginx reload || true
fi

log "Post-checks de Nginx y estáticos…"
ASSETS_ROOT="/var/www/html/assets"
[[ -d "$ASSETS_ROOT" ]] || die "No existe el directorio $ASSETS_ROOT"
INDEX_JS="$(find "$ASSETS_ROOT" -maxdepth 1 -type f -name 'index-*.js' -printf '%f\n' | head -n1)"
[[ -n "$INDEX_JS" ]] || die "No se encontró bundle index-*.js en $ASSETS_ROOT"
VENDOR_JS="$(find "$ASSETS_ROOT" -maxdepth 1 -type f -name 'vendor-*.js' -printf '%f\n' | head -n1)"
[[ -n "$VENDOR_JS" ]] || die "No se encontró bundle vendor-*.js en $ASSETS_ROOT"
INDEX_CSS="$(find "$ASSETS_ROOT" -maxdepth 1 -type f -name 'index-*.css' -printf '%f\n' | head -n1)"
[[ -n "$INDEX_CSS" ]] || die "No se encontró bundle index-*.css en $ASSETS_ROOT"

ROOT_STATUS="$(curl -s -I http://127.0.0.1/ | head -n1 || true)"
[[ "$ROOT_STATUS" =~ HTTP/1\.[01]\ 200 ]] || die "Nginx no responde 200 en / (obtenido: $ROOT_STATUS)"

ASSET_HEAD_STATUS="$(curl -s -I "http://127.0.0.1/assets/${INDEX_JS}" | head -n1 || true)"
[[ "$ASSET_HEAD_STATUS" =~ HTTP/1\.[01]\ 200 ]] || die "El bundle ${INDEX_JS} no responde 200 (obtenido: $ASSET_HEAD_STATUS)"

ASSET_BODY_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1/assets/${INDEX_JS}" || true)"
[[ "$ASSET_BODY_STATUS" == "200" ]] || die "El bundle ${INDEX_JS} no devolvió 200 en descarga (obtenido: $ASSET_BODY_STATUS)"

API_STATUS_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/health || true)"
if [[ "$API_STATUS_CODE" == "200" ]]; then
  log "Backend OK (/api/health 200)"
else
  warn "Backend no responde 200 en /api/health (obtenido: $API_STATUS_CODE)"
fi

# ----- Servicio fondos IA -----
log "Instalando servicio y timer de fondos IA…"
cat > "$SYSTEMD_DIR/$BG_SVC" <<SERVICE
[Unit]
Description=Pantalla Dash · Generar fondo IA
After=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_DIR/env
User=$APP_USER
SupplementaryGroups=pantalla
WorkingDirectory=$REPO_DIR
ExecStart=$BACKEND_DIR/.venv/bin/python $GEN_SCRIPT
StandardOutput=append:$LOG_DIR/bg.log
StandardError=append:$LOG_DIR/bg.log

[Install]
WantedBy=multi-user.target
SERVICE

cat > "$SYSTEMD_DIR/$BG_TIMER" <<'TIMER'
[Unit]
Description=Timer fondos IA (dinámico por config.json)

[Timer]
OnBootSec=1min
OnUnitActiveSec=360min
Unit=pantalla-bg-generate.service

[Install]
WantedBy=timers.target
TIMER

log "Configurando sincronización automática del timer de fondos IA…"
install -Dm755 "$BG_SYNC_SCRIPT_SRC" "$BG_SYNC_SCRIPT_DST"
install -Dm644 "$REPO_DIR/system/$BG_SYNC_SERVICE" "$SYSTEMD_DIR/$BG_SYNC_SERVICE"
install -Dm644 "$REPO_DIR/system/$BG_SYNC_PATH" "$SYSTEMD_DIR/$BG_SYNC_PATH"

systemctl_safe daemon-reload
systemctl_safe enable --now "$BG_TIMER"
systemctl_safe enable --now "$BG_SYNC_PATH"
systemctl_safe start "$BG_SYNC_SERVICE"

# ----- Reinicia backend para cargar endpoints nuevos (config/Wi-Fi si los añadiste) -----
if systemctl is-system-running >/dev/null 2>&1; then
  systemctl restart "${BACKEND_SVC_BASENAME}@$APP_USER" || true
else
  warn "D-Bus no disponible para reiniciar ${BACKEND_SVC_BASENAME}@$APP_USER"
fi

echo "[POST] Reinicio ordenado de servicios…"
if systemctl is-system-running >/dev/null 2>&1; then
  if ! systemctl restart nginx; then
    warn "No se pudo reiniciar nginx (¿instalado?)"
  fi
else
  warn "D-Bus no disponible para reiniciar nginx"
fi
if systemctl is-system-running >/dev/null 2>&1; then
  if ! systemctl restart "${BACKEND_SVC_BASENAME}@$APP_USER"; then
    warn "No se pudo reiniciar ${BACKEND_SVC_BASENAME}@$APP_USER"
  fi
else
  warn "D-Bus no disponible para reiniciar ${BACKEND_SVC_BASENAME}@$APP_USER"
fi

# Refrescar el navegador kiosk para limpiar cachés
pkill -f 'chrom(e|ium).*--kiosk' || true

sleep 5
echo "[POST] Precargando endpoints para UI (efemérides/side-info)…"
curl -fsS http://127.0.0.1:8081/api/season/month >/dev/null || true
curl -fsS http://127.0.0.1:8081/api/news/headlines >/dev/null || true
curl -fsS http://127.0.0.1:8081/api/weather/today >/dev/null || true
curl -fsS http://127.0.0.1:8081/api/backgrounds/current >/dev/null || true

echo "[POST] Validaciones rápidas:"
curl -s http://127.0.0.1:8081/api/health | jq . || true
curl -s http://127.0.0.1:8081/api/season/month | jq . | head -n 20 || true
curl -s http://127.0.0.1:8081/api/news/headlines | jq . | head -n 20 || true

# Ajuste de zona horaria (solo si no está ya configurada)
if ! timedatectl | grep -q "Time zone: ${TZ_DEFAULT}"; then
  log "Configurando zona horaria ${TZ_DEFAULT}..."
  sudo timedatectl set-timezone "${TZ_DEFAULT}"
else
  log "Zona horaria ya configurada: ${TZ_DEFAULT}"
fi

# ----- Checks finales -----
echo
log "Checks finales:"
set +e
curl -fsS http://127.0.0.1/api/health >/dev/null && echo "  ✅ Backend responde /api/health" || echo "  ❌ Backend DOWN (journalctl -u ${BACKEND_SVC_BASENAME}@$APP_USER -n 100)"
curl -fsS "http://127.0.0.1/assets/${INDEX_JS}" >/dev/null && echo "  ✅ Assets JS disponibles" || echo "  ❌ Assets inaccesibles"
if systemctl is-system-running >/dev/null 2>&1; then
  systemctl is-active --quiet "${BACKEND_SVC_BASENAME}@$APP_USER" && echo "  ✅ Servicio backend activo" || echo "  ❌ Servicio backend inactivo"
  systemctl is-active --quiet "pantalla-xorg@$UI_USER" && echo "  ✅ Xorg activo" || echo "  ❌ Xorg no está activo"
else
  echo "  ⚠️ Comprobaciones systemctl omitidas (D-Bus no disponible)"
fi
sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user is-active "$OPENBOX_SERVICE_NAME" >/dev/null 2>&1 && echo "  ✅ Openbox (usuario) activo" || echo "  ❌ Openbox (usuario) no activo"
sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user is-active "$UI_SERVICE_NAME" >/dev/null 2>&1 && echo "  ✅ UI Chromium activa" || echo "  ❌ UI Chromium no activa"
nmcli -t -f DEVICE device status >/dev/null && echo "  ✅ nmcli OK" || echo "  ❌ nmcli reportó error"

echo "[CHECK] MQTT Blitzortung status:"
REAL_USER="${SUDO_USER:-$USER}"
STATUS=$(sudo -u "$REAL_USER" --login systemctl --user --no-pager status blitz_relay.service 2>/dev/null || true)
if [[ -n "$STATUS" ]]; then
  grep -E "Active|PID" <<<"$STATUS" || true
else
  echo "  ⚠️ Servicio blitz_relay.service no disponible."
fi

echo "[CHECK] Backend provider:"
curl -s http://127.0.0.1/api/storms/status | jq '.provider? // .storm?.provider?' || true

echo "== Backend health =="
curl -s http://127.0.0.1:8081/api/health || true

echo "== Season month =="
curl -s http://127.0.0.1:8081/api/season/month | jq '.month? // .' || true

echo "== News headlines (top) =="
curl -s http://127.0.0.1:8081/api/news/headlines | jq '.[0:3]' || true

echo "== Fondo actual =="
curl -s http://127.0.0.1:8081/api/backgrounds/current | jq . || true

FN=$(curl -s http://127.0.0.1:8081/api/backgrounds/current | jq -r .filename)
if [[ -n "$FN" && "$FN" != "null" ]]; then
  echo "== HEAD Nginx bg =="
  curl -sI "http://127.0.0.1/backgrounds/auto/$FN" | sed -n '1,8p' || true
  echo "== HEAD Backend bg =="
  curl -sI "http://127.0.0.1:8081/backgrounds/auto/$FN" | sed -n '1,8p' || true
else
  warn "No se pudo resolver filename desde /api/backgrounds/current"
fi

echo "== Nginx access (últimas peticiones de season/news) =="
sudo egrep -n 'GET /api/(season/month|news/headlines)' /var/log/nginx/access.log | tail -n 8 || true
set -e

curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/api/health || true
sudo -u "$REAL_USER" --login systemctl --user status blitz_relay.service --no-pager -l | head -n 10 || true

# genera primer fondo si hay clave
if grep -qE '^OPENAI_API_KEY=.+$' "$ENV_DIR/env"; then
  log "Generando primer fondo IA…"
  systemctl_safe start "$BG_SVC" || true
  sleep 2
  # Verificar que el directorio existe antes de listar
  if [[ -d "$ASSETS_DIR" ]] && ls -1 "$ASSETS_DIR"/*.webp >/dev/null 2>&1; then
    echo "  ✅ Fondo IA generado en $ASSETS_DIR"
  else
    echo "  ℹ️  Aún no se ve .webp; revisa log: tail -n 120 $LOG_DIR/bg.log"
  fi
else
  warn "OPENAI_API_KEY no configurada. Saltando generación inicial de fondo."
fi

echo
log "Instalación completada."
echo "  UI:       http://localhost/"
echo "  Backend:  http://127.0.0.1:8081"
echo "  Config:   $ENV_DIR/config.json ($APP_USER:pantalla 640)"
echo "  Secretos: $ENV_DIR/secrets.json ($APP_USER:$APP_USER 600)"
echo "  Env:      $ENV_DIR/env ($APP_USER:pantalla 640)"
echo "  Fondos:   $ASSETS_DIR"
log "Hora local del sistema: $(date)"
