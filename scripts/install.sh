#!/usr/bin/env bash
set -euo pipefail

SYSTEMD_DBUS_AVAILABLE=1
if ! command -v systemctl >/dev/null 2>&1; then
  SYSTEMD_DBUS_AVAILABLE=0
elif ! systemctl list-unit-files >/dev/null 2>&1; then
  SYSTEMD_DBUS_AVAILABLE=0
fi
if [[ ! -S /run/systemd/system ]]; then
  SYSTEMD_DBUS_AVAILABLE=0
elif command -v busctl >/dev/null 2>&1; then
  if ! busctl status >/dev/null 2>&1; then
    SYSTEMD_DBUS_AVAILABLE=0
  fi
fi
SYSTEMD_DBUS_MESSAGE_SHOWN=0

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

export DEBIAN_FRONTEND=noninteractive

run_userctl() {
  local target="$USER"
  local use_login=0
  local env_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --user)
        target="$2"
        shift 2
        ;;
      --login)
        use_login=1
        shift
        ;;
      --env)
        shift
        while [[ $# -gt 0 && "$1" != "--" ]]; do
          env_args+=("$1")
          shift
        done
        ;;
      --)
        shift
        break
        ;;
      *)
        break
        ;;
    esac
  done

  local cmd=("$@")
  local cmd_desc="${cmd[*]}"

  if [[ ${SYSTEMD_DBUS_AVAILABLE:-1} -ne 1 ]]; then
    if [[ ${SYSTEMD_DBUS_MESSAGE_SHOWN:-0} -eq 0 ]]; then
      warn "systemd D-Bus no disponible; omitiendo operaciones systemctl --user"
      SYSTEMD_DBUS_MESSAGE_SHOWN=1
    fi
    echo "[INFO] (skip) systemctl --user ${cmd_desc}"
    return 0
  fi

  local sudo_cmd=(sudo -u "$target")
  if (( use_login )); then
    sudo_cmd+=(--login)
  fi
  if ((${#env_args[@]} > 0)); then
    sudo_cmd+=(env "${env_args[@]}")
  fi
  sudo_cmd+=(systemctl --user)
  sudo_cmd+=("${cmd[@]}")
  if ! "${sudo_cmd[@]}"; then
    echo "[WARN] Fallo leve: systemctl --user ${cmd_desc} (usuario: ${target})"
    return 1
  fi
}

run_sysctl() {
  local cmd_desc="$*"
  if [[ ${SYSTEMD_DBUS_AVAILABLE:-1} -ne 1 ]]; then
    if [[ ${SYSTEMD_DBUS_MESSAGE_SHOWN:-0} -eq 0 ]]; then
      warn "systemd D-Bus no disponible; omitiendo operaciones systemctl"
      SYSTEMD_DBUS_MESSAGE_SHOWN=1
    fi
    echo "[INFO] (skip) systemctl ${cmd_desc}"
    return 0
  fi
  if ! systemctl "$@"; then
    echo "[WARN] Fallo leve: systemctl ${cmd_desc}"
    return 1
  fi
}

echo "[INFO] Limpiando entorno previo (sin tocar Snap global)…"
sudo apt purge -y chromium chromium-browser || true
sudo rm -f /etc/apt/sources.list.d/*chromium*.list 2>/dev/null || true
sudo apt autoremove -y

echo "[INFO] Instalando dependencias base del sistema..."
sudo apt update -y
sudo apt install -y xorg openbox x11-xserver-utils dbus-x11 fonts-dejavu-core \
                    python3-pip python3-venv git curl jq nginx software-properties-common

wait_for_http() {
  local host="$1"
  local port="$2"
  local path="$3"
  local timeout="${4:-30}"
  local start
  start=$(date +%s)
  local delay=2
  local code=""
  while true; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://${host}:${port}${path}" || true)
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    local now
    now=$(date +%s)
    if (( now - start >= timeout )); then
      warn "No se obtuvo 200 en http://${host}:${port}${path} tras ${timeout}s (último código: ${code:-N/A})"
      return 1
    fi
    sleep "$delay"
    if (( delay < 5 )); then
      delay=$((delay + 1))
    fi
  done
}

# ----- Paths base (script dentro de /scripts -> raíz es su padre) -----
APP_USER="${SUDO_USER:-${USER}}"
REPO_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/dash-ui"
ENV_DIR="/etc/pantalla-dash"
LOG_DIR="/var/log/pantalla-dash"
NGINX_SITE="/etc/nginx/sites-available/pantalla"
SYSTEMD_DIR="/etc/systemd/system"
USER_SYSTEMD_DIR="/etc/xdg/systemd/user"
LEGACY_USER_SYSTEMD_DIR="/etc/systemd/user"
LEGACY_UI_SERVICE_NAME="pantalla-ui.service"
OPENBOX_SERVICE_NAME="pantalla-openbox.service"
OPENBOX_SERVICE_SRC="$REPO_DIR/services/$OPENBOX_SERVICE_NAME"
UI_LAUNCHER_SRC="$REPO_DIR/scripts/pantalla-ui-launch.sh"
UI_LAUNCHER_DST="/usr/local/bin/pantalla-ui-launch.sh"

BACKEND_SVC_BASENAME="pantalla-dash-backend"
BACKEND_SVC_TEMPLATE="${BACKEND_SVC_BASENAME}@.service"
XORG_SERVICE_NAME="pantalla-xorg@.service"
XORG_SERVICE_SRC="$REPO_DIR/system/$XORG_SERVICE_NAME"

# ----- Defaults de configuración -----
TZ_DEFAULT="${TZ_DEFAULT:-Europe/Madrid}"
AEMET_MUNICIPIO_ID="${AEMET_MUNICIPIO_ID:-12138}"   # Vila-real
AEMET_MUNICIPIO_NAME="${AEMET_MUNICIPIO_NAME:-Vila-real}"
AEMET_POSTAL_CODE="${AEMET_POSTAL_CODE:-12540}"
AEMET_PROVINCE="${AEMET_PROVINCE:-Castellón}"
CITY_NAME="${CITY_NAME:-Vila-real}"

# ----- Flags CLI / entorno -----
AEMET_KEY="${AEMET_KEY:-}"
NON_INTERACTIVE="0"
ENV_FILE=""
INSTALL_NODE="1"    # instala Node LTS si falta
ENABLE_LOCAL_MQTT="0"

usage() {
  cat <<EOF
Uso: sudo ./scripts/install.sh [opciones]
  --aemet-key KEY         Clave AEMET
  --municipio-id ID       (por defecto: ${AEMET_MUNICIPIO_ID})
  --municipio-name NAME   (por defecto: ${AEMET_MUNICIPIO_NAME})
  --postal-code CP        (por defecto: ${AEMET_POSTAL_CODE})
  --province NAME         (por defecto: ${AEMET_PROVINCE})
  --city NAME             (por defecto: ${CITY_NAME})
  --env FILE              Cargar variables (.env con AEMET_KEY=...)
  --no-node               No instalar Node LTS
  --enable-local-mqtt     Instala y configura Mosquitto en loopback
  --non-interactive       Sin preguntas
  -h, --help              Ayuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --aemet-key) AEMET_KEY="$2"; shift 2;;
    --municipio-id) AEMET_MUNICIPIO_ID="$2"; shift 2;;
    --municipio-name) AEMET_MUNICIPIO_NAME="$2"; shift 2;;
    --postal-code) AEMET_POSTAL_CODE="$2"; shift 2;;
    --province) AEMET_PROVINCE="$2"; shift 2;;
    --city) CITY_NAME="$2"; shift 2;;
    --env) ENV_FILE="$2"; shift 2;;
    --no-node) INSTALL_NODE="0"; shift;;
    --enable-local-mqtt) ENABLE_LOCAL_MQTT="1"; shift;;
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
  AEMET_KEY="${AEMET_KEY:-${AEMET_API_KEY:-$AEMET_KEY}}"
fi

if [[ "$NON_INTERACTIVE" != "1" ]]; then
  if [[ -z "$AEMET_KEY" ]]; then read -rp "AEMET_API_KEY (enter para dejar vacío): " AEMET_KEY || true; fi
  read -rp "Municipio ID AEMET [${AEMET_MUNICIPIO_ID}]: " _i || true; AEMET_MUNICIPIO_ID="${_i:-$AEMET_MUNICIPIO_ID}"
  read -rp "Municipio nombre [${AEMET_MUNICIPIO_NAME}]: " _n || true; AEMET_MUNICIPIO_NAME="${_n:-$AEMET_MUNICIPIO_NAME}"
  read -rp "Código postal [${AEMET_POSTAL_CODE}]: " _p || true; AEMET_POSTAL_CODE="${_p:-$AEMET_POSTAL_CODE}"
  read -rp "Provincia [${AEMET_PROVINCE}]: " _pr || true; AEMET_PROVINCE="${_pr:-$AEMET_PROVINCE}"
  read -rp "Ciudad (UI) [${CITY_NAME}]: " _c || true; CITY_NAME="${_c:-$CITY_NAME}"
fi

log "Instalando paquetes base…"
apt-get update -y
apt-get install -y python3 unzip ca-certificates espeak-ng network-manager rsync netcat-openbsd

log "Asegurando NetworkManager activo…"
run_sysctl enable --now NetworkManager || true

# --- X stack mínimo y sesión ligera (idempotente) ---
log "Instalando utilidades adicionales para sesión gráfica…"
sudo apt install -y unclutter || true

echo "[INFO] Añadiendo repositorio ungoogled-chromium..."
sudo add-apt-repository -y ppa:ungoogled-chromium/ppa
sudo apt update -y
sudo apt install -y ungoogled-chromium

if command -v chromium >/dev/null 2>&1; then
  echo "[OK] ungoogled-chromium instalado en: $(command -v chromium)"
else
  echo "[ERROR] No se pudo instalar ungoogled-chromium."
  exit 1
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
echo "[INFO] Configurando autostart de Openbox para ungoogled-chromium…"
sudo -u "${APP_USER}" mkdir -p "${APP_HOME}/.config/openbox"

AUTOSTART_FILE="${APP_HOME}/.config/openbox/autostart"
TMP_AUTOSTART="$(mktemp)"
cat >"$TMP_AUTOSTART" <<'EOF'
# --- BEGIN Pantalla_reloj AUTOSTART (stable 2025) ---
xset -dpms
xset s off
sleep 2
chromium --kiosk http://127.0.0.1 \
  --noerrdialogs --disable-session-crashed-bubble --incognito --start-fullscreen \
  --disable-pinch --overscroll-history-navigation=0 --no-first-run \
  --disable-infobars --fast --fast-start --disable-features=TranslateUI \
  --window-size=1920,480 --window-position=0,0 &
# --- END Pantalla_reloj AUTOSTART (stable 2025) ---
EOF

if [[ -f "$AUTOSTART_FILE" ]]; then
  awk '
    BEGIN { skip=0 }
    /--- BEGIN Pantalla_reloj AUTOSTART \(stable 2025\) ---/ { skip=1; next }
    /--- END Pantalla_reloj AUTOSTART \(stable 2025\) ---/ { skip=0; next }
    skip==0 { print }
  ' "$AUTOSTART_FILE" > "${AUTOSTART_FILE}.clean" || true
  cat "${AUTOSTART_FILE}.clean" "$TMP_AUTOSTART" > "$AUTOSTART_FILE"
  rm -f "${AUTOSTART_FILE}.clean"
else
  cp -f "$TMP_AUTOSTART" "$AUTOSTART_FILE"
fi
rm -f "$TMP_AUTOSTART"
chown "${APP_USER}:${APP_USER}" "$AUTOSTART_FILE"
chmod 0755 "$AUTOSTART_FILE"

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

log "Instalando lanzador de Chromium para systemd (${UI_LAUNCHER_DST})…"
install -m 755 "$UI_LAUNCHER_SRC" "$UI_LAUNCHER_DST"

log "Instalando servicio systemd de usuario ${OPENBOX_SERVICE_NAME}…"
# Asegurar que UI_USER esté correctamente definido
if [[ -n "${PANTALLA_UI_USER:-}" ]]; then
  UI_USER="$PANTALLA_UI_USER"
else
  UI_USER="$APP_USER"
fi

if ! id "$UI_USER" >/dev/null 2>&1; then
  die "El usuario $UI_USER no existe; ajusta PANTALLA_UI_USER antes de continuar"
fi

if [[ -f "$SYSTEMD_DIR/$LEGACY_UI_SERVICE_NAME" ]]; then
  warn "  Detectado servicio de sistema legacy; se deshabilita y elimina."
  run_sysctl disable --now "$LEGACY_UI_SERVICE_NAME" || true
  rm -f "$SYSTEMD_DIR/$LEGACY_UI_SERVICE_NAME"
  run_sysctl daemon-reload || true
fi

if [[ -f "$LEGACY_USER_SYSTEMD_DIR/$LEGACY_UI_SERVICE_NAME" ]]; then
  warn "  Eliminando unidad de usuario legacy ${LEGACY_UI_SERVICE_NAME}."
  rm -f "$LEGACY_USER_SYSTEMD_DIR/$LEGACY_UI_SERVICE_NAME"
fi

UI_UID="$(id -u "$UI_USER")"
UI_RUNTIME_DIR="/run/user/$UI_UID"
sudo loginctl enable-linger "$UI_USER" || true

if [[ ! -d "$UI_RUNTIME_DIR" ]]; then
  sudo mkdir -p "$UI_RUNTIME_DIR"
  sudo chown "$UI_USER":"$UI_USER" "$UI_RUNTIME_DIR"
fi

UI_SYSTEMD_ENV=("XDG_RUNTIME_DIR=$UI_RUNTIME_DIR" "DBUS_SESSION_BUS_ADDRESS=unix:path=$UI_RUNTIME_DIR/bus")

echo "[INFO] Configurando servicio Openbox con entorno D-Bus…"
sudo mkdir -p "$USER_SYSTEMD_DIR"
if [[ -f "$OPENBOX_SERVICE_SRC" ]]; then
  sudo cp -f "$OPENBOX_SERVICE_SRC" "$USER_SYSTEMD_DIR/$OPENBOX_SERVICE_NAME"
fi
if [[ -f "$LEGACY_USER_SYSTEMD_DIR/$OPENBOX_SERVICE_NAME" ]]; then
  sudo rm -f "$LEGACY_USER_SYSTEMD_DIR/$OPENBOX_SERVICE_NAME"
fi
if ! sudo systemctl --user daemon-reload 2>/dev/null; then
  echo "[INFO] (skip) sudo systemctl --user daemon-reload"
fi
if ! sudo systemctl --user enable --now "$OPENBOX_SERVICE_NAME" 2>/dev/null; then
  echo "[INFO] (skip) sudo systemctl --user enable --now $OPENBOX_SERVICE_NAME"
fi
if [[ ${SYSTEMD_DBUS_AVAILABLE:-1} -eq 1 ]]; then
  sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user daemon-reload || true
  sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user enable --now "$OPENBOX_SERVICE_NAME" || true
else
  echo "[INFO] (skip) systemctl --user daemon-reload (systemd D-Bus no disponible)"
  echo "[INFO] (skip) systemctl --user enable --now $OPENBOX_SERVICE_NAME"
fi
sleep 3

echo "[CHECK] Verificando ejecución de autostart…"
if [[ ${SYSTEMD_DBUS_AVAILABLE:-1} -eq 1 ]]; then
  sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user restart pantalla-openbox || true
else
  echo "[INFO] (skip) systemctl --user restart pantalla-openbox"
fi
sleep 6
pgrep chromium >/dev/null && echo "✅ Chromium lanzado desde autostart" || echo "❌ Chromium no lanzado (revisar logs Openbox)"

echo "[INFO] Deshabilitando UI por systemd (si existe)…"
UI_HOME="$(getent passwd "$UI_USER" | cut -d: -f6)"
if [[ -n "$UI_HOME" ]]; then
  run_userctl --user "$UI_USER" --env "${UI_SYSTEMD_ENV[@]}" -- disable --now "pantalla-ui@${UI_USER}.service" 2>/dev/null || true
  rm -f "$UI_HOME/.config/systemd/user/pantalla-ui@.service" 2>/dev/null || true
  run_userctl --user "$UI_USER" --env "${UI_SYSTEMD_ENV[@]}" -- daemon-reload || true
fi

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
log "Deshabilitando y eliminando fondos IA (si existen)…"
run_sysctl disable --now pantalla-bg-generate.timer pantalla-bg-generate.service 2>/dev/null || true
run_sysctl disable --now pantalla-bg-sync.path pantalla-bg-sync.service 2>/dev/null || true
rm -f "$SYSTEMD_DIR/pantalla-bg-generate.service" "$SYSTEMD_DIR/pantalla-bg-generate.timer" \
      "$SYSTEMD_DIR/pantalla-bg-sync.service" "$SYSTEMD_DIR/pantalla-bg-sync.path" 2>/dev/null || true
rm -f /usr/local/sbin/pantalla-bg-sync-timer 2>/dev/null || true
rm -f /opt/dash/scripts/generate_bg_daily.py 2>/dev/null || true
rm -f /etc/logrotate.d/pantalla-bg 2>/dev/null || true
run_sysctl daemon-reload || true

groupadd -f pantalla
install -d -m 2770 -o root -g pantalla "$ENV_DIR"
mkdir -p "$LOG_DIR" /opt/dash/assets
install -d -m 755 -o root -g root "$ENV_DIR/calendar"
chmod 755 "$LOG_DIR"
touch "$LOG_DIR/calendar.log"
chown root:root "$LOG_DIR/calendar.log"
chmod 644 "$LOG_DIR/calendar.log"
chown -R "$APP_USER:$APP_USER" /opt/dash
chmod 755 /opt/dash /opt/dash/assets
usermod -aG pantalla "$APP_USER" || true
log "Si acabamos de añadir '$APP_USER' al grupo 'pantalla', es necesario reiniciar sesión o ejecutar 'newgrp pantalla' para que tome efecto."
log "Sugerencia: verifica pertenencia al grupo con 'id $APP_USER'."

log "Configurando sudoers para nmcli sin contraseña…"
SUDOERS_FILE="/etc/sudoers.d/pantalla-wifi"
printf "%s ALL=(root) NOPASSWD:/usr/bin/nmcli\n" "$APP_USER" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"

log "Escribiendo $ENV_DIR/env …"
if [[ ! -f "$ENV_DIR/env" ]]; then
  echo "# Variables de entorno para pantalla-dash" > "$ENV_DIR/env"
fi
chown "$APP_USER":pantalla "$ENV_DIR/env"
chmod 640 "$ENV_DIR/env"

log "Escribiendo $ENV_DIR/config.json …"
WIFI_IFACE="$(nmcli -t -f DEVICE,TYPE device 2>/dev/null | awk -F: '$2=="wifi"{print $1; exit}' || true)"
if [[ -n "$WIFI_IFACE" ]]; then
  log "Interfaz Wi-Fi detectada: $WIFI_IFACE"
  WIFI_PREF_VALUE="\"$WIFI_IFACE\""
else
  warn "No se detectó interfaz Wi-Fi; se configurará preferredInterface=null"
  WIFI_PREF_VALUE="null"
fi
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
  "wifi": { "preferredInterface": ${WIFI_PREF_VALUE} },
  "background": { "intervalMinutes": 60, "mode": "daily", "retainDays": 7 },
  "locale": { "country": "ES", "autonomousCommunity": "Comunitat Valenciana", "province": "Castellón", "city": "${CITY_NAME}" },
  "ui": {
    "mode": "geoscope_with_overlay",
    "overlay": {
      "enabled": true,
      "opacity": 0.28,
      "blur_px": 6,
      "corner_radius": 20,
      "position": "bottom",
      "margin_px": 24,
      "dwell_seconds": 15,
      "transition_ms": 450,
      "order": [
        "weather_now",
        "weather_week",
        "moon",
        "season",
        "ephemeris",
        "news",
        "saints",
        "calendar"
      ]
    }
  },
  "geoscope": { "enabled": true, "rotate": true, "fps_cap": 30 }
}
JSON
chown "$APP_USER":pantalla "$ENV_DIR/config.json"
chmod 640 "$ENV_DIR/config.json"

log "Escribiendo $ENV_DIR/secrets.json …"
SECRETS_PATH="$ENV_DIR/secrets.json" python3 <<'PY'
import json
import os

path = os.environ["SECRETS_PATH"]
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as handle:
    json.dump({}, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
chown "$APP_USER":pantalla "$ENV_DIR/secrets.json"
chmod 600 "$ENV_DIR/secrets.json"

log "Escribiendo $ENV_DIR/backend.env …"
cat > "$ENV_DIR/backend.env" <<EOF
PANTALLA_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
EOF
chown "$APP_USER":pantalla "$ENV_DIR/backend.env"
chmod 640 "$ENV_DIR/backend.env"

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

run_sysctl daemon-reload || true

if [[ "$ENABLE_LOCAL_MQTT" == "1" ]]; then
  echo "[INFO] Instalando Mosquitto (loopback seguro)…"
  apt-get install -y mosquitto mosquitto-clients

  mkdir -p /etc/mosquitto/conf.d
  cat >/etc/mosquitto/mosquitto.conf <<'EOF'
allow_anonymous true
include_dir /etc/mosquitto/conf.d
EOF
  cat >/etc/mosquitto/conf.d/loopback.conf <<'EOF'
listener 1883 127.0.0.1
allow_anonymous true
persistence false
connection_messages false
EOF
  run_sysctl enable --now mosquitto || true

  if nc -z 127.0.0.1 1883 2>/dev/null; then
    echo "[OK] Mosquitto activo en loopback."
  else
    echo "[WARN] Mosquitto no responde en 127.0.0.1:1883 (se verificará tras login)."
  fi

  log "El backend gestionará el relay Blitzortung vía MQTT local."

  sudo mkdir -p /var/log/mosquitto
  sudo chown -R mosquitto:mosquitto /var/log/mosquitto
else
  log "Mosquitto no instalado (proxy público por defecto)."
fi

sudo mkdir -p /var/log/pantalla
sudo chown -R "${APP_USER}:${APP_USER}" /var/log/pantalla

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
if ! run_sysctl reload nginx; then
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

echo "[CHECK] Verificando entorno gráfico y navegador..."
if ! sudo systemctl --user restart pantalla-openbox.service 2>/dev/null; then
  echo "[INFO] (skip) sudo systemctl --user restart pantalla-openbox.service"
fi
if [[ ${SYSTEMD_DBUS_AVAILABLE:-1} -eq 1 ]]; then
  sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user restart pantalla-openbox || true
else
  echo "[INFO] (skip) systemctl --user restart pantalla-openbox"
fi
sleep 6
pgrep Xorg >/dev/null && echo "✅ Xorg activo" || echo "❌ Xorg no activo"
pgrep openbox >/dev/null && echo "✅ Openbox activo" || echo "❌ Openbox no activo"
pgrep chromium >/dev/null && echo "✅ Chromium kiosk activo" || echo "❌ Chromium no detectado"
curl -s -m 3 -o /dev/null -w "Frontend HTTP: %{http_code}\n" http://127.0.0.1/ || true
curl -s -m 3 -o /dev/null -w "Backend API: %{http_code}\n" http://127.0.0.1:8081/api/health || true

# ----- Reinicia backend para cargar endpoints nuevos (config/Wi-Fi si los añadiste) -----
if ! run_sysctl restart "${BACKEND_SVC_BASENAME}@$APP_USER"; then
  rc=$?
  if [[ $rc -ne 2 ]]; then
    warn "No se pudo reiniciar ${BACKEND_SVC_BASENAME}@$APP_USER"
  fi
fi

echo "[POST] Reinicio ordenado de servicios…"
if ! run_sysctl restart nginx; then
  rc=$?
  if [[ $rc -ne 2 ]]; then
    warn "No se pudo reiniciar nginx (¿instalado?)"
  fi
fi
if ! run_sysctl restart "${BACKEND_SVC_BASENAME}@$APP_USER"; then
  rc=$?
  if [[ $rc -ne 2 ]]; then
    warn "No se pudo reiniciar ${BACKEND_SVC_BASENAME}@$APP_USER"
  fi
fi

# Refrescar el navegador kiosk para limpiar cachés
pkill -f 'chrom(e|ium).*--kiosk' || true

sleep 5
BACKEND_READY=0
HEALTH_STATUS_BODY=""
HEALTH_STATUS_CODE=""
HEALTH_URL="http://127.0.0.1:8081/api/health"
HEALTH_START=$(date +%s)
HEALTH_DELAY=1
while true; do
  RESPONSE="$(curl -sS --max-time 2 -w '\n%{http_code}' "$HEALTH_URL" || true)"
  BODY="${RESPONSE%$'\n'*}"
  CODE="${RESPONSE##*$'\n'}"
  if [[ "$CODE" == "200" ]]; then
    BACKEND_READY=1
    HEALTH_STATUS_BODY="$BODY"
    HEALTH_STATUS_CODE="$CODE"
    echo "[OK] Backend operativo en $HEALTH_URL"
    break
  fi
  NOW=$(date +%s)
  if (( NOW - HEALTH_START >= 10 )); then
    echo "[WARN] Backend no respondió 200 en $HEALTH_URL tras 10s (último código: ${CODE:-N/A})"
    break
  fi
  sleep "$HEALTH_DELAY"
  if (( HEALTH_DELAY < 5 )); then
    HEALTH_DELAY=$((HEALTH_DELAY * 2))
  fi
done

BACKEND_JSON_OK=0
if (( BACKEND_READY )); then
  echo "[POST] Precargando endpoints para UI (efemérides/side-info)…"
  curl -fsS http://127.0.0.1:8081/api/season/month >/dev/null || true
  curl -fsS http://127.0.0.1:8081/api/news/headlines >/dev/null || true
  curl -fsS http://127.0.0.1:8081/api/weather/today >/dev/null || true
  curl -fsS http://127.0.0.1:8081/api/backgrounds/current >/dev/null || true

  RESP_WITH_CODE="$(curl -sS -w '\n%{http_code}' http://127.0.0.1:8081/api/config || true)"
  RESP_CODE="${RESP_WITH_CODE##*$'\n'}"
  RESP_BODY="${RESP_WITH_CODE%$'\n'*}"
  if [[ "$RESP_CODE" == "200" ]]; then
    if command -v jq >/dev/null 2>&1; then
      if echo "$RESP_BODY" | jq . >/dev/null 2>&1; then
        echo "[OK] Configuración backend JSON válida."
        BACKEND_JSON_OK=1
      else
        echo "[WARN] /api/config respondió JSON inválido; se omite validación detallada."
      fi
    else
      echo "[SKIP] jq no disponible; se omite validación JSON."
    fi
  else
    echo "[SKIP] /api/config devolvió ${RESP_CODE:-N/A}; se omite validación JSON."
  fi
else
  echo "[SKIP] Precarga de endpoints (backend no listo)"
  echo "[SKIP] Parseo con jq omitido: backend no listo."
fi

# Ajuste de zona horaria (solo si no está ya configurada)
if ! timedatectl | grep -q "Time zone: ${TZ_DEFAULT}"; then
  log "Configurando zona horaria ${TZ_DEFAULT}..."
  sudo timedatectl set-timezone "${TZ_DEFAULT}"
else
  log "Zona horaria ya configurada: ${TZ_DEFAULT}"
fi

chown dani:dani backend/config/config.json 2>/dev/null || true
chmod 0640 backend/config/config.json 2>/dev/null || true

# ----- Checks finales -----
echo
echo "[POST] Validaciones rápidas:"
HEALTH_BODY="$HEALTH_STATUS_BODY"
if (( BACKEND_READY )); then
  if [[ -z "$HEALTH_BODY" ]]; then
    HEALTH_BODY="$(curl -s "$HEALTH_URL" || true)"
  fi
  if printf '%s' "$HEALTH_BODY" | grep -q "healthy"; then
    echo "  ✅ Backend UP"
  else
    echo "  ❌ Backend responde pero no está healthy (ver logs con: journalctl -u ${BACKEND_SVC_BASENAME}@$APP_USER -n 50)"
  fi
else
  echo "  ⚠️ Backend no verificado (se omitió la comprobación de salud)"
fi

if pgrep -f "chromium.*--kiosk" >/dev/null 2>&1; then
  echo "  ✅ UI Chromium activa"
else
  echo "  ⚠️ UI Chromium no detectada"
fi

if [[ "$ENABLE_LOCAL_MQTT" == "1" ]]; then
  if command -v mosquitto_sub >/dev/null 2>&1; then
    if mosquitto_sub -h 127.0.0.1 -t '$SYS/broker/version' -C 1 -W 2 >/dev/null 2>&1; then
      echo "  ✅ Mosquitto operativo"
    else
      echo "  ⚠️ Mosquitto no responde (loopback)"
    fi
  else
    echo "  ⚠️ mosquitto_sub no disponible para comprobar el broker"
  fi
fi

echo
log "Instalación completada."
log "Si aún no lo has hecho, ejecuta ./scripts/install_post.sh tras iniciar sesión de usuario para activar servicios y validar el backend."
echo "  UI:       http://localhost/"
echo "  Backend:  http://127.0.0.1:8081"
echo "  Config:   $ENV_DIR/config.json ($APP_USER:pantalla 640)"
echo "  Secretos: $ENV_DIR/secrets.json ($APP_USER:pantalla 600)"
echo "  Env:      $ENV_DIR/env ($APP_USER:pantalla 640)"
log "Hora local del sistema: $(date)"
