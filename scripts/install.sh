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
UI_LAUNCHER_SRC="$REPO_DIR/scripts/pantalla-ui-launch.sh"
UI_LAUNCHER_DST="/usr/local/bin/pantalla-ui-launch.sh"

BACKEND_SVC_BASENAME="pantalla-dash-backend"
BACKEND_SVC_TEMPLATE="${BACKEND_SVC_BASENAME}@.service"
BG_SVC="pantalla-bg-generate.service"
BG_TIMER="pantalla-bg-generate.timer"

# ----- Defaults de configuración -----
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
apt-get install -y python3 python3-venv python3-pip nginx curl jq unzip ca-certificates espeak-ng network-manager

log "Asegurando NetworkManager activo…"
systemctl enable --now NetworkManager || true

# --- X stack mínimo y sesión ligera (idempotente) ---
log "Instalando Xorg + Openbox + LightDM + utilidades..."
sudo apt-get update
sudo apt-get install -y xorg openbox lightdm x11-xserver-utils
# Opcional para kiosko puro (ocultar cursor); queda comentado en autostart
sudo apt-get install -y unclutter || true

log "Instalando navegador Chromium para modo kiosko..."
if sudo apt-get install -y chromium-browser; then
  log "Paquete chromium-browser instalado."
elif sudo apt-get install -y chromium; then
  log "Paquete chromium instalado."
else
  warn "No se pudo instalar Chromium automáticamente. Instálalo manualmente para el modo kiosko."
fi

APP_USER="${SUDO_USER:-${USER}}"
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

log "Configurando autologin de LightDM para ${APP_USER} y sesión por defecto openbox..."
sudo mkdir -p /etc/lightdm/lightdm.conf.d

# Autologin
sudo tee /etc/lightdm/lightdm.conf.d/50-autologin.conf >/dev/null <<EOF
[Seat:*]
autologin-user=${APP_USER}
autologin-user-timeout=0
EOF

# Sesión openbox
sudo tee /etc/lightdm/lightdm.conf.d/60-session.conf >/dev/null <<'EOF'
[Seat:*]
user-session=openbox
EOF

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

log "Instalando servicio systemd de usuario ${UI_SERVICE_NAME}…"
UI_USER="${PANTALLA_UI_USER:-$APP_USER}"
if ! id "$UI_USER" >/dev/null 2>&1; then
  die "El usuario $UI_USER no existe; ajusta PANTALLA_UI_USER antes de continuar"
fi

if [[ -f "$SYSTEMD_DIR/$UI_SERVICE_NAME" ]]; then
  warn "  Detectado servicio de sistema legacy; se deshabilita y elimina."
  systemctl disable --now "$UI_SERVICE_NAME" || true
  rm -f "$SYSTEMD_DIR/$UI_SERVICE_NAME"
  systemctl daemon-reload || true
fi

install -D -m 644 "$UI_SERVICE_SRC" "$USER_SYSTEMD_DIR/$UI_SERVICE_NAME"

UI_UID="$(id -u "$UI_USER")"
UI_RUNTIME_DIR="/run/user/$UI_UID"
sudo loginctl enable-linger "$UI_USER" || true

if [[ ! -d "$UI_RUNTIME_DIR" ]]; then
  sudo mkdir -p "$UI_RUNTIME_DIR"
  sudo chown "$UI_USER":"$UI_USER" "$UI_RUNTIME_DIR"
fi

UI_SYSTEMD_ENV=("XDG_RUNTIME_DIR=$UI_RUNTIME_DIR" "DBUS_SESSION_BUS_ADDRESS=unix:path=$UI_RUNTIME_DIR/bus")

sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user daemon-reload || true
sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user enable "$UI_SERVICE_NAME" || true
sudo -u "$UI_USER" env "${UI_SYSTEMD_ENV[@]}" systemctl --user restart "$UI_SERVICE_NAME" || true

sudo chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}/.config/openbox"
sudo chmod +x "${APP_HOME}/.config/openbox/autostart"

log "Habilitando LightDM para iniciar entorno gráfico en el arranque…"
sudo systemctl enable lightdm || true

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
mkdir -p "$ENV_DIR" "$ASSETS_DIR" "$LOG_DIR" /opt/dash/assets
chown -R "$APP_USER:$APP_USER" /opt/dash
chmod 755 /opt/dash /opt/dash/assets
touch "$LOG_DIR/bg.log"
chown "$APP_USER:$APP_USER" "$LOG_DIR/bg.log"
chmod 664 "$LOG_DIR/bg.log"
chgrp pantalla "$ENV_DIR" || true
chmod 750 "$ENV_DIR"
usermod -aG pantalla "$APP_USER" || true

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
chgrp pantalla "$ENV_DIR/env"
chmod 640 "$ENV_DIR/env"
chown "$APP_USER":pantalla "$ENV_DIR/env"

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
  "wifi": { "preferredInterface": "wlan0" },
  "background": { "intervalMinutes": 60, "mode": "daily", "retainDays": 7 },
  "locale": { "country": "ES", "autonomousCommunity": "Comunitat Valenciana", "province": "Castellón", "city": "${CITY_NAME}" }
}
JSON
chown "$APP_USER":pantalla "$ENV_DIR/config.json"
chmod 640 "$ENV_DIR/config.json"

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
chown "$APP_USER":"$APP_USER" "$ENV_DIR/secrets.json"
chmod 600 "$ENV_DIR/secrets.json"

log "Escribiendo $ENV_DIR/backend.env …"
cat > "$ENV_DIR/backend.env" <<EOF
PANTALLA_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
EOF
chown "$APP_USER":pantalla "$ENV_DIR/backend.env"
chmod 640 "$ENV_DIR/backend.env"

log "Preparando backend (venv + deps)…"
cd "$BACKEND_DIR"
sudo -u "$APP_USER" bash -lc "python3 -m venv .venv"
sudo -u "$APP_USER" bash -lc "source .venv/bin/activate && pip install -U pip && pip install fastapi uvicorn httpx pydantic requests python-dateutil Jinja2 openai pillow"

log "Servicio backend templated…"
# Migra posible unidad antigua
if [[ -f "$SYSTEMD_DIR/${BACKEND_SVC_BASENAME}.service" ]]; then
  mv "$SYSTEMD_DIR/${BACKEND_SVC_BASENAME}.service" "$SYSTEMD_DIR/${BACKEND_SVC_TEMPLATE}"
fi
cat > "$SYSTEMD_DIR/${BACKEND_SVC_TEMPLATE}" <<SERVICE
[Unit]
Description=Pantalla Dash Backend (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
User=%i
SupplementaryGroups=pantalla
WorkingDirectory=$BACKEND_DIR
EnvironmentFile=$ENV_DIR/backend.env
Environment="PYTHONUNBUFFERED=1"
ExecStart=/bin/bash -lc 'source .venv/bin/activate && uvicorn app:app --host 127.0.0.1 --port 8081 --workers 2 --timeout-keep-alive 30'
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now "${BACKEND_SVC_BASENAME}@$APP_USER" || true

# --- Hardening generador IA: corrige parámetros del script ---
GEN_SCRIPT="$REPO_DIR/opt/dash/scripts/generate_bg_daily.py"
if [[ -f "$GEN_SCRIPT" ]]; then
  log "Parcheando $GEN_SCRIPT (response_format / size)…"
  sed -i -E 's/,?\s*response_format\s*=\s*["'\''][^"'\'']*["'\'']//g' "$GEN_SCRIPT" || true
  sed -i -E 's/size\s*=\s*["'\''][^"'\'']*["'\'']/size="1536x1024"/g' "$GEN_SCRIPT" || true
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
  sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && jq \".dependencies += {\\\"react-router-dom\\\":\\\"^6\\\"}\" package.json > package.tmp.json && mv package.tmp.json package.json" 2>/dev/null || true
  if sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && npm install"; then
    log "npm install de dependencias obligatorias OK"
  else
    die "Fallo en npm install tras ajustar dependencias obligatorias."
  fi

  if sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && npm run build"; then
    log "Build frontend OK"
  else
    die "Fallo en 'npm run build'"
  fi

  rm -rf /var/www/html/*
  cp -r dist/* /var/www/html/
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
    proxy_pass http://127.0.0.1:8081/;
    proxy_set_header Host $host;
  }

  location /assets/ {
    alias /opt/dash/assets/;
    access_log off;
    expires 7d;
  }

  location = /healthz {
    default_type text/plain;
    return 200 'ok';
  }
}
NGINX
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/pantalla
rm -f /etc/nginx/sites-enabled/default || true
nginx -t && systemctl restart nginx

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
Description=Timer fondos IA
[Timer]
OnBootSec=30s
OnCalendar=*-*-* 07:00:00
OnCalendar=*-*-* 12:00:00
OnCalendar=*-*-* 19:00:00
Persistent=true
AccuracySec=1min
RandomizedDelaySec=120
Unit=pantalla-bg-generate.service
[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now "$BG_TIMER"

# ----- Reinicia backend para cargar endpoints nuevos (config/Wi-Fi si los añadiste) -----
systemctl restart "${BACKEND_SVC_BASENAME}@$APP_USER" || true

# ----- Checks finales -----
echo
log "Checks finales:"
set +e
curl -fsS http://127.0.0.1:8081/api/health >/dev/null && echo "  ✅ Backend UP" || echo "  ❌ Backend DOWN (journalctl -u ${BACKEND_SVC_BASENAME}@$APP_USER -n 100)"
curl -sI http://127.0.0.1/ | head -n1 | grep -q " 200 " && echo "  ✅ Nginx sirve SPA" || echo "  ❌ Nginx NOK"
nmcli -t -f DEVICE device status >/dev/null && echo "  ✅ nmcli OK" || echo "  ❌ nmcli reportó error"
set -e

# genera primer fondo si hay clave
if grep -qE '^OPENAI_API_KEY=.+$' "$ENV_DIR/env"; then
  log "Generando primer fondo IA…"
  systemctl start "$BG_SVC" || true
  sleep 2
  if ls -1 "$ASSETS_DIR"/*.webp >/dev/null 2>&1; then
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
